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
  meta: { updatedAt: string; hints?: string[] };
};

/* -------------------- tuning -------------------- */

// You want this to “lock in” fast but not off a single weak keyword.
const ConfidenceTarget = 0.82;
const MaxRounds = 8;
const MinTopScoreForHighConfidence = 6;

/* -------------------- question bank -------------------- */
/**
 * IMPORTANT:
 * These are “building blocks” — nextQuestionFor() will pick an order that feels adaptive.
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
      "Automotive repair / mechanical",
      "Collision / body / paint",
      "Auto detailing / ceramic coating",
      "Paving / asphalt / concrete",
      "Landscaping / hardscaping",
      "Fencing",
      "Marine repair",
      "Restaurant / bistro",
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
    qid: "specialty",
    question: "What’s the best keyword that describes your specialty?",
    help: "Example: “ceramic coating”, “brakes”, “dent repair”, “sealcoating”, “retaining walls”.",
  },
  {
    qid: "top_jobs",
    question: "Name 2–3 common jobs you quote.",
    help: "Short is fine. Example: “brakes + rotors, oil changes, diagnostics”.",
  },
  {
    qid: "who_for",
    question: "Who are your customers most often?",
    help: "Pick the closest match.",
    options: ["Residential", "Commercial", "Both"],
  },
  {
    qid: "location",
    question: "Where do you operate?",
    help: "City/state or a rough service radius.",
  },
];

/* -------------------- scoring rules -------------------- */
/**
 * These keys MUST match your `industries.key` values.
 */
const KEYWORDS: Record<string, Array<RegExp>> = {
  // Automotive (broad)
  automotive_repair: [
    /automotive/i,
    /auto\b/i,
    /car\b/i,
    /truck\b/i,
    /mechanic/i,
    /repair/i,
    /brake/i,
    /engine/i,
    /diagnostic/i,
    /oil change/i,
    /transmission/i,
    /alignment/i,
    /tire/i,

    // detailing signals (we’ll also add hints)
    /detail(ing|er)?/i,
    /ceramic/i,
    /coating/i,
    /paint correction/i,
    /polish(ing)?/i,
    /buff(ing)?/i,
    /interior detail/i,
    /exterior detail/i,
    /wash(ing)?/i,
    /wax/i,
  ],

  // Collision/body is its own key in your DB
  auto_repair_collision: [
    /collision/i,
    /body shop/i,
    /\bbodywork\b/i,
    /paint\b/i,
    /dent/i,
    /hail damage/i,
    /scratch/i,
    /bumper/i,
    /fender/i,
    /panel/i,
    /frame/i,
    /estimate\b/i,
  ],

  paving_contractor: [
    /asphalt/i,
    /pav(e|ing)/i,
    /sealcoat(ing)?/i,
    /concrete/i,
    /driveway/i,
    /parking lot/i,
    /striping/i,
    /crack fill/i,
  ],

  landscaping_hardscaping: [
    /landscap(e|ing)/i,
    /hardscap(e|ing)/i,
    /mulch/i,
    /pavers/i,
    /retaining wall/i,
    /lawn/i,
    /sod/i,
    /tree/i,
    /shrub/i,
    /patio/i,
  ],

  fencing_contractor: [/fence/i, /fencing/i, /gate/i, /vinyl fence/i, /wood fence/i, /chain link/i],

  marine_repair: [/marine/i, /boat/i, /outboard/i, /inboard/i, /fiberglass/i, /gelcoat/i, /dock/i, /prop/i],

  bistro: [/bistro/i, /restaurant/i, /bar\b/i, /cafe/i, /kitchen/i, /menu/i],
};

/**
 * Option boosts: option answers should dominate weak keyword matches.
 * Points are intentionally large so 2-3 answers can “lock in”.
 */
const OPTION_BOOST: Record<string, Array<{ match: RegExp; key: string; points: number }>> = {
  services: [
    { match: /auto detailing|ceramic/i, key: "automotive_repair", points: 7 }, // until you add dedicated detailing key
    { match: /collision|body|paint/i, key: "auto_repair_collision", points: 9 },
    { match: /automotive repair|mechanical/i, key: "automotive_repair", points: 8 },
    { match: /paving|asphalt|concrete/i, key: "paving_contractor", points: 9 },
    { match: /landscap|hardscap/i, key: "landscaping_hardscaping", points: 8 },
    { match: /fenc/i, key: "fencing_contractor", points: 8 },
    { match: /marine/i, key: "marine_repair", points: 8 },
    { match: /restaurant|bistro/i, key: "bistro", points: 8 },
  ],
  materials_objects: [
    { match: /cars\/trucks/i, key: "automotive_repair", points: 3 },
    { match: /boats/i, key: "marine_repair", points: 3 },
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
 * IMPORTANT:
 * New tenants might not have a tenant_onboarding row yet in some edge paths.
 * Use UPSERT so interview never crashes.
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
    where status = 'approved'
    order by label asc
    limit 2000
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
      meta: { updatedAt: now, hints: Array.isArray(existing?.meta?.hints) ? existing.meta.hints : [] },
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
    meta: { updatedAt: now, hints: [] },
  };

  baseAi.industryInference = inf;
  return { ai: baseAi, inf };
}

function getAnsweredSet(inf: IndustryInference) {
  return new Set((inf.answers ?? []).map((a) => a.qid));
}

/**
 * Make the interview feel like it learns:
 * - Services first.
 * - If automotive/collision is leading, ask Specialty early to disambiguate.
 * - If paving is leading, ask Who-for early.
 */
function nextQuestionFor(inf: IndustryInference): IndustryInference["nextQuestion"] {
  const answered = getAnsweredSet(inf);

  // Always start with “services”
  if (!answered.has("services")) return QUESTIONS.find((q) => q.qid === "services") ?? null;

  const top = inf.candidates?.[0]?.key ?? "";
  const second = inf.candidates?.[1]?.key ?? "";

  // If automotive/collision are in play and specialty not answered, ask it early
  const automotiveInPlay = top === "automotive_repair" || top === "auto_repair_collision" || second === "auto_repair_collision";
  if (automotiveInPlay && !answered.has("specialty")) return QUESTIONS.find((q) => q.qid === "specialty") ?? null;

  // If paving is leading and who_for not answered, ask it early
  if (top === "paving_contractor" && !answered.has("who_for")) return QUESTIONS.find((q) => q.qid === "who_for") ?? null;

  // Otherwise proceed through remaining in a natural order
  const order = ["materials_objects", "top_jobs", "who_for", "location"];
  for (const qid of order) {
    if (!answered.has(qid)) return QUESTIONS.find((q) => q.qid === qid) ?? null;
  }

  return null;
}

function scoreCandidates(
  answers: InterviewAnswer[],
  canon: Array<{ key: string; label: string }>
): { candidates: Candidate[]; hints: string[] } {
  const text = answers.map((a) => a.answer).join(" | ");
  const scores = new Map<string, number>();
  const hints: string[] = [];

  // 1) Keyword scoring
  for (const [key, patterns] of Object.entries(KEYWORDS)) {
    let s = 0;
    for (const p of patterns) {
      if (p.test(text)) s += 1;
    }
    if (s > 0) scores.set(key, (scores.get(key) ?? 0) + s);
  }

  // hinting: detect detailing specifically (so UI can evolve later)
  if (/detail(ing|er)?|ceramic|coating|paint correction|polish|buff/i.test(text)) {
    hints.push("detailing_signal");
  }

  // 2) Option boosts
  for (const a of answers) {
    const boosts = OPTION_BOOST[a.qid] ?? [];
    for (const b of boosts) {
      if (b.match.test(a.answer)) scores.set(b.key, (scores.get(b.key) ?? 0) + b.points);
    }
  }

  const canonLabel = new Map(canon.map((c) => [c.key, c.label]));
  const candidates: Candidate[] = [];

  // ✅ Only emit candidates that actually exist in `industries`
  // (so Step3 can actually show/confirm them)
  for (const [k, s] of scores.entries()) {
    if (!canonLabel.has(k)) continue;
    candidates.push({ key: k, label: canonLabel.get(k) ?? k, score: s });
  }

  // Hard fallback: if nothing matched, pick a safe existing key if present
  if (!candidates.length) {
    const fallbackKey = canonLabel.has("automotive_repair")
      ? "automotive_repair"
      : canon[0]?.key ?? null;

    if (fallbackKey) {
      candidates.push({
        key: fallbackKey,
        label: canonLabel.get(fallbackKey) ?? fallbackKey,
        score: 0,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return { candidates: candidates.slice(0, 6), hints };
}

function computeConfidence(cands: Candidate[]) {
  const top = cands[0]?.score ?? 0;
  const second = cands[1]?.score ?? 0;

  if (top <= 0) return 0;

  // Weak evidence: keep it low
  if (top < MinTopScoreForHighConfidence) {
    // top=1 -> 0.12, top=3 -> 0.30, top=5 -> 0.48
    return Math.max(0, Math.min(0.55, top / 8));
  }

  // Strong evidence: magnitude + separation
  const mag = Math.min(1, top / 12); // scale
  const sep = Math.max(0, Math.min(1, (top - second) / Math.max(1, top)));

  // Push confidence higher once it’s clearly separated
  const conf = 0.6 * mag + 0.4 * sep;
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
        meta: { updatedAt: now, hints: [] },
      };

      ai.industryInference = inf;
      ai.suggestedIndustryKey = null;
      ai.confidenceScore = 0;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
    }

    if (parsed.data.action === "start") {
      // Don’t wipe answers; just ensure next question is set.
      inf.nextQuestion = nextQuestionFor(inf);

      ai.industryInference = { ...inf, meta: { ...(inf.meta ?? {}), updatedAt: now } };
      await writeAiAnalysis(tenantId, ai);

      return NextResponse.json({ ok: true, tenantId, industryInference: ai.industryInference }, { status: 200 });
    }

    // action === "answer"
    const qid = safeTrim(parsed.data.qid);
    const ansRaw = parsed.data.answer;

    const ans =
      typeof ansRaw === "string" ? safeTrim(ansRaw) : safeTrim(ansRaw == null ? "" : JSON.stringify(ansRaw));

    if (!qid || !ans) {
      return NextResponse.json({ ok: false, error: "ANSWER_REQUIRED", message: "qid and answer are required." }, { status: 400 });
    }

    const q = QUESTIONS.find((x) => x.qid === qid);
    const qText = q?.question ?? qid;

    const answers = Array.isArray(inf.answers) ? [...inf.answers] : [];
    answers.push({ qid, question: qText, answer: ans, createdAt: now });

    const { candidates, hints } = scoreCandidates(answers, canon);
    const confidenceScore = computeConfidence(candidates);

    const suggestedIndustryKey = candidates[0]?.key ?? null;

    const round = Math.min(MaxRounds, (Number(inf.round ?? 1) || 1) + 1);

    const reachedTarget = confidenceScore >= ConfidenceTarget;
    const exhausted = round >= MaxRounds;

    const status: IndustryInference["status"] = reachedTarget || exhausted ? "suggested" : "collecting";
    const needsConfirmation = true;

    // Build a temp inf to drive adaptive next question selection
    const temp: IndustryInference = {
      mode: "interview",
      status,
      round,
      confidenceScore,
      suggestedIndustryKey,
      needsConfirmation,
      nextQuestion: null,
      answers,
      candidates,
      meta: { updatedAt: now, hints },
    };

    const nextQ = status === "collecting" ? nextQuestionFor(temp) : null;

    const next: IndustryInference = {
      ...temp,
      nextQuestion: nextQ ? { ...nextQ } : null,
    };

    ai.industryInference = next;

    // Mirror for Step3 and other downstream logic
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