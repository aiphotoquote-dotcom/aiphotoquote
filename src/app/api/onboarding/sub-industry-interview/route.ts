// src/app/api/onboarding/sub-industry-interview/route.ts

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

function normalizeKey(raw: any) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
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

function clamp01(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
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

/* -------------------- defaults -------------------- */

type DefaultSub = { key: string; label: string };

async function listDefaultSubIndustries(industryKey: string): Promise<DefaultSub[]> {
  const ik = normalizeKey(industryKey);
  if (!ik) return [];

  // NOTE: your PCC page expects industry_sub_industries has is_active + sort_order
  const r = await db.execute(sql`
    select
      key::text as "key",
      label::text as "label"
    from industry_sub_industries
    where industry_key = ${ik}
      and is_active = true
    order by sort_order asc, label asc
    limit 200
  `);

  return rowsOf(r)
    .map((x: any) => ({
      key: normalizeKey(x?.key),
      label: safeTrim(x?.label) || titleFromKey(String(x?.key ?? "")),
    }))
    .filter((x) => x.key && x.label);
}

function findDefaultByKeyOrLabel(defaults: DefaultSub[], raw: string): DefaultSub | null {
  const s = safeTrim(raw);
  if (!s) return null;

  const k = normalizeKey(s);
  if (k) {
    const byKey = defaults.find((d) => normalizeKey(d.key) === k);
    if (byKey) return byKey;
  }

  const sLower = s.toLowerCase();
  const byLabel = defaults.find((d) => safeTrim(d.label).toLowerCase() === sLower);
  return byLabel ?? null;
}

/* -------------------- state shapes -------------------- */

type InterviewAnswer = {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
};

type Candidate = { key?: string; label: string; score: number };

type SubIndustryInterview = {
  mode: "SUB";
  status: "collecting" | "locked";
  round: number;

  industryKey: string; // context
  confidenceScore: number; // 0..1

  // ✅ now canonical-friendly (label stays for back-compat UI)
  proposedSubIndustryKey?: string | null;
  proposedSubIndustryLabel: string | null;

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

const CONF_TARGET = 0.75;
const MAX_ROUNDS = 8;
const OTHER_OPTION = "Other / Not listed";

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

/* -------------------- inference state -------------------- */

function firstQuestionFallback() {
  return {
    id: "sub_start",
    question: "To tailor your setup, what kind of work do you focus on within this industry?",
    help: "Examples: exterior only, interiors, cabinets, commercial, new construction, repaints, specialty work, etc.",
    inputType: "text" as const,
  };
}

function firstQuestionFromDefaults(defaults: DefaultSub[]) {
  const opts = defaults.map((d) => d.label).slice(0, 12);
  const options = [...opts, OTHER_OPTION];

  return {
    id: "sub_pick_default",
    question: "Which sub-industry best matches your focus?",
    help: "Pick the closest option. If yours isn’t listed, choose “Other / Not listed”.",
    inputType: "select" as const,
    options,
  };
}

function freshState(industryKey: string, defaults: DefaultSub[]): SubIndustryInterview {
  const now = new Date().toISOString();
  const ik = normalizeKey(industryKey) || safeTrim(industryKey);

  return {
    mode: "SUB",
    status: "collecting",
    round: 1,
    industryKey: ik,
    confidenceScore: 0,

    proposedSubIndustryKey: null,
    proposedSubIndustryLabel: null,

    candidates: defaults.slice(0, 6).map((d) => ({ key: d.key, label: d.label, score: 0 })),

    nextQuestion: defaults.length ? firstQuestionFromDefaults(defaults) : firstQuestionFallback(),
    answers: [],
    meta: { updatedAt: now },
  };
}

function ensureSub(ai: any | null, industryKey: string, defaults: DefaultSub[]): { ai: any; st: SubIndustryInterview } {
  const now = new Date().toISOString();
  const baseAi = ai && typeof ai === "object" ? ai : {};
  const existing = baseAi?.subIndustryInterview;

  const ik = normalizeKey(industryKey) || safeTrim(industryKey);

  if (existing && typeof existing === "object" && existing?.mode === "SUB") {
    const proposedLabel = safeTrim(existing.proposedSubIndustryLabel) || null;
    const proposedKey = normalizeKey((existing as any).proposedSubIndustryKey ?? "") || null;

    // ✅ don't allow "locked" with no proposed label
    const status: "collecting" | "locked" = existing.status === "locked" && proposedLabel ? "locked" : "collecting";

    const st: SubIndustryInterview = {
      mode: "SUB",
      status,
      round: Number(existing.round ?? 1) || 1,
      industryKey: normalizeKey(existing.industryKey) || ik,
      confidenceScore: clamp01(existing.confidenceScore ?? 0),

      proposedSubIndustryKey: proposedKey,
      proposedSubIndustryLabel: proposedLabel,

      candidates: Array.isArray(existing.candidates) ? existing.candidates : [],
      nextQuestion: existing.nextQuestion ?? null,
      answers: Array.isArray(existing.answers) ? existing.answers : [],
      meta: { updatedAt: now, ...(existing.meta ?? {}) },
    };

    // If industry changed, reset (different context)
    if (normalizeKey(st.industryKey) && ik && normalizeKey(st.industryKey) !== ik) {
      const fresh = freshState(ik, defaults);
      baseAi.subIndustryInterview = fresh;
      return { ai: baseAi, st: fresh };
    }

    // If we have defaults and the current nextQuestion is missing, give a deterministic one
    if (defaults.length && !st.nextQuestion && st.status !== "locked") {
      st.nextQuestion = firstQuestionFromDefaults(defaults);
    }

    baseAi.subIndustryInterview = st;
    return { ai: baseAi, st };
  }

  const st = freshState(ik, defaults);
  baseAi.subIndustryInterview = st;
  return { ai: baseAi, st };
}

function buildTranscript(st: SubIndustryInterview) {
  return st.answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n");
}

/* -------------------- LLM -------------------- */

async function runLLM_Sub(args: {
  st: SubIndustryInterview;
  action: "start" | "answer";
  defaults: DefaultSub[];
}): Promise<{
  confidenceScore: number;
  proposedSubIndustryKey: string | null;
  proposedSubIndustryLabel: string | null;
  candidates: Candidate[];
  nextQuestion: SubIndustryInterview["nextQuestion"];
  debugReason?: string;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing in the environment.");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini";

  const askedQuestions = new Set(args.st.answers.map((a) => safeTrim(a.question).toLowerCase()).filter(Boolean));
  const transcript = buildTranscript(args.st);

  const defaultLines =
    args.defaults.length > 0
      ? args.defaults
          .slice(0, 30)
          .map((d) => `${d.key} = ${d.label}`)
          .join("\n")
      : "(none)";

  const system = [
    "You are the onboarding interviewer for a platform called AIPhotoQuote.",
    "Goal: identify a concise sub-industry under the given industry key.",
    "",
    "Rules:",
    "- Output ONLY valid JSON (no markdown, no prose).",
    "- Never repeat a question that was already asked.",
    "- Keep the sub-industry label short, human-friendly (2–6 words).",
    "- Prefer labels that help tailor defaults (services, photos, questions).",
    "- If platform defaults are provided, prefer one of them when it fits.",
    "",
    "When you are confident enough (>=0.75), propose a final subIndustryKey + subIndustryLabel and stop asking questions (nextQuestion = null).",
    "Otherwise ask the next best targeted question.",
  ].join("\n");

  const user = [
    `Action: ${args.action}`,
    `Industry key context: ${safeTrim(args.st.industryKey) || "(unknown)"}`,
    "",
    "Platform default sub-industries (key = label):",
    defaultLines,
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
        subIndustryKey: "interior_painting",
        subIndustryLabel: "Interior Painting",
        candidates: [{ key: "exterior_painting", label: "Exterior Painting", score: 0.0 }],
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

  const confidenceScore = clamp01((parsed as any).confidenceScore ?? 0);

  const keyRaw = normalizeKey((parsed as any).subIndustryKey ?? "");
  const labelRaw = safeTrim((parsed as any).subIndustryLabel ?? "");

  // Try to map to platform defaults if possible (canonical)
  const defaults = args.defaults;
  const fromDefault =
    (keyRaw ? defaults.find((d) => normalizeKey(d.key) === keyRaw) : null) ||
    (labelRaw ? defaults.find((d) => safeTrim(d.label).toLowerCase() === labelRaw.toLowerCase()) : null);

  const proposedSubIndustryKey = fromDefault ? fromDefault.key : keyRaw || (labelRaw ? normalizeKey(labelRaw) : "");
  const proposedSubIndustryLabel = fromDefault
    ? fromDefault.label
    : labelRaw
      ? labelRaw.slice(0, 64)
      : proposedSubIndustryKey
        ? titleFromKey(proposedSubIndustryKey)
        : null;

  const candRaw = Array.isArray((parsed as any).candidates) ? (parsed as any).candidates : [];
  const candidates: Candidate[] = candRaw
    .map((c: any) => {
      const ck = normalizeKey(c?.key ?? "");
      const cl = safeTrim(c?.label ?? "");
      const mapped =
        (ck ? defaults.find((d) => normalizeKey(d.key) === ck) : null) ||
        (cl ? defaults.find((d) => safeTrim(d.label).toLowerCase() === cl.toLowerCase()) : null);

      return {
        key: mapped ? mapped.key : ck || (cl ? normalizeKey(cl) : ""),
        label: mapped ? mapped.label : cl || (ck ? titleFromKey(ck) : ""),
        score: clamp01(c?.score ?? 0),
      };
    })
    .filter((c: Candidate) => Boolean(c.label))
    .slice(0, 6);

  let nextQuestion: any = (parsed as any).nextQuestion ?? null;
  if (nextQuestion && typeof nextQuestion === "object") {
    const q = safeTrim(nextQuestion.question);
    const qLower = q.toLowerCase();
    if (!q || askedQuestions.has(qLower)) {
      nextQuestion = null;
    } else {
      nextQuestion = {
        id: safeTrim(nextQuestion.id) || `subq_${Date.now()}`,
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
    proposedSubIndustryKey: proposedSubIndustryKey ? proposedSubIndustryKey.slice(0, 64) : null,
    proposedSubIndustryLabel: proposedSubIndustryLabel || null,
    candidates,
    nextQuestion,
    debugReason: safeTrim((parsed as any).debugReason ?? ""),
  };
}

/* -------------------- schema -------------------- */

const PostSchema = z.object({
  tenantId: z.string().min(1),
  industryKey: z.string().min(1),
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
    const industryKeyInput = safeTrim(parsed.data.industryKey);
    const industryKey = normalizeKey(industryKeyInput) || industryKeyInput;

    await requireMembership(clerkUserId, tenantId);

    // ✅ pull defaults first (drives deterministic UX)
    const defaults = await listDefaultSubIndustries(industryKey);

    const ai0 = await readAiAnalysis(tenantId);
    const { ai, st: st0 } = ensureSub(ai0, industryKey, defaults);

    const now = new Date().toISOString();
    let st: SubIndustryInterview = { ...st0, meta: { ...(st0.meta ?? {}), updatedAt: now } };

    if (parsed.data.action === "reset") {
      st = freshState(industryKey, defaults);
      ai.subIndustryInterview = st;
      await writeAiAnalysis(tenantId, ai);
      return noCacheJson({ ok: true, tenantId, subIndustryInterview: st }, 200);
    }

    if (parsed.data.action === "start") {
      // ✅ Idempotent: if locked or already has a question, return it
      if (st.status === "locked" || st.nextQuestion?.id) {
        ai.subIndustryInterview = st;
        await writeAiAnalysis(tenantId, ai);
        return noCacheJson({ ok: true, tenantId, subIndustryInterview: st }, 200);
      }

      // ✅ If defaults exist: do NOT call LLM. Ask deterministic select question.
      if (defaults.length) {
        st = {
          ...st,
          status: "collecting",
          round: 1,
          confidenceScore: 0,
          proposedSubIndustryKey: null,
          proposedSubIndustryLabel: null,
          candidates: defaults.slice(0, 6).map((d) => ({ key: d.key, label: d.label, score: 0 })),
          nextQuestion: firstQuestionFromDefaults(defaults),
          meta: {
            updatedAt: now,
            model: { name: "defaults", status: "ok" },
            debug: { reason: "Presented platform default sub-industries (no LLM call)." },
          },
        };

        ai.subIndustryInterview = st;
        await writeAiAnalysis(tenantId, ai);
        return noCacheJson({ ok: true, tenantId, subIndustryInterview: st }, 200);
      }

      // ✅ No defaults: open the interview (LLM-driven)
      try {
        const out = await runLLM_Sub({ st, action: "start", defaults });

        const locked = out.confidenceScore >= CONF_TARGET && Boolean(out.proposedSubIndustryLabel);

        st = {
          ...st,
          status: locked ? "locked" : "collecting",
          round: 1,
          confidenceScore: out.confidenceScore,
          proposedSubIndustryKey: locked ? out.proposedSubIndustryKey : null,
          proposedSubIndustryLabel: locked ? out.proposedSubIndustryLabel : null,
          candidates: out.candidates?.length
            ? out.candidates
            : out.proposedSubIndustryLabel
              ? [{ key: out.proposedSubIndustryKey || undefined, label: out.proposedSubIndustryLabel, score: out.confidenceScore }]
              : [],
          nextQuestion: locked ? null : out.nextQuestion ?? firstQuestionFallback(),
          meta: {
            updatedAt: now,
            model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "ok" },
            debug: { reason: out.debugReason || undefined },
          },
        };

        ai.subIndustryInterview = st;
        await writeAiAnalysis(tenantId, ai);

        return noCacheJson({ ok: true, tenantId, subIndustryInterview: st }, 200);
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

        ai.subIndustryInterview = st;
        await writeAiAnalysis(tenantId, ai);

        return noCacheJson({ ok: true, tenantId, subIndustryInterview: st }, 200);
      }
    }

    // action === "answer"
    const qid = safeTrim(parsed.data.questionId);
    const qTextFromBody = safeTrim(parsed.data.questionText);
    const qTextFromState = safeTrim(st.nextQuestion?.question);
    const qText = qTextFromBody || qTextFromState;

    const ansRaw = parsed.data.answer;
    const ans = typeof ansRaw === "string" ? safeTrim(ansRaw) : safeTrim(ansRaw == null ? "" : JSON.stringify(ansRaw));

    if (!qText || !ans) {
      return noCacheJson(
        { ok: false, error: "ANSWER_REQUIRED", message: "questionText (or active question) and answer are required." },
        400
      );
    }

    // ✅ If we asked the defaults select question, and the user picked a default:
    // lock immediately with canonical key+label (no LLM, perfect normalization).
    if (normalizeKey(st.nextQuestion?.id) === "sub_pick_default" && defaults.length) {
      const picked = safeTrim(ans);

      if (picked && picked !== OTHER_OPTION) {
        const d = findDefaultByKeyOrLabel(defaults, picked);

        if (d) {
          const answers = Array.isArray(st.answers) ? [...st.answers] : [];
          const last = answers.length ? answers[answers.length - 1] : null;

          const lastSame =
            last &&
            safeTrim(last.question).toLowerCase() === safeTrim(qText).toLowerCase() &&
            safeTrim(last.answer).toLowerCase() === safeTrim(picked).toLowerCase();

          if (!lastSame) {
            answers.push({
              id: qid || `suba_${Date.now()}`,
              question: qText,
              answer: picked,
              createdAt: now,
            });
          }

          st = {
            ...st,
            answers,
            status: "locked",
            confidenceScore: 0.95,
            proposedSubIndustryKey: d.key,
            proposedSubIndustryLabel: d.label,
            candidates: [{ key: d.key, label: d.label, score: 0.95 }],
            nextQuestion: null,
            meta: {
              updatedAt: now,
              model: { name: "defaults", status: "ok" },
              debug: { reason: "User selected platform default; locked without LLM." },
            },
          };

          ai.subIndustryInterview = st;
          await writeAiAnalysis(tenantId, ai);

          return noCacheJson({ ok: true, tenantId, subIndustryInterview: st }, 200);
        }
      }

      // If they chose "Other", fall through and treat it like a text interview next.
      // We do NOT lock here.
    }

    // ✅ Server-side dedupe: don’t append identical last turn (double-tap / retry)
    const answers = Array.isArray(st.answers) ? [...st.answers] : [];
    const last = answers.length ? answers[answers.length - 1] : null;

    const lastSame =
      last &&
      safeTrim(last.question).toLowerCase() === safeTrim(qText).toLowerCase() &&
      safeTrim(last.answer).toLowerCase() === safeTrim(ans).toLowerCase();

    if (!lastSame) {
      answers.push({
        id: qid || `suba_${Date.now()}`,
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

    const hitMax = st.round >= MAX_ROUNDS;

    try {
      const out = await runLLM_Sub({ st, action: "answer", defaults });

      const locked = (out.confidenceScore >= CONF_TARGET && Boolean(out.proposedSubIndustryLabel)) || hitMax;

      // pick best final label/key
      const finalKey = out.proposedSubIndustryKey || st.proposedSubIndustryKey || null;
      const finalLabel = out.proposedSubIndustryLabel || st.proposedSubIndustryLabel || (finalKey ? titleFromKey(finalKey) : null);

      st = {
        ...st,
        status: locked && finalLabel ? "locked" : "collecting",
        confidenceScore: out.confidenceScore,
        proposedSubIndustryKey: locked && finalLabel ? finalKey : null,
        proposedSubIndustryLabel: locked && finalLabel ? finalLabel : null,
        candidates: out.candidates?.length
          ? out.candidates
          : finalLabel
            ? [{ key: finalKey || undefined, label: finalLabel, score: out.confidenceScore }]
            : [],
        nextQuestion:
          locked
            ? null
            : // if defaults exist and we’re still collecting, prefer asking the deterministic picker again
              defaults.length
              ? firstQuestionFromDefaults(defaults)
              : out.nextQuestion ?? firstQuestionFallback(),
        meta: {
          updatedAt: now,
          model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "ok" },
          debug: { reason: out.debugReason || undefined },
        },
      };

      ai.subIndustryInterview = st;
      await writeAiAnalysis(tenantId, ai);

      return noCacheJson({ ok: true, tenantId, subIndustryInterview: st }, 200);
    } catch (e: any) {
      st = {
        ...st,
        status: "collecting",
        nextQuestion: defaults.length ? firstQuestionFromDefaults(defaults) : firstQuestionFallback(),
        meta: {
          updatedAt: now,
          model: {
            name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini",
            status: "llm_error",
            error: e?.message ?? String(e),
          },
        },
      };

      ai.subIndustryInterview = st;
      await writeAiAnalysis(tenantId, ai);

      return noCacheJson({ ok: true, tenantId, subIndustryInterview: st }, 200);
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return noCacheJson({ ok: false, error: "INTERNAL", message: msg }, status);
  }
}