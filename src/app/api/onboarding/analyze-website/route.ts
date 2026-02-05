import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------- utils ---------------- */

function safeTrim(v: unknown) {
  return String(v ?? "").trim();
}

function normalizeUrl(raw: string) {
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) return `https://${raw}`;
  return raw;
}

function firstRow(r: any) {
  if (Array.isArray(r)) return r[0] ?? null;
  if (r && typeof r === "object" && 0 in r) return r[0];
  return null;
}

/* ---------------- schema ---------------- */

const AnalysisSchema = z.object({
  businessGuess: z.string(),
  fit: z.enum(["good", "maybe", "poor"]),
  fitReason: z.string(),
  suggestedIndustryKey: z.string(),
  questions: z.array(z.string()).min(1).max(6),
  confidenceScore: z.number().min(0).max(1),
  needsConfirmation: z.boolean(),
  detectedServices: z.array(z.string()),
  billingSignals: z.array(z.string()),
});

/* ---------------- prompts ---------------- */

function websiteIntelPrompt(url: string) {
  return `
Visit the website below and summarize the business factually.

Website:
${url}

Return a clear paragraph describing:
- What the business does
- What they service (boats, cars, homes, etc.)
- Core services offered
- Any constraints (size limits, location, specialty)

Do NOT return JSON.
`.trim();
}

function normalizePrompt(rawText: string) {
  return `
You are onboarding intelligence for AIPhotoQuote.

Convert the following website intelligence into structured JSON.

WEBSITE_INTELLIGENCE:
${rawText}

Return JSON with:
- businessGuess (2–5 sentences)
- fit: good | maybe | poor (photo-based quoting)
- fitReason
- suggestedIndustryKey
- questions (3–6)
- detectedServices
- billingSignals
- confidenceScore (0–1)
- needsConfirmation (true if confidence < 0.8)

Return ONLY valid JSON.
`.trim();
}

/* ---------------- handler ---------------- */

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("UNAUTHENTICATED");

    const body = await req.json();
    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) throw new Error("TENANT_ID_REQUIRED");

    const r = await db.execute(sql`
      select website
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row = firstRow(r);
    const website = normalizeUrl(safeTrim(row?.website));
    if (!website) throw new Error("NO_WEBSITE");

    const cfg = await loadPlatformLlmConfig();
    const model =
      cfg?.models?.onboardingModel ||
      cfg?.models?.estimatorModel ||
      "gpt-4.1";

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    /* ---------- PASS 1: web browsing ---------- */

    const intelResp = await client.responses.create({
      model,
      tools: [{ type: "web_search" }],
      temperature: 0.2,
      input: websiteIntelPrompt(website),
    });

    const rawIntel = String(intelResp.output_text ?? "").trim();
    if (!rawIntel) throw new Error("EMPTY_WEB_RESULT");

    /* ---------- PASS 2: JSON normalization ---------- */

    const normalizedResp = await client.responses.create({
      model,
      temperature: 0.2,
      text: { format: { type: "json_object" } },
      input: normalizePrompt(rawIntel),
    });

    const jsonText = String(normalizedResp.output_text ?? "");
    const parsed = AnalysisSchema.safeParse(JSON.parse(jsonText));

    if (!parsed.success) throw new Error("JSON_PARSE_FAILED");

    const analysis = {
      ...parsed.data,
      website,
      source: "web_tools_two_pass",
      analyzedAt: new Date().toISOString(),
      meta: {
        status: "complete",
        lastAction: "AI analysis complete.",
      },
    };

    await db.execute(sql`
      update tenant_onboarding
      set ai_analysis = ${JSON.stringify(analysis)}::jsonb,
          current_step = greatest(current_step, 2),
          updated_at = now()
      where tenant_id = ${tenantId}::uuid
    `);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis: analysis });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e.message },
      { status: 500 }
    );
  }
}