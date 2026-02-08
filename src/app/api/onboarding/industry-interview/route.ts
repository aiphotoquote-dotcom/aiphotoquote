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

type Conflict =
  | {
      type: "close_call";
      between: [string, string];
      scores: [number, number];
      reason: string;
    }
  | {
      type: "top_flipped";
      from: string;
      to: string;
      reason: string;
    }
  | {
      type: "confidence_plateau";
      prev: number;
      next: number;
      reason: string;
    };

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

  conflicts: Conflict[];

  meta: { updatedAt: string; lastAskedQid?: string | null };
};

/* -------------------- tuning -------------------- */

const ConfidenceTarget = 0.82;
const MaxRounds = 8;

const MinTopScoreForHighConfidence = 3;

// Don’t “lock” just because we hit MaxRounds when still in conflict.
// We can still suggest at exhaustion if there are no blocking conflicts.
const ForceSuggestAtExhaustion = true;

// conflict tuning (deterministic)
const CloseCallMaxGap = 1; // top vs 2nd score <= 1 means ambiguity
const ConfidencePlateauDelta = 0.05; // change < 5% between rounds is "not improving"

/**
 * Question bank (>= MaxRounds recommended).
 * Clarifiers are generated dynamically.
 */
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
      "Auto detailing / ceramic coating",
      "Auto repair / mechanic",
      "Auto body / collision",
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
    qid: "materials_objects",
    question: "What do you work on most often?",
    help: "Pick the closest match.",
    options: ["Cars/Trucks", "Boats", "Homes", "Businesses", "Roads/Parking lots", "Other"],
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
    help: "Example: “ceramic coating, paint correction, interior detail”.",
  },
  {
    qid: "materials",
    question: "What materials or surfaces do you work with most?",
    help: "Example: “clear coat, paint, leather, vinyl, asphalt, pavers”.",
  },
  {
    qid: "specialty",
    question: "Any specialty keywords customers use to find you?",
    help: "Example: “ceramic coating”, “paint correction”, “PPF”, “collision repair”.",
  },
  {
    qid: "location",
    question: "Where do you operate?",
    help: "City/state or a rough service radius.",
  },
];

/**
 * Keyword scoring rules (deterministic).
 */
const KEYWORDS: Record<string, Array<string | RegExp>> = {
  auto_detailing: [
    /detail/i,
    /detailing/i,
    /ceramic/i,
    /coating/i,
    /paint correction/i,
    /\bppf\b/i,
    /polish/i,
    /buff/i,
    /wax/i,
    /\bwash\b/i,
    /\bcar wash\b/i,
    /\binterior detail\b/i,
  ],
  auto_repair: [
    /auto repair/i,
    /mechanic/i,
    /brake/i,
    /engine/i,
    /diagnostic/i,
    /oil change/i,
    /transmission/i,
    /alternator/i,
    /starter/i,
  ],
  auto_repair_collision: [
    /collision/i,
    /body shop/i,
    /auto body/i,
    /\bdent\b/i,
    /bumper/i,
    /panel/i,
    /paint/i,
    /fender/i,
  ],
  upholstery: [/upholster/i, /vinyl/i, /leather/i, /canvas/i, /headliner/i, /marine/i, /sew/i],
  paving_contractor: [/asphalt/i, /pav(e|ing)/i, /sealcoat/i, /concrete/i, /driveway/i, /parking lot/i],
  landscaping_hardscaping: [/landscap/i, /hardscap/i, /mulch/i, /pavers/i, /retaining wall/i, /lawn/i],
  hvac: [/hvac/i, /air condition/i, /\bac\b/i, /furnace/i, /heat pump/i],
  plumbing: [/plumb/i, /water heater/i, /drain/i, /sewer/i],
  electrical: [/electric/i, /panel/i, /breaker/i, /wiring/i],
  roofing: [/roof/i, /shingle/i, /gutter/i, /siding/i],
  cleaning_services: [/clean/i, /janitor/i, /maid/i, /pressure wash/i, /deep clean/i, /move out/i],
};

/**
 * Strong mapping for option answers.
 */
const OPTION_BOOST: Record<string, Array<{ match: RegExp; key: string; points: number }>> = {
  services: [
    { match: /detail|ceramic|coating/i, key: "auto_detailing", points: 6 },
    { match: /auto repair|mechanic/i, key: "auto_repair", points: 6 },
    { match: /collision|body/i, key: "auto_repair_collision", points: 6 },
    { match: /upholstery/i, key: "upholstery", points: 6 },
    { match: /paving|asphalt|concrete/i, key: "paving_contractor", points: 6 },
    { match: /landscap|hardscap/i, key: "landscaping_hardscaping", points: 6 },
    { match: /hvac/i, key: "hvac", points: 6 },
    { match: /plumb/i, key: "plumbing", points: 6 },
    { match: /electrical/i, key: "electrical", points: 6 },
    { match: /roof|siding/i, key: "roofing", points: 6 },
    { match: /clean|janitorial/i, key: "cleaning_services", points: 6 },
  ],
  materials_objects: [
    { match: /cars\/trucks/i, key: "auto_detailing", points: 1 },
    { match: /cars\/trucks/i, key: "auto_repair", points: 1 },
    { match: /cars\/trucks/i, key: "auto_repair_collision", points: 1 },
    { match: /boats/i, key: "upholstery", points: 2 },
    { match: /roads|parking/i, key: "paving_contractor", points: 2 },
    { match: /homes/i, key: "landscaping_hardscaping", points: 1 },
    { match: /homes/i, key: "cleaning_services", points: 1 },
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
    limit 1000
  `);
  return rowsOf(r).map((x: any) => ({ key: String(x.key), label: String(x.label) }));
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
      conflicts: Array.isArray(existing.conflicts) ? existing.conflicts : [],
      meta: { updatedAt: now, lastAskedQid: safeTrim(existing?.meta?.lastAskedQid) || null },
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
    conflicts: [],
    meta: { updatedAt: now, lastAskedQid: null },
  };

  baseAi.industryInference = inf;
  return { ai: baseAi, inf };
}

/* -------------------- scoring -------------------- */

function scoreCandidates(answers: InterviewAnswer[], canon: Array<{ key: string; label: string }>): Candidate[] {
  const text = answers.map((a) => a.answer).join(" | ");
  const scores = new Map<string, number>();

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

  for (const a of answers) {
    const boosts = OPTION_BOOST[a.qid] ?? [];
    for (const b of boosts) {
      if (b.match.test(a.answer)) scores.set(b.key, (scores.get(b.key) ?? 0) + b.points);
    }
  }

  const canonKeys = new Set(canon.map((c) => c.key));
  const candidates: Candidate[] = [];

  for (const [k, s] of scores.entries()) {
    if (canonKeys.size === 0 || canonKeys.has(k)) {
      const label = canon.find((c) => c.key === k)?.label ?? k;
      candidates.push({ key: k, label, score: s });
    }
  }

  if (!candidates.length) {
    candidates.push({
      key: "service",
      label: canon.find((c) => c.key === "service")?.label ?? "Service",
      score: 0,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 6);
}

function computeConfidence(cands: Candidate[]) {
  const top = cands[0]?.score ?? 0;
  const second = cands[1]?.score ?? 0;

  if (top <= 0) return 0;

  if (top < MinTopScoreForHighConfidence) {
    return Math.max(0, Math.min(0.35, top / 8));
  }

  const mag = Math.min(1, top / 10);
  const sep = top > 0 ? Math.max(0, Math.min(1, (top - second) / Math.max(1, top))) : 0;

  const conf = 0.55 * mag + 0.45 * sep;
  return Math.max(0, Math.min(1, conf));
}

/* -------------------- conflicts + clarifiers -------------------- */

function detectConflicts(prev: IndustryInference, nextCandidates: Candidate[], nextConfidence: number): Conflict[] {
  const out: Conflict[] = [];

  const prevTop = prev.candidates?.[0]?.key ? normalizeKey(prev.candidates[0].key) : "";
  const nextTop = nextCandidates?.[0]?.key ? normalizeKey(nextCandidates[0].key) : "";

  if (prevTop && nextTop && prevTop !== nextTop) {
    out.push({ type: "top_flipped", from: prevTop, to: nextTop, reason: "Top match changed after new answers." });
  }

  const top = nextCandidates?.[0];
  const second = nextCandidates?.[1];
  if (top && second) {
    const gap = Math.abs((top.score ?? 0) - (second.score ?? 0));
    if (gap <= CloseCallMaxGap && (top.score ?? 0) > 0) {
      out.push({
        type: "close_call",
        between: [normalizeKey(top.key), normalizeKey(second.key)],
        scores: [top.score, second.score],
        reason: "Top two industries are very close.",
      });
    }
  }

  const prevConf = Number(prev.confidenceScore ?? 0) || 0;
  if (prev.round >= 2 && Math.abs(nextConfidence - prevConf) < ConfidencePlateauDelta) {
    out.push({
      type: "confidence_plateau",
      prev: prevConf,
      next: nextConfidence,
      reason: "Confidence is not improving — need a clarifying question.",
    });
  }

  return out;
}

function hasBlockingConflict(conflicts: Conflict[]) {
  return conflicts.some((c) => c.type === "close_call" || c.type === "top_flipped" || c.type === "confidence_plateau");
}

function clarifierQuestionFrom(conflicts: Conflict[], candidates: Candidate[]) {
  const top = candidates[0];
  const second = candidates[1];

  if (top && second) {
    const a = top.label || top.key;
    const b = second.label || second.key;

    const keyA = normalizeKey(top.key);
    const keyB = normalizeKey(second.key);
    const pair = [keyA, keyB].sort().join("|");

    if (pair === ["auto_detailing", "auto_repair"].sort().join("|")) {
      return {
        qid: "clarify_detail_vs_repair",
        question: "Quick clarification — which best describes you?",
        help: "This prevents mixing ‘detailing’ with ‘mechanic/repair’ templates.",
        options: ["Detailing (wash/polish/wax/coatings)", "Mechanical repair (brakes/engine/diagnostics)", "Both"],
      };
    }

    if (pair === ["auto_detailing", "cleaning_services"].sort().join("|")) {
      return {
        qid: "clarify_detail_vs_cleaning",
        question: "Quick clarification — what do customers usually hire you for?",
        help: "These sound similar, but your starter templates differ a lot.",
        options: [
          "Car detailing (paint/interior + appearance)",
          "General cleaning (homes/businesses/janitorial)",
          "Both / not sure",
        ],
      };
    }

    if (pair === ["auto_repair", "auto_repair_collision"].sort().join("|")) {
      return {
        qid: "clarify_repair_vs_collision",
        question: "Quick clarification — what type of auto work do you do most?",
        help: "This sets the right photo requests and inspection prompts.",
        options: ["Mechanical repair (brakes/engine)", "Collision/body (panels/paint/dents)", "Both"],
      };
    }

    return {
      qid: "clarify_top_two",
      question: "Just to clarify — which is closer to your business?",
      help: "Pick the closest match so we load the right starter pack.",
      options: [a, b, "Something else"],
    };
  }

  return {
    qid: "clarify_freeform",
    question: "Describe your business in one sentence.",
    help: "Example: “We do ceramic coatings + interior detailing for cars and trucks.”",
  };
}

/* -------------------- adaptive + anti-loop question picking -------------------- */

function pickDiscriminatingQid(inf: IndustryInference): string | null {
  const answered = new Set(inf.answers.map((a) => a.qid));

  if (!answered.has("services")) return "services";

  const top = normalizeKey(inf.candidates?.[0]?.key ?? "");
  const second = normalizeKey(inf.candidates?.[1]?.key ?? "");

  const pair = [top, second].filter(Boolean).sort().join("|");

  if (pair.includes("auto_")) {
    if (!answered.has("specialty")) return "specialty";
    if (!answered.has("top_jobs")) return "top_jobs";
    if (!answered.has("job_type")) return "job_type";
    if (!answered.has("materials_objects")) return "materials_objects";
    return null;
  }

  if (["hvac", "plumbing", "electrical", "roofing"].includes(top) || ["hvac", "plumbing", "electrical", "roofing"].includes(second)) {
    if (!answered.has("job_type")) return "job_type";
    if (!answered.has("materials")) return "materials";
    if (!answered.has("who_for")) return "who_for";
    if (!answered.has("top_jobs")) return "top_jobs";
    return null;
  }

  if (top === "cleaning_services" || second === "cleaning_services") {
    if (!answered.has("who_for")) return "who_for";
    if (!answered.has("top_jobs")) return "top_jobs";
    if (!answered.has("materials_objects")) return "materials_objects";
    return null;
  }

  if (!answered.has("top_jobs")) return "top_jobs";
  if (!answered.has("materials_objects")) return "materials_objects";
  if (!answered.has("job_type")) return "job_type";
  if (!answered.has("materials")) return "materials";
  if (!answered.has("who_for")) return "who_for";
  if (!answered.has("specialty")) return "specialty";
  if (!answered.has("location")) return "location";

  return null;
}

function nextQuestionAdaptive(inf: IndustryInference) {
  const qid = pickDiscriminatingQid(inf);
  if (!qid) return null;
  return QUESTIONS.find((x) => x.qid === qid) ?? null;
}

function altFreeform(lastAskedQid: string | null) {
  // rotate through different freeform prompts so the UX never looks “stuck”
  if (lastAskedQid === "clarify_freeform") {
    return {
      qid: "clarify_freeform_not",
      question: "Quick check — what do you NOT do?",
      help: "Example: “We do detailing, but we don’t do mechanical repairs or collision work.”",
    };
  }
  if (lastAskedQid === "clarify_freeform_not") {
    return {
      qid: "clarify_freeform_keywords",
      question: "Give 3 keywords customers search for to find you.",
      help: "Example: “ceramic coating, interior detail, paint correction”.",
    };
  }
  return {
    qid: "clarify_freeform",
    question: "Describe your business in one sentence.",
    help: "Example: “We do ceramic coatings + interior detailing for cars and trucks.”",
  };
}

function avoidRepeatQuestion(args: {
  inf: IndustryInference;
  proposed: { qid: string; question: string; help?: string; options?: string[] } | null;
  candidates: Candidate[];
  conflicts: Conflict[];
}) {
  const lastAsked = safeTrim(args.inf?.meta?.lastAskedQid ?? "") || "";

  if (!args.proposed) return null;

  // If we’re about to ask the same qid again, pick something else.
  if (lastAsked && normalizeKey(args.proposed.qid) === normalizeKey(lastAsked)) {
    // If we have a top-two, prefer a targeted clarifier first.
    if (args.candidates.length >= 2) {
      const c = clarifierQuestionFrom(args.conflicts, args.candidates);
      if (c && normalizeKey(c.qid) !== normalizeKey(lastAsked)) return c;
    }

    // Otherwise rotate to a different unanswered high-signal question.
    const answered = new Set(args.inf.answers.map((a) => a.qid));
    const fallbacks = ["specialty", "top_jobs", "materials", "job_type", "materials_objects", "who_for", "location"];
    for (const qid of fallbacks) {
      if (!answered.has(qid)) {
        const q = QUESTIONS.find((x) => x.qid === qid);
        if (q) return q;
      }
    }

    // If all else fails: different freeform prompt with a different qid.
    return altFreeform(lastAsked);
  }

  return args.proposed;
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
        conflicts: [],
        meta: { updatedAt: now, lastAskedQid: null },
      };

      ai.industryInference = inf;
      ai.suggestedIndustryKey = null;
      ai.confidenceScore = 0;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
    }

    if (parsed.data.action === "start") {
      const proposed =
        hasBlockingConflict(inf.conflicts) && inf.candidates?.length
          ? clarifierQuestionFrom(inf.conflicts, inf.candidates)
          : nextQuestionAdaptive(inf) ?? QUESTIONS[0] ?? null;

      const q = avoidRepeatQuestion({ inf, proposed, candidates: inf.candidates ?? [], conflicts: inf.conflicts ?? [] }) ?? proposed;

      inf.nextQuestion = q ?? altFreeform(safeTrim(inf.meta?.lastAskedQid ?? "") || null);

      inf.meta = { ...(inf.meta ?? { updatedAt: now }), updatedAt: now, lastAskedQid: inf.nextQuestion?.qid ?? null };

      ai.industryInference = { ...inf, meta: inf.meta };
      await writeAiAnalysis(tenantId, ai);

      return NextResponse.json({ ok: true, tenantId, industryInference: ai.industryInference }, { status: 200 });
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

    const qFromBank = QUESTIONS.find((x) => x.qid === qid);
    const qText =
      (inf.nextQuestion?.qid === qid ? safeTrim(inf.nextQuestion?.question) : "") || qFromBank?.question || qid;

    const answers = Array.isArray(inf.answers) ? [...inf.answers] : [];
    answers.push({ qid, question: qText, answer: ans, createdAt: now });

    const candidates = scoreCandidates(answers, canon);
    const confidenceScore = computeConfidence(candidates);

    const conflicts = detectConflicts(inf, candidates, confidenceScore);

    const topKeyRaw = candidates[0]?.key ? normalizeKey(candidates[0].key) : "";
    const suggestedIndustryKey = topKeyRaw || null;

    const round = Math.min(MaxRounds, (Number(inf.round ?? 1) || 1) + 1);
    const exhausted = round >= MaxRounds;

    const reachedTarget = confidenceScore >= ConfidenceTarget && !hasBlockingConflict(conflicts);

    const canForceSuggest =
      exhausted &&
      ForceSuggestAtExhaustion &&
      !hasBlockingConflict(conflicts) &&
      (candidates[0]?.score ?? 0) > 0;

    const status: IndustryInference["status"] = reachedTarget || canForceSuggest ? "suggested" : "collecting";

    let nextQ: any = null;
    if (status === "collecting") {
      const proposed = hasBlockingConflict(conflicts)
        ? clarifierQuestionFrom(conflicts, candidates)
        : nextQuestionAdaptive({
            ...inf,
            answers,
            candidates,
            confidenceScore,
            conflicts,
            round,
            suggestedIndustryKey,
            status,
            needsConfirmation: true,
            nextQuestion: null,
            meta: { ...(inf.meta ?? { updatedAt: now }), updatedAt: now },
          } as any);

      nextQ = avoidRepeatQuestion({ inf, proposed, candidates, conflicts }) ?? proposed;

      if (!nextQ) {
        nextQ = altFreeform(safeTrim(inf.meta?.lastAskedQid ?? "") || null);
      }
    }

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
      conflicts,
      meta: { ...(inf.meta ?? { updatedAt: now }), updatedAt: now, lastAskedQid: nextQ?.qid ?? null },
    };

    ai.industryInference = next;

    // Mirror for Step3 + downstream
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