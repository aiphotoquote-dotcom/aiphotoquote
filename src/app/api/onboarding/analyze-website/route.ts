// src/app/api/onboarding/analyze-website/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  // Basic + fast: remove script/style, tags, collapse whitespace.
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
    // Keep a reasonable budget for the model
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

const AnalysisSchema = z.object({
  // Explain back to user what we think they do
  businessGuess: z.string().min(1),

  // Whether AIPhotoQuote is a good fit and why
  fit: z.enum(["good", "maybe", "poor"]),
  fitReason: z.string().min(1),

  // Industry categorization guess
  suggestedIndustryKey: z.string().min(1),

  // Short, human, actionable questions to confirm
  questions: z.array(z.string()).min(1).max(6),

  // Confidence 0..1 (we show as %)
  confidenceScore: z.number().min(0).max(1),

  // If low confidence, we keep asking
  needsConfirmation: z.boolean(),

  detectedServices: z.array(z.string()).default([]),
  billingSignals: z.array(z.string()).default([]),
});

function buildSystemPrompt() {
  return [
    "You are onboarding intelligence for AIPhotoQuote.",
    "Your job: read a business website text and produce an explain-back summary and fit assessment.",
    "",
    "Rules:",
    "- Be specific about what the business does (what they service + top services).",
    "- If uncertain, say so and ask clarifying questions.",
    "- Keep it customer-friendly and non-salesy.",
    "- Output MUST be valid JSON matching the schema requested.",
    "- confidenceScore is 0..1 and should reflect how certain you are.",
    "- needsConfirmation should be true when confidenceScore < 0.8.",
  ].join("\n");
}

function buildUserPrompt(args: {
  url: string;
  extractedText: string;
  prior?: any | null;
  correction?: { answer: "yes" | "no"; feedback?: string } | null;
}) {
  const { url, extractedText, prior, correction } = args;

  const priorBlock = prior
    ? `PRIOR_ANALYSIS_JSON:\n${JSON.stringify(prior, null, 2)}\n`
    : `PRIOR_ANALYSIS_JSON:\n(null)\n`;

  const correctionBlock = correction
    ? `USER_CONFIRMATION:\n${JSON.stringify(correction, null, 2)}\n`
    : `USER_CONFIRMATION:\n(null)\n`;

  return [
    `WEBSITE_URL: ${url}`,
    "",
    priorBlock,
    correctionBlock,
    "WEBSITE_TEXT (clipped):",
    extractedText || "(no text extracted)",
    "",
    "TASK:",
    "1) Write businessGuess: 2-5 sentences describing what the business likely does (what they service + top services).",
    "2) Decide fit: good/maybe/poor for using photo-based quoting.",
    "3) Provide fitReason: 1-3 sentences.",
    "4) Pick suggestedIndustryKey (short snake-case or kebab-case; examples: marine, auto, upholstery, auto-restyling, boat-paint, general-contractor).",
    "5) Provide 3-6 short questions to confirm.",
    "6) Provide detectedServices and billingSignals (best-effort).",
    "7) Provide confidenceScore 0..1 and needsConfirmation boolean.",
    "",
    "Output ONLY JSON.",
  ].join("\n");
}

function pickModelFromPcc(cfg: any) {
  const m =
    String(cfg?.models?.onboardingModel ?? "").trim() ||
    String(cfg?.models?.estimatorModel ?? "").trim() ||
    "gpt-4o-mini";
  return m;
}

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });

    await requireMembership(clerkUserId, tenantId);

    // Read website from onboarding table
    const r = await db.execute(sql`
      select website, ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? null;
    const websiteRaw = String(row?.website ?? "").trim();
    const website = normalizeUrl(websiteRaw);

    // Extract text (or empty)
    const extracted = website ? await fetchWebsiteText(website) : null;
    const extractedText = extracted?.extractedText ?? "";
    const extractedTextPreview = extracted?.extractedTextPreview ?? "";

    const priorAnalysis = row?.ai_analysis ?? null;

    // PCC model selection (we’ll port prompts later)
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
            correction: null,
          }),
        },
      ],
    });

    const content = resp.choices?.[0]?.message?.content ?? "";
    const parsed = AnalysisSchema.safeParse(JSON.parse(content));

    if (!parsed.success) {
      // store something helpful for debugging
      const fallback = {
        businessGuess: "We couldn’t parse the analysis result. Please retry.",
        fit: "maybe",
        fitReason: "Model output was not valid for our schema.",
        suggestedIndustryKey: "service",
        questions: [
          "What do you work on most (cars/trucks/boats/other)?",
          "What are your top 3 services?",
          "Do you mostly do upgrades, repairs, or both?",
        ],
        confidenceScore: 0.3,
        needsConfirmation: true,
        detectedServices: [],
        billingSignals: [],
        analyzedAt: new Date().toISOString(),
        source: "llm_v1_parse_fail",
        modelUsed: model,
        extractedTextPreview,
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
      source: "llm_v1",
      modelUsed: model,
      extractedTextPreview,
      website: website || null,
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