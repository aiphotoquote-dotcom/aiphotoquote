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

function noCacheJson(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store",
    },
  });
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

function titleFromKey(key: string) {
  const s = safeTrim(key).replace(/[-_]+/g, " ").trim();
  if (!s) return "Service";
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

function jsonExtract(s: string): any | null {
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

/* -------------------- Mode A shapes -------------------- */

type InterviewAnswer = {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
};

type Candidate = { key: string; label: string; score: number; exists?: boolean };

type IndustryInterviewA = {
  mode: "A";
  status: "collecting" | "locked";
  round: number;

  confidenceScore: number; // 0..1
  fitScore: number; // 0..1

  proposedIndustry: {
    key: string;
    label: string;
    description?: string | null;
    exists: boolean;
    shouldCreate: boolean;
  } | null;

  candidates: Candidate[];

  nextQuestion: {
    id: string;
    question: string;
    help?: string;
    inputType?: "text" | "select";
    options?: string[];
  } | null;

  answers: InterviewAnswer[];

  meta: {
    updatedAt: string;
    model?: { name?: string; status?: "ok" | "llm_error"; error?: string };
    debug?: { reason?: string };
  };
};

const CONF_TARGET = 0.82;
const FIT_TARGET = 0.55;
const MAX_ROUNDS = 10;

/* -------------------- db helpers -------------------- */

async function readAiAnalysis(tenantId: string): Promise<any | null> {
  const r = await db.execute(sql`
    select ai_analysis
    from tenant_onboarding
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const row = firstRow(r);
  const ai = row?.ai_analysis ?? null;

  if (typeof ai === "string") {
    try {
      return JSON.parse(ai);
    } catch {
      return null;
    }
  }
  return ai && typeof ai === "object" ? ai : null;
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

async function industryExistsByKey(key: string): Promise<boolean> {
  const k = normalizeKey(key);
  if (!k) return false;
  const r = await db.execute(sql`
    select 1 as ok
    from industries
    where key = ${k}
    limit 1
  `);
  const row = firstRow(r);
  return Boolean(row?.ok);
}

/**
 * ✅ Correct IN list (no ANY(...) param weirdness)
 */
async function markCandidatesExist(cands: Candidate[]): Promise<Candidate[]> {
  const keys = Array.from(
    new Set(
      cands
        .map((c) => normalizeKey(c.key))
        .filter(Boolean)
        .slice(0, 10)
    )
  );
  if (!keys.length) return cands;

  const inList = sql.join(keys.map((k) => sql`${k}`), sql`, `);

  const r = await db.execute(sql`
    select key::text as key
    from industries
    where key in (${inList})
  `);

  const found = new Set(rowsOf(r).map((x: any) => String(x.key)));
  return cands.map((c) => ({ ...c, exists: found.has(normalizeKey(c.key)) }));
}

async function ensureIndustryExists(args: { key: string; label?: string; description?: string | null }) {
  const key = normalizeKey(args.key);
  if (!key) return "";

  const label = safeTrim(args.label) || titleFromKey(key);
  const description = args.description == null ? null : String(args.description);

  await db.execute(sql`
    insert into industries (id, key, label, description)
    values (gen_random_uuid(), ${key}, ${label}, ${description})
    on conflict (key) do update
      set label = excluded.label
  `);

  return key;
}

/* -------------------- inference state -------------------- */

function ensureModeA(ai: any | null): { ai: any; st: IndustryInterviewA } {
  const now = new Date().toISOString();
  const baseAi = ai && typeof ai === "object" ? ai : {};

  const existing = baseAi?.industryInterview;
  if (existing && typeof existing === "object" && existing?.mode === "A") {
    const answers = Array.isArray(existing.answers) ? existing.answers : [];
    const round = Number(existing.round ?? 1);
    const confidenceScore = Number(existing.confidenceScore ?? 0) || 0;
    const fitScore = Number(existing.fitScore ?? 0) || 0;

    const st: IndustryInterviewA = {
      mode: "A",
      status: existing.status === "locked" ? "locked" : "collecting",
      round: Number.isFinite(round) && round > 0 ? round : 1,
      confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : 0,
      fitScore: Number.isFinite(fitScore) ? fitScore : 0,
      proposedIndustry: existing.proposedIndustry ?? null,
      candidates: Array.isArray(existing.candidates) ? existing.candidates : [],
      nextQuestion: existing.nextQuestion ?? null,
      answers,
      meta: { updatedAt: now, ...(existing.meta ?? {}) },
    };

    baseAi.industryInterview = st;
    return { ai: baseAi, st };
  }

  const st: IndustryInterviewA = {
    mode: "A",
    status: "collecting",
    round: 1,
    confidenceScore: 0,
    fitScore: 0,
    proposedIndustry: null,
    candidates: [],
    nextQuestion: null,
    answers: [],
    meta: { updatedAt: now },
  };

  baseAi.industryInterview = st;
  return { ai: baseAi, st };
}

function buildTranscript(st: IndustryInterviewA) {
  return st.answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n");
}

function firstQuestionFallback() {
  return {
    id: "q_start",
    question: "In one sentence, what do you do and what do you work on most often?",
    help: "Example: “We build and repair in-ground pools for residential customers.”",
    inputType: "text" as const,
  };
}

/* -------------------- LLM -------------------- */

async function runLLM_ModeA(args: {
  st: IndustryInterviewA;
  action: "start" | "answer";
}): Promise<{
  confidenceScore: number;
  fitScore: number;
  proposedIndustry: { key: string; label: string; description?: string | null; shouldCreate: boolean } | null;
  candidates: Candidate[];
  nextQuestion: IndustryInterviewA["nextQuestion"];
  debugReason?: string;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing in the environment.");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini";

  const askedQuestions = new Set(args.st.answers.map((a) => safeTrim(a.question).toLowerCase()).filter(Boolean));
  const transcript = buildTranscript(args.st);

  const system = [
    "You are the onboarding interviewer for a platform called AIPhotoQuote.",
    "Your job is to: (1) identify the customer's industry, (2) decide if AIPhotoQuote is a good fit, (3) ask the next best question.",
    "",
    "CRITICAL RULES:",
    "- Do NOT assume you know what industries exist in the platform.",
    "- You may propose a new industry if needed.",
    "- Never repeat a question that has already been asked (even paraphrased).",
    "- Output ONLY valid JSON. No markdown, no prose.",
    "",
    "Scoring:",
    "- confidenceScore: how confident you are about the industry (0..1).",
    "- fitScore: how suitable AIPhotoQuote is for this business (0..1).",
    "",
    "When confidenceScore is high (>=0.82) and fitScore is at least moderate (>=0.55), propose an industry clearly.",
    "Otherwise keep collecting signal with a targeted question.",
  ].join("\n");

  const user = [
    `Action: ${args.action}`,
    "",
    "Already asked questions (do not repeat):",
    Array.from(askedQuestions).slice(0, 50).join(" | ") || "(none)",
    "",
    "Transcript so far:",
    transcript || "(none)",
    "",
    "Return JSON with this shape:",
    JSON.stringify(
      {
        confidenceScore: 0.0,
        fitScore: 0.0,
        proposedIndustry: {
          key: "snake_case_key",
          label: "Human label",
          description: "optional short",
          shouldCreate: true,
        },
        candidates: [{ key: "snake_case", label: "Label", score: 0.0 }],
        nextQuestion: {
          id: "short_id",
          question: "string",
          help: "optional",
          inputType: "text",
          options: ["optional"],
        },
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
  const parsed = jsonExtract(content);
  if (!parsed || typeof parsed !== "object") throw new Error("LLM returned non-JSON output.");

  const confidence = Number((parsed as any).confidenceScore ?? 0);
  const fit = Number((parsed as any).fitScore ?? 0);

  const confidenceScore = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  const fitScore = Number.isFinite(fit) ? Math.max(0, Math.min(1, fit)) : 0;

  // proposedIndustry
  let proposedIndustry: any = null;
  if ((parsed as any).proposedIndustry && typeof (parsed as any).proposedIndustry === "object") {
    const key = normalizeKey((parsed as any).proposedIndustry.key ?? "");
    const label = safeTrim((parsed as any).proposedIndustry.label ?? "");
    if (key && label) {
      proposedIndustry = {
        key,
        label,
        description: (parsed as any).proposedIndustry.description == null ? null : String((parsed as any).proposedIndustry.description),
        shouldCreate: Boolean((parsed as any).proposedIndustry.shouldCreate ?? false),
      };
    }
  }

  // candidates
  const candRaw = Array.isArray((parsed as any).candidates) ? (parsed as any).candidates : [];
  const candidates: Candidate[] = candRaw
    .map((c: any) => ({
      key: normalizeKey(c?.key ?? ""),
      label: safeTrim(c?.label ?? ""),
      score: Number(c?.score ?? 0) || 0,
    }))
    .filter((c: Candidate) => Boolean(c.key))
    .slice(0, 6);

  // nextQuestion
  let nextQuestion: any = (parsed as any).nextQuestion ?? null;
  if (nextQuestion && typeof nextQuestion === "object") {
    const q = safeTrim(nextQuestion.question);
    const qLower = q.toLowerCase();
    if (!q || askedQuestions.has(qLower)) {
      nextQuestion = null;
    } else {
      nextQuestion = {
        id: safeTrim(nextQuestion.id) || `q_${Date.now()}`,
        question: q,
        help: safeTrim(nextQuestion.help) || undefined,
        inputType: nextQuestion.inputType === "select" ? "select" : "text",
        options: Array.isArray(nextQuestion.options)
          ? nextQuestion.options.map((x: any) => safeTrim(x)).filter(Boolean).slice(0, 12)
          : undefined,
      };
    }
  } else {
    nextQuestion = null;
  }

  return {
    confidenceScore,
    fitScore,
    proposedIndustry,
    candidates: candidates.length
      ? candidates
      : proposedIndustry
        ? [{ key: proposedIndustry.key, label: proposedIndustry.label, score: confidenceScore }]
        : [],
    nextQuestion,
    debugReason: safeTrim((parsed as any).debugReason ?? ""),
  };
}

/* -------------------- schema -------------------- */

const PostSchema = z.object({
  tenantId: z.string().min(1),
  action: z.enum(["start", "answer", "reset"]),
  questionId: z.string().optional(),
  questionText: z.string().optional(),
  answer: z.any().optional(),
});

/* -------------------- handler -------------------- */

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const bodyRaw = await req.json().catch(() => null);
    const parsed = PostSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return noCacheJson({ ok: false, error: "BAD_REQUEST", message: "Invalid request body." }, 400);
    }

    const tenantId = safeTrim(parsed.data.tenantId);
    await requireMembership(clerkUserId, tenantId);

    const ai0 = await readAiAnalysis(tenantId);
    const { ai, st: st0 } = ensureModeA(ai0);

    const now = new Date().toISOString();
    let st: IndustryInterviewA = { ...st0, meta: { ...(st0.meta ?? {}), updatedAt: now } };

    if (parsed.data.action === "reset") {
      st = {
        mode: "A",
        status: "collecting",
        round: 1,
        confidenceScore: 0,
        fitScore: 0,
        proposedIndustry: null,
        candidates: [],
        nextQuestion: firstQuestionFallback(),
        answers: [],
        meta: { updatedAt: now, model: { status: "ok" } },
      };

      ai.industryInterview = st;
      ai.suggestedIndustryKey = null;
      ai.confidenceScore = 0;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return noCacheJson({ ok: true, tenantId, industryInterview: st }, 200);
    }

    if (parsed.data.action === "start") {
      try {
        const out = await runLLM_ModeA({ st, action: "start" });
        const candidates = await markCandidatesExist(out.candidates ?? []);

        let proposed: IndustryInterviewA["proposedIndustry"] = null;
        if (out.proposedIndustry?.key) {
          const exists = await industryExistsByKey(out.proposedIndustry.key);
          const shouldCreate =
            Boolean(out.proposedIndustry.shouldCreate) &&
            !exists &&
            out.confidenceScore >= CONF_TARGET &&
            out.fitScore >= FIT_TARGET;

          proposed = {
            key: out.proposedIndustry.key,
            label: out.proposedIndustry.label,
            description: out.proposedIndustry.description ?? null,
            exists,
            shouldCreate,
          };

          if (shouldCreate) {
            await ensureIndustryExists({
              key: proposed.key,
              label: proposed.label,
              description: proposed.description ?? null,
            });
            proposed.exists = true;
          }
        }

        const nextQ = out.nextQuestion ?? firstQuestionFallback();

        st = {
          ...st,
          status: "collecting",
          round: 1,
          confidenceScore: out.confidenceScore,
          fitScore: out.fitScore,
          proposedIndustry: proposed,
          candidates,
          nextQuestion: nextQ,
          meta: {
            updatedAt: now,
            model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "ok" },
            debug: { reason: out.debugReason || undefined },
          },
        };

        ai.industryInterview = st;
        if (proposed?.key) ai.suggestedIndustryKey = proposed.key;
        ai.confidenceScore = st.confidenceScore;
        ai.needsConfirmation = true;

        await writeAiAnalysis(tenantId, ai);
        return noCacheJson({ ok: true, tenantId, industryInterview: st }, 200);
      } catch (e: any) {
        st = {
          ...st,
          status: "collecting",
          round: 1,
          confidenceScore: 0,
          fitScore: 0,
          proposedIndustry: null,
          candidates: [],
          nextQuestion: firstQuestionFallback(),
          meta: {
            updatedAt: now,
            model: {
              name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini",
              status: "llm_error",
              error: e?.message ?? String(e),
            },
          },
        };

        ai.industryInterview = st;
        ai.needsConfirmation = true;

        await writeAiAnalysis(tenantId, ai);
        return noCacheJson({ ok: true, tenantId, industryInterview: st }, 200);
      }
    }

    // action === "answer"
    const qid = safeTrim(parsed.data.questionId);
    const qTextFromBody = safeTrim(parsed.data.questionText);

    // Accept either questionText OR derive from current state
    const qTextFromState = safeTrim(st.nextQuestion?.question);
    const qText = qTextFromBody || qTextFromState;

    const ansRaw = parsed.data.answer;
    const ans = typeof ansRaw === "string" ? safeTrim(ansRaw) : safeTrim(ansRaw == null ? "" : JSON.stringify(ansRaw));

    if (!qText || !ans) {
      return noCacheJson(
        {
          ok: false,
          error: "ANSWER_REQUIRED",
          message: "questionText (or valid questionId) and answer are required.",
        },
        400
      );
    }

    // Server-side dedupe
    const last = Array.isArray(st.answers) && st.answers.length ? st.answers[st.answers.length - 1] : null;
    const lastSame =
      last &&
      safeTrim(last.question).toLowerCase() === safeTrim(qText).toLowerCase() &&
      safeTrim(last.answer).toLowerCase() === safeTrim(ans).toLowerCase();

    const answers = Array.isArray(st.answers) ? [...st.answers] : [];
    if (!lastSame) {
      answers.push({
        id: qid || safeTrim(last?.id) || `a_${Date.now()}`,
        question: qText,
        answer: ans,
        createdAt: now,
      });
    }

    st = {
      ...st,
      answers,
      round: Math.min(MAX_ROUNDS, (Number(st.round ?? 1) || 1) + 1),
      meta: { ...(st.meta ?? {}), updatedAt: now },
    };

    try {
      const out = await runLLM_ModeA({ st, action: "answer" });
      const candidates = await markCandidatesExist(out.candidates ?? []);

      let proposed: IndustryInterviewA["proposedIndustry"] = null;
      if (out.proposedIndustry?.key) {
        const exists = await industryExistsByKey(out.proposedIndustry.key);
        const shouldCreate =
          Boolean(out.proposedIndustry.shouldCreate) &&
          !exists &&
          out.confidenceScore >= CONF_TARGET &&
          out.fitScore >= FIT_TARGET;

        proposed = {
          key: out.proposedIndustry.key,
          label: out.proposedIndustry.label,
          description: out.proposedIndustry.description ?? null,
          exists,
          shouldCreate,
        };
      }

      const reached = out.confidenceScore >= CONF_TARGET && out.fitScore >= FIT_TARGET;
      const status: IndustryInterviewA["status"] = reached ? "locked" : "collecting";

      // ✅ AUTO-CREATE ON LOCK (do not rely on model's shouldCreate)
      if (status === "locked" && proposed?.key) {
        const existsNow = await industryExistsByKey(proposed.key);
        if (!existsNow) {
          await ensureIndustryExists({
            key: proposed.key,
            label: proposed.label,
            description: proposed.description ?? null,
          });
        }
        proposed.exists = true;
        proposed.shouldCreate = proposed.shouldCreate || !existsNow;
      }

      st = {
        ...st,
        status,
        confidenceScore: out.confidenceScore,
        fitScore: out.fitScore,
        proposedIndustry: proposed,
        candidates,
        nextQuestion: status === "collecting" ? (out.nextQuestion ?? firstQuestionFallback()) : null,
        meta: {
          updatedAt: now,
          model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "ok" },
          debug: { reason: out.debugReason || undefined },
        },
      };

      ai.industryInterview = st;
      if (proposed?.key) ai.suggestedIndustryKey = proposed.key;
      ai.confidenceScore = st.confidenceScore;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return noCacheJson({ ok: true, tenantId, industryInterview: st }, 200);
    } catch (e: any) {
      st = {
        ...st,
        status: "collecting",
        nextQuestion: firstQuestionFallback(),
        meta: {
          updatedAt: now,
          model: {
            name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini",
            status: "llm_error",
            error: e?.message ?? String(e),
          },
        },
      };

      ai.industryInterview = st;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return noCacheJson({ ok: true, tenantId, industryInterview: st }, 200);
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return noCacheJson({ ok: false, error: "INTERNAL", message: msg }, status);
  }
}