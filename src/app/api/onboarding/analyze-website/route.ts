// src/app/api/onboarding/analyze-website/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Minimal HTML -> text extractor (no deps).
 * Good enough for onboarding classification.
 */
function htmlToText(html: string) {
  // remove scripts/styles/noscript
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  // strip tags
  s = s.replace(/<\/?[^>]+>/g, " ");

  // decode a few common entities
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // normalize whitespace
  s = s.replace(/\s+/g, " ").trim();

  // cap to keep tokens reasonable
  if (s.length > 12000) s = s.slice(0, 12000);
  return s;
}

function normalizeUrl(raw: string) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

const OnboardingOutSchema = z.object({
  fit: z.union([z.boolean(), z.literal("unknown")]).default("unknown"),
  confidenceScore: z.number().min(0).max(1).default(0.5),
  suggestedIndustryKey: z.string().min(1).default("general"),
  detectedServices: z.array(z.string()).default([]),
  billingSignals: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

const ONBOARDING_SYSTEM_PROMPT = `
You are an onboarding classifier for a photo-based quoting SaaS (AI Photo Quote).

Return ONLY valid JSON (no markdown, no commentary).
Classify a service business from its website text.

Output JSON keys:
- fit: true | false | "unknown"  (whether the business seems like a good fit for photo-based estimating)
- confidenceScore: number from 0.0 to 1.0
- suggestedIndustryKey: short key like "marine" | "auto" | "rv" | "furniture" | "general"
- detectedServices: string[]
- billingSignals: string[] (e.g. "estimate-based", "flat-rate", "hourly", "insurance", "commercial")
- notes: short explanation for internal onboarding
`.trim();

export async function POST() {
  try {
    const a = await auth();
    const clerkUserId = a.userId;
    if (!clerkUserId) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

    // Pull onboarding model from PCC LLM config (falls back to defaults if config missing)
    const cfg = await loadPlatformLlmConfig();
    const onboardingModel =
      String((cfg as any)?.models?.onboardingModel ?? "").trim() ||
      String((cfg as any)?.models?.estimatorModel ?? "").trim() ||
      "gpt-4o-mini";

    // ✅ Prod schema: tenant_members.clerk_user_id (text), no user_id column.
    const rTenant = await db.execute(sql`
      select tm.tenant_id
      from tenant_members tm
      where tm.clerk_user_id = ${clerkUserId}
      order by tm.created_at asc
      limit 1
    `);

    const rowT: any = (rTenant as any)?.rows?.[0] ?? null;
    const tenantId = rowT?.tenant_id ? String(rowT.tenant_id) : null;
    if (!tenantId) return NextResponse.json({ ok: false, error: "NO_TENANT" }, { status: 400 });

    const r = await db.execute(sql`
      select website
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? null;
    const websiteRaw = String(row?.website ?? "").trim();
    const website = normalizeUrl(websiteRaw);

    if (!website) {
      // No website: persist a deterministic “unknown” result
      const out = {
        fit: "unknown" as const,
        confidenceScore: 0.52,
        suggestedIndustryKey: "general",
        detectedServices: [],
        billingSignals: [],
        notes: "No website provided; we’ll confirm industry via questions next.",
        analyzedAt: new Date().toISOString(),
        source: "no_website",
        modelUsed: onboardingModel,
      };

      await db.execute(sql`
        insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
        values (${tenantId}::uuid, ${JSON.stringify(out)}::jsonb, 2, false, now(), now())
        on conflict (tenant_id) do update
        set ai_analysis = excluded.ai_analysis,
            current_step = greatest(tenant_onboarding.current_step, 2),
            updated_at = now()
      `);

      return NextResponse.json({ ok: true, tenantId, aiAnalysis: out }, { status: 200 });
    }

    // --- Fetch website HTML (basic, safe) ---
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    let html = "";
    try {
      const res = await fetch(website, {
        method: "GET",
        redirect: "follow",
        headers: {
          "user-agent": "aiphotoquote-onboarding/1.0",
          accept: "text/html,application/xhtml+xml",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      html = await res.text();
    } finally {
      clearTimeout(timeout);
    }

    const siteText = htmlToText(html);
    const extra = String((cfg as any)?.prompts?.extraSystemPreamble ?? "").trim();
    const system = [extra, ONBOARDING_SYSTEM_PROMPT].filter(Boolean).join("\n\n");

    // --- OpenAI call governed by PCC onboardingModel ---
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: onboardingModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_tokens: 900,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify(
            {
              website,
              extractedText: siteText,
            },
            null,
            2
          ),
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const validated = OnboardingOutSchema.parse(parsed);

    const out = {
      ...validated,
      analyzedAt: new Date().toISOString(),
      source: "openai_v1",
      modelUsed: onboardingModel,
    };

    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${JSON.stringify(out)}::jsonb, 2, false, now(), now())
      on conflict (tenant_id) do update
      set ai_analysis = excluded.ai_analysis,
          current_step = greatest(tenant_onboarding.current_step, 2),
          updated_at = now()
    `);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis: out }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const isAbort = /aborted|abort/i.test(msg);

    return NextResponse.json(
      { ok: false, error: isAbort ? "FETCH_TIMEOUT" : "INTERNAL", message: msg },
      { status: isAbort ? 504 : 500 }
    );
  }
}