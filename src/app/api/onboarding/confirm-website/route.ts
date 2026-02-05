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

const ConfirmReq = z.object({
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
    "You must refine your understanding based on user confirmation/correction.",
    "",
    "Rules:",
    "- If answer=yes: increase confidence unless prior was already high; tighten businessGuess.",
    "- If answer=no: incorporate feedback and adjust businessGuess/services/industry; ask better questions.",
    "- Output MUST be valid JSON only.",
    "- confidenceScore is 0..1 and needsConfirmation should be true when confidenceScore < 0.8.",
  ].join("\n");
}

function buildUserPrompt(args: {
  website: string | null;
  prior: any | null;
  answer: "yes" | "no";
  feedback?: string;
  extractedTextPreview?: string;
}) {
  const { website, prior, answer, feedback, extractedTextPreview } = args;

  return [
    `WEBSITE_URL: ${website || "(unknown)"}`,
    "",
    `PRIOR_ANALYSIS_JSON:\n${JSON.stringify(prior ?? null, null, 2)}\n`,
    `USER_CONFIRMATION:\n${JSON.stringify({ answer, feedback: feedback || null }, null, 2)}\n`,
    `TEXT_PREVIEW:\n${String(extractedTextPreview ?? "").trim() || "(none)"}\n`,
    "",
    "TASK:",
    "- Refine businessGuess to be accurate and specific.",
    "- Update suggestedIndustryKey and detectedServices if needed.",
    "- Provide questions that would reduce uncertainty.",
    "- Output ONLY JSON.",
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

    const bodyRaw = await req.json().catch(() => null);
    const body = ConfirmReq.parse(bodyRaw);

    const tenantId = safeTrim(body.tenantId);
    await requireMembership(clerkUserId, tenantId);

    const r = await db.execute(sql`
      select website, ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? null;
    const website = String(row?.website ?? "").trim() || null;
    const prior = row?.ai_analysis ?? null;
    const extractedTextPreview = prior?.extractedTextPreview ?? "";

    if (!prior) {
      return NextResponse.json(
        { ok: false, error: "NO_PRIOR_ANALYSIS", message: "Run website analysis first." },
        { status: 400 }
      );
    }

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
            website,
            prior,
            answer: body.answer,
            feedback: safeTrim(body.feedback) || undefined,
            extractedTextPreview,
          }),
        },
      ],
    });

    const content = resp.choices?.[0]?.message?.content ?? "";
    const parsed = AnalysisSchema.safeParse(JSON.parse(content));

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "BAD_MODEL_OUTPUT", message: "Model output did not match schema." },
        { status: 500 }
      );
    }

    const updated = {
      ...prior,
      ...parsed.data,
      analyzedAt: new Date().toISOString(),
      source: "llm_v1_confirm",
      modelUsed: model,
      lastConfirmation: {
        answer: body.answer,
        feedback: safeTrim(body.feedback) || null,
        at: new Date().toISOString(),
      },
    };

    await db.execute(sql`
      update tenant_onboarding
      set ai_analysis = ${JSON.stringify(updated)}::jsonb,
          updated_at = now()
      where tenant_id = ${tenantId}::uuid
    `);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis: updated }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}