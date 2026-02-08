// src/app/api/onboarding/industry-interview/route.ts

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import OpenAI from "openai";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* -------------------- utils -------------------- */

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeKey(raw: string) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray((r as any).rows)) return (r as any).rows[0] ?? null;
  return null;
}

function rowsOf(r: any): any[] {
  if (!r) return [];
  if (Array.isArray(r)) return r;
  if (Array.isArray((r as any).rows)) return (r as any).rows;
  return [];
}

async function requireAuthed(): Promise<{ clerkUserId: string }> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return { clerkUserId: userId };
}

async function requireMembership(clerkUserId: string, tenantId: string) {
  const r = await db.execute(sql`
    select 1 as ok
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${clerkUserId}
      and status = 'active'
    limit 1
  `);
  const row = firstRow(r);
  if (!row?.ok) throw new Error("FORBIDDEN_TENANT");
}

/* -------------------- shapes -------------------- */

type InterviewAnswer = {
  qid: string;
  question: string;
  answer: string;
  createdAt: string;
};

type Candidate = { key: string; label: string; score: number }; // score 0..100

type ProposedIndustry = {
  key: string; // snake_case
  label: string; // human label
  description?: string | null;
  why: string; // short reasoning
};

type IndustryInference = {
  mode: "interview";
  status: "collecting" | "suggested";
  round: number;
  confidenceScore: number; // 0..1
  suggestedIndustryKey: string | null;
  needsConfirmation: boolean;

  nextQuestion: { qid: string; question: string; help?: string; options?: string[] } | null;

  answers: InterviewAnswer[];
  candidates: Candidate[];

  // ✅ AI can propose a new industry when none match well
  proposedIndustry?: ProposedIndustry | null;

  meta: { updatedAt: string; model?: string };
};

/* -------------------- tuning -------------------- */

const MaxRounds = 8;

// if AI says confidence >= target and it’s not asking another question, we mark suggested
const ConfidenceTarget = 0.82;

/**
 * Our “question slots” for the UI/UX.
 * LLM chooses the next qid and can write a better question/options.
 */
const QID_SLOTS: Array<{
  qid: string;
  intent: string;
  example?: string;
}> = [
  { qid: "services", intent: "Primary service type in 3–7 words.", example: "ceramic coating / interior detail" },
  { qid: "materials_objects", intent: "What they work on (cars, boats, homes, offices, etc.)." },
  { qid: "job_type", intent: "Repair vs replace vs install vs maintenance." },
  { qid: "who_for", intent: "Residential vs commercial vs both." },
  { qid: "top_jobs", intent: "2–3 common jobs they quote.", example: "roller shades, plantation shutters, motorized blinds" },
  { qid: "materials", intent: "Materials/surfaces they work with.", example: "fabric, vinyl, aluminum, wood" },
  { qid: "specialty", intent: "Niche keywords customers search.", example: "motorized shades, blackout curtains" },
  { qid: "location", intent: "City/state or radius." },
  { qid: "freeform", intent: "One sentence describing the business.", example: "We sell and install blinds and shades for homes and offices." },
];

/* -------------------- db helpers -------------------- */

async function readAiAnalysis(tenantId: string): Promise<any | null> {
  const r = await db.execute(sql`
    select ai_analysis
    from tenant_onboarding
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  return row?.ai_analysis ?? null;
}

async function writeAiAnalysis(tenantId: string, ai: any) {
  await db.execute(sql`
    insert into tenant_onboarding (tenant_id, ai_analysis, updated_at, created_at)
    values (
      ${tenantId}::uuid,
      ${JSON.stringify(ai)}::jsonb,
      now(),
      now()
    )
    on conflict (tenant_id) do update
      set ai_analysis = excluded.ai_analysis,
          updated_at = now()
  `);
}

async function listCanonicalIndustries(): Promise<Array<{ key: string; label: string; description: string | null }>> {
  const r = await db.execute(sql`
    select key::text as "key", label::text as "label", description::text as "description"
    from industries
    order by label asc
    limit 2000
  `);
  return rowsOf(r).map((x: any) => ({
    key: String(x.key),
    label: String(x.label),
    description: x.description == null ? null : String(x.description),
  }));
}

function ensureInference(ai: any | null): { ai: any; inf: IndustryInference } {
  const now = new Date().toISOString();
  const baseAi = ai && typeof ai === "object" ? ai : {};
  const existing = baseAi?.industryInference;

  if (existing && typeof existing === "object" && existing?.mode === "interview") {
    const answers = Array.isArray(existing.answers) ? existing.answers : [];
    const round = Number(existing.round ?? 1);
    const confidenceScore = Number(existing.confidenceScore ?? 0) || 0;
    const suggestedIndustryKey = safeTrim(existing.suggestedIndustryKey) || null;

    const inf: IndustryInference = {
      mode: "interview",
      status: suggestedIndustryKey ? "suggested" : "collecting",
      round: Number.isFinite(round) && round > 0 ? round : 1,
      confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : 0,
      suggestedIndustryKey,
      needsConfirmation: Boolean(existing.needsConfirmation ?? true),
      nextQuestion: existing.nextQuestion ?? null,
      answers,
      candidates: Array.isArray(existing.candidates) ? existing.candidates : [],
      proposedIndustry: existing.proposedIndustry ?? null,
      meta: { updatedAt: now, model: safeTrim(existing?.meta?.model) || undefined },
    };

    baseAi.industryInference = inf;
    return { ai: baseAi, inf };
  }

  const inf: IndustryInference = {
    mode: "interview",
    status: "collecting",
    round: 1,
    confidenceScore: 0,
    suggestedIndustryKey: null,
    needsConfirmation: true,
    nextQuestion: null,
    answers: [],
    candidates: [],
    proposedIndustry: null,
    meta: { updatedAt: now },
  };

  baseAi.industryInference = inf;
  return { ai: baseAi, inf };
}

/* -------------------- LLM -------------------- */

const LlmOutSchema = z.object({
  // top candidates ranked; can include a new industry key if proposing
  candidates: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        score: z.number().min(0).max(100),
      })
    )
    .min(1)
    .max(8),

  suggestedIndustryKey: z.string().nullable(),
  confidenceScore: z.number().min(0).max(1),
  status: z.enum(["collecting", "suggested"]),

  // next question (only if collecting)
  nextQuestion: z
    .object({
      qid: z.string().min(1),
      question: z.string().min(1),
      help: z.string().optional(),
      options: z.array(z.string()).optional(),
    })
    .nullable(),

  // if the model believes none fit well, it can propose a new industry
  proposedIndustry: z
    .object({
      key: z.string().min(3),
      label: z.string().min(3),
      description: z.string().nullable().optional(),
      why: z.string().min(8),
    })
    .nullable()
    .optional(),
});

function pickNextQid(answers: InterviewAnswer[]) {
  const answered = new Set(answers.map((a) => a.qid));
  // pick first unasked slot; fallback freeform
  const next = QID_SLOTS.find((s) => !answered.has(s.qid));
  return next?.qid ?? "freeform";
}

async function runLlm(args: {
  canon: Array<{ key: string; label: string; description: string | null }>;
  answers: InterviewAnswer[];
  round: number;
}) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const askedQids = args.answers.map((a) => a.qid);
  const nextQidHint = pickNextQid(args.answers);

  const system = [
    "You are AIPhotoQuote's onboarding interview brain.",
    "Goal: infer the customer's industry from short answers and ask the best next question.",
    "You MUST avoid repeating the same question in different words.",
    "If none of the canonical industries fit well, propose a NEW industry (snake_case key + human label).",
    "Output MUST be valid JSON matching the requested schema.",
  ].join("\n");

  const user = {
    canonical_industries: args.canon,
    interview: {
      round: args.round,
      asked_qids: askedQids,
      answers: args.answers,
      allowed_qid_slots: QID_SLOTS,
      next_qid_hint: nextQidHint,
      max_rounds: MaxRounds,
      confidence_target: ConfidenceTarget,
    },
    output_rules: {
      // Keep “real-feeling” UX
      candidates_max: 6,
      next_question_should_be_high_signal: true,
      next_question_should_include_options_when_possible: true,
      avoid_generic_example_text_unless_relevant: true,
    },
  };

  // Use Responses API (modern OpenAI SDK); enforce JSON
  const resp = await client.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) },
    ],
    text: { format: { type: "json_object" } },
  });

  const text = resp.output_text ?? "";
  const parsed = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();

  const out = LlmOutSchema.parse(parsed);

  // normalize keys
  const candidates = out.candidates
    .map((c) => ({
      key: normalizeKey(c.key),
      label: safeTrim(c.label) || normalizeKey(c.key),
      score: Number(c.score) || 0,
    }))
    .filter((c) => c.key);

  const suggestedIndustryKey = out.suggestedIndustryKey ? normalizeKey(out.suggestedIndustryKey) : null;

  const proposedIndustry = out.proposedIndustry
    ? {
        key: normalizeKey(out.proposedIndustry.key),
        label: safeTrim(out.proposedIndustry.label),
        description: out.proposedIndustry.description ?? null,
        why: safeTrim(out.proposedIndustry.why),
      }
    : null;

  const nextQuestion =
    out.nextQuestion && out.status === "collecting"
      ? {
          qid: safeTrim(out.nextQuestion.qid) || nextQidHint,
          question: safeTrim(out.nextQuestion.question),
          help: safeTrim(out.nextQuestion.help) || undefined,
          options: Array.isArray(out.nextQuestion.options)
            ? out.nextQuestion.options.map((x) => safeTrim(x)).filter(Boolean).slice(0, 12)
            : undefined,
        }
      : null;

  return {
    candidates: candidates.slice(0, 6),
    suggestedIndustryKey,
    confidenceScore: out.confidenceScore,
    status: out.status,
    nextQuestion,
    proposedIndustry: proposedIndustry?.key ? proposedIndustry : null,
    model: resp.model,
  };
}

/* -------------------- schema -------------------- */

const PostSchema = z.object({
  tenantId: z.string().min(1),
  action: z.enum(["start", "answer", "reset"]),
  qid: z.string().optional(),
  answer: z.any().optional(),
});

/* -------------------- handlers -------------------- */

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const bodyRaw = await req.json().catch(() => null);
    const parsed = PostSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "Invalid request body." }, { status: 400 });
    }

    const tenantId = safeTrim(parsed.data.tenantId);
    await requireMembership(clerkUserId, tenantId);

    const ai0 = await readAiAnalysis(tenantId);
    const { ai, inf: inf0 } = ensureInference(ai0);

    const canon = await listCanonicalIndustries();
    const now = new Date().toISOString();

    // reset
    if (parsed.data.action === "reset") {
      const inf: IndustryInference = {
        mode: "interview",
        status: "collecting",
        round: 1,
        confidenceScore: 0,
        suggestedIndustryKey: null,
        needsConfirmation: true,
        nextQuestion: null,
        answers: [],
        candidates: [],
        proposedIndustry: null,
        meta: { updatedAt: now },
      };

      ai.industryInference = inf;
      ai.suggestedIndustryKey = null;
      ai.confidenceScore = 0;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
    }

    // start or answer updates answers, then asks LLM what next
    let answers: InterviewAnswer[] = Array.isArray(inf0.answers) ? [...inf0.answers] : [];

    if (parsed.data.action === "answer") {
      const qid = safeTrim(parsed.data.qid);
      const ansRaw = parsed.data.answer;
      const ans = typeof ansRaw === "string" ? safeTrim(ansRaw) : safeTrim(ansRaw == null ? "" : JSON.stringify(ansRaw));

      if (!qid || !ans) {
        return NextResponse.json(
          { ok: false, error: "ANSWER_REQUIRED", message: "qid and answer are required." },
          { status: 400 }
        );
      }

      const qText = qid; // UI already stores question text; keep minimal here
      answers.push({ qid, question: qText, answer: ans, createdAt: now });
    }

    // cap rounds
    const round = Math.min(MaxRounds, parsed.data.action === "start" ? Math.max(1, Number(inf0.round) || 1) : (Number(inf0.round) || 1) + 1);

    // run the real AI
    const llm = await runLlm({ canon, answers, round });

    // If the model proposes a new industry, treat it as the suggestion.
    const suggestedKey = llm.proposedIndustry?.key || llm.suggestedIndustryKey || null;

    // suggested if LLM says suggested OR it reaches target and provides no nextQuestion
    const status: IndustryInference["status"] =
      llm.status === "suggested" || (llm.confidenceScore >= ConfidenceTarget && !llm.nextQuestion) ? "suggested" : "collecting";

    const next: IndustryInference = {
      mode: "interview",
      status,
      round,
      confidenceScore: llm.confidenceScore,
      suggestedIndustryKey: suggestedKey,
      needsConfirmation: true,
      nextQuestion: status === "collecting" ? llm.nextQuestion ?? { qid: "freeform", question: "Describe your business in one sentence." } : null,
      answers,
      candidates: llm.candidates,
      proposedIndustry: llm.proposedIndustry ?? null,
      meta: { updatedAt: now, model: llm.model },
    };

    ai.industryInference = next;

    // mirror for Step3 expectations
    ai.suggestedIndustryKey = suggestedKey;
    ai.confidenceScore = llm.confidenceScore;
    ai.needsConfirmation = true;

    await writeAiAnalysis(tenantId, ai);

    return NextResponse.json({ ok: true, tenantId, industryInference: next }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}