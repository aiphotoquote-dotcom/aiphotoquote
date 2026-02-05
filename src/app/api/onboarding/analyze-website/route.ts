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

/* --------------------- utils --------------------- */

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray((r as any)?.rows)) return (r as any).rows[0] ?? null;
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

function normalizeUrl(raw: string) {
  const s = safeTrim(raw);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* --------------------- schema --------------------- */

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

/* --------------------- prompts --------------------- */

function buildSystemPrompt() {
  return `
You are onboarding intelligence for AIPhotoQuote.

You are allowed to browse and read websites using built-in web tools.

Rules:
- Read the business website directly.
- If the site is sparse or unclear, infer cautiously.
- Be specific about what the business services (boats, cars, homes, etc).
- Output MUST be valid JSON matching the requested schema.
- confidenceScore must reflect certainty (0–1).
- needsConfirmation must be true if confidenceScore < 0.8.
`.trim();
}

function buildUserPrompt(url: string) {
  return `
Analyze this business website and summarize what the company does:

WEBSITE_URL:
${url}

TASK:
1) Write businessGuess (2–5 sentences).
2) Decide fit: good / maybe / poor for photo-based quoting.
3) Explain fitReason.
4) Pick suggestedIndustryKey (snake/kebab-case).
5) Provide 3–6 confirmation questions.
6) List detectedServices and billingSignals.
7) Provide confidenceScore (0–1) and needsConfirmation.

Return ONLY valid JSON.
`.trim();
}

/* --------------------- handler --------------------- */

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });
    }

    await requireMembership(clerkUserId, tenantId);

    const r = await db.execute(sql`
      select website
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row = firstRow(r);
    const websiteRaw = String(row?.website ?? "").trim();
    const website = normalizeUrl(websiteRaw);

    if (!website) {
      return NextResponse.json(
        { ok: false, error: "NO_WEBSITE", message: "No website on file." },
        { status: 400 }
      );
    }

    const cfg = await loadPlatformLlmConfig();
    const model =
      String(cfg?.models?.onboardingModel ?? "").trim() ||
      "gpt-4.1";

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("MISSING_OPENAI_API_KEY");

    const client = new OpenAI({ apiKey });

    const response = await client.responses.create({
      model,
      tools: [{ type: "web_search" }],
      temperature: 0.2,
      response_format: { type: "json_object" },
      input: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(website) },
      ],
    });

    const text = response.output_text ?? "";
    const json = safeJsonParse(text);
    const parsed = json ? AnalysisSchema.safeParse(json) : null;

    if (!parsed?.success) {
      return NextResponse.json(
        {
          ok: true,
          tenantId,
          aiAnalysis: {
            businessGuess:
              "We attempted to analyze your website, but the response was unclear. Please confirm what services you provide.",
            fit: "maybe",
            fitReason: "Website content could not be confidently classified.",
            suggestedIndustryKey: "service",
            questions: [
              "What do you primarily work on?",
              "What are your top services?",
              "Do customers usually send photos?",
            ],
            confidenceScore: 0.25,
            needsConfirmation: true,
            detectedServices: [],
            billingSignals: [],
            source: "web_tools_parse_fail",
            website,
          },
        },
        { status: 200 }
      );
    }

    const analysis = {
      ...parsed.data,
      analyzedAt: new Date().toISOString(),
      source: "openai_web_tools",
      website,
    };

    await db.execute(sql`
      update tenant_onboarding
      set ai_analysis = ${JSON.stringify(analysis)}::jsonb,
          current_step = greatest(current_step, 2),
          updated_at = now()
      where tenant_id = ${tenantId}::uuid
    `);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis: analysis }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status =
      msg === "UNAUTHENTICATED" ? 401 :
      msg === "FORBIDDEN_TENANT" ? 403 : 500;

    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}