// src/app/api/onboarding/confirm-website/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------- utils ------------------------- */

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray(r.rows)) return r.rows[0] ?? null;
  return null;
}

async function requireAuthed(): Promise<{ clerkUserId: string }> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return { clerkUserId: userId };
}

async function requireMembership(clerkUserId: string, tenantId: string): Promise<void> {
  const r = await db.execute(sql`
    select 1 as ok
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${clerkUserId}
    limit 1
  `);
  const row = firstRow(r);
  if (!row?.ok) throw new Error("FORBIDDEN_TENANT");
}

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  if (t.length <= max) return t;
  return t.slice(0, max);
}

function normalizeUrl(raw: string) {
  const s = safeTrim(raw);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function stripHtmlToText(html: string) {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const noTags = withoutScripts.replace(/<[^>]+>/g, " ");
  const decoded = noTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return decoded.replace(/\s+/g, " ").trim();
}

async function fetchWebsiteText(url: string) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "AIPhotoQuoteBot/1.0 (+https://aiphotoquote.com)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    const ct = String(res.headers.get("content-type") ?? "");
    const isHtml = ct.includes("text/html") || ct.includes("application/xhtml+xml");

    const raw = await res.text().catch(() => "");
    const text = isHtml ? stripHtmlToText(raw) : raw;
    const clipped = clamp(text, 12_000);

    return {
      ok: res.ok,
      status: res.status,
      contentType: ct,
      extractedText: clipped,
      extractedTextPreview: clamp(clipped, 900),
    };
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------- schema ------------------------- */

const ConfirmSchema = z.object({
  tenantId: z.string().min(1),
  answer: z.enum(["yes", "no"]),
  feedback: z.string().optional(),
});

const AnalysisSchema = z.object({
  businessGuess: z.string().min(1),
  fit: z.enum(["good", "maybe", "poor"]),
  fitReason: z.string().min(1),
  suggestedIndustryKey: z.string().min(1),
  questions: z.array(z.string()).min(1).max(6),
  confidenceScore: z.number().min(0).max(1),
  needsConfirmation: z.boolean(),
  detectedServices: z.array(z.string()).default([]),
  billingSignals: z.array(z.string()).default([]),
});

function buildSystemPrompt() {
  return [
    "You are onboarding intelligence for AIPhotoQuote.",
    "Your job: refine the business understanding using prior analysis + the user’s confirmation/correction.",
    "",
    "Rules:",
    "- Use the user’s correction as ground truth.",
    "- Keep it customer-friendly and non-salesy.",
    "- Output MUST be valid JSON matching the schema requested.",
    "- confidenceScore is 0..1 and should reflect how certain you are now.",
    "- needsConfirmation should be true when confidenceScore < 0.8.",
  ].join("\n");
}

function buildUserPrompt(args: {
  url: string;
  extractedText: string;
  prior: any | null;
  correction: { answer: "yes" | "no"; feedback?: string | null };
}) {
  const { url, extractedText, prior, correction } = args;

  return [
    `WEBSITE_URL: ${url}`,
    "",
    `PRIOR_ANALYSIS_JSON:\n${JSON.stringify(prior ?? null, null, 2)}\n`,
    `USER_CONFIRMATION:\n${JSON.stringify(correction, null, 2)}\n`,
    "WEBSITE_TEXT (clipped):",
    extractedText || "(no text extracted)",
    "",
    "TASK:",
    "You previously produced an analysis. The user has now confirmed or corrected it.",
    "",
    "1) If answer=yes: keep the same general description but tighten it and increase confidence (unless prior was clearly weak).",
    "2) If answer=no: treat feedback as the true description. Rewrite businessGuess accordingly and update services/industry.",
    "3) Always output 3-6 concise questions that would increase confidence further (unless already high).",
    "4) Decide fit: good/maybe/poor for photo-based quoting and provide fitReason.",
    "5) Pick suggestedIndustryKey (short kebab-case or snake-case).",
    "6) Provide detectedServices and billingSignals (best-effort).",
    "7) Provide confidenceScore 0..1 and needsConfirmation boolean.",
    "",
    "Output ONLY JSON.",
  ].join("\n");
}

function pickModelFromPcc(cfg: any) {
  return (
    String(cfg?.models?.onboardingModel ?? "").trim() ||
    String(cfg?.models?.estimatorModel ?? "").trim() ||
    "gpt-4o-mini"
  );
}

/* ------------------------- route ------------------------- */

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    const parsedBody = ConfirmSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: parsedBody.error.message },
        { status: 400 }
      );
    }

    const { tenantId: tenantIdRaw, answer, feedback } = parsedBody.data;
    const tenantId = safeTrim(tenantIdRaw);

    await requireMembership(clerkUserId, tenantId);

    // Load onboarding row
    const r = await db.execute(sql`
      select website, ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? null;
    const priorAnalysis = row?.ai_analysis ?? null;

    // Website is optional; but if present we'll re-extract (cheap and keeps context fresh)
    const websiteRaw = String(row?.website ?? "").trim();
    const website = normalizeUrl(websiteRaw);

    const extracted = website ? await fetchWebsiteText(website) : null;
    const extractedText = extracted?.extractedText ?? "";
    const extractedTextPreview = extracted?.extractedTextPreview ?? "";

    // Model selection from PCC
    const cfg = await loadPlatformLlmConfig();
    const model = pickModelFromPcc(cfg);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("MISSING_OPENAI_API_KEY");

    const client = new OpenAI({ apiKey });

    const resp = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: buildUserPrompt({
            url: website || "(none provided)",
            extractedText,
            prior: priorAnalysis,
            correction: { answer, feedback: feedback?.trim() || null },
          }),
        },
      ],
    });

    const content = resp.choices?.[0]?.message?.content ?? "";
    let data: unknown;

    try {
      data = JSON.parse(content);
    } catch {
      data = null;
    }

    const parsed = AnalysisSchema.safeParse(data);

    // If parsing fails, store a helpful fallback but keep the loop alive
    if (!parsed.success) {
      const fallback = {
        businessGuess:
          answer === "yes"
            ? "Thanks — we’ll proceed using our current understanding."
            : "Thanks — we’ll use your correction. Please add a bit more detail about what you service + top services.",
        fit: "maybe",
        fitReason: "We need a bit more detail to finalize fit and categorization.",
        suggestedIndustryKey: "service",
        questions:
          answer === "yes"
            ? [
                "What do you work on most (cars/trucks/boats/other)?",
                "What are your top 3 services?",
                "Do you mostly do upgrades, repairs, or both?",
              ]
            : [
                "What do you work on most (cars/trucks/boats/other)?",
                "List your top 3 services (short list).",
                "Anything you do NOT do (to avoid misclassification)?",
              ],
        confidenceScore: 0.4,
        needsConfirmation: true,
        detectedServices: [],
        billingSignals: [],
        analyzedAt: new Date().toISOString(),
        source: "llm_v1_confirm_parse_fail",
        modelUsed: model,
        extractedTextPreview,
        website: website || null,
        lastConfirmation: { answer, feedback: feedback?.trim() || null },
      };

      await db.execute(sql`
        insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
        values (${tenantId}::uuid, ${JSON.stringify(fallback)}::jsonb, 2, false, now(), now())
        on conflict (tenant_id) do update
        set ai_analysis = excluded.ai_analysis,
            current_step = greatest(tenant_onboarding.current_step, 2),
            updated_at = now()
      `);

      return NextResponse.json({ ok: true, tenantId, aiAnalysis: fallback }, { status: 200 });
    }

    const analysis = {
      ...parsed.data,
      analyzedAt: new Date().toISOString(),
      source: "llm_v1_confirm",
      modelUsed: model,
      extractedTextPreview,
      website: website || null,
      lastConfirmation: { answer, feedback: feedback?.trim() || null },
    };

    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${JSON.stringify(analysis)}::jsonb, 2, false, now(), now())
      on conflict (tenant_id) do update
      set ai_analysis = excluded.ai_analysis,
          current_step = greatest(tenant_onboarding.current_step, 2),
          updated_at = now()
    `);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis: analysis }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}