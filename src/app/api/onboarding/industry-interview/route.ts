// src/app/api/onboarding/industry-interview/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

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
  confidenceScore: number;
  suggestedIndustryKey: string | null;
  needsConfirmation: boolean;
  nextQuestion: { qid: string; question: string; help?: string; options?: string[] } | null;
  answers: InterviewAnswer[];
  candidates: Candidate[];
  meta: { updatedAt: string };
};

/* -------------------- tuning -------------------- */

// We want this to feel fast. If we have a strong signal, stop early.
const ConfidenceTarget = 0.82;
const MaxRounds = 8;

// If top two are close, ask a disambiguation question rather than generic ones.
const CloseScoreDelta = 2;

// If the user keeps giving “Other” / vague answers, jump to freeform sooner.
const VagueAnswerThreshold = 2;

/* -------------------- question bank -------------------- */

const QUESTIONS: Array<{
  qid: string;
  question: string;
  help?: string;
  options?: string[];
}> = [
  {
    qid: "services",
    question: "What do you primarily do?",
    help: "Pick the closest match.",
    options: [
      "Upholstery / reupholstery",
      "Paving / asphalt / concrete",
      "Landscaping / hardscaping",
      "HVAC",
      "Plumbing",
      "Electrical",
      "Auto repair / body",
      "Car detailing / ceramic coating",
      "Roofing / siding",
      "Cleaning / janitorial",
      "Other",
    ],
  },
  {
    qid: "materials_objects",
    question: "What do you work on most often?",
    help: "Pick the closest match.",
    options: ["Boats", "Cars/Trucks", "Homes", "Businesses", "Roads/Parking lots", "Other"],
  },
  {
    qid: "job_type",
    question: "What type of work do you quote most?",
    help: "Pick the closest match.",
    options: ["Repairs", "Full replacement", "New installs", "Maintenance", "Mix of these"],
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
    help: "Example: “ceramic coating, paint correction, interior detail” or “brakes, collision repair”.",
  },
  {
    qid: "materials",
    question: "What materials/products do you work with most?",
    help: "Example: “vinyl/leather”, “asphalt”, “pavers”, “clear coat”, “ceramic coating”.",
  },
  {
    qid: "specialty",
    question: "Any specialty keywords customers use to find you?",
    help: "Example: “paint correction”, “PPF”, “marine vinyl”, “sealcoating”, “retaining walls”.",
  },
  {
    qid: "location",
    question: "Where do you operate?",
    help: "City/state or a rough service radius.",
  },
];

/* -------------------- scoring rules -------------------- */

/**
 * Keyword scoring (deterministic).
 * IMPORTANT: We intentionally include “detailing” signals; those were missing before.
 */
const KEYWORDS: Record<string, Array<string | RegExp>> = {
  upholstery: [/upholster/i, /vinyl/i, /leather/i, /canvas/i, /headliner/i, /marine/i, /sew/i],
  paving_contractor: [/asphalt/i, /pav(e|ing)/i, /sealcoat/i, /concrete/i, /driveway/i, /parking lot/i],
  landscaping_hardscaping: [/landscap/i, /hardscap/i, /mulch/i, /pavers/i, /retaining wall/i, /lawn/i],
  hvac: [/hvac/i, /air condition/i, /\bac\b/i, /furnace/i, /heat pump/i],
  plumbing: [/plumb/i, /water heater/i, /drain/i, /sewer/i],
  electrical: [/electric/i, /panel/i, /breaker/i, /wiring/i],
  auto_repair: [/auto repair/i, /collision/i, /body shop/i, /mechanic/i, /brake/i, /engine/i, /transmission/i],
  // We don't assume an "auto_detailing" industry exists in your DB yet.
  // So we map detailing signals into auto_repair for now (best-fit experience bucket).
  auto_detailing_like: [/detail(ing)?/i, /ceramic/i, /paint correction/i, /\bppf\b/i, /polish/i, /buff/i, /wax/i, /interior detail/i],
  roofing: [/roof/i, /shingle/i, /gutter/i, /siding/i],
  cleaning_services: [/clean/i, /janitor/i, /maid/i, /pressure wash/i],
};

/**
 * Strong mapping for option answers.
 * These should dominate over weak keyword matches.
 */
const OPTION_BOOST: Record<string, Array<{ match: RegExp; key: string; points: number }>> = {
  services: [
    { match: /upholstery/i, key: "upholstery", points: 7 },
    { match: /paving|asphalt|concrete/i, key: "paving_contractor", points: 7 },
    { match: /landscap|hardscap/i, key: "landscaping_hardscaping", points: 7 },
    { match: /\bhvac\b/i, key: "hvac", points: 7 },
    { match: /plumb/i, key: "plumbing", points: 7 },
    { match: /electrical/i, key: "electrical", points: 7 },
    { match: /auto repair|body/i, key: "auto_repair", points: 7 },
    { match: /detailing|ceramic/i, key: "auto_repair", points: 6 }, // map detailing into auto_repair bucket for now
    { match: /roof|siding/i, key: "roofing", points: 7 },
    { match: /clean|janitorial/i, key: "cleaning_services", points: 7 },
  ],
  materials_objects: [
    { match: /boats/i, key: "upholstery", points: 3 },
    { match: /cars\/trucks/i, key: "auto_repair", points: 3 },
    { match: /roads|parking/i, key: "paving_contractor", points: 3 },
    { match: /homes/i, key: "landscaping_hardscaping", points: 2 },
    { match: /businesses/i, key: "cleaning_services", points: 1 },
  ],
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

/**
 * Use UPSERT so the interview never crashes even if tenant_onboarding row doesn't exist yet.
 */
async function writeAiAnalysis(tenantId: string, ai: any) {
  await db.execute(sql`
    insert into tenant_onboarding (tenant_id, ai_analysis, updated_at, created_at)
    values (${tenantId}::uuid, ${ai}::jsonb, now(), now())
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
    limit 1000
  `);
  return rowsOf(r).map((x: any) => ({ key: String(x.key), label: String(x.label) }));
}

/* -------------------- inference helpers -------------------- */

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
      meta: { updatedAt: now },
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

function countVague(answers: InterviewAnswer[]) {
  // treat "Other" or very short answers as vague signals
  let n = 0;
  for (const a of answers) {
    const s = safeTrim(a.answer).toLowerCase();
    if (s === "other") n++;
    if (s.length > 0 && s.length < 3) n++;
  }
  return n;
}

function scoreCandidates(answers: InterviewAnswer[], canon: Array<{ key: string; label: string }>): Candidate[] {
  const text = answers.map((a) => a.answer).join(" | ");
  const scores = new Map<string, number>();

  // 1) Keyword scoring
  for (const [k, patterns] of Object.entries(KEYWORDS)) {
    let s = 0;
    for (const p of patterns) {
      if (typeof p === "string") {
        if (text.toLowerCase().includes(p.toLowerCase())) s += 1;
      } else {
        if (p.test(text)) s += 1;
      }
    }
    if (s > 0) scores.set(k, (scores.get(k) ?? 0) + s);
  }

  // Fold “auto_detailing_like” into auto_repair bucket (until we add a canonical industry for detailing)
  if ((scores.get("auto_detailing_like") ?? 0) > 0) {
    const add = scores.get("auto_detailing_like") ?? 0;
    scores.delete("auto_detailing_like");
    scores.set("auto_repair", (scores.get("auto_repair") ?? 0) + add);
  }

  // 2) Option boosts
  for (const a of answers) {
    const boosts = OPTION_BOOST[a.qid] ?? [];
    for (const b of boosts) {
      if (b.match.test(a.answer)) scores.set(b.key, (scores.get(b.key) ?? 0) + b.points);
    }
  }

  const canonKeys = new Set(canon.map((c) => c.key));
  const candidates: Candidate[] = [];

  for (const [k, s] of scores.entries()) {
    // Only keep keys that exist in canonical industries (prevents phantom candidates)
    if (canonKeys.has(k)) {
      const label = canon.find((c) => c.key === k)?.label ?? k;
      candidates.push({ key: k, label, score: s });
    }
  }

  // fallback
  if (!candidates.length) {
    const serviceLabel = canon.find((c) => c.key === "service")?.label ?? "Service";
    candidates.push({ key: "service", label: serviceLabel, score: 0 });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 6);
}

function computeConfidence(cands: Candidate[]) {
  const top = cands[0]?.score ?? 0;
  const second = cands[1]?.score ?? 0;

  if (top <= 0) return 0;

  // Magnitude grows quickly early and then saturates (feels more “alive” than hard caps)
  // Example: top=2 -> ~0.33, top=5 -> ~0.63, top=8 -> ~0.80
  const mag = 1 - Math.exp(-top / 5);

  // Separation: if top is clearly above second, confidence rises
  const sep = top > 0 ? Math.max(0, Math.min(1, (top - second) / Math.max(1, top))) : 0;

  // Combine, biased slightly toward separation once mag is decent
  const conf = 0.6 * mag + 0.4 * sep;
  return Math.max(0, Math.min(1, conf));
}

/**
 * Adaptive next question:
 * - If we’re vague: jump to freeform.
 * - If top two are close: ask a targeted disambiguation question.
 * - Otherwise: ask the next unanswered high-signal question.
 */
function pickNextQuestion(answers: InterviewAnswer[], candidates: Candidate[], round: number) {
  const answered = new Set(answers.map((a) => a.qid));

  // If we already suggested, no next question.
  if (round >= MaxRounds) return null;

  // Too vague? go freeform.
  if (!answered.has("freeform") && countVague(answers) >= VagueAnswerThreshold) {
    return {
      qid: "freeform",
      question: "Describe your business in one sentence.",
      help: "Example: “We do car detailing + ceramic coating and paint correction.”",
    };
  }

  // Close race? disambiguate.
  const top = candidates[0];
  const second = candidates[1];
  if (top && second && Math.abs((top.score ?? 0) - (second.score ?? 0)) <= CloseScoreDelta && !answered.has("disambiguate")) {
    // Lightweight targeted options based on the top keys
    const pair = `${top.key}__${second.key}`;

    // Simple targeted option sets (expand over time)
    const optionMap: Record<string, { question: string; options: string[]; help?: string }> = {
      "auto_repair__cleaning_services": {
        question: "Which is closer to what customers hire you for?",
        options: ["Fix/repair vehicles (mechanical/body)", "Clean/detail vehicles (appearance)", "Both"],
        help: "This helps us choose the right customer photo checklist + estimate style.",
      },
      "cleaning_services__auto_repair": {
        question: "Which is closer to what customers hire you for?",
        options: ["Clean/detail vehicles (appearance)", "Fix/repair vehicles (mechanical/body)", "Both"],
        help: "This helps us choose the right customer photo checklist + estimate style.",
      },
      "upholstery__auto_repair": {
        question: "Which describes you better?",
        options: ["Upholstery/interiors", "Mechanical/body repair", "Both"],
        help: "We’ll load the right templates and photo requests.",
      },
      "auto_repair__upholstery": {
        question: "Which describes you better?",
        options: ["Mechanical/body repair", "Upholstery/interiors", "Both"],
        help: "We’ll load the right templates and photo requests.",
      },
    };

    const hit = optionMap[pair];
    return {
      qid: "disambiguate",
      question: hit?.question ?? "Quick clarification: what’s closest to your work?",
      help: hit?.help ?? "This makes the setup more accurate.",
      options: hit?.options ?? ["Option 1", "Option 2", "Both"],
    };
  }

  // Otherwise pick the next unanswered question, but skip stuff we already know
  // If services answered and is strong, we prioritize objects and top_jobs next.
  const preferredOrder = ["services", "materials_objects", "top_jobs", "specialty", "materials", "job_type", "who_for", "location"];

  for (const qid of preferredOrder) {
    if (!answered.has(qid)) {
      const q = QUESTIONS.find((x) => x.qid === qid);
      if (q) return q;
    }
  }

  // If nothing left, freeform if not answered
  if (!answered.has("freeform")) {
    return {
      qid: "freeform",
      question: "Describe your business in one sentence.",
      help: "Example: “We do collision repair + paint for cars and trucks.”",
    };
  }

  return null;
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

    let inf = { ...inf0 };
    const now = new Date().toISOString();

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
        meta: { updatedAt: now },
      };

      ai.industryInference = inf;
      ai.suggestedIndustryKey = null;
      ai.confidenceScore = 0;
      ai.needsConfirmation = true;

      // Seed the first question immediately so the UI never shows “enough info” on first paint
      const nq = pickNextQuestion(inf.answers, inf.candidates, inf.round);
      ai.industryInference.nextQuestion = nq ? { ...nq } : null;

      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: ai.industryInference }, { status: 200 });
    }

    if (parsed.data.action === "start") {
      // Keep existing answers; just ensure nextQuestion exists
      const candidates = scoreCandidates(inf.answers ?? [], canon);
      const confidenceScore = computeConfidence(candidates);

      const topKey = candidates[0]?.key ? normalizeKey(candidates[0].key) : "";
      const suggestedIndustryKey = topKey || null;

      const reachedTarget = confidenceScore >= ConfidenceTarget;

      const status: IndustryInference["status"] = reachedTarget ? "suggested" : "collecting";

      const nextQ = status === "collecting" ? pickNextQuestion(inf.answers ?? [], candidates, inf.round ?? 1) : null;

      const next: IndustryInference = {
        mode: "interview",
        status,
        round: Number(inf.round ?? 1) || 1,
        confidenceScore,
        suggestedIndustryKey,
        needsConfirmation: true,
        nextQuestion: nextQ ? { ...(nextQ as any) } : null,
        answers: Array.isArray(inf.answers) ? inf.answers : [],
        candidates,
        meta: { updatedAt: now },
      };

      ai.industryInference = next;
      ai.suggestedIndustryKey = suggestedIndustryKey;
      ai.confidenceScore = confidenceScore;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: next }, { status: 200 });
    }

    // action === "answer"
    const qid = safeTrim(parsed.data.qid);
    const ansRaw = parsed.data.answer;

    const ans =
      typeof ansRaw === "string" ? safeTrim(ansRaw) : safeTrim(ansRaw == null ? "" : JSON.stringify(ansRaw));

    if (!qid || !ans) {
      return NextResponse.json(
        { ok: false, error: "ANSWER_REQUIRED", message: "qid and answer are required." },
        { status: 400 }
      );
    }

    const q = QUESTIONS.find((x) => x.qid === qid);
    const qText = q?.question ?? qid;

    const answers = Array.isArray(inf.answers) ? [...inf.answers] : [];
    answers.push({ qid, question: qText, answer: ans, createdAt: now });

    const candidates = scoreCandidates(answers, canon);
    const confidenceScore = computeConfidence(candidates);

    const topKey = candidates[0]?.key ? normalizeKey(candidates[0].key) : "";
    const suggestedIndustryKey = topKey || null;

    const round = Math.min(MaxRounds, (Number(inf.round ?? 1) || 1) + 1);

    const reachedTarget = confidenceScore >= ConfidenceTarget;
    const exhausted = round >= MaxRounds;

    const status: IndustryInference["status"] = reachedTarget || exhausted ? "suggested" : "collecting";

    const nextQ = status === "collecting" ? pickNextQuestion(answers, candidates, round) : null;

    const next: IndustryInference = {
      mode: "interview",
      status,
      round,
      confidenceScore,
      suggestedIndustryKey,
      needsConfirmation: true,
      nextQuestion: nextQ ? { ...(nextQ as any) } : null,
      answers,
      candidates,
      meta: { updatedAt: now },
    };

    ai.industryInference = next;
    ai.suggestedIndustryKey = suggestedIndustryKey;
    ai.confidenceScore = confidenceScore;
    ai.needsConfirmation = true;

    await writeAiAnalysis(tenantId, ai);

    return NextResponse.json({ ok: true, tenantId, industryInference: next }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}