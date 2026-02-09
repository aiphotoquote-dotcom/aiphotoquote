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
    model?: { name?: string; status?: "ok" | "llm_error"; error?: string };
    debug?: { reason?: string; note?: string; conflict?: boolean; preGuess?: string };
  };
};

/* -------------------- tuning -------------------- */

const CONF_TARGET = 0.82;
const MAX_ROUNDS = 8;

/* -------------------- question bank -------------------- */
/**
 * IMPORTANT:
 * - freeform is LAST resort only
 * - industry-specific lock-in questions exist for multiple industries now
 * - domain_clarifier prevents “Homes” from derailing auto/collision etc.
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

  // ✅ conflict resolver (prevents “Homes” poisoning vehicle industries)
  {
    qid: "domain_clarifier",
    question: "Quick clarifier — what do you quote MOST often?",
    help: "This prevents loading the wrong starter pack.",
    options: ["Vehicles (cars/trucks/vans)", "Homes (residential)", "Commercial buildings/offices", "Outdoor/roads/land", "Other"],
  },

  // ✅ Window Treatments lock-ins
  {
    qid: "wt_products",
    question: "For window treatments — what do you install most?",
    options: ["Blinds", "Shades", "Shutters", "Drapes/Curtains", "Mix of these"],
  },
  {
    qid: "wt_job_type",
    question: "For window treatments — what kind of jobs are most common?",
    options: ["New install", "Replacement", "Repair", "Measuring/consultation", "Mix of these"],
  },
  {
    qid: "wt_customer_type",
    question: "For window treatments — who are your customers most often?",
    options: ["Residential", "Commercial", "Both"],
  },

  // ✅ Vehicle Wraps lock-ins
  {
    qid: "vw_wrap_type",
    question: "For wraps — what do you do most?",
    options: ["Full wraps", "Partial wraps", "Commercial lettering/decals", "Fleet wraps", "Mix of these"],
  },
  {
    qid: "vw_design",
    question: "For wraps — do customers typically provide artwork?",
    options: ["They provide artwork", "We design it", "Both"],
  },

  // ✅ Auto Repair / Collision lock-ins
  {
    qid: "arc_work_type",
    question: "For collision/body work — what do you do most?",
    options: ["Dent/scratch repair", "Panel replacement", "Paint & refinish", "Insurance collision claims", "Mix of these"],
  },
  {
    qid: "arc_claims",
    question: "Do you handle insurance claims?",
    options: ["Yes", "No", "Sometimes"],
  },

  // ✅ Auto Detailing lock-ins
  {
    qid: "ad_services",
    question: "For detailing — what do you sell most?",
    options: ["Wash packages", "Interior detail", "Paint correction", "Ceramic coating", "Mix of these"],
  },

  // ✅ Painting Contractors lock-ins
  {
    qid: "paint_scope",
    question: "For painting — what do you paint most?",
    options: ["Interior", "Exterior", "Both"],
  },
  {
    qid: "paint_customer_type",
    question: "For painting — who are your customers most often?",
    options: ["Residential", "Commercial", "Both"],
  },

  // ✅ Paving lock-ins
  {
    qid: "paving_type",
    question: "For paving — what do you do most?",
    options: ["Asphalt paving", "Sealcoating", "Concrete", "Striping", "Mix of these"],
  },

  // ✅ Upholstery lock-ins
  {
    qid: "uph_domain",
    question: "For upholstery — what do you work on most?",
    options: ["Auto", "Marine", "Furniture", "Commercial", "Mix of these"],
  },

  // LAST resort only
  {
    qid: "freeform",
    question: "Describe your business in one sentence.",
    help: "Be specific: what you do + what you work on (short is fine).",
  },
];

/* -------------------- industry lock-ins -------------------- */

const INDUSTRY_LOCKINS: Record<string, string[]> = {
  window_treatments: ["wt_products", "wt_job_type", "wt_customer_type"],
  vehicle_wraps: ["vw_wrap_type", "vw_design"],
  auto_repair_collision: ["arc_work_type", "arc_claims"],
  auto_detailing: ["ad_services"],
  painting_contractors: ["paint_scope", "paint_customer_type"],
  paving_contractor: ["paving_type"],
  upholstery: ["uph_domain"],
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

function answeredSet(inf: IndustryInference) {
  return new Set((inf.answers ?? []).map((a) => a.qid));
}

function pickQ(qid: string) {
  return QUESTION_BANK.find((q) => q.qid === qid) ?? null;
}

/* -------------------- heuristics + conflict detection -------------------- */

function heuristicSuggestIndustry(text: string) {
  const t = text.toLowerCase();

  if (/(wrap|wrapped|wrapping|vinyl|graphics|decal|lettering)/i.test(t)) return { key: "vehicle_wraps", conf: 0.80 };
  if (/(blinds|shade|shades|window treatment|window coverings|drapes|curtain|shutters)/i.test(t))
    return { key: "window_treatments", conf: 0.82 };

  if (/(collision|auto body|body shop|dent|bumper|panel|refinish)/i.test(t)) return { key: "auto_repair_collision", conf: 0.78 };
  if (/(ceramic|coating|paint correction|detail|detailing|wax|wash|buff|polish|ppf)/i.test(t))
    return { key: "auto_detailing", conf: 0.76 };
  if (/(interior|exterior).*(paint|painting)|painting contractor|repaint house|trim paint/i.test(t))
    return { key: "painting_contractors", conf: 0.76 };

  if (/(mechanic|brake|engine|oil change|diagnostic|repair)/i.test(t)) return { key: "auto_repair", conf: 0.72 };
  if (/(upholster|vinyl|leather|canvas|headliner|marine|sew)/i.test(t)) return { key: "upholstery", conf: 0.72 };
  if (/(asphalt|sealcoat|driveway|parking lot|paving|concrete|striping)/i.test(t)) return { key: "paving_contractor", conf: 0.72 };
  if (/(cleaning|janitor|maid|deep clean|pressure wash)/i.test(t)) return { key: "cleaning_services", conf: 0.70 };

  return { key: "service", conf: 0.1 };
}

/**
 * Detect “vehicle industry + home object” type conflicts and force a domain clarifier.
 */
function detectDomainConflict(inf: IndustryInference, bestGuessKey: string | null) {
  const key = normalizeKey(bestGuessKey ?? "");
  if (!key) return false;

  const answers = (inf.answers ?? []).map((a) => `${a.qid}:${a.answer}`.toLowerCase()).join(" | ");
  const hasHomes = /\bhomes?\b/.test(answers) || /\bresidential\b/.test(answers);
  const hasVehicles = /\bcars?\b|\btrucks?\b|\bvans?\b|\bvehicles?\b/.test(answers);

  const vehicleIndustries = new Set(["auto_repair_collision", "auto_detailing", "auto_repair", "vehicle_wraps"]);
  if (vehicleIndustries.has(key) && hasHomes && !hasVehicles) return true;

  return false;
}

/* -------------------- question picking -------------------- */

function nextFromStructuredBank(inf: IndustryInference) {
  const answered = answeredSet(inf);

  // Always prefer structured qids before freeform
  const preferred = ["services", "work_objects", "top_jobs", "keywords"];

  for (const qid of preferred) {
    if (!answered.has(qid)) return pickQ(qid);
  }

  // freeform LAST
  if (!answered.has("freeform")) return pickQ("freeform");
  return null;
}

function deterministicLockIn(inf: IndustryInference, bestGuessKey: string | null) {
  const key = normalizeKey(bestGuessKey ?? "");
  if (!key) return null;

  const answered = answeredSet(inf);
  const list = INDUSTRY_LOCKINS[key] ?? [];
  for (const qid of list) {
    if (!answered.has(qid)) return pickQ(qid);
  }
  return null;
}

function allowedNextQids(inf: IndustryInference, bestGuessKey: string | null) {
  const answered = answeredSet(inf);

  // conflict clarifier can always be used if not answered
  const qids: string[] = [];
  if (!answered.has("domain_clarifier")) qids.push("domain_clarifier");

  // industry lock-ins
  const key = normalizeKey(bestGuessKey ?? "");
  const lockIns = INDUSTRY_LOCKINS[key] ?? [];
  for (const qid of lockIns) if (!answered.has(qid)) qids.push(qid);

  // structured
  for (const qid of ["services", "work_objects", "top_jobs", "keywords"]) {
    if (!answered.has(qid)) qids.push(qid);
  }

  // freeform last, only if nothing else left
  if (qids.length === 0 && !answered.has("freeform")) qids.push("freeform");
  return qids;
}

/* -------------------- REAL AI (LLM) -------------------- */

function buildInterviewText(inf: IndustryInference) {
  return (inf.answers ?? []).map((a) => `- (${a.qid}) ${a.question}\n  Answer: ${a.answer}`).join("\n");
}

async function runLLM(args: {
  canon: Array<{ key: string; label: string }>;
  inf: IndustryInference;
  action: "start" | "answer";
  preGuessKey: string | null;
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

  const canonList = args.canon.slice(0, 500).map((c) => `${c.key} — ${c.label}`).join("\n");
  const history = buildInterviewText(args.inf);
  const last = args.inf.answers?.[args.inf.answers.length - 1];

  const allowQids = allowedNextQids(args.inf, args.preGuessKey);

  const system = [
    "You are the onboarding classifier for AIPhotoQuote.",
    "Goal: pick the best industry starter pack and ask the next best question.",
    "Output ONLY valid JSON (no markdown, no extra text).",
    "",
    "Rules:",
    "- suggestedIndustryKey MUST be snake_case.",
    "- confidenceScore must be 0..1.",
    "- candidates: 3-6 items, each { key, label, score }.",
    "- nextQuestion must be one of the allowed qids (or null).",
    "- Do NOT repeat a qid already answered.",
    "- Prefer multiple-choice clarifiers over freeform.",
    "- If correct industry is NOT in canonical industries, propose newIndustry { key, label, description? }.",
    "",
    "We DO want these as first-class industries if detected:",
    "- vehicle_wraps (vinyl wraps / graphics / decals)",
    "- window_treatments (blinds / shades / window coverings / shutters / drapes)",
  ].join("\n");

  const user = [
    `Action: ${args.action}`,
    `Pre-guess industry key: ${args.preGuessKey || "(none)"}`,
    "",
    "Canonical industries (key — label):",
    canonList || "(none)",
    "",
    "Allowed next qids:",
    allowQids.join(", ") || "(none)",
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
        nextQuestion: { qid: "one_of_allowed_qids", question: "string", help: "string", options: ["a", "b"] },
        newIndustry: { key: "snake_case", label: "Label", description: "optional" },
        debugReason: "short reason",
      },
      null,
      2
    ),
  ].join("\n");

  const model = process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini";

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.2,
    // helps prevent “prose then json”
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const content = resp.choices?.[0]?.message?.content ?? "";
  const parsed = jsonExtract(content) ?? (content ? JSON.parse(content) : null);
  if (!parsed || typeof parsed !== "object") throw new Error("LLM returned non-JSON output.");

  const suggested = normalizeKey(parsed.suggestedIndustryKey ?? "");
  const rawConf = Number(parsed.confidenceScore ?? 0);
  const confidenceScore = Number.isFinite(rawConf) ? Math.max(0, Math.min(1, rawConf)) : 0;

  const candRaw = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const candidates: Candidate[] = candRaw
    .map((c: any) => ({
      key: normalizeKey(c?.key ?? ""),
      label: safeTrim(c?.label ?? ""),
      score: Number(c?.score ?? 0) || 0,
    }))
    .filter((c: Candidate) => c.key);

  const finalCandidates =
    candidates.length > 0
      ? candidates.slice(0, 6)
      : [{ key: suggested || args.preGuessKey || "service", label: titleFromKey(suggested || args.preGuessKey || "service"), score: 0 }];

  const answered = answeredSet(args.inf);
  const allowed = new Set(allowQids);

  let nextQuestion: any = parsed.nextQuestion ?? null;
  if (nextQuestion && typeof nextQuestion === "object") {
    const qid = safeTrim(nextQuestion.qid);
    if (!qid || answered.has(qid) || !allowed.has(qid)) {
      nextQuestion = null;
    } else {
      const bank = pickQ(qid);
      nextQuestion = {
        qid,
        question: safeTrim(nextQuestion.question) || bank?.question || titleFromKey(qid),
        help: safeTrim(nextQuestion.help) || bank?.help || undefined,
        options: Array.isArray(nextQuestion.options)
          ? nextQuestion.options.map((x: any) => safeTrim(x)).filter(Boolean)
          : bank?.options,
      };
    }
  } else {
    nextQuestion = null;
  }

  let newIndustry: any = parsed.newIndustry ?? null;
  if (newIndustry && typeof newIndustry === "object") {
    const nk = normalizeKey(newIndustry.key ?? "");
    const nl = safeTrim(newIndustry.label ?? "");
    if (nk && nl) {
      newIndustry = { key: nk, label: nl, description: newIndustry.description == null ? null : String(newIndustry.description) };
    } else newIndustry = null;
  } else newIndustry = null;

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

    const answersBlobForGuess = (inf.answers ?? []).map((a) => a.answer).join(" | ");
    const preH = heuristicSuggestIndustry(answersBlobForGuess);
    const preGuessKey = inf.suggestedIndustryKey || preH.key || null;

    if (parsed.data.action === "start") {
      try {
        const out = await runLLM({ canon, inf, action: "start", preGuessKey });

        // build-criteria: create new industries
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

        const bestKey = out.suggestedIndustryKey || preGuessKey;

        // ✅ conflict clarifier first
        const conflict = detectDomainConflict(inf, bestKey);
        const conflictQ = conflict ? pickQ("domain_clarifier") : null;

        // ✅ deterministic lock-in second
        const lockIn = !conflict ? deterministicLockIn(inf, bestKey) : null;

        // ✅ model question third
        const modelQ = !conflict && out.nextQuestion ? out.nextQuestion : null;

        // ✅ structured bank fourth
        const bankQ = !conflict && !lockIn && !modelQ ? nextFromStructuredBank(inf) : null;

        const q = conflictQ ?? lockIn ?? modelQ ?? bankQ ?? pickQ("freeform");

        inf = {
          ...inf,
          status: "collecting",
          suggestedIndustryKey: bestKey || null,
          confidenceScore: Number.isFinite(out.confidenceScore) ? out.confidenceScore : 0,
          candidates: Array.isArray(out.candidates) && out.candidates.length ? out.candidates : [{ key: "service", label: "Service", score: 0 }],
          nextQuestion: q,
          needsConfirmation: true,
          meta: {
            updatedAt: now,
            model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "ok" },
            debug: { reason: out.debugReason || undefined, note: conflict ? "domain_conflict" : lockIn ? "lock_in" : undefined, conflict, preGuess: preGuessKey || undefined },
          },
        };

        ai.industryInference = inf;
        ai.suggestedIndustryKey = inf.suggestedIndustryKey;
        ai.confidenceScore = inf.confidenceScore;
        ai.needsConfirmation = true;

        await writeAiAnalysis(tenantId, ai);
        return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
      } catch (e: any) {
        const fallbackQ = pickQ("services") ?? pickQ("freeform");

        inf = {
          ...inf,
          status: "collecting",
          suggestedIndustryKey: preGuessKey,
          confidenceScore: Number.isFinite(inf.confidenceScore) ? inf.confidenceScore : 0,
          candidates: [{ key: preGuessKey || "service", label: titleFromKey(preGuessKey || "service"), score: 0 }],
          nextQuestion: fallbackQ,
          needsConfirmation: true,
          meta: {
            updatedAt: now,
            model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "llm_error", error: e?.message ?? String(e) },
            debug: { note: "start_fallback", preGuess: preGuessKey || undefined },
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

    const qFromBank = pickQ(qid);
    const qText = qFromBank?.question ?? qid;

    const answers = Array.isArray(inf.answers) ? [...inf.answers] : [];
    answers.push({ qid, question: qText, answer: ans, createdAt: now });

    inf = {
      ...inf,
      answers,
      round: Math.min(MAX_ROUNDS, (Number(inf.round ?? 1) || 1) + 1),
      meta: { ...(inf.meta ?? {}), updatedAt: now },
    };

    const blob = answers.map((a) => a.answer).join(" | ");
    const h = heuristicSuggestIndustry(blob);
    const preKey = inf.suggestedIndustryKey || h.key;

    try {
      const out = await runLLM({ canon, inf, action: "answer", preGuessKey: preKey });

      if (out.newIndustry?.key && out.newIndustry?.label) {
        await ensureIndustryExists({
          keyOrLabel: out.newIndustry.key,
          label: out.newIndustry.label,
          description: out.newIndustry.description ?? null,
        });
      }

      const bestKey = out.suggestedIndustryKey || preKey;

      if (bestKey) {
        const existsInCanon = canon.some((c) => c.key === bestKey);
        if (!existsInCanon) {
          await ensureIndustryExists({ keyOrLabel: bestKey, label: titleFromKey(bestKey) });
        }
      }

      const reached = out.confidenceScore >= CONF_TARGET;
      const status: IndustryInference["status"] = reached ? "suggested" : "collecting";

      let nextQ: IndustryInference["nextQuestion"] = null;

      if (status === "collecting") {
        const conflict = detectDomainConflict(inf, bestKey);
        const conflictQ = conflict ? pickQ("domain_clarifier") : null;
        const lockIn = !conflict ? deterministicLockIn(inf, bestKey) : null;

        // Only accept modelQ if it’s not answered already
        const answered = answeredSet(inf);
        const modelQ = out.nextQuestion && !answered.has(out.nextQuestion.qid) ? out.nextQuestion : null;

        nextQ = conflictQ ?? lockIn ?? modelQ ?? nextFromStructuredBank(inf) ?? pickQ("freeform");
      }

      const candidates =
        Array.isArray(out.candidates) && out.candidates.length
          ? out.candidates
          : [{ key: bestKey || "service", label: titleFromKey(bestKey || "service"), score: 0 }];

      inf = {
        mode: "interview",
        status,
        round: inf.round,
        confidenceScore: out.confidenceScore,
        suggestedIndustryKey: bestKey || candidates[0]?.key || null,
        needsConfirmation: true,
        nextQuestion: nextQ,
        answers,
        candidates,
        meta: {
          updatedAt: now,
          model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "ok" },
          debug: { reason: out.debugReason || undefined, preGuess: preKey || undefined },
        },
      };

      ai.industryInference = inf;
      ai.suggestedIndustryKey = inf.suggestedIndustryKey;
      ai.confidenceScore = inf.confidenceScore;
      ai.needsConfirmation = true;

      await writeAiAnalysis(tenantId, ai);
      return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
    } catch (e: any) {
      // Heuristic fallback, but still “alive”
      if (h.key && h.key !== "service") {
        await ensureIndustryExists({ keyOrLabel: h.key, label: titleFromKey(h.key) });
      }

      const status: IndustryInference["status"] = h.conf >= CONF_TARGET ? "suggested" : "collecting";

      const conflict = detectDomainConflict(inf, h.key);
      const conflictQ = conflict ? pickQ("domain_clarifier") : null;
      const lockIn = !conflict ? deterministicLockIn(inf, h.key) : null;

      const fallbackQ = conflictQ ?? lockIn ?? nextFromStructuredBank(inf) ?? pickQ("freeform");

      inf = {
        mode: "interview",
        status,
        round: inf.round,
        confidenceScore: h.conf,
        suggestedIndustryKey: h.key || null,
        needsConfirmation: true,
        nextQuestion: status === "collecting" ? fallbackQ : null,
        answers,
        candidates: [
          { key: h.key, label: titleFromKey(h.key), score: Math.round(h.conf * 10) },
          { key: "service", label: "Service", score: 0 },
        ],
        meta: {
          updatedAt: now,
          model: { name: process.env.OPENAI_ONBOARDING_MODEL || "gpt-4o-mini", status: "llm_error", error: e?.message ?? String(e) },
          debug: { note: "heuristic_fallback", conflict, preGuess: preKey || undefined },
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