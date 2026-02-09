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

function titleFromKey(key: string) {
  const s = safeTrim(key).replace(/[-_]+/g, " ").trim();
  if (!s) return "Service";
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Extract first JSON object from text (fallback if model disobeys). */
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

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
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
  confidenceScore: number;
  suggestedIndustryKey: string | null;
  needsConfirmation: boolean;
  nextQuestion: { qid: string; question: string; help?: string; options?: string[] } | null;
  answers: InterviewAnswer[];
  candidates: Candidate[];
  meta: {
    updatedAt: string;
    model?: { name?: string; status?: "ok" | "llm_error"; error?: string };
    debug?: { reason?: string };
  };
};

/* -------------------- tuning -------------------- */

const CONF_TARGET = 0.82;
const MAX_ROUNDS = 8;

/**
 * Keep this bank “universal” (no industry-specific questions).
 * The LLM chooses from these ONLY (prevents repeats / weird custom qids).
 */
const QUESTION_BANK: Array<{ qid: string; question: string; help?: string; options?: string[] }> = [
  {
    qid: "services",
    question: "What do you primarily do?",
    help: "Pick the closest match.",
    options: [
      "Auto detailing / appearance",
      "Auto repair / mechanic",
      "Auto body / collision",
      "Vehicle wraps / vinyl graphics",
      "Window treatments (blinds/shades)",
      "Upholstery / reupholstery",
      "Paving / asphalt / concrete",
      "Landscaping / hardscaping",
      "HVAC",
      "Plumbing",
      "Electrical",
      "Roofing / siding",
      "Cleaning / janitorial",
      "Other",
    ],
  },
  {
    qid: "work_objects",
    question: "What do you work on most often?",
    help: "Pick the closest match.",
    options: ["Cars/Trucks", "Boats", "Homes", "Businesses", "Roads/Parking lots", "Other"],
  },
  {
    qid: "who_for",
    question: "Who are your customers?",
    help: "Pick the closest match.",
    options: ["Residential", "Commercial", "Both"],
  },
  {
    qid: "top_jobs",
    question: "Name 2–3 common jobs you quote.",
    help: "Example: “wash packages, interior detail, paint correction”.",
  },
  {
    qid: "keywords",
    question: "What keywords do customers use to find you?",
    help: "Example: “ceramic coating”, “wraps”, “custom blinds”, “paint correction”, “PPF”.",
  },
  {
    qid: "freeform",
    question: "Describe your business in one sentence.",
    help: "Be specific: what you do + what you work on.",
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

/**
 * Creates industry ONLY when explicitly proposed by the LLM (design criteria).
 */
async function ensureIndustryExists(args: { key: string; label: string; description?: string | null }) {
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
      status: existing.status === "suggested" ? "suggested" : suggestedIndustryKey ? "suggested" : "collecting",
      round: Number.isFinite(round) && round > 0 ? round : 1,
      confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : 0,
      suggestedIndustryKey,
      needsConfirmation: Boolean(existing.needsConfirmation ?? true),
      nextQuestion: existing.nextQuestion ?? null,
      answers,
      candidates: Array.isArray(existing.candidates) ? existing.candidates : [],
      meta: { updatedAt: now, ...(existing.meta ?? {}) },
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
    meta: { updatedAt: now },
  };

  baseAi.industryInference = inf;
  return { ai: baseAi, inf };
}

function unansweredQids(inf: IndustryInference) {
  const answered = new Set(inf.answers.map((a) => a.qid));
  return QUESTION_BANK.map((q) => q.qid).filter((qid) => !answered.has(qid));
}

function nextUnansweredFromBank(inf: IndustryInference) {
  const answered = new Set(inf.answers.map((a) => a.qid));
  return QUESTION_BANK.find((q) => !answered.has(q.qid)) ?? null;
}

/* -------------------- anti-repetition guard -------------------- */

function tokenize(s: string) {
  return safeTrim(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length >= 3);
}

/**
 * If the next question heavily overlaps the last answer, it feels redundant.
 * Example: last answer "garage doors" + next question "what type of garage doors..."
 * We block that and rotate to a different unanswered Q.
 */
function isEchoQuestion(lastAnswer: string, nextQ: { question: string; help?: string } | null) {
  if (!lastAnswer || !nextQ) return false;
  const a = new Set(tokenize(lastAnswer));
  const q = tokenize(nextQ.question + " " + (nextQ.help ?? ""));
  if (!q.length || a.size === 0) return false;

  let overlap = 0;
  for (const w of q) if (a.has(w)) overlap++;

  const ratio = overlap / Math.max(1, q.length);
  return ratio >= 0.35 && overlap >= 2;
}

function rotateNonEchoQuestion(inf: IndustryInference, proposed: IndustryInference["nextQuestion"]) {
  const last = inf.answers[inf.answers.length - 1]?.answer ?? "";
  if (!isEchoQuestion(last, proposed)) return proposed;

  // rotate to a different unanswered bank question
  const answered = new Set(inf.answers.map((a) => a.qid));
  const candidates = QUESTION_BANK.filter((q) => !answered.has(q.qid));

  // Prefer “dimension-changing” questions first
  const preference = ["who_for", "top_jobs", "keywords", "work_objects", "services", "freeform"];
  for (const qid of preference) {
    const q = candidates.find((x) => x.qid === qid);
    if (q) return { ...q };
  }

  return proposed; // fallback
}

/* -------------------- FALLBACK (non-creative) heuristic -------------------- */
/**
 * This is ONLY used when the LLM fails, and it MUST NOT invent new industries.
 * It may only select from existing canonical industry keys.
 */
function heuristicSuggestIndustry(text: string, canonKeys: Set<string>) {
  const t = text.toLowerCase();

  const signals: Array<{ key: string; re: RegExp; weight: number }> = [
    { key: "window_treatments", re: /(blind|blinds|shade|shades|window treatment|window coverings|drape|curtain)/i, weight: 3 },
    { key: "vehicle_wraps", re: /(wrap|wrapped|wrapping|vinyl|graphics|decal|lettering)/i, weight: 3 },
    { key: "auto_detailing", re: /(detail|detailing|ceramic|coating|paint correction|polish|buff|wax|wash|ppf)/i, weight: 2 },
    { key: "auto_repair", re: /(mechanic|brake|engine|oil change|diagnostic|repair)/i, weight: 2 },
    { key: "auto_repair_collision", re: /(collision|auto body|body shop|dent|bumper|panel)/i, weight: 2 },
    { key: "upholstery", re: /(upholster|vinyl|leather|canvas|headliner|marine|sew)/i, weight: 2 },
    { key: "paving_contractor", re: /(asphalt|sealcoat|driveway|parking lot|paving|concrete)/i, weight: 2 },
    { key: "cleaning_services", re: /(cleaning|janitor|maid|deep clean|pressure wash)/i, weight: 2 },
  ];

  let best: { key: string; score: number } | null = null;
  for (const s of signals) {
    if (!canonKeys.has(s.key)) continue; // IMPORTANT: do not introduce non-canonical industries here
    if (s.re.test(t)) {
      best = !best || s.weight > best.score ? { key: s.key, score: s.weight } : best;
    }
  }

  if (!best) return { key: "service", conf: 0.1 };

  // conservative confidence (fallback)
  const conf = best.score >= 3 ? 0.7 : 0.55;
  return { key: best.key, conf };
}

/* -------------------- REAL AI (LLM) -------------------- */

function buildInterviewText(inf: IndustryInference) {
  return inf.answers.map((a) => `- (${a.qid}) ${a.question}\n  Answer: ${a.answer}`).join("\n");
}

/**
 * LLM is only allowed to pick nextQuestion.qid from the remaining bank.
 * This stops “repeat qid” and stops “made-up qids”.
 */
async function runLLM(args: {
  canon: Array<{ key: string; label: string }>;
  inf: IndustryInference;
  action: "start" | "answer";
}): Promise<{
  suggestedIndustryKey: string | null;
  confidenceScore: number;
  candidates: Candidate[];
  nextQuestion: IndustryInference["nextQuestion"];
  newIndustry?: { key: string; label: string; description?: string | null } | null;
  debugReason?: string;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing in the environment.");

  const client = new OpenAI({ apiKey });

  const remainingQids = unansweredQids(args.inf);
  const canonList = args.canon.slice(0, 500).map((c) => `${c.key} — ${c.label}`).join("\n");
  const history = buildInterviewText(args.inf);

  const system = [
    "You are the onboarding classifier for AIPhotoQuote.",
    "Goal: infer the best-fit industry starter pack and choose the next best question.",
    "Return ONLY valid JSON. No markdown. No extra text.",
    "",
    "Rules:",
    "- suggestedIndustryKey MUST be a key from canonical industries OR you must propose newIndustry.",
    "- confidenceScore must be a number between 0 and 1.",
    "- candidates must be an array of 3-6 items: { key, label, score } (score can be 0-10).",
    "- nextQuestion.qid MUST be one of the allowedRemainingQids list, or null if you're ready.",
    "- Do NOT ask redundant/echo questions (don’t restate the noun they just gave you). Ask a different dimension.",
    "",
    "If correct industry is not in canonical list, propose newIndustry { key, label, description? }.",
    "Examples of distinct industries we want as first-class if detected:",
    "- vehicle_wraps (vinyl wraps / graphics / decals)",
    "- window_treatments (blinds / shades / window coverings)",
  ].join("\n");

  const user = [
    `Action: ${args.action}`,
    "",
    "Allowed remaining question qids:",
    remainingQids.join(", ") || "(none)",
    "",
    "Canonical industries (key — label):",
    canonList || "(none)",
    "",
    "Interview so far:",
    history || "(none yet)",
    "",
    "Return JSON with this exact shape:",
    JSON.stringify(
      {
        suggestedIndustryKey: "canonical_key_or_null",
        confidenceScore: 0.0,
        candidates: [{ key: "canonical_key_or_proposed_key", label: "Label", score: 0 }],
        nextQuestion: { qid: "one_of_allowedRemainingQids", question: "string", help: "string", options: ["a", "b"] },
        newIndustry: { key: "snake_case", label: "Label", description: "optional" },
        debugReason: "short reason",
      },
      null,
      2
    ),
  ].join("\n");

  const model = process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini";

  // NOTE: We keep it compatible across SDK versions by not requiring strict response_format.
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

  const suggestedRaw = normalizeKey(parsed.suggestedIndustryKey ?? "");
  const confidenceScore = clamp01(Number(parsed.confidenceScore ?? 0));

  const candRaw = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const candidates: Candidate[] = candRaw
    .map((c: any) => ({
      key: normalizeKey(c?.key ?? ""),
      label: safeTrim(c?.label ?? ""),
      score: Number(c?.score ?? 0) || 0,
    }))
    .filter((c: Candidate) => c.key);

  // nextQuestion must use remainingQids
  let nextQuestion: any = parsed.nextQuestion ?? null;
  if (nextQuestion && typeof nextQuestion === "object") {
    const qid = safeTrim(nextQuestion.qid);
    if (!qid || !remainingQids.includes(qid)) {
      nextQuestion = null;
    } else {
      nextQuestion = {
        qid,
        question: safeTrim(nextQuestion.question) || QUESTION_BANK.find((q) => q.qid === qid)?.question || "Describe your business in one sentence.",
        help: safeTrim(nextQuestion.help) || QUESTION_BANK.find((q) => q.qid === qid)?.help || undefined,
        options: Array.isArray(nextQuestion.options)
          ? nextQuestion.options.map((x: any) => safeTrim(x)).filter(Boolean)
          : QUESTION_BANK.find((q) => q.qid === qid)?.options,
      };
    }
  } else {
    nextQuestion = null;
  }

  // newIndustry (optional)
  let newIndustry: any = parsed.newIndustry ?? null;
  if (newIndustry && typeof newIndustry === "object") {
    const nk = normalizeKey(newIndustry.key ?? "");
    const nl = safeTrim(newIndustry.label ?? "");
    if (nk && nl) newIndustry = { key: nk, label: nl, description: newIndustry.description == null ? null : String(newIndustry.description) };
    else newIndustry = null;
  } else newIndustry = null;

  // Ensure candidates non-empty
  const finalCandidates =
    candidates.length > 0
      ? candidates.slice(0, 6).map((c) => ({
          key: c.key,
          label: c.label || args.canon.find((x) => x.key === c.key)?.label || titleFromKey(c.key),
          score: c.score,
        }))
      : [{ key: suggestedRaw || "service", label: args.canon.find((x) => x.key === suggestedRaw)?.label || "Service", score: 0 }];

  return {
    suggestedIndustryKey: suggestedRaw || (finalCandidates[0]?.key ?? null),
    confidenceScore,
    candidates: finalCandidates,
    nextQuestion,
    newIndustry,
    debugReason: safeTrim(parsed.debugReason ?? ""),
  };
}

/* -------------------- schema -------------------- */

const PostSchema = z.object({
  tenantId: z.string().min(1),
  action: z.enum(["start", "answer", "reset"]),
  qid: z.string().optional(),
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
    const { ai, inf: inf0 } = ensureInference(ai0);

    const canon = await listCanonicalIndustries();
    const canonKeys = new Set(canon.map((c) => c.key));

    const now = new Date().toISOString();

    let inf: IndustryInference = {
      ...inf0,
      meta: { ...(inf0.meta ?? {}), updatedAt: now },
    };

    if (parsed.data.action === "reset") {
      inf = {
        mode: "interview",
        status: "collecting",
        round: 1,
        confidenceScore: 0,
        suggestedIndustryKey: null,
        needsConfirmation: true,
        nextQuestion: null,
        answers: [],
        candidates: [],
        meta: { updatedAt: now, model: { status: "ok" } },
      };

      ai.industryInference = inf;
      ai.suggestedIndustryKey = null;
      ai.confidenceScore = 0;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
    }

    if (parsed.data.action === "start") {
      // Always ask first unanswered question; LLM can still pre-rank in the background via suggested/candidates
      try {
        const out = await runLLM({ canon, inf, action: "start" });

        // Only create industry when explicitly proposed by LLM
        if (out.newIndustry?.key && out.newIndustry?.label) {
          await ensureIndustryExists({
            key: out.newIndustry.key,
            label: out.newIndustry.label,
            description: out.newIndustry.description ?? null,
          });
        }

        const q0 =
          out.nextQuestion ??
          nextUnansweredFromBank(inf) ??
          ({
            qid: "freeform",
            question: "Describe your business in one sentence.",
            help: "Be specific: what you do + what you work on.",
          } as const);

        const q = rotateNonEchoQuestion(inf, q0);

        inf = {
          ...inf,
          status: "collecting",
          suggestedIndustryKey: out.suggestedIndustryKey && (canonKeys.has(out.suggestedIndustryKey) || out.newIndustry) ? out.suggestedIndustryKey : inf.suggestedIndustryKey,
          confidenceScore: clamp01(out.confidenceScore),
          candidates: Array.isArray(out.candidates) && out.candidates.length ? out.candidates : [{ key: "service", label: "Service", score: 0 }],
          nextQuestion: q,
          needsConfirmation: true,
          meta: {
            updatedAt: now,
            model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "ok" },
            debug: { reason: out.debugReason || undefined },
          },
        };

        ai.industryInference = inf;
        ai.suggestedIndustryKey = inf.suggestedIndustryKey;
        ai.confidenceScore = inf.confidenceScore;
        ai.needsConfirmation = true;

        await writeAiAnalysis(tenantId, ai);
        return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
      } catch (e: any) {
        const q = nextUnansweredFromBank(inf) ?? { qid: "freeform", question: "Describe your business in one sentence." };

        inf = {
          ...inf,
          status: "collecting",
          suggestedIndustryKey: inf.suggestedIndustryKey ?? null,
          confidenceScore: clamp01(inf.confidenceScore),
          candidates: Array.isArray(inf.candidates) && inf.candidates.length ? inf.candidates : [{ key: "service", label: "Service", score: 0 }],
          nextQuestion: q,
          needsConfirmation: true,
          meta: {
            updatedAt: now,
            model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "llm_error", error: e?.message ?? String(e) },
          },
        };

        ai.industryInference = inf;
        await writeAiAnalysis(tenantId, ai);
        return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
      }
    }

    // action === "answer"
    const qid = safeTrim(parsed.data.qid);
    const ansRaw = parsed.data.answer;
    const ans = typeof ansRaw === "string" ? safeTrim(ansRaw) : safeTrim(ansRaw == null ? "" : JSON.stringify(ansRaw));

    if (!qid || !ans) {
      return NextResponse.json({ ok: false, error: "ANSWER_REQUIRED", message: "qid and answer are required." }, { status: 400 });
    }

    // Store answer
    const qFromBank = QUESTION_BANK.find((q) => q.qid === qid);
    const qText = qFromBank?.question ?? qid;

    const answers = Array.isArray(inf.answers) ? [...inf.answers] : [];
    answers.push({ qid, question: qText, answer: ans, createdAt: now });

    inf = {
      ...inf,
      answers,
      round: Math.min(MAX_ROUNDS, (Number(inf.round ?? 1) || 1) + 1),
      meta: { ...(inf.meta ?? {}), updatedAt: now },
    };

    // REAL AI first
    try {
      const out = await runLLM({ canon, inf, action: "answer" });

      if (out.newIndustry?.key && out.newIndustry?.label) {
        await ensureIndustryExists({
          key: out.newIndustry.key,
          label: out.newIndustry.label,
          description: out.newIndustry.description ?? null,
        });
      }

      const reached = out.confidenceScore >= CONF_TARGET;
      const status: IndustryInference["status"] = reached ? "suggested" : "collecting";

      const candidates = Array.isArray(out.candidates) && out.candidates.length ? out.candidates : [{ key: "service", label: "Service", score: 0 }];

      // Only accept suggestedIndustryKey if it is canonical OR it was just proposed as newIndustry
      const suggested =
        out.suggestedIndustryKey && (canonKeys.has(out.suggestedIndustryKey) || out.newIndustry?.key === out.suggestedIndustryKey)
          ? out.suggestedIndustryKey
          : candidates[0]?.key || null;

      let nextQ: IndustryInference["nextQuestion"] = null;
      if (status === "collecting") {
        const answered = new Set(answers.map((a) => a.qid));
        const modelQ = out.nextQuestion && !answered.has(out.nextQuestion.qid) ? out.nextQuestion : null;

        const fallback =
          modelQ ??
          nextUnansweredFromBank({ ...inf, answers } as any) ??
          ({
            qid: "freeform",
            question: "Describe your business in one sentence.",
            help: "Be specific: what you do + what you work on.",
          } as const);

        nextQ = rotateNonEchoQuestion({ ...inf, answers } as any, fallback);
      }

      inf = {
        mode: "interview",
        status,
        round: inf.round,
        confidenceScore: clamp01(out.confidenceScore),
        suggestedIndustryKey: suggested,
        needsConfirmation: true,
        nextQuestion: nextQ,
        answers,
        candidates,
        meta: {
          updatedAt: now,
          model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "ok" },
          debug: { reason: out.debugReason || undefined },
        },
      };

      ai.industryInference = inf;
      ai.suggestedIndustryKey = inf.suggestedIndustryKey;
      ai.confidenceScore = inf.confidenceScore;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
    } catch (e: any) {
      // Fallback heuristic: must not invent new industries
      const blob = answers.map((a) => a.answer).join(" | ");
      const h = heuristicSuggestIndustry(blob, canonKeys);

      const status: IndustryInference["status"] = h.conf >= CONF_TARGET ? "suggested" : "collecting";

      const answered = new Set(answers.map((a) => a.qid));
      const fallbackQ =
        (!answered.has("keywords") ? QUESTION_BANK.find((x) => x.qid === "keywords") : null) ||
        (!answered.has("top_jobs") ? QUESTION_BANK.find((x) => x.qid === "top_jobs") : null) ||
        (!answered.has("who_for") ? QUESTION_BANK.find((x) => x.qid === "who_for") : null) ||
        (!answered.has("work_objects") ? QUESTION_BANK.find((x) => x.qid === "work_objects") : null) ||
        (!answered.has("services") ? QUESTION_BANK.find((x) => x.qid === "services") : null) ||
        (!answered.has("freeform") ? QUESTION_BANK.find((x) => x.qid === "freeform") : null) ||
        null;

      const nextQ =
        status === "collecting"
          ? rotateNonEchoQuestion(
              { ...inf, answers } as any,
              fallbackQ ? { ...fallbackQ } : { qid: "freeform", question: "Describe your business in one sentence." }
            )
          : null;

      inf = {
        mode: "interview",
        status,
        round: inf.round,
        confidenceScore: clamp01(h.conf),
        suggestedIndustryKey: h.key && canonKeys.has(h.key) ? h.key : null,
        needsConfirmation: true,
        nextQuestion: nextQ,
        answers,
        candidates: [
          { key: h.key, label: canon.find((c) => c.key === h.key)?.label || titleFromKey(h.key), score: Math.round(h.conf * 10) },
          { key: "service", label: "Service", score: 0 },
        ],
        meta: {
          updatedAt: now,
          model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "llm_error", error: e?.message ?? String(e) },
        },
      };

      ai.industryInference = inf;
      ai.suggestedIndustryKey = inf.suggestedIndustryKey;
      ai.confidenceScore = inf.confidenceScore;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}