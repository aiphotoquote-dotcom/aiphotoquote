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

type Candidate = { key: string; label: string; score: number };

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

  meta: { updatedAt: string; model?: string };
};

/* -------------------- product rules -------------------- */

// ✅ Hybrid mode (C): only become “suggested” when confidence is high enough.
const CONFIDENCE_TARGET = 0.82;
const MAX_ROUNDS = 10; // allow a bit more since LLM can steer better than heuristics

// If the LLM proposes a new industry (not in canonical list),
// only create it when confidence is above target.
const ALLOW_NEW_INDUSTRY_WHEN_CONFIDENT = true;

/**
 * Default question bank (the LLM may choose to ask one of these, or a custom clarifier)
 * NOTE: qid uniqueness matters so UI doesn’t feel repetitive.
 */
const QUESTION_BANK: Array<{ qid: string; question: string; help?: string; options?: string[] }> = [
  {
    qid: "services",
    question: "What do you primarily do?",
    help: "Short answer is fine. Example: “sell and install blinds” or “car detailing”.",
  },
  {
    qid: "objects",
    question: "What do you work on most often?",
    help: "Example: cars, boats, homes, offices, roads, etc.",
  },
  {
    qid: "top_jobs",
    question: "Name 2–3 common jobs you quote.",
    help: "Example: “vertical blinds install, roller shades, motorized shades”.",
  },
  {
    qid: "materials",
    question: "What materials or products do you handle most?",
    help: "Example: vinyl, leather, asphalt, clear coat, fabric, window coverings, etc.",
  },
  {
    qid: "customer_type",
    question: "Who are your customers?",
    help: "Residential, commercial, or both?",
  },
  {
    qid: "freeform",
    question: "Describe your business in one sentence.",
    help: "Example: “We sell and install custom blinds and shades for homes and offices.”",
  },
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

async function listCanonicalIndustries(): Promise<Array<{ key: string; label: string }>> {
  const r = await db.execute(sql`
    select key::text as "key", label::text as "label"
    from industries
    order by label asc
    limit 2000
  `);
  return rowsOf(r).map((x: any) => ({ key: String(x.key), label: String(x.label) }));
}

async function ensureIndustryExists(args: { key: string; label: string }) {
  const key = normalizeKey(args.key);
  const label = safeTrim(args.label);

  if (!key || !label) return;

  await db.execute(sql`
    insert into industries (id, key, label, description)
    values (gen_random_uuid(), ${key}, ${label}, null)
    on conflict (key) do update
      set label = excluded.label
  `);
}

/* -------------------- inference state -------------------- */

function ensureInference(ai: any | null): { ai: any; inf: IndustryInference } {
  const now = new Date().toISOString();
  const baseAi = ai && typeof ai === "object" ? ai : {};
  const existing = baseAi?.industryInference;

  if (existing && typeof existing === "object" && existing?.mode === "interview") {
    const answers = Array.isArray(existing.answers) ? existing.answers : [];
    const candidates = Array.isArray(existing.candidates) ? existing.candidates : [];
    const round = Number(existing.round ?? 1);
    const confidenceScore = Number(existing.confidenceScore ?? 0);
    const suggestedIndustryKey = safeTrim(existing.suggestedIndustryKey) || null;

    const inf: IndustryInference = {
      mode: "interview",
      status: suggestedIndustryKey ? "suggested" : "collecting",
      round: Number.isFinite(round) && round > 0 ? round : 1,
      confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : 0,
      suggestedIndustryKey,
      needsConfirmation: true,
      nextQuestion: existing.nextQuestion ?? null,
      answers,
      candidates,
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
    nextQuestion: QUESTION_BANK[0] ?? null,
    answers: [],
    candidates: [],
    meta: { updatedAt: now },
  };

  baseAi.industryInference = inf;
  return { ai: baseAi, inf };
}

/* -------------------- REAL AI (LLM) -------------------- */

const LlmOutputSchema = z.object({
  // 0..1
  confidenceScore: z.number().min(0).max(1),

  // Ranked options (include canon keys when possible; can include a proposed new key)
  candidates: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        score: z.number().min(0).max(100),
      })
    )
    .min(1)
    .max(10),

  // If canon doesn’t fit, propose a new industry.
  // key must be snake_case-ish (we normalize again server-side).
  proposedNewIndustry: z
    .object({
      key: z.string().min(2),
      label: z.string().min(2),
      reason: z.string().min(2).optional(),
    })
    .nullable()
    .optional(),

  // Next question to ask (avoid repeating qids)
  nextQuestion: z
    .object({
      qid: z.string().min(1),
      question: z.string().min(3),
      help: z.string().optional(),
      options: z.array(z.string()).optional(),
    })
    .nullable(),

  // short explanation for internal debug
  rationale: z.string().min(1).max(800).optional(),
});

function pickFallbackNextQuestion(alreadyAsked: Set<string>) {
  const q = QUESTION_BANK.find((x) => !alreadyAsked.has(x.qid)) ?? QUESTION_BANK[QUESTION_BANK.length - 1] ?? null;
  return q ? { ...q } : null;
}

async function runIndustryInferenceLLM(args: {
  canon: Array<{ key: string; label: string }>;
  answers: InterviewAnswer[];
  lastQuestion?: { qid: string; question: string } | null;
}): Promise<z.infer<typeof LlmOutputSchema>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("MISSING_OPENAI_API_KEY");

  const openai = new OpenAI({ apiKey });

  const canonList = args.canon.slice(0, 2000);
  const alreadyAsked = new Set(args.answers.map((a) => a.qid));
  const last = args.answers[args.answers.length - 1] ?? null;

  const system = [
    "You are an onboarding classifier for AIPhotoQuote.",
    "Your job: infer the best-fit INDUSTRY for a service business from short interview answers.",
    "",
    "Rules:",
    "1) Prefer mapping to an existing canonical industry key when possible.",
    "2) If NONE fit, propose a NEW industry (key + label) that should exist as its own industry.",
    "3) Ask the next BEST question that disambiguates quickly.",
    "4) Avoid repeating qids already asked.",
    "5) Keep questions short and mobile-friendly.",
    "6) ConfidenceScore is 0..1. Only use >=0.82 when you are very sure.",
  ].join("\n");

  const user = {
    canonicalIndustries: canonList,
    interviewState: {
      alreadyAskedQids: Array.from(alreadyAsked),
      lastAnswer: last
        ? { qid: last.qid, question: last.question, answer: last.answer, createdAt: last.createdAt }
        : null,
      answers: args.answers.map((a) => ({ qid: a.qid, question: a.question, answer: a.answer })),
    },
    questionBank: QUESTION_BANK,
    note: "Return JSON ONLY that matches the schema. Do not include markdown.",
  };

  // Use “responses” API style via SDK’s chat.completions for compatibility
  const model = "gpt-4o-mini"; // fast + good enough for classification; you can swap later
  const resp = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content ?? "";
  let parsed: any = null;

  try {
    parsed = JSON.parse(raw);
  } catch {
    // If the model ever returns non-JSON, fail loudly so you see it in UI/Logs.
    throw new Error("LLM_NON_JSON_RESPONSE");
  }

  const out = LlmOutputSchema.parse(parsed);
  return out;
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
    const now = new Date().toISOString();

    // Canon list is needed for all actions (start/answer) so we can rank real industries.
    const canon = await listCanonicalIndustries();

    if (parsed.data.action === "reset") {
      const fresh: IndustryInference = {
        mode: "interview",
        status: "collecting",
        round: 1,
        confidenceScore: 0,
        suggestedIndustryKey: null,
        needsConfirmation: true,
        nextQuestion: QUESTION_BANK[0] ?? null,
        answers: [],
        candidates: [],
        meta: { updatedAt: now },
      };

      ai.industryInference = fresh;
      ai.suggestedIndustryKey = null;
      ai.confidenceScore = 0;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: fresh }, { status: 200 });
    }

    if (parsed.data.action === "start") {
      // Start should always deliver a valid nextQuestion and stable inference object
      const alreadyAsked = new Set(inf0.answers.map((a) => a.qid));
      const nextQ = inf0.nextQuestion ?? pickFallbackNextQuestion(alreadyAsked) ?? QUESTION_BANK[0] ?? null;

      const inf: IndustryInference = {
        ...inf0,
        mode: "interview",
        status: "collecting",
        needsConfirmation: true,
        nextQuestion: nextQ,
        meta: { updatedAt: now, model: inf0.meta?.model },
      };

      ai.industryInference = inf;
      await writeAiAnalysis(tenantId, ai);

      return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
    }

    // action === "answer"
    const qid = safeTrim(parsed.data.qid);
    const ansRaw = parsed.data.answer;
    const answer =
      typeof ansRaw === "string" ? safeTrim(ansRaw) : safeTrim(ansRaw == null ? "" : JSON.stringify(ansRaw));

    if (!qid || !answer) {
      return NextResponse.json(
        { ok: false, error: "ANSWER_REQUIRED", message: "qid and answer are required." },
        { status: 400 }
      );
    }

    // append answer
    const questionText =
      QUESTION_BANK.find((q) => q.qid === qid)?.question ||
      inf0.nextQuestion?.question ||
      qid;

    const answers: InterviewAnswer[] = Array.isArray(inf0.answers) ? [...inf0.answers] : [];
    answers.push({ qid, question: questionText, answer, createdAt: now });

    // run REAL AI inference
    let llmOut: z.infer<typeof LlmOutputSchema> | null = null;
    try {
      llmOut = await runIndustryInferenceLLM({ canon, answers, lastQuestion: inf0.nextQuestion });
    } catch (e: any) {
      // Don’t crash the UX—return a stable object with a fallback next question
      const alreadyAsked = new Set(answers.map((a) => a.qid));
      const fallbackQ = pickFallbackNextQuestion(alreadyAsked);

      const infFail: IndustryInference = {
        mode: "interview",
        status: "collecting",
        round: Math.min(MAX_ROUNDS, (Number(inf0.round ?? 1) || 1) + 1),
        confidenceScore: 0,
        suggestedIndustryKey: null,
        needsConfirmation: true,
        nextQuestion: fallbackQ ?? {
          qid: "freeform",
          question: "Describe your business in one sentence.",
          help: "Example: “We sell and install blinds and shades for homes and offices.”",
        },
        answers,
        candidates: [
          { key: "service", label: "Service", score: 0 },
        ],
        meta: { updatedAt: now, model: "llm_error" },
      };

      ai.industryInference = infFail;
      ai.suggestedIndustryKey = null;
      ai.confidenceScore = 0;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);

      // Surface a readable error for you during testing
      return NextResponse.json(
        { ok: true, tenantId, industryInference: infFail, debug: { error: e?.message ?? String(e) } },
        { status: 200 }
      );
    }

    const confidenceScore = Number(llmOut.confidenceScore ?? 0);
    const candidates: Candidate[] = (llmOut.candidates ?? []).map((c) => ({
      key: normalizeKey(c.key),
      label: safeTrim(c.label) || normalizeKey(c.key),
      score: Number.isFinite(c.score) ? c.score : 0,
    }));

    const top = candidates[0] ?? null;

    // Proposed new industry handling
    const proposed = llmOut.proposedNewIndustry ?? null;
    const proposedKey = proposed ? normalizeKey(proposed.key) : "";
    const proposedLabel = proposed ? safeTrim(proposed.label) : "";

    const canonKeySet = new Set(canon.map((x) => normalizeKey(x.key)));
    const topIsCanon = top?.key ? canonKeySet.has(normalizeKey(top.key)) : false;

    // Decide suggested key:
    // - If top is canon: use it
    // - Else if AI proposed a new industry: use proposed (if allowed)
    // - Else: fallback to top key if present
    let suggestedIndustryKey: string | null = null;

    if (top?.key && topIsCanon) {
      suggestedIndustryKey = normalizeKey(top.key);
    } else if (ALLOW_NEW_INDUSTRY_WHEN_CONFIDENT && proposedKey && proposedLabel) {
      suggestedIndustryKey = proposedKey;
    } else if (top?.key) {
      suggestedIndustryKey = normalizeKey(top.key);
    }

    // Hybrid rule: only “suggested” when confident enough.
    const reachedTarget = confidenceScore >= CONFIDENCE_TARGET;
    const round = Math.min(MAX_ROUNDS, (Number(inf0.round ?? 1) || 1) + 1);
    const exhausted = round >= MAX_ROUNDS;

    const status: IndustryInference["status"] =
      reachedTarget || exhausted ? "suggested" : "collecting";

    // Create the known-new industry only when status is suggested AND confidence target met
    if (
      status === "suggested" &&
      reachedTarget &&
      proposedKey &&
      proposedLabel &&
      !canonKeySet.has(proposedKey)
    ) {
      await ensureIndustryExists({ key: proposedKey, label: proposedLabel });
    }

    // Next question: only if still collecting.
    const alreadyAsked = new Set(answers.map((a) => a.qid));
    let nextQuestion: IndustryInference["nextQuestion"] = null;

    if (status === "collecting") {
      const nq = llmOut.nextQuestion ?? null;
      if (nq?.qid && !alreadyAsked.has(nq.qid)) {
        nextQuestion = {
          qid: safeTrim(nq.qid),
          question: safeTrim(nq.question),
          help: safeTrim(nq.help) || undefined,
          options: Array.isArray(nq.options) ? nq.options.map((x) => safeTrim(x)).filter(Boolean) : undefined,
        };
      } else {
        nextQuestion = pickFallbackNextQuestion(alreadyAsked);
      }

      if (!nextQuestion) {
        nextQuestion = {
          qid: "freeform",
          question: "Describe your business in one sentence.",
          help: "Example: “We sell and install blinds and shades for homes and offices.”",
        };
      }
    }

    const nextInf: IndustryInference = {
      mode: "interview",
      status,
      round,
      confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : 0,
      suggestedIndustryKey: suggestedIndustryKey || null,
      needsConfirmation: true,
      nextQuestion,
      answers,
      candidates: candidates.length
        ? candidates
        : [{ key: "service", label: "Service", score: 0 }],
      meta: { updatedAt: now, model: "gpt-4o-mini" },
    };

    // Persist + mirror fields (Step3 reads these)
    ai.industryInference = nextInf;
    ai.suggestedIndustryKey = nextInf.suggestedIndustryKey;
    ai.confidenceScore = nextInf.confidenceScore;
    ai.needsConfirmation = true;

    await writeAiAnalysis(tenantId, ai);

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        industryInference: nextInf,
        // debug is safe to keep during your testing; remove later if you want
        debug: {
          proposedNewIndustry: proposed ?? null,
          reachedTarget,
        },
      },
      { status: 200 }
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}