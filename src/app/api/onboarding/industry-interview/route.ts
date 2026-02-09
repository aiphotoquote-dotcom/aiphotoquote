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

function jsonExtract(s: string): any | null {
  // Extract the first top-level JSON object from a string.
  // Works even if the model wraps it in prose.
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
    // extra debug is allowed; UI won’t break if it ignores it
    model?: { name?: string; status?: "ok" | "llm_error"; error?: string };
    debug?: { reason?: string };
  };
};

/* -------------------- tuning -------------------- */

const CONF_TARGET = 0.82;
const MAX_ROUNDS = 8;

/**
 * A small “starter” bank the model can draw from, but the LLM may also write its own.
 * The key rule is: it must not repeat qids already answered.
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
  // ✅ always stringify to jsonb
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

/* -------------------- deterministic “fast heuristics” (fallback only) -------------------- */

function heuristicSuggestIndustry(text: string) {
  const t = text.toLowerCase();

  // IMPORTANT: include your “new industries” that must exist independently
  if (/(wrap|wrapped|wrapping|vinyl|graphics|decal|lettering)/i.test(t)) return { key: "vehicle_wraps", conf: 0.75 };
  if (/(blinds|shade|shades|window treatment|window coverings|drapes|curtain)/i.test(t))
    return { key: "window_treatments", conf: 0.78 };
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
  // allow the model to choose from bank qids + custom qids, but never repeat answered qids
  const bankQids = QUESTION_BANK.map((q) => q.qid).filter((qid) => !answered.has(qid));
  return bankQids.length ? bankQids : ["freeform"];
}

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
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing in the environment.");
  }

  const client = new OpenAI({ apiKey });

  const answeredQids = new Set(args.inf.answers.map((a) => a.qid));
  const allowQids = allowedNextQids(args.inf);

  const canonList = args.canon.slice(0, 400).map((c) => `${c.key} — ${c.label}`).join("\n");

  const history = buildInterviewText(args.inf);
  const last = args.inf.answers[args.inf.answers.length - 1];

  const system = [
    "You are the onboarding classifier for AIPhotoQuote.",
    "Goal: pick the best industry starter pack and ask the next best question.",
    "You MUST output ONLY valid JSON (no markdown, no extra text).",
    "",
    "Rules:",
    "- suggestedIndustryKey MUST be snake_case.",
    "- confidenceScore must be a number between 0 and 1.",
    "- candidates must be an array of 3-6 items, each: { key, label, score }.",
    "- nextQuestion must be an object { qid, question, help?, options? } or null.",
    "- Do NOT repeat an already-answered qid.",
    "- If the correct industry is NOT in canonical industries, propose a new industry via newIndustry { key, label, description? }.",
    "",
    "Examples of distinct industries we DO want as first-class industries if detected:",
    "- vehicle_wraps (vinyl wraps / graphics / decals)",
    "- window_treatments (blinds / shades / window coverings)",
  ].join("\n");

  const user = [
    `Action: ${args.action}`,
    "",
    "Canonical industries (key — label):",
    canonList || "(none)",
    "",
    "Already answered qids:",
    Array.from(answeredQids).join(", ") || "(none)",
    "",
    "Allowed next qids to choose from:",
    allowQids.join(", "),
    "",
    "Interview so far:",
    history || "(none yet)",
    "",
    last ? `Last answer: (${last.qid}) ${last.answer}` : "",
    "",
    "Return JSON with this shape:",
    JSON.stringify(
      {
        suggestedIndustryKey: "string_or_null",
        confidenceScore: 0.0,
        candidates: [{ key: "snake_case", label: "Label", score: 0 }],
        nextQuestion: { qid: "one_of_allowed_next_qids_or_custom", question: "string", help: "string", options: ["a", "b"] },
        newIndustry: { key: "snake_case", label: "Label", description: "optional" },
        debugReason: "short reason for why you chose this",
      },
      null,
      2
    ),
  ].join("\n");

  const model = process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini";

  // chat.completions is the most widely compatible shape across SDK versions
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const content = resp.choices?.[0]?.message?.content ?? "";
  const parsed = jsonExtract(content) ?? null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM returned non-JSON output.");
  }

  const suggested = normalizeKey(parsed.suggestedIndustryKey ?? "");
  const confidence = Number(parsed.confidenceScore ?? 0);
  const confidenceScore = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;

  const candRaw = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const candidates: Candidate[] = candRaw
    .map((c: any) => ({
      key: normalizeKey(c?.key ?? ""),
      label: safeTrim(c?.label ?? ""),
      score: Number(c?.score ?? 0) || 0,
    }))
    .filter((c: Candidate) => c.key);

  // Ensure we always have at least 1 candidate
  const finalCandidates =
    candidates.length > 0
      ? candidates.slice(0, 6)
      : [{ key: suggested || "service", label: safeTrim(args.canon.find((x) => x.key === suggested)?.label) || "Service", score: 0 }];

  // Next question (must not repeat)
  let nextQuestion: any = parsed.nextQuestion ?? null;
  if (nextQuestion && typeof nextQuestion === "object") {
    const qid = safeTrim(nextQuestion.qid);
    if (!qid || answeredQids.has(qid)) {
      nextQuestion = null;
    } else {
      nextQuestion = {
        qid,
        question: safeTrim(nextQuestion.question) || "Describe your business in one sentence.",
        help: safeTrim(nextQuestion.help) || undefined,
        options: Array.isArray(nextQuestion.options) ? nextQuestion.options.map((x: any) => safeTrim(x)).filter(Boolean) : undefined,
      };
    }
  } else {
    nextQuestion = null;
  }

  // newIndustry proposal
  let newIndustry: any = parsed.newIndustry ?? null;
  if (newIndustry && typeof newIndustry === "object") {
    const nk = normalizeKey(newIndustry.key ?? "");
    const nl = safeTrim(newIndustry.label ?? "");
    if (nk && nl) {
      newIndustry = { key: nk, label: nl, description: newIndustry.description == null ? null : String(newIndustry.description) };
    } else {
      newIndustry = null;
    }
  } else {
    newIndustry = null;
  }

  return {
    suggestedIndustryKey: suggested || (finalCandidates[0]?.key ?? null),
    confidenceScore,
    candidates: finalCandidates.map((c) => ({
      key: c.key,
      label: c.label || args.canon.find((x) => x.key === c.key)?.label || titleFromKey(c.key),
      score: c.score,
    })),
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
      // Try LLM first
      try {
        const out = await runLLM({ canon, inf, action: "start" });

        // If model proposes a brand new industry, create it (your “must be its own industry” requirement)
        if (out.newIndustry?.key && out.newIndustry?.label) {
          await ensureIndustryExists({
            keyOrLabel: out.newIndustry.key,
            label: out.newIndustry.label,
            description: out.newIndustry.description ?? null,
          });
        }

        // Also ensure suggested industry exists (even if model didn’t explicitly send newIndustry)
        if (out.suggestedIndustryKey) {
          const existsInCanon = canon.some((c) => c.key === out.suggestedIndustryKey);
          if (!existsInCanon) {
            await ensureIndustryExists({ keyOrLabel: out.suggestedIndustryKey, label: titleFromKey(out.suggestedIndustryKey) });
          }
        }

        // Choose next question (never null on start)
        const q =
          out.nextQuestion ??
          nextUnansweredFromBank(inf) ??
          ({
            qid: "freeform",
            question: "Describe your business in one sentence.",
            help: "Example: “We install custom blinds and shades for homes and offices.”",
          } as const);

        inf = {
          ...inf,
          status: "collecting",
          suggestedIndustryKey: out.suggestedIndustryKey || null,
          confidenceScore: Number.isFinite(out.confidenceScore) ? out.confidenceScore : 0,
          candidates: out.candidates ?? [],
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
        // Fallback: still return a sane object (never undefined fields)
        const fallbackQ =
          nextUnansweredFromBank(inf) ??
          ({
            qid: "freeform",
            question: "Describe your business in one sentence.",
            help: "Example: “We do vehicle wraps and vinyl graphics for cars and vans.”",
          } as const);

        inf = {
          ...inf,
          status: "collecting",
          suggestedIndustryKey: inf.suggestedIndustryKey ?? null,
          confidenceScore: Number.isFinite(inf.confidenceScore) ? inf.confidenceScore : 0,
          candidates: Array.isArray(inf.candidates) && inf.candidates.length ? inf.candidates : [{ key: "service", label: "Service", score: 0 }],
          nextQuestion: fallbackQ,
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

    // Store answer (keep the question text stable if we can)
    const qFromBank = QUESTION_BANK.find((q) => q.qid === qid);
    const qText = qFromBank?.question ?? qid;

    const answers = Array.isArray(inf.answers) ? [...inf.answers] : [];
    answers.push({ qid, question: qText, answer: ans, createdAt: now });

    // Update base inference shell before model call
    inf = {
      ...inf,
      answers,
      round: Math.min(MAX_ROUNDS, (Number(inf.round ?? 1) || 1) + 1),
      meta: { ...(inf.meta ?? {}), updatedAt: now },
    };

    // Try REAL AI first
    try {
      const out = await runLLM({ canon, inf, action: "answer" });

      // Create any new industry the model proposes (this is your “build criteria” requirement)
      if (out.newIndustry?.key && out.newIndustry?.label) {
        await ensureIndustryExists({
          keyOrLabel: out.newIndustry.key,
          label: out.newIndustry.label,
          description: out.newIndustry.description ?? null,
        });
      }

      // Also ensure suggested exists if not in canon yet (covers “wraps” etc even if model skips newIndustry)
      if (out.suggestedIndustryKey) {
        const existsInCanon = canon.some((c) => c.key === out.suggestedIndustryKey);
        if (!existsInCanon) {
          await ensureIndustryExists({ keyOrLabel: out.suggestedIndustryKey, label: titleFromKey(out.suggestedIndustryKey) });
        }
      }

      const reached = out.confidenceScore >= CONF_TARGET;
      const status: IndustryInference["status"] = reached ? "suggested" : "collecting";

      // Pick next question only if still collecting
      let nextQ: IndustryInference["nextQuestion"] = null;
      if (status === "collecting") {
        // Never repeat answered qids
        const answered = new Set(answers.map((a) => a.qid));
        const modelQ = out.nextQuestion && !answered.has(out.nextQuestion.qid) ? out.nextQuestion : null;
        nextQ =
          modelQ ??
          nextUnansweredFromBank({ ...inf, answers } as any) ??
          ({
            qid: "freeform",
            question: "Describe your business in one sentence.",
            help: "Be specific: what you do + what you work on.",
          } as const);
      }

      // Candidates (always non-empty)
      const candidates = Array.isArray(out.candidates) && out.candidates.length ? out.candidates : [{ key: "service", label: "Service", score: 0 }];

      inf = {
        mode: "interview",
        status,
        round: inf.round,
        confidenceScore: out.confidenceScore,
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

      // Mirror for Step3 + downstream
      ai.industryInference = inf;
      ai.suggestedIndustryKey = inf.suggestedIndustryKey;
      ai.confidenceScore = inf.confidenceScore;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
    } catch (e: any) {
      // Fallback heuristic so the flow never becomes “dead”
      const blob = answers.map((a) => a.answer).join(" | ");
      const h = heuristicSuggestIndustry(blob);

      // Ensure heuristic-created “must be its own” industries exist too
      if (h.key && h.key !== "service") {
        await ensureIndustryExists({ keyOrLabel: h.key, label: titleFromKey(h.key) });
      }

      const status: IndustryInference["status"] = h.conf >= CONF_TARGET ? "suggested" : "collecting";

      // Don’t repeat qids endlessly; if freeform already answered, rotate to keywords/top_jobs
      const answered = new Set(answers.map((a) => a.qid));
      const fallbackQ =
        (!answered.has("keywords") ? QUESTION_BANK.find((x) => x.qid === "keywords") : null) ||
        (!answered.has("top_jobs") ? QUESTION_BANK.find((x) => x.qid === "top_jobs") : null) ||
        (!answered.has("services") ? QUESTION_BANK.find((x) => x.qid === "services") : null) ||
        (!answered.has("work_objects") ? QUESTION_BANK.find((x) => x.qid === "work_objects") : null) ||
        null;

      inf = {
        mode: "interview",
        status,
        round: inf.round,
        confidenceScore: h.conf,
        suggestedIndustryKey: h.key || null,
        needsConfirmation: true,
        nextQuestion: status === "collecting" ? (fallbackQ ? { ...fallbackQ } : { qid: "freeform", question: "Describe your business in one sentence." }) : null,
        answers,
        candidates: [
          { key: h.key, label: titleFromKey(h.key), score: Math.round(h.conf * 10) },
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