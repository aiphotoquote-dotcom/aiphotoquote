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

function jsonExtract(s: string): any | null {
  // Try to extract a JSON object from a response even if extra text leaks.
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const chunk = s.slice(start, end + 1);
  try {
    return JSON.parse(chunk);
  } catch {
    return null;
  }
}

function normPrompt(s: string) {
  return safeTrim(s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s?]/g, "")
    .trim();
}

function clamp01(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/* -------------------- shapes -------------------- */

type InterviewTurn = {
  id: string; // question id
  question: string;
  inputType: "text" | "yes_no" | "single_choice" | "multi_choice";
  options?: string[];
  answer?: string | null;
  createdAt: string;
};

type Candidate = { label: string; score: number };

type NextQuestion = {
  id: string;
  question: string;
  help?: string | null;
  inputType: InterviewTurn["inputType"];
  options?: string[];
};

type ModeAState = {
  mode: "A";
  status: "collecting" | "ready";
  round: number;

  hypothesisLabel: string | null; // human-readable
  proposedIndustry: { key: string; label: string } | null; // not persisted globally here
  confidenceScore: number; // 0-1

  fitScore: number; // 0-1
  fitReason: string | null;

  candidates: Candidate[];
  nextQuestion: NextQuestion | null;

  turns: InterviewTurn[];

  meta: {
    updatedAt: string;
    model?: { name?: string; status?: "ok" | "llm_error"; error?: string };
    debug?: { reason?: string };
  };
};

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

/* -------------------- state init -------------------- */

function ensureModeA(ai0: any | null): { ai: any; st: ModeAState } {
  const now = new Date().toISOString();
  const ai = ai0 && typeof ai0 === "object" ? ai0 : {};

  const existing = ai?.industryInterview;
  if (existing && typeof existing === "object" && existing?.mode === "A") {
    const turns: InterviewTurn[] = Array.isArray(existing.turns) ? existing.turns : [];
    const st: ModeAState = {
      mode: "A",
      status: existing.status === "ready" ? "ready" : "collecting",
      round: Number(existing.round ?? turns.length + 1) || 1,
      hypothesisLabel: safeTrim(existing.hypothesisLabel) || null,
      proposedIndustry:
        existing.proposedIndustry && typeof existing.proposedIndustry === "object"
          ? {
              key: normalizeKey(existing.proposedIndustry.key ?? existing.proposedIndustry.label ?? ""),
              label: safeTrim(existing.proposedIndustry.label ?? ""),
            }
          : null,
      confidenceScore: clamp01(existing.confidenceScore),
      fitScore: clamp01(existing.fitScore),
      fitReason: safeTrim(existing.fitReason) || null,
      candidates: Array.isArray(existing.candidates)
        ? existing.candidates
            .map((c: any) => ({ label: safeTrim(c?.label), score: clamp01(c?.score) }))
            .filter((c: Candidate) => c.label)
            .slice(0, 6)
        : [],
      nextQuestion:
        existing.nextQuestion && typeof existing.nextQuestion === "object"
          ? {
              id: safeTrim(existing.nextQuestion.id) || "q_next",
              question: safeTrim(existing.nextQuestion.question),
              help: existing.nextQuestion.help ?? null,
              inputType: existing.nextQuestion.inputType ?? "text",
              options: Array.isArray(existing.nextQuestion.options)
                ? existing.nextQuestion.options.map((x: any) => safeTrim(x)).filter(Boolean)
                : undefined,
            }
          : null,
      turns,
      meta: { updatedAt: now, ...(existing.meta ?? {}) },
    };

    ai.industryInterview = st;
    return { ai, st };
  }

  const st: ModeAState = {
    mode: "A",
    status: "collecting",
    round: 1,
    hypothesisLabel: null,
    proposedIndustry: null,
    confidenceScore: 0,
    fitScore: 0,
    fitReason: null,
    candidates: [],
    nextQuestion: null,
    turns: [],
    meta: { updatedAt: now },
  };

  ai.industryInterview = st;
  return { ai, st };
}

/* -------------------- fallback question toolbelt -------------------- */
/**
 * This is NOT an industry bank.
 * These are universal disambiguators to prevent dead-ends / repeats.
 * No lists of industries; no “what category are you” suggestions.
 */
const FALLBACKS: NextQuestion[] = [
  {
    id: "one_sentence",
    question: "In one sentence, what do you do and who is it for?",
    help: "Example: “We pressure wash homes and small commercial buildings.”",
    inputType: "text",
  },
  {
    id: "typical_jobs",
    question: "Name 2–3 common jobs you quote.",
    help: "Short phrases are perfect.",
    inputType: "text",
  },
  {
    id: "what_work_on",
    question: "What do you work on most often?",
    help: "Pick the closest match.",
    inputType: "single_choice",
    options: ["Homes", "Vehicles", "Boats", "Businesses", "Outdoor property", "Other"],
  },
  {
    id: "res_com",
    question: "Is your work mostly residential, commercial, or both?",
    inputType: "single_choice",
    options: ["Residential", "Commercial", "Both"],
  },
  {
    id: "keywords",
    question: "What keywords would customers search to find you?",
    help: "Comma separated is fine.",
    inputType: "text",
  },
  {
    id: "install_vs_repair",
    question: "Is this mostly install, repair, cleaning/maintenance, or build/custom work?",
    inputType: "single_choice",
    options: ["Install", "Repair", "Cleaning / maintenance", "Build / custom", "Mix of these"],
  },
  {
    id: "photo_quote_fit",
    question: "Can you usually estimate price from photos plus a few questions?",
    inputType: "yes_no",
  },
  {
    id: "photos_needed",
    question: "When you quote, what photos are most useful?",
    help: "Example: wide shot + close-ups + measurements.",
    inputType: "text",
  },
];

function pickFallbackNext(st: ModeAState): NextQuestion {
  const asked = new Set(st.turns.map((t) => t.id));
  const q = FALLBACKS.find((x) => !asked.has(x.id)) ?? FALLBACKS[0];
  return q;
}

/* -------------------- LLM -------------------- */

const LlmOutSchema = z.object({
  hypothesisLabel: z.string().nullable().optional(),
  proposedIndustry: z
    .object({
      key: z.string().optional(),
      label: z.string().optional(),
    })
    .nullable()
    .optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  fitScore: z.number().min(0).max(1).optional(),
  fitReason: z.string().nullable().optional(),
  candidates: z
    .array(
      z.object({
        label: z.string().min(1),
        score: z.number().min(0).max(1),
      })
    )
    .optional(),
  nextQuestion: z
    .object({
      id: z.string().min(1),
      question: z.string().min(1),
      help: z.string().nullable().optional(),
      inputType: z.enum(["text", "yes_no", "single_choice", "multi_choice"]),
      options: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  status: z.enum(["collecting", "ready"]).optional(),
  debugReason: z.string().optional(),
});

function buildTranscript(st: ModeAState) {
  return st.turns
    .map((t, i) => {
      const a = safeTrim(t.answer);
      return [
        `Turn ${i + 1}`,
        `Q(${t.id}) [${t.inputType}]: ${t.question}`,
        a ? `A: ${a}` : `A: (no answer yet)`,
      ].join("\n");
    })
    .join("\n\n");
}

async function runLLM(args: { st: ModeAState; action: "start" | "answer" }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing in the environment.");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini";

  const askedIds = args.st.turns.map((t) => t.id);
  const askedPrompts = args.st.turns.map((t) => t.question);

  const lastTurn = args.st.turns[args.st.turns.length - 1] ?? null;

  const system = [
    "You are the onboarding interviewer for AIPhotoQuote.",
    "You must behave like a great human interviewer: ask ONE high-signal next question, based on the conversation so far.",
    "",
    "CRITICAL RULES:",
    "- Do NOT assume you know what industries exist. Do NOT reference a platform taxonomy. No dropdown lists of industries.",
    "- Your job is to infer what the business does, then propose an industry that best represents it (create it if needed).",
    "- Ask only questions that reduce uncertainty and move toward a confident industry + a product-fit decision.",
    "- Never repeat the same question. Never reuse a question id already used.",
    "- Keep questions short, natural, and “alive” — like a real conversation.",
    "- Output ONLY valid JSON. No markdown, no extra text.",
    "",
    "OUTPUT FIELDS:",
    "- hypothesisLabel: human readable guess (e.g., “Pressure Washing” or “Custom Window Coverings”).",
    "- proposedIndustry: { key, label } where key is snake_case and label is readable. If unsure, still propose your best label.",
    "- confidenceScore: 0-1 confidence in proposedIndustry.",
    "- fitScore: 0-1 confidence that AIPhotoQuote can generate useful estimates for this business (photos + a few questions).",
    "- fitReason: one sentence explaining fitScore.",
    "- candidates: 2-5 alternate hypotheses with scores (0-1).",
    "- nextQuestion: ONE renderable question object or null if status=ready.",
    "- status: collecting | ready (ready means: enough signal to proceed to industry confirmation).",
    "",
    "QUESTION OBJECT RULES:",
    "- inputType must be one of: text | yes_no | single_choice | multi_choice.",
    "- options required only for single_choice/multi_choice; keep options generic (no industry lists).",
    "- id must be a short stable id (snake_case) unique within this interview.",
  ].join("\n");

  const user = [
    `Action: ${args.action}`,
    "",
    "Conversation so far:",
    buildTranscript(args.st) || "(none yet)",
    "",
    "Already used question ids:",
    askedIds.join(", ") || "(none)",
    "",
    "Already asked question prompts (avoid repeats):",
    askedPrompts.length ? askedPrompts.map((p) => `- ${p}`).join("\n") : "(none)",
    "",
    lastTurn?.answer ? `Most recent answer: ${lastTurn.answer}` : "",
    "",
    "Return JSON in this exact shape:",
    JSON.stringify(
      {
        hypothesisLabel: "string or null",
        proposedIndustry: { key: "snake_case", label: "Label" },
        confidenceScore: 0.0,
        fitScore: 0.0,
        fitReason: "string",
        candidates: [{ label: "Alt label", score: 0.0 }],
        nextQuestion: {
          id: "snake_case",
          question: "string",
          help: "string or null",
          inputType: "text | yes_no | single_choice | multi_choice",
          options: ["optional", "strings"],
        },
        status: "collecting | ready",
        debugReason: "short reason",
      },
      null,
      2
    ),
  ].join("\n");

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const content = resp.choices?.[0]?.message?.content ?? "";
  const raw = jsonExtract(content);
  const parsed = LlmOutSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error("LLM returned invalid JSON shape.");
  }

  const out = parsed.data;

  const proposedLabel = safeTrim(out.proposedIndustry?.label ?? out.hypothesisLabel ?? "");
  const proposedKey = normalizeKey(out.proposedIndustry?.key ?? proposedLabel);

  const candidates =
    out.candidates && Array.isArray(out.candidates)
      ? out.candidates
          .map((c) => ({ label: safeTrim(c.label), score: clamp01(c.score) }))
          .filter((c) => c.label)
          .slice(0, 6)
      : [];

  return {
    status: out.status === "ready" ? ("ready" as const) : ("collecting" as const),
    hypothesisLabel: safeTrim(out.hypothesisLabel ?? proposedLabel) || null,
    proposedIndustry: proposedLabel ? { key: proposedKey || normalizeKey(proposedLabel), label: proposedLabel } : null,
    confidenceScore: clamp01(out.confidenceScore),
    fitScore: clamp01(out.fitScore),
    fitReason: safeTrim(out.fitReason) || null,
    candidates,
    nextQuestion: out.nextQuestion ?? null,
    debugReason: safeTrim(out.debugReason),
    modelName: model,
  };
}

function validateOrFallbackNext(st: ModeAState, proposed: NextQuestion | null): NextQuestion | null {
  if (!proposed) return null;

  const askedIds = new Set(st.turns.map((t) => t.id));
  if (askedIds.has(proposed.id)) return pickFallbackNext(st);

  const askedPrompts = new Set(st.turns.map((t) => normPrompt(t.question)));
  const pNorm = normPrompt(proposed.question);
  if (!pNorm) return pickFallbackNext(st);
  if (askedPrompts.has(pNorm)) return pickFallbackNext(st);

  // If choice types, ensure options exist and are reasonable
  if ((proposed.inputType === "single_choice" || proposed.inputType === "multi_choice") && (!proposed.options || proposed.options.length < 2)) {
    return pickFallbackNext(st);
  }

  return {
    id: normalizeKey(proposed.id) || "q_next",
    question: safeTrim(proposed.question),
    help: proposed.help ?? null,
    inputType: proposed.inputType,
    options: proposed.options?.map((x) => safeTrim(x)).filter(Boolean),
  };
}

/* -------------------- request schema -------------------- */

const PostSchema = z.object({
  tenantId: z.string().min(1),
  action: z.enum(["start", "answer", "reset"]),
  questionId: z.string().optional(), // the question being answered
  answer: z.any().optional(),
});

/* -------------------- handler -------------------- */

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
    const { ai, st: st0 } = ensureModeA(ai0);

    const now = new Date().toISOString();

    if (parsed.data.action === "reset") {
      const st: ModeAState = {
        mode: "A",
        status: "collecting",
        round: 1,
        hypothesisLabel: null,
        proposedIndustry: null,
        confidenceScore: 0,
        fitScore: 0,
        fitReason: null,
        candidates: [],
        nextQuestion: null,
        turns: [],
        meta: { updatedAt: now, model: { status: "ok" } },
      };

      ai.industryInterview = st;

      // Back-compat mirrors (Step3/other code may read these)
      ai.suggestedIndustryKey = null;
      ai.confidenceScore = 0;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);

      return NextResponse.json(
        {
          ok: true,
          tenantId,
          industryInterview: st,
        },
        { status: 200 }
      );
    }

    // START
    if (parsed.data.action === "start") {
      let st = { ...st0, meta: { ...(st0.meta ?? {}), updatedAt: now } };

      // If already has nextQuestion and no turns yet, keep it; otherwise generate fresh
      if (!st.turns.length && st.nextQuestion) {
        ai.industryInterview = st;
        await writeAiAnalysis(tenantId, ai);
        return NextResponse.json({ ok: true, tenantId, industryInterview: st }, { status: 200 });
      }

      try {
        const out = await runLLM({ st, action: "start" });

        const nextQ = validateOrFallbackNext(st, out.nextQuestion) ?? pickFallbackNext(st);

        st = {
          ...st,
          status: "collecting",
          round: 1,
          hypothesisLabel: out.hypothesisLabel,
          proposedIndustry: out.proposedIndustry,
          confidenceScore: out.confidenceScore,
          fitScore: out.fitScore,
          fitReason: out.fitReason,
          candidates: out.candidates,
          nextQuestion: nextQ,
          meta: {
            updatedAt: now,
            model: { name: out.modelName, status: "ok" },
            debug: { reason: out.debugReason || undefined },
          },
        };

        ai.industryInterview = st;

        // Back-compat mirrors (best-effort)
        ai.suggestedIndustryKey = st.proposedIndustry?.key ?? null;
        ai.confidenceScore = st.confidenceScore ?? 0;
        ai.needsConfirmation = true;

        await writeAiAnalysis(tenantId, ai);

        return NextResponse.json({ ok: true, tenantId, industryInterview: st }, { status: 200 });
      } catch (e: any) {
        const fallback = pickFallbackNext(st);

        const stErr: ModeAState = {
          ...st,
          status: "collecting",
          nextQuestion: fallback,
          meta: {
            updatedAt: now,
            model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "llm_error", error: e?.message ?? String(e) },
          },
        };

        ai.industryInterview = stErr;
        await writeAiAnalysis(tenantId, ai);

        return NextResponse.json({ ok: true, tenantId, industryInterview: stErr }, { status: 200 });
      }
    }

    // ANSWER
    const questionId = safeTrim(parsed.data.questionId);
    const ansRaw = parsed.data.answer;
    const answer =
      typeof ansRaw === "string" ? safeTrim(ansRaw) : safeTrim(ansRaw == null ? "" : JSON.stringify(ansRaw));

    if (!questionId || !answer) {
      return NextResponse.json({ ok: false, error: "ANSWER_REQUIRED", message: "questionId and answer are required." }, { status: 400 });
    }

    let st: ModeAState = { ...st0, meta: { ...(st0.meta ?? {}), updatedAt: now } };

    // Attach answer to the last asked question if it matches; otherwise create a turn from st.nextQuestion
    const nextQ = st.nextQuestion;
    const qText = nextQ?.question && nextQ?.id === questionId ? nextQ.question : safeTrim(questionId);

    // Prevent duplicate answers for same questionId
    const alreadyAnswered = st.turns.some((t) => t.id === questionId && safeTrim(t.answer));
    if (alreadyAnswered) {
      // If the UI double-submits, just return current state without changing anything.
      return NextResponse.json({ ok: true, tenantId, industryInterview: st }, { status: 200 });
    }

    // Create / append turn
    const turn: InterviewTurn = {
      id: questionId,
      question: qText || (nextQ?.question ?? questionId),
      inputType: nextQ?.id === questionId ? nextQ.inputType : "text",
      options: nextQ?.id === questionId ? nextQ.options : undefined,
      answer,
      createdAt: now,
    };

    st = {
      ...st,
      turns: [...(Array.isArray(st.turns) ? st.turns : []), turn],
      round: Math.max(1, (Number(st.round ?? 1) || 1) + 1),
      nextQuestion: null, // will be replaced by LLM or fallback
      status: "collecting",
    };

    try {
      const out = await runLLM({ st, action: "answer" });

      const status = out.status;

      const validatedNext =
        status === "ready" ? null : validateOrFallbackNext(st, out.nextQuestion) ?? pickFallbackNext(st);

      st = {
        ...st,
        status,
        hypothesisLabel: out.hypothesisLabel,
        proposedIndustry: out.proposedIndustry,
        confidenceScore: out.confidenceScore,
        fitScore: out.fitScore,
        fitReason: out.fitReason,
        candidates: out.candidates,
        nextQuestion: validatedNext,
        meta: {
          updatedAt: now,
          model: { name: out.modelName, status: "ok" },
          debug: { reason: out.debugReason || undefined },
        },
      };

      ai.industryInterview = st;

      // Back-compat mirrors (best-effort)
      ai.suggestedIndustryKey = st.proposedIndustry?.key ?? null;
      ai.confidenceScore = st.confidenceScore ?? 0;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);

      return NextResponse.json({ ok: true, tenantId, industryInterview: st }, { status: 200 });
    } catch (e: any) {
      // Hard fallback: pick next toolbelt question that hasn't been asked
      const fallback = pickFallbackNext(st);

      const stErr: ModeAState = {
        ...st,
        status: "collecting",
        nextQuestion: fallback,
        meta: {
          updatedAt: now,
          model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "llm_error", error: e?.message ?? String(e) },
        },
      };

      ai.industryInterview = stErr;

      // Back-compat mirrors (still keep what we have)
      ai.suggestedIndustryKey = stErr.proposedIndustry?.key ?? ai.suggestedIndustryKey ?? null;
      ai.confidenceScore = stErr.confidenceScore ?? ai.confidenceScore ?? 0;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);

      return NextResponse.json({ ok: true, tenantId, industryInterview: stErr }, { status: 200 });
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}