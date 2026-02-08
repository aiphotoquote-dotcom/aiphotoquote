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

type BeliefSignals = {
  // per-industry accumulated score
  scores: Record<string, number>;
  // explicit “not this” signals
  exclusions: Record<string, number>;
  // extracted facts for future prompting / explainability
  entities: string[];
  services: string[];
  surfacesMaterials: string[];
  notes: string[];
  updatedAt: string;
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
  belief: BeliefSignals;
  meta: { updatedAt: string };
};

/* -------------------- tuning -------------------- */

const ConfidenceTarget = 0.82;
const MaxRounds = 8;

// When the user contradicts the current top category, we stop “locking in”
// and force more questioning even at round exhaustion unless super confident.
const ContradictionPenalty = 4; // points subtracted from a category when contradicted
const ContradictionHoldThreshold = 0.70; // if confidence < this and contradiction occurred, don’t suggest

/**
 * Question bank (>= MaxRounds recommended).
 * Keep short, high-signal, mobile-friendly.
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

/* -------------------- scoring rules -------------------- */

/**
 * Keyword rules.
 * NOTE: These keys can be created dynamically later via /api/onboarding/industries,
 * but we still keep a “starter ontology” so onboarding feels smart.
 */
const KEYWORDS: Record<string, Array<string | RegExp>> = {
  auto_detailing: [/detail/i, /detailing/i, /ceramic/i, /coating/i, /paint correction/i, /\bppf\b/i, /polish/i, /buff/i, /wax/i],
  auto_repair: [/auto repair/i, /mechanic/i, /brake/i, /engine/i, /diagnostic/i, /oil change/i],
  auto_repair_collision: [/collision/i, /body shop/i, /auto body/i, /\bdent\b/i, /bumper/i, /\bpanel\b/i, /spray/i],
  upholstery: [/upholster/i, /vinyl/i, /leather/i, /canvas/i, /headliner/i, /marine/i, /sew/i],
  paving_contractor: [/asphalt/i, /pav(e|ing)/i, /sealcoat/i, /concrete/i, /driveway/i, /parking lot/i],
  landscaping_hardscaping: [/landscap/i, /hardscap/i, /mulch/i, /pavers/i, /retaining wall/i, /lawn/i],
  hvac: [/hvac/i, /air condition/i, /\bac\b/i, /furnace/i, /heat pump/i],
  plumbing: [/plumb/i, /water heater/i, /drain/i, /sewer/i],
  electrical: [/electric/i, /panel/i, /breaker/i, /wiring/i],
  roofing: [/roof/i, /shingle/i, /gutter/i, /siding/i],
  cleaning_services: [/clean/i, /janitor/i, /maid/i, /pressure wash/i],
};

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
    { match: /boats/i, key: "upholstery", points: 1 },
    { match: /roads|parking/i, key: "paving_contractor", points: 2 },
    { match: /homes/i, key: "landscaping_hardscaping", points: 1 },
  ],
};

function detectContradictions(answer: string) {
  const a = answer.toLowerCase();

  // very cheap but effective:
  const neg = /\b(no|not|don't|do not|never|isn't|aren't|without)\b/i.test(a);

  // categories that often get contradicted in your tests
  const contradictsRepair = neg && (/\brepair\b/i.test(a) || /\bmechanic\b/i.test(a) || /\bauto repair\b/i.test(a));
  const contradictsCollision = neg && (/\bcollision\b/i.test(a) || /\bbody\b/i.test(a) || /\bdent\b/i.test(a));
  const contradictsDetailing = neg && (/\bdetail\b/i.test(a) || /\bdetailing\b/i.test(a) || /\bwax\b/i.test(a) || /\bceramic\b/i.test(a));

  return {
    neg,
    contradictsRepair,
    contradictsCollision,
    contradictsDetailing,
  };
}

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

/**
 * IMPORTANT:
 * We do NOT require canonical industries to exist to function.
 * If industries table is empty, we still score and return candidate keys.
 */
async function listCanonicalIndustries(): Promise<Array<{ key: string; label: string }>> {
  const r = await db.execute(sql`
    select key::text as "key", label::text as "label"
    from industries
    order by label asc
    limit 2000
  `);
  return rowsOf(r).map((x: any) => ({ key: String(x.key), label: String(x.label) }));
}

/* -------------------- inference state -------------------- */

function ensureInference(ai: any | null): { ai: any; inf: IndustryInference } {
  const now = new Date().toISOString();
  const baseAi = ai && typeof ai === "object" ? ai : {};
  const existing = baseAi?.industryInference;

  const defaultBelief: BeliefSignals = {
    scores: {},
    exclusions: {},
    entities: [],
    services: [],
    surfacesMaterials: [],
    notes: [],
    updatedAt: now,
  };

  if (existing && typeof existing === "object" && existing?.mode === "interview") {
    const answers = Array.isArray(existing.answers) ? existing.answers : [];
    const round = Number(existing.round ?? 1);
    const confidenceScore = Number(existing.confidenceScore ?? 0) || 0;
    const suggestedIndustryKey = safeTrim(existing.suggestedIndustryKey) || null;

    const belief = existing.belief && typeof existing.belief === "object" ? existing.belief : defaultBelief;

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
      belief: {
        ...defaultBelief,
        ...belief,
        scores: { ...(belief.scores ?? {}) },
        exclusions: { ...(belief.exclusions ?? {}) },
        entities: Array.isArray(belief.entities) ? belief.entities : [],
        services: Array.isArray(belief.services) ? belief.services : [],
        surfacesMaterials: Array.isArray(belief.surfacesMaterials) ? belief.surfacesMaterials : [],
        notes: Array.isArray(belief.notes) ? belief.notes : [],
        updatedAt: now,
      },
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
    belief: defaultBelief,
    meta: { updatedAt: now },
  };

  baseAi.industryInference = inf;
  return { ai: baseAi, inf };
}

function nextQuestionFor(inf: IndustryInference) {
  const answered = new Set(inf.answers.map((a) => a.qid));
  const q = QUESTIONS.find((x) => !answered.has(x.qid));
  return q ?? null;
}

function ingestAnswerIntoBelief(belief: BeliefSignals, qid: string, answer: string) {
  const text = answer;

  // quick extractors (cheap + useful)
  if (qid === "materials_objects") belief.entities = uniq([...belief.entities, answer]);
  if (qid === "top_jobs") belief.services = uniq([...belief.services, ...splitCsvish(answer)]);
  if (qid === "materials") belief.surfacesMaterials = uniq([...belief.surfacesMaterials, ...splitCsvish(answer)]);
  if (qid === "specialty") belief.notes = uniq([...belief.notes, ...splitCsvish(answer)]);

  // contradictions (explicit “not this”)
  const c = detectContradictions(answer);
  if (c.contradictsRepair) belief.exclusions["auto_repair"] = (belief.exclusions["auto_repair"] ?? 0) + 1;
  if (c.contradictsCollision) belief.exclusions["auto_repair_collision"] = (belief.exclusions["auto_repair_collision"] ?? 0) + 1;
  if (c.contradictsDetailing) belief.exclusions["auto_detailing"] = (belief.exclusions["auto_detailing"] ?? 0) + 1;

  return { belief, contradiction: c.neg };
}

function splitCsvish(s: string) {
  return s
    .split(/,|\/|\||;|\n/i)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function uniq(xs: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function scoreCandidatesFromAnswersAndBelief(
  answers: InterviewAnswer[],
  canon: Array<{ key: string; label: string }>,
  belief: BeliefSignals
): Candidate[] {
  const combinedText = answers.map((a) => a.answer).join(" | ");

  const scores = new Map<string, number>();

  // Start from belief scores (this is what makes it “stateful”)
  for (const [k, v] of Object.entries(belief.scores ?? {})) {
    scores.set(k, (scores.get(k) ?? 0) + (Number(v) || 0));
  }

  // Keyword scoring
  for (const [k, patterns] of Object.entries(KEYWORDS)) {
    let s = 0;
    for (const p of patterns) {
      if (typeof p === "string") {
        if (combinedText.toLowerCase().includes(p.toLowerCase())) s += 1;
      } else {
        if (p.test(combinedText)) s += 1;
      }
    }
    if (s > 0) scores.set(k, (scores.get(k) ?? 0) + s);
  }

  // Option boosts
  for (const a of answers) {
    const boosts = OPTION_BOOST[a.qid] ?? [];
    for (const b of boosts) {
      if (b.match.test(a.answer)) {
        scores.set(b.key, (scores.get(b.key) ?? 0) + b.points);
      }
    }
  }

  // Apply exclusions as penalties
  for (const [k, count] of Object.entries(belief.exclusions ?? {})) {
    const n = Number(count) || 0;
    if (n <= 0) continue;
    scores.set(k, (scores.get(k) ?? 0) - ContradictionPenalty * n);
  }

  // Canon labels if known; otherwise title-case key
  const canonMap = new Map(canon.map((c) => [c.key, c.label]));
  const candidates: Candidate[] = [];

  for (const [k, s] of scores.entries()) {
    const key = normalizeKey(k);
    if (!key) continue;

    const label =
      canonMap.get(key) ??
      key
        .replace(/_+/g, " ")
        .split(" ")
        .filter(Boolean)
        .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
        .join(" ");

    candidates.push({ key, label, score: s });
  }

  if (!candidates.length) {
    candidates.push({ key: "service", label: "Service", score: 0 });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 6);
}

function computeConfidence(cands: Candidate[]) {
  const top = cands[0]?.score ?? 0;
  const second = cands[1]?.score ?? 0;
  if (top <= 0) return 0;

  // magnitude
  const mag = Math.max(0, Math.min(1, top / 10));
  // separation
  const sep = Math.max(0, Math.min(1, (top - second) / Math.max(1, Math.abs(top))));
  // blend
  const conf = 0.55 * mag + 0.45 * sep;
  return Math.max(0, Math.min(1, conf));
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
        belief: {
          scores: {},
          exclusions: {},
          entities: [],
          services: [],
          surfacesMaterials: [],
          notes: [],
          updatedAt: now,
        },
        meta: { updatedAt: now },
      };

      ai.industryInference = inf;
      ai.suggestedIndustryKey = null;
      ai.confidenceScore = 0;
      ai.needsConfirmation = true;

      // IMPORTANT: interview route does NOT write tenant_sub_industries or industries.
      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
    }

    if (parsed.data.action === "start") {
      const nq = nextQuestionFor(inf);
      inf.nextQuestion = nq ? { ...nq } : null;

      if (!inf.nextQuestion) {
        inf.nextQuestion = {
          qid: "freeform",
          question: "Describe your business in one sentence.",
          help: "Example: “We do ceramic coatings + interior detailing for cars and trucks.”",
        };
      }

      ai.industryInference = { ...inf, meta: { updatedAt: now } };
      await writeAiAnalysis(tenantId, ai);

      return NextResponse.json({ ok: true, tenantId, industryInference: ai.industryInference }, { status: 200 });
    }

    // action === "answer"
    const qid = safeTrim(parsed.data.qid);
    const ansRaw = parsed.data.answer;

    const ans =
      typeof ansRaw === "string"
        ? safeTrim(ansRaw)
        : safeTrim(ansRaw == null ? "" : JSON.stringify(ansRaw));

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

    // belief update
    const belief = { ...(inf.belief ?? { scores: {}, exclusions: {}, entities: [], services: [], surfacesMaterials: [], notes: [], updatedAt: now }) };
    const { belief: belief2, contradiction } = ingestAnswerIntoBelief(belief, qid, ans);
    belief2.updatedAt = now;

    // score with belief
    const candidates = scoreCandidatesFromAnswersAndBelief(answers, canon, belief2);
    const confidenceScore = computeConfidence(candidates);

    const topKey = candidates[0]?.key ? normalizeKey(candidates[0].key) : "";
    const suggestedIndustryKey = topKey || null;

    const round = Math.min(MaxRounds, (Number(inf.round ?? 1) || 1) + 1);

    const reachedTarget = confidenceScore >= ConfidenceTarget;

    // “Don’t push categories” rule:
    // If the user contradicted and we’re not yet highly confident, keep collecting.
    const holdBecauseContradiction = contradiction && confidenceScore < ContradictionHoldThreshold;

    const exhausted = round >= MaxRounds;
    const shouldSuggest = reachedTarget || (exhausted && !holdBecauseContradiction);

    const status: IndustryInference["status"] = shouldSuggest ? "suggested" : "collecting";
    const needsConfirmation = true;

    let nextQ = status === "collecting" ? nextQuestionFor({ ...inf, answers }) : null;
    if (status === "collecting" && !nextQ) {
      nextQ = {
        qid: "freeform",
        question: "Describe your business in one sentence.",
        help: "Example: “We do ceramic coatings + paint correction for cars and trucks.”",
      };
    }

    const next: IndustryInference = {
      mode: "interview",
      status,
      round,
      confidenceScore,
      suggestedIndustryKey,
      needsConfirmation,
      nextQuestion: nextQ ? { ...(nextQ as any) } : null,
      answers,
      candidates,
      belief: belief2,
      meta: { updatedAt: now },
    };

    ai.industryInference = next;

    // Mirror for Step3 + downstream
    ai.suggestedIndustryKey = suggestedIndustryKey;
    ai.confidenceScore = confidenceScore;
    ai.needsConfirmation = true;

    // IMPORTANT: interview route does NOT write industries table or subindustries table.
    // That happens only in /api/onboarding/industries when user confirms in Step3.
    await writeAiAnalysis(tenantId, ai);

    return NextResponse.json({ ok: true, tenantId, industryInference: next }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}