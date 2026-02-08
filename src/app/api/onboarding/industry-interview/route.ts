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

function titleize(keyOrLabel: string) {
  const s = safeTrim(keyOrLabel).replace(/[_-]+/g, " ");
  if (!s) return "";
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
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

  // Starter pack bucket
  suggestedIndustryKey: string | null;

  // Always true for now; Step3 confirms
  needsConfirmation: boolean;

  nextQuestion: { qid: string; question: string; help?: string; options?: string[] } | null;
  answers: InterviewAnswer[];

  // Candidate list = starter-pack industries (what your Step2 UI already shows)
  candidates: Candidate[];

  meta: { updatedAt: string };
};

/* -------------------- tuning -------------------- */

const ConfidenceTarget = 0.82;
const MaxRounds = 8;

// Don’t “suggest” unless we have real evidence.
const MinTopScoreForSuggest = 5;
const MinSeparationForSuggest = 0.25;

const ForceSuggestAtExhaustion = true;

/**
 * IMPORTANT: industry keys can be messy right now.
 * We normalize “aliases” here so the UX feels consistent even before DB cleanup.
 */
const INDUSTRY_ALIASES: Record<string, string> = {
  auto_repair: "automotive_repair",
  automotive_repair_collision: "auto_repair_collision",
};

function canonIndustryKey(k: string) {
  const nk = normalizeKey(k);
  return INDUSTRY_ALIASES[nk] ?? nk;
}

/* -------------------- interview questions -------------------- */

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
      "Car restoration",
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
    qid: "top_jobs",
    question: "Name 2–3 common jobs you quote.",
    help: "Example: “ceramic coating, paint correction, interior detail”.",
  },
  {
    qid: "specialty",
    question: "Any specialty keywords customers use to find you?",
    help: "Example: “ceramic coating”, “paint correction”, “PPF”, “collision repair”.",
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
    qid: "materials",
    question: "What materials or surfaces do you work with most?",
    help: "Example: “clear coat, paint, leather, vinyl, asphalt, pavers”.",
  },
  {
    qid: "location",
    question: "Where do you operate?",
    help: "City/state or a rough service radius.",
  },
];

/* -------------------- taxonomy -------------------- */
/**
 * Sub-industries are “precision labels” that get created dynamically.
 * They map to a starter-pack industry bucket.
 */
type SubIndustryDef = {
  key: string;
  label: string;
  parentIndustryKey: string; // starter pack bucket
  keywords: Array<string | RegExp>;
};

// built-in set (seed signals); NOT required to match DB
const SUB_INDUSTRIES: SubIndustryDef[] = [
  {
    key: "auto_detailing",
    label: "Auto Detailing",
    parentIndustryKey: "automotive_repair",
    keywords: [/detail/i, /detailing/i, /interior detail/i, /exterior detail/i, /wash/i, /wax/i],
  },
  {
    key: "ceramic_coating",
    label: "Ceramic Coating",
    parentIndustryKey: "automotive_repair",
    keywords: [/ceramic/i, /coating/i, /graphene/i],
  },
  {
    key: "paint_correction",
    label: "Paint Correction",
    parentIndustryKey: "automotive_repair",
    keywords: [/paint correction/i, /compound/i, /polish/i, /buff/i, /swirl/i],
  },
  {
    key: "ppf",
    label: "Paint Protection Film (PPF)",
    parentIndustryKey: "automotive_repair",
    keywords: [/\bppf\b/i, /paint protection film/i, /clear bra/i],
  },
  {
    key: "auto_repair_collision",
    label: "Auto Body / Collision",
    parentIndustryKey: "auto_repair_collision",
    keywords: [/collision/i, /auto body/i, /body shop/i, /dent/i, /bumper/i, /\bpaint\b/i],
  },
  {
    key: "auto_mechanic",
    label: "Auto Repair / Mechanic",
    parentIndustryKey: "automotive_repair",
    keywords: [/mechanic/i, /engine/i, /brake/i, /diagnostic/i, /transmission/i],
  },
  {
    key: "car_restoration",
    label: "Car Restoration",
    parentIndustryKey: "automotive_repair",
    keywords: [/restoration/i, /restore/i, /classic/i, /vintage/i, /frame[- ]off/i],
  },
];

// Industry scoring = starter pack buckets. This can be sparse; DB will grow over time.
const INDUSTRY_KEYWORDS: Record<string, Array<string | RegExp>> = {
  automotive_repair: [/car/i, /truck/i, /vehicle/i, /mechanic/i, /detail/i, /detailing/i, /ceramic/i, /\bppf\b/i, /collision/i],
  auto_repair_collision: [/collision/i, /auto body/i, /body shop/i, /dent/i, /bumper/i, /\bpaint\b/i],
  upholstery: [/upholster/i, /vinyl/i, /leather/i, /canvas/i, /headliner/i, /marine/i, /sew/i],
  paving_contractor: [/asphalt/i, /pav(e|ing)/i, /sealcoat/i, /concrete/i, /driveway/i, /parking lot/i],
  landscaping_hardscaping: [/landscap/i, /hardscap/i, /mulch/i, /pavers/i, /retaining wall/i, /lawn/i],
  hvac: [/hvac/i, /air condition/i, /\bac\b/i, /furnace/i, /heat pump/i],
  plumbing: [/plumb/i, /water heater/i, /drain/i, /sewer/i],
  electrical: [/electric/i, /panel/i, /breaker/i, /wiring/i],
  roofing: [/roof/i, /shingle/i, /gutter/i, /siding/i],
  cleaning_services: [/clean/i, /janitor/i, /maid/i, /pressure wash/i],
};

// Options mapping: these boosts can create new keys too.
const OPTION_BOOST: Record<string, Array<{ match: RegExp; key: string; points: number }>> = {
  services: [
    { match: /detail|ceramic|coating/i, key: "auto_detailing", points: 8 },
    { match: /collision|body/i, key: "auto_repair_collision", points: 8 },
    { match: /restoration/i, key: "car_restoration", points: 8 },
    { match: /auto repair|mechanic/i, key: "auto_mechanic", points: 8 },

    { match: /upholstery/i, key: "upholstery", points: 8 },
    { match: /paving|asphalt|concrete/i, key: "paving_contractor", points: 8 },
    { match: /landscap|hardscap/i, key: "landscaping_hardscaping", points: 8 },
    { match: /hvac/i, key: "hvac", points: 8 },
    { match: /plumb/i, key: "plumbing", points: 8 },
    { match: /electrical/i, key: "electrical", points: 8 },
    { match: /roof|siding/i, key: "roofing", points: 8 },
    { match: /clean|janitorial/i, key: "cleaning_services", points: 8 },
  ],
  materials_objects: [
    { match: /cars\/trucks/i, key: "automotive_repair", points: 3 },
    { match: /boats/i, key: "upholstery", points: 3 },
    { match: /roads|parking/i, key: "paving_contractor", points: 4 },
    { match: /homes/i, key: "landscaping_hardscaping", points: 2 },
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
 * ✅ CRITICAL FIX: stringify JSONB input
 * ✅ UPSERT so missing row never crashes
 */
async function writeAiAnalysis(tenantId: string, ai: any) {
  await db.execute(sql`
    insert into tenant_onboarding (tenant_id, ai_analysis, updated_at, created_at)
    values (${tenantId}::uuid, ${JSON.stringify(ai)}::jsonb, now(), now())
    on conflict (tenant_id) do update
      set ai_analysis = excluded.ai_analysis,
          updated_at = now()
  `);
}

async function listIndustries(): Promise<Array<{ key: string; label: string }>> {
  const r = await db.execute(sql`
    select key::text as "key", label::text as "label"
    from industries
    order by label asc
    limit 5000
  `);
  return rowsOf(r).map((x: any) => ({ key: canonIndustryKey(String(x.key)), label: String(x.label) }));
}

async function ensureIndustryExists(keyRaw: string, labelRaw?: string) {
  const key = canonIndustryKey(keyRaw);
  if (!key) return;
  const label = safeTrim(labelRaw) || titleize(key);

  // If your industries table has extra columns, this still works because we only insert common columns.
  await db.execute(sql`
    insert into industries (key, label, status, created_by, created_at, updated_at)
    values (${key}, ${label}, 'approved', 'ai', now(), now())
    on conflict (key) do update
      set label = excluded.label,
          updated_at = now()
  `);
}

async function listTenantSubIndustries(tenantId: string): Promise<Array<{ key: string; label: string }>> {
  const r = await db.execute(sql`
    select key::text as "key", label::text as "label"
    from tenant_sub_industries
    where tenant_id = ${tenantId}::uuid
    order by label asc
    limit 5000
  `);
  return rowsOf(r).map((x: any) => ({ key: normalizeKey(String(x.key)), label: String(x.label) }));
}

async function ensureTenantSubIndustry(tenantId: string, keyRaw: string, labelRaw?: string) {
  const key = normalizeKey(keyRaw);
  if (!key) return;
  const label = safeTrim(labelRaw) || titleize(key);

  await db.execute(sql`
    insert into tenant_sub_industries (tenant_id, key, label, updated_at)
    values (${tenantId}::uuid, ${key}, ${label}, now())
    on conflict (tenant_id, key) do update
      set label = excluded.label,
          updated_at = now()
  `);
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

function nextQuestionFor(inf: IndustryInference) {
  const answered = new Set(inf.answers.map((a) => a.qid));
  return QUESTIONS.find((x) => !answered.has(x.qid)) ?? null;
}

/* -------------------- scoring -------------------- */

function addScore(scores: Map<string, number>, keyRaw: string, points: number) {
  const key = normalizeKey(keyRaw);
  if (!key || !Number.isFinite(points) || points <= 0) return;
  scores.set(key, (scores.get(key) ?? 0) + points);
}

function scoreByPatterns(text: string, patterns: Array<string | RegExp>) {
  const t = text.toLowerCase();
  let s = 0;
  for (const p of patterns) {
    if (typeof p === "string") {
      if (t.includes(p.toLowerCase())) s += 1;
    } else {
      if (p.test(text)) s += 1;
    }
  }
  return s;
}

function computeConfidence(cands: Candidate[]) {
  const top = cands[0]?.score ?? 0;
  const second = cands[1]?.score ?? 0;
  if (top <= 0) return 0;

  const mag = Math.min(1, top / 12);
  const sep = top > 0 ? Math.max(0, Math.min(1, (top - second) / Math.max(1, top))) : 0;

  // separation matters more to avoid “pushing”
  const conf = 0.45 * mag + 0.55 * sep;
  return Math.max(0, Math.min(1, conf));
}

function toCandidates(scores: Map<string, number>, labelForKey: (k: string) => string): Candidate[] {
  const out: Candidate[] = [];
  for (const [k, s] of scores.entries()) {
    if (s <= 0) continue;
    out.push({ key: k, label: labelForKey(k) || titleize(k), score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 8);
}

function buildSubUniverse(
  tenantSubs: Array<{ key: string; label: string }>
): Array<{ key: string; label: string; parentIndustryKey: string; keywords: Array<string | RegExp> }> {
  const builtIns = SUB_INDUSTRIES.map((s) => ({
    key: normalizeKey(s.key),
    label: s.label,
    parentIndustryKey: canonIndustryKey(s.parentIndustryKey),
    keywords: s.keywords,
  }));

  const builtInKeys = new Set(builtIns.map((x) => x.key));

  const tenantDefs = tenantSubs
    .map((t) => {
      const key = normalizeKey(t.key);
      if (!key || builtInKeys.has(key)) return null;
      const label = safeTrim(t.label) || titleize(key);

      // Tenant subs don’t have parent mapping yet; we allow weak match + “service” parent.
      return {
        key,
        label,
        parentIndustryKey: "service",
        keywords: [
          new RegExp(`\\b${key.replace(/_/g, "\\s+")}\\b`, "i"),
          ...(label ? [new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")] : []),
        ],
      };
    })
    .filter(Boolean) as Array<{ key: string; label: string; parentIndustryKey: string; keywords: Array<string | RegExp> }>;

  return [...builtIns, ...tenantDefs];
}

function scoreAll(
  answers: InterviewAnswer[],
  industries: Array<{ key: string; label: string }>,
  subUniverse: Array<{ key: string; label: string; parentIndustryKey: string; keywords: Array<string | RegExp> }>
) {
  const text = answers.map((a) => a.answer).join(" | ");

  // ---------- sub-industry scoring ----------
  const subScores = new Map<string, number>();

  for (const s of subUniverse) {
    const hits = scoreByPatterns(text, s.keywords);
    if (hits > 0) addScore(subScores, s.key, hits * 2);
  }

  for (const a of answers) {
    const boosts = OPTION_BOOST[a.qid] ?? [];
    for (const b of boosts) {
      if (b.match.test(a.answer)) addScore(subScores, b.key, b.points);
    }
  }

  const subCandidates = toCandidates(subScores, (k) => subUniverse.find((x) => x.key === k)?.label ?? titleize(k));
  const topSubKey = subCandidates[0]?.key ? normalizeKey(subCandidates[0].key) : "";
  const topSubDef = topSubKey ? subUniverse.find((x) => x.key === topSubKey) : null;

  // ---------- industry scoring (starter pack buckets) ----------
  const indScores = new Map<string, number>();

  for (const [k, patterns] of Object.entries(INDUSTRY_KEYWORDS)) {
    const hits = scoreByPatterns(text, patterns);
    if (hits > 0) addScore(indScores, canonIndustryKey(k), hits);
  }

  // If sub-industry is strong, boost its parent industry bucket
  if (topSubDef) {
    addScore(indScores, canonIndustryKey(topSubDef.parentIndustryKey), Math.max(2, (subCandidates[0]?.score ?? 0) / 3));
  }

  // Option boosts can also push industries
  for (const a of answers) {
    const boosts = OPTION_BOOST[a.qid] ?? [];
    for (const b of boosts) {
      addScore(indScores, canonIndustryKey(b.key), Math.round(b.points / 2));
    }
  }

  const industryLabel = (k: string) => industries.find((x) => canonIndustryKey(x.key) === canonIndustryKey(k))?.label ?? titleize(k);

  // IMPORTANT: we do NOT restrict to existing industries; we allow “new keys” to surface.
  const industryCandidates = toCandidates(indScores, industryLabel);

  const suggestedSubIndustryKey = topSubKey || null;

  // Starter pack = parent of top sub if present, else top industry candidate, else “service”
  const parentCandidate = topSubDef ? canonIndustryKey(topSubDef.parentIndustryKey) : "";
  const suggestedIndustryKey =
    (parentCandidate && parentCandidate !== "service" ? parentCandidate : "") ||
    (industryCandidates[0]?.key ? canonIndustryKey(industryCandidates[0].key) : "") ||
    "service";

  const confidenceScore = computeConfidence(industryCandidates);

  return {
    suggestedIndustryKey,
    suggestedSubIndustryKey,
    industryCandidates,
    subCandidates,
    confidenceScore,
  };
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

    // pull current registries (but we can create if missing)
    const industries = await listIndustries();
    const tenantSubs = await listTenantSubIndustries(tenantId);
    const subUniverse = buildSubUniverse(tenantSubs);

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
      ai.starterPackIndustryKey = null;
      ai.suggestedSubIndustryKey = null;
      ai.confidenceScore = 0;
      ai.needsConfirmation = true;
      ai.subIndustryCandidates = [];

      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
    }

    if (parsed.data.action === "start") {
      // ensure baseline exists (no pre-seeding required)
      await ensureIndustryExists("service", "Service");

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

    const scored = scoreAll(answers, industries, subUniverse);

    // ✅ AUTO-CREATE what we inferred (no manual pre-population)
    await ensureIndustryExists(scored.suggestedIndustryKey, titleize(scored.suggestedIndustryKey));
    if (scored.suggestedSubIndustryKey) {
      await ensureTenantSubIndustry(tenantId, scored.suggestedSubIndustryKey, titleize(scored.suggestedSubIndustryKey));
    }

    const round = Math.min(MaxRounds, (Number(inf.round ?? 1) || 1) + 1);
    const exhausted = round >= MaxRounds;

    const top = scored.industryCandidates[0];
    const second = scored.industryCandidates[1];

    const sep =
      top?.score && second?.score
        ? Math.max(0, Math.min(1, (top.score - second.score) / Math.max(1, top.score)))
        : 0;

    const strongEnough =
      (top?.score ?? 0) >= MinTopScoreForSuggest &&
      sep >= MinSeparationForSuggest &&
      scored.confidenceScore >= ConfidenceTarget;

    const status: IndustryInference["status"] =
      strongEnough || (exhausted && ForceSuggestAtExhaustion && Boolean(scored.suggestedIndustryKey))
        ? "suggested"
        : "collecting";

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
      confidenceScore: scored.confidenceScore,
      suggestedIndustryKey: scored.suggestedIndustryKey,
      needsConfirmation: true,
      nextQuestion: nextQ ? { ...(nextQ as any) } : null,
      answers,
      candidates: scored.industryCandidates,
      meta: { updatedAt: now },
    };

    ai.industryInference = next;

    // Mirrors for downstream steps
    ai.suggestedIndustryKey = scored.suggestedIndustryKey;
    ai.starterPackIndustryKey = scored.suggestedIndustryKey;
    ai.suggestedSubIndustryKey = scored.suggestedSubIndustryKey;
    ai.subIndustryCandidates = scored.subCandidates;

    ai.confidenceScore = scored.confidenceScore;
    ai.needsConfirmation = true;

    await writeAiAnalysis(tenantId, ai);

    return NextResponse.json({ ok: true, tenantId, industryInference: next }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}