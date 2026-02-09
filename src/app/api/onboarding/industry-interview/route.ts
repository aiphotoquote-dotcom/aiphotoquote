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

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function stableCandidates(cands: Candidate[], canon: Array<{ key: string; label: string }>) {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cands) {
    const k = normalizeKey(c.key);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const label = safeTrim(c.label) || canon.find((x) => x.key === k)?.label || titleFromKey(k);
    out.push({ key: k, label, score: Number(c.score ?? 0) || 0 });
    if (out.length >= 6) break;
  }
  if (!out.length) out.push({ key: "service", label: "Service", score: 0 });
  return out;
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
 * Bank qids are the ONLY qids we allow the UI flow to use.
 * (This is what stops the “repeating / dead / same question” feel.)
 */
const QUESTION_BANK: Array<{ qid: string; question: string; help?: string; options?: string[] }> = [
  {
    qid: "services",
    question: "What do you primarily do?",
    help: "Pick the closest match.",
    options: [
      "Auto detailing / ceramic coating",
      "Auto repair / mechanic",
      "Auto body / collision",
      "Vehicle wraps / vinyl graphics",
      "Window treatments (blinds/shades)",
      "Painting contractor",
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
    qid: "top_jobs",
    question: "Name 2–3 common jobs you quote.",
    help: "Example: “paint correction, interior detail, wash packages”.",
  },
  {
    qid: "keywords",
    question: "What keywords do customers use to find you?",
    help: "Example: “ceramic coating”, “wraps”, “blinds”, “paint correction”, “PPF”.",
  },
  {
    qid: "freeform",
    question: "Describe your business in one sentence.",
    help: "Example: “We install custom blinds and shades for homes and offices.”",
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

async function ensureIndustryExists(args: { keyOrLabel: string; label?: string; description?: string | null }) {
  const key = normalizeKey(args.keyOrLabel);
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
      status: suggestedIndustryKey ? "suggested" : "collecting",
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

function nextUnansweredFromBank(inf: IndustryInference) {
  const answered = new Set(inf.answers.map((a) => a.qid));
  const q = QUESTION_BANK.find((x) => !answered.has(x.qid));
  return q ?? null;
}

function pickNextQuestionDeterministic(inf: IndustryInference) {
  // Make it feel alive: if they haven’t answered “services” yet, always ask that first.
  const answered = new Set(inf.answers.map((a) => a.qid));
  if (!answered.has("services")) return QUESTION_BANK.find((q) => q.qid === "services") ?? null;
  return nextUnansweredFromBank(inf);
}

/* -------------------- heuristic fallback (only if LLM fails) -------------------- */

function heuristicSuggestIndustry(text: string) {
  const t = text.toLowerCase();

  if (/(wrap|wrapped|wrapping|vinyl|graphics|decal|lettering)/i.test(t)) return { key: "vehicle_wraps", conf: 0.78 };
  if (/(blinds|shade|shades|window treatment|window coverings|drapes|curtain)/i.test(t))
    return { key: "window_treatments", conf: 0.80 };
  if (/(paint|painting|interior paint|exterior paint|painter)/i.test(t)) return { key: "painting_contractors", conf: 0.78 };

  if (/(ceramic|coating|paint correction|detail|detailing|wax|wash|buff|polish|ppf)/i.test(t))
    return { key: "auto_detailing", conf: 0.74 };
  if (/(mechanic|brake|engine|oil change|diagnostic|repair)/i.test(t)) return { key: "auto_repair", conf: 0.72 };
  if (/(collision|auto body|body shop|dent|bumper|panel)/i.test(t)) return { key: "auto_repair_collision", conf: 0.72 };
  if (/(upholster|vinyl|leather|canvas|headliner|marine|sew)/i.test(t)) return { key: "upholstery", conf: 0.72 };
  if (/(asphalt|sealcoat|driveway|parking lot|paving|concrete)/i.test(t)) return { key: "paving_contractor", conf: 0.72 };
  if (/(cleaning|janitor|maid|deep clean|pressure wash)/i.test(t)) return { key: "cleaning_services", conf: 0.70 };

  return { key: "service", conf: 0.1 };
}

/* -------------------- REAL AI (LLM) -------------------- */

function buildInterviewText(inf: IndustryInference) {
  return inf.answers
    .map((a) => `- (${a.qid}) ${a.question}\n  Answer: ${a.answer}`)
    .join("\n");
}

function allowedNextQids(inf: IndustryInference) {
  const answered = new Set(inf.answers.map((a) => a.qid));
  return QUESTION_BANK.map((q) => q.qid).filter((qid) => !answered.has(qid));
}

const LlmOutSchema = z.object({
  suggestedIndustryKey: z.string().nullable().optional(),
  confidenceScore: z.number().min(0).max(1),
  candidates: z.array(z.object({ key: z.string(), label: z.string().optional(), score: z.number().optional() })).min(1).max(6),
  // We only accept nextQuestion.qid if it's one of allowedNextQids (validated after parse)
  nextQuestion: z
    .object({
      qid: z.string(),
      question: z.string(),
      help: z.string().optional(),
      options: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  newIndustry: z
    .object({
      key: z.string(),
      label: z.string(),
      description: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  debugReason: z.string().optional(),
});

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

  const model = process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini";

  const allowedQids = allowedNextQids(args.inf);
  const canonList = args.canon.slice(0, 600).map((c) => `${c.key} — ${c.label}`).join("\n");
  const history = buildInterviewText(args.inf);

  const system = [
    "You are the onboarding classifier for AIPhotoQuote.",
    "Goal: infer the best-fit industry starter pack AND choose the next best interview question.",
    "",
    "Hard rules:",
    "- Output MUST be valid JSON matching the provided JSON schema.",
    "- suggestedIndustryKey MUST be snake_case.",
    "- confidenceScore is 0..1.",
    "- candidates: 3-6 items with { key, label, score } (score can be any numeric ranking).",
    "- nextQuestion.qid MUST be one of the allowedNextQids provided (never repeat).",
    "- If the correct industry is missing, propose newIndustry { key, label, description? }.",
    "",
    "First-class industries we DO want if detected:",
    "- vehicle_wraps (vinyl wraps / graphics / decals)",
    "- window_treatments (blinds / shades / window coverings)",
    "- painting_contractors (interior/exterior painting)",
  ].join("\n");

  const user = [
    `Action: ${args.action}`,
    "",
    "Canonical industries (key — label):",
    canonList || "(none)",
    "",
    "Allowed next qids:",
    allowedQids.join(", ") || "(none)",
    "",
    "Interview so far:",
    history || "(none yet)",
  ].join("\n");

  // Use strict JSON schema output to eliminate “prose + JSON” and missing fields.
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // @ts-ignore - supported by OpenAI chat.completions on modern models
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "IndustryInterviewDecision",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            suggestedIndustryKey: { type: ["string", "null"] },
            confidenceScore: { type: "number", minimum: 0, maximum: 1 },
            candidates: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  key: { type: "string" },
                  label: { type: "string" },
                  score: { type: "number" },
                },
                required: ["key"],
              },
            },
            nextQuestion: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    qid: { type: "string" },
                    question: { type: "string" },
                    help: { type: "string" },
                    options: { type: "array", items: { type: "string" } },
                  },
                  required: ["qid", "question"],
                },
              ],
            },
            newIndustry: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    key: { type: "string" },
                    label: { type: "string" },
                    description: { type: ["string", "null"] },
                  },
                  required: ["key", "label"],
                },
              ],
            },
            debugReason: { type: "string" },
          },
          required: ["confidenceScore", "candidates"],
        },
      },
    },
  });

  const content = resp.choices?.[0]?.message?.content ?? "";
  let parsedJson: any;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new Error("LLM returned non-JSON output.");
  }

  const parsed = LlmOutSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("LLM returned JSON that failed validation.");
  }

  const suggested = normalizeKey(parsed.data.suggestedIndustryKey ?? "");
  const confidenceScore = clamp01(parsed.data.confidenceScore);

  const rawCandidates: Candidate[] = (parsed.data.candidates ?? []).map((c) => ({
    key: normalizeKey(c.key ?? ""),
    label: safeTrim((c as any).label ?? ""),
    score: Number((c as any).score ?? 0) || 0,
  }));

  const candidates = stableCandidates(rawCandidates, args.canon);
  const topKey = candidates[0]?.key || "service";

  // nextQuestion must be one of allowed qids (or null)
  let nextQuestion: IndustryInference["nextQuestion"] = null;
  if (parsed.data.nextQuestion && typeof parsed.data.nextQuestion === "object") {
    const qid = safeTrim(parsed.data.nextQuestion.qid);
    const ok = allowedQids.includes(qid);
    if (ok) {
      const q = QUESTION_BANK.find((x) => x.qid === qid);
      nextQuestion = {
        qid,
        question: safeTrim(parsed.data.nextQuestion.question) || q?.question || "Describe your business in one sentence.",
        help: safeTrim(parsed.data.nextQuestion.help) || q?.help || undefined,
        options: Array.isArray(parsed.data.nextQuestion.options) ? parsed.data.nextQuestion.options.map((x) => safeTrim(x)).filter(Boolean) : q?.options,
      };
    }
  }

  // newIndustry proposal
  let newIndustry: any = null;
  if (parsed.data.newIndustry && typeof parsed.data.newIndustry === "object") {
    const nk = normalizeKey(parsed.data.newIndustry.key ?? "");
    const nl = safeTrim(parsed.data.newIndustry.label ?? "");
    if (nk && nl) {
      newIndustry = { key: nk, label: nl, description: parsed.data.newIndustry.description ?? null };
    }
  }

  return {
    suggestedIndustryKey: suggested || topKey || null,
    confidenceScore,
    candidates,
    nextQuestion,
    newIndustry,
    debugReason: safeTrim(parsed.data.debugReason ?? ""),
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

    const now = new Date().toISOString();

    let inf: IndustryInference = {
      ...inf0,
      meta: { ...(inf0.meta ?? {}), updatedAt: now },
      // hardening: never allow undefined arrays
      answers: Array.isArray(inf0.answers) ? inf0.answers : [],
      candidates: Array.isArray(inf0.candidates) ? inf0.candidates : [],
    };

    if (parsed.data.action === "reset") {
      inf = {
        mode: "interview",
        status: "collecting",
        round: 1,
        confidenceScore: 0,
        suggestedIndustryKey: null,
        needsConfirmation: true,
        nextQuestion: pickNextQuestionDeterministic({
          ...inf,
          answers: [],
        }) ?? {
          qid: "services",
          question: "What do you primarily do?",
          help: "Pick the closest match.",
          options: QUESTION_BANK.find((q) => q.qid === "services")?.options ?? [],
        },
        answers: [],
        candidates: [{ key: "service", label: "Service", score: 0 }],
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
      // If we already have answers, don't re-ask; otherwise start with "services" to feel alive.
      const q0 = pickNextQuestionDeterministic(inf) ?? QUESTION_BANK.find((q) => q.qid === "services") ?? QUESTION_BANK[0];

      // Try LLM, but always return a complete IndustryInference even if LLM fails.
      try {
        const out = await runLLM({ canon, inf, action: "start" });

        if (out.newIndustry?.key && out.newIndustry?.label) {
          await ensureIndustryExists({
            keyOrLabel: out.newIndustry.key,
            label: out.newIndustry.label,
            description: out.newIndustry.description ?? null,
          });
        }

        if (out.suggestedIndustryKey) {
          const existsInCanon = canon.some((c) => c.key === out.suggestedIndustryKey);
          if (!existsInCanon) {
            await ensureIndustryExists({ keyOrLabel: out.suggestedIndustryKey, label: titleFromKey(out.suggestedIndustryKey) });
          }
        }

        const candidates = stableCandidates(out.candidates ?? [], canon);

        // On start, we NEVER allow nextQuestion to be null.
        const nextQuestion =
          out.nextQuestion ??
          q0 ??
          ({
            qid: "freeform",
            question: "Describe your business in one sentence.",
            help: "Be specific: what you do + what you work on.",
          } as const);

        inf = {
          ...inf,
          status: "collecting",
          suggestedIndustryKey: out.suggestedIndustryKey || candidates[0]?.key || null,
          confidenceScore: clamp01(out.confidenceScore),
          candidates,
          nextQuestion,
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
        const candidates = stableCandidates(inf.candidates ?? [{ key: "service", label: "Service", score: 0 }], canon);

        inf = {
          ...inf,
          status: "collecting",
          suggestedIndustryKey: inf.suggestedIndustryKey ?? candidates[0]?.key ?? null,
          confidenceScore: Number.isFinite(inf.confidenceScore) ? clamp01(inf.confidenceScore) : 0,
          candidates,
          nextQuestion: q0 ?? {
            qid: "freeform",
            question: "Describe your business in one sentence.",
            help: "Example: “We do vehicle wraps and vinyl graphics for cars and vans.”",
          },
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

    // Round bump (cap)
    const nextRound = Math.min(MAX_ROUNDS, (Number(inf.round ?? 1) || 1) + 1);

    inf = {
      ...inf,
      answers,
      round: nextRound,
      meta: { ...(inf.meta ?? {}), updatedAt: now },
    };

    // Try LLM first
    try {
      const out = await runLLM({ canon, inf, action: "answer" });

      if (out.newIndustry?.key && out.newIndustry?.label) {
        await ensureIndustryExists({
          keyOrLabel: out.newIndustry.key,
          label: out.newIndustry.label,
          description: out.newIndustry.description ?? null,
        });
      }

      if (out.suggestedIndustryKey) {
        const existsInCanon = canon.some((c) => c.key === out.suggestedIndustryKey);
        if (!existsInCanon) {
          await ensureIndustryExists({ keyOrLabel: out.suggestedIndustryKey, label: titleFromKey(out.suggestedIndustryKey) });
        }
      }

      const candidates = stableCandidates(out.candidates ?? [], canon);
      const confidenceScore = clamp01(out.confidenceScore);

      const reached = confidenceScore >= CONF_TARGET;
      const status: IndustryInference["status"] = reached ? "suggested" : "collecting";

      let nextQ: IndustryInference["nextQuestion"] = null;
      if (status === "collecting") {
        // Enforce: only bank qids, never repeat
        const answeredQids = new Set(answers.map((a) => a.qid));
        const modelQ = out.nextQuestion && !answeredQids.has(out.nextQuestion.qid) ? out.nextQuestion : null;

        nextQ =
          modelQ ??
          pickNextQuestionDeterministic({ ...inf, answers } as any) ??
          ({
            qid: "freeform",
            question: "Describe your business in one sentence.",
            help: "Be specific: what you do + what you work on.",
          } as const);
      }

      inf = {
        mode: "interview",
        status,
        round: nextRound,
        confidenceScore,
        suggestedIndustryKey: out.suggestedIndustryKey || candidates[0]?.key || null,
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
      // Heuristic fallback: still never return incomplete payload, and never loop the same qid.
      const blob = answers.map((a) => a.answer).join(" | ");
      const h = heuristicSuggestIndustry(blob);

      if (h.key && h.key !== "service") {
        await ensureIndustryExists({ keyOrLabel: h.key, label: titleFromKey(h.key) });
      }

      const confidenceScore = clamp01(h.conf);
      const reached = confidenceScore >= CONF_TARGET;
      const status: IndustryInference["status"] = reached ? "suggested" : "collecting";

      const answered = new Set(answers.map((a) => a.qid));
      const fallbackQ =
        (!answered.has("keywords") ? QUESTION_BANK.find((x) => x.qid === "keywords") : null) ||
        (!answered.has("top_jobs") ? QUESTION_BANK.find((x) => x.qid === "top_jobs") : null) ||
        (!answered.has("work_objects") ? QUESTION_BANK.find((x) => x.qid === "work_objects") : null) ||
        (!answered.has("freeform") ? QUESTION_BANK.find((x) => x.qid === "freeform") : null) ||
        null;

      inf = {
        mode: "interview",
        status,
        round: nextRound,
        confidenceScore,
        suggestedIndustryKey: h.key || null,
        needsConfirmation: true,
        nextQuestion: status === "collecting" ? (fallbackQ ? { ...fallbackQ } : null) : null,
        answers,
        candidates: stableCandidates(
          [
            { key: h.key, label: titleFromKey(h.key), score: Math.round(confidenceScore * 10) },
            { key: "service", label: "Service", score: 0 },
          ],
          canon
        ),
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