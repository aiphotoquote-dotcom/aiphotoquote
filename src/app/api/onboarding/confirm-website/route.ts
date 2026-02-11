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

/* --------------------- utils --------------------- */

function safeTrim(v: unknown) {
  return String(v ?? "").trim();
}

function normalizeUrl(raw: string) {
  const s = safeTrim(raw);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

// Drizzle RowList can be array-like; avoid `.rows`
function firstRow(r: any): any | null {
  try {
    if (!r) return null;
    if (Array.isArray(r)) return r[0] ?? null;
    if (typeof r === "object" && r !== null && 0 in r) return (r as any)[0] ?? null;
    return null;
  } catch {
    return null;
  }
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

function safeJsonParseObject(txt: string): any | null {
  const s = safeTrim(txt);
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    if (!v || typeof v !== "object") return null;
    return v;
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

const BodySchema = z.object({
  tenantId: z.string().min(1),
  answer: z.enum(["yes", "no"]),
  feedback: z.string().optional(),
});

/* --------------------- prompts --------------------- */

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

If the site is unclear, infer cautiously and say what’s uncertain.

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

function normalizeWithUserFeedbackPrompt(rawText: string, feedback: string) {
  return `
You are onboarding intelligence for AIPhotoQuote.

You have website intelligence AND the user says your prior understanding was incorrect.
The USER_FEEDBACK is the highest priority signal.

WEBSITE_INTELLIGENCE:
${rawText}

USER_FEEDBACK (highest priority):
${feedback}

TASK:
Update the structured classification to match the user's feedback, using the site text only as secondary support.

Return JSON with:
- businessGuess (2–5 sentences)
- fit: good | maybe | poor
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

/* --------------------- handler --------------------- */

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const bodyRaw = await req.json().catch(() => null);
    const bodyParsed = BodySchema.safeParse(bodyRaw);
    if (!bodyParsed.success) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "Invalid request body." }, { status: 400 });
    }

    const tenantId = safeTrim(bodyParsed.data.tenantId);
    const answer = bodyParsed.data.answer;
    const feedback = safeTrim(bodyParsed.data.feedback);

    await requireMembership(clerkUserId, tenantId);

    const r = await db.execute(sql`
      select website, ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row = firstRow(r);
    const website = normalizeUrl(String(row?.website ?? ""));
    const priorAnalysis = row?.ai_analysis ?? null;

    if (!priorAnalysis) {
      return NextResponse.json(
        { ok: false, error: "NO_ANALYSIS", message: "No analysis exists yet. Run website analysis first." },
        { status: 400 }
      );
    }

    const priorMeta = priorAnalysis?.meta && typeof priorAnalysis.meta === "object" ? priorAnalysis.meta : {};
    const prevRound = Number(priorMeta?.round ?? 0) || 0;
    const nextRound = prevRound + 1;

    // ✅ YES = lock it in
    if (answer === "yes") {
      const bumpedConfidence = Math.max(Number(priorAnalysis?.confidenceScore ?? 0) || 0, 0.9);

      const updated = {
        ...priorAnalysis,
        confidenceScore: bumpedConfidence,
        needsConfirmation: false,
        meta: {
          ...priorMeta,
          status: "complete",
          round: nextRound,
          lastAction: "User confirmed website analysis.",
          userCorrection: null,
          updatedAt: new Date().toISOString(),
        },
      };

      await db.execute(sql`
        update tenant_onboarding
        set ai_analysis = ${JSON.stringify(updated)}::jsonb,
            current_step = greatest(current_step, 2),
            updated_at = now()
        where tenant_id = ${tenantId}::uuid
      `);

      return NextResponse.json({ ok: true, tenantId, aiAnalysis: updated }, { status: 200 });
    }

    // ✅ NO = re-run using web tools + user feedback
    if (!website) {
      return NextResponse.json({ ok: false, error: "NO_WEBSITE", message: "No website on file." }, { status: 400 });
    }

    // mark running so UI shows real progress
    const running = {
      ...priorAnalysis,
      meta: {
        ...priorMeta,
        status: "running",
        round: nextRound,
        lastAction: "Re-checking website with your feedback…",
        userCorrection: { answer: "no", feedback: feedback || null },
        startedAt: new Date().toISOString(),
      },
    };

    await db.execute(sql`
      update tenant_onboarding
      set ai_analysis = ${JSON.stringify(running)}::jsonb,
          updated_at = now()
      where tenant_id = ${tenantId}::uuid
    `);

    const cfg = await loadPlatformLlmConfig();
    const model =
      (cfg as any)?.models?.onboardingModel ||
      (cfg as any)?.models?.estimatorModel ||
      "gpt-4.1";

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("MISSING_OPENAI_API_KEY");

    const client = new OpenAI({ apiKey });

    // PASS 1 (web)
    const intelResp = await client.responses.create({
      model,
      tools: [{ type: "web_search" }],
      temperature: 0.2,
      input: websiteIntelPrompt(website),
    });

    const rawIntel = String(intelResp.output_text ?? "").trim();
    if (!rawIntel) throw new Error("EMPTY_WEB_RESULT");

    // PASS 2 (json)
    const normalizedResp = await client.responses.create({
      model,
      temperature: 0.2,
      text: { format: { type: "json_object" } },
      input: feedback ? normalizeWithUserFeedbackPrompt(rawIntel, feedback) : normalizePrompt(rawIntel),
    });

    const jsonText = String(normalizedResp.output_text ?? "");
    const obj = safeJsonParseObject(jsonText);
    const parsed = obj ? AnalysisSchema.safeParse(obj) : null;

    // ✅ IMPORTANT: if rerun output is invalid, DO NOT overwrite the last-good suggestion with "service".
    // Preserve priorAnalysis and just mark that we need a guided interview to correct it.
    if (!parsed || !parsed.success) {
      const preserved = {
        ...priorAnalysis,
        // steer the UI back to “needs confirmation / interview”
        needsConfirmation: true,
        confidenceScore: Math.min(0.5, Math.max(0, Number(priorAnalysis?.confidenceScore ?? 0) || 0)),
        // overwrite questions to be maximally useful for correction
        questions: [
          "In one sentence, what do you do?",
          "What do you work on most (homes/cars/boats/commercial/other)?",
          "What are your top 3 services?",
          "Do customers typically send photos before you quote?",
        ].slice(0, 6),
        source: "web_tools_two_pass_parse_fail_preserved_prior",
        website,
        analyzedAt: new Date().toISOString(),
        meta: {
          ...priorMeta,
          status: "complete",
          round: nextRound,
          lastAction: "User corrected; rerun completed but output was invalid.",
          userCorrection: { answer: "no", feedback: feedback || null },
          // capture a hint for debugging without breaking UI
          error: "RERUN_OUTPUT_INVALID",
          finishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      await db.execute(sql`
        update tenant_onboarding
        set ai_analysis = ${JSON.stringify(preserved)}::jsonb,
            current_step = greatest(current_step, 2),
            updated_at = now()
        where tenant_id = ${tenantId}::uuid
      `);

      return NextResponse.json({ ok: true, tenantId, aiAnalysis: preserved }, { status: 200 });
    }

    const nextAnalysis = {
      ...parsed.data,
      source: "web_tools_two_pass_confirm_loop",
      website,
      analyzedAt: new Date().toISOString(),
      meta: {
        ...priorMeta,
        status: "complete",
        round: nextRound,
        lastAction: "User corrected; AI re-analyzed with feedback.",
        userCorrection: { answer: "no", feedback: feedback || null },
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    await db.execute(sql`
      update tenant_onboarding
      set ai_analysis = ${JSON.stringify(nextAnalysis)}::jsonb,
          current_step = greatest(current_step, 2),
          updated_at = now()
      where tenant_id = ${tenantId}::uuid
    `);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis: nextAnalysis }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}