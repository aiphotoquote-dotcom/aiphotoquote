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

function safeJsonStringify(v: any): string {
  try {
    // Avoid passing [object Object] into SQL params: always serialize explicitly.
    return JSON.stringify(v ?? {});
  } catch {
    return "{}";
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

const ConfidenceTarget = 0.82;
const MaxRounds = 8;

/**
 * Question bank (ordered). We stop once confidence is high.
 * Keep short, high-signal, and easy to answer on mobile.
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
    help: "A short phrase is fine. Example: “custom boat upholstery, vinyl repairs”",
    options: [
      "Upholstery / reupholstery",
      "Paving / asphalt / concrete",
      "Landscaping / hardscaping",
      "HVAC / plumbing / electrical",
      "Auto repair / body",
      "Roofing / siding",
      "Cleaning / janitorial",
      "Other",
    ],
  },
  {
    qid: "who_for",
    question: "Who are your customers?",
    help: "Pick the closest match.",
    options: ["Residential", "Commercial", "Both"],
  },
  {
    qid: "materials_objects",
    question: "What do you work on most often?",
    help: "Example: “boats, cars, RVs” or “driveways, parking lots”.",
    options: ["Boats", "Cars/Trucks", "Homes", "Businesses", "Roads/Parking lots", "Other"],
  },
  {
    qid: "top_jobs",
    question: "Name 2–3 common jobs you quote.",
    help: "Example: “boat seats, headliners, custom covers”.",
  },
  {
    qid: "location",
    question: "Where do you operate?",
    help: "City/state or a rough service radius.",
  },
];

/**
 * Simple scoring rules (deterministic).
 * We’ll swap this to OpenAI later, but this is enough to get the recursion + UI + state right.
 */
const KEYWORDS: Record<string, Array<string | RegExp>> = {
  upholstery: [/upholster/i, /vinyl/i, /canvas/i, /headliner/i, /sew/i, /marine upholstery/i],
  paving_contractor: [/asphalt/i, /pav(e|ing)/i, /sealcoat/i, /concrete/i, /driveway/i, /parking lot/i],
  landscaping_hardscaping: [/landscap/i, /hardscap/i, /mulch/i, /pavers/i, /retaining wall/i, /lawn/i],
  hvac: [/hvac/i, /air condition/i, /furnace/i, /heat pump/i],
  plumbing: [/plumb/i, /water heater/i, /drain/i, /sewer/i],
  electrical: [/electric/i, /panel/i, /breaker/i, /wiring/i],
  auto_repair: [/auto repair/i, /mechanic/i, /brake/i, /engine/i],
  roofing: [/roof/i, /shingle/i, /gutter/i, /siding/i],
  cleaning_services: [/clean/i, /janitor/i, /maid/i, /pressure wash/i],
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
  // ✅ Critical fix: serialize JS object to JSON for jsonb param
  const aiJson = safeJsonStringify(ai);

  // ✅ Make resilient: onboarding row might not exist yet -> upsert
  await db.execute(sql`
    insert into tenant_onboarding (tenant_id, ai_analysis, created_at, updated_at)
    values (${tenantId}::uuid, ${aiJson}::jsonb, now(), now())
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
  const q = QUESTIONS.find((x) => !answered.has(x.qid));
  return q ?? null;
}

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
    if (s > 0) scores.set(k, s);
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
    candidates.push({ key: "service", label: canon.find((c) => c.key === "service")?.label ?? "Service", score: 1 });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 6).map((c) => ({ ...c, score: c.score }));
}

function computeConfidence(cands: Candidate[]) {
  const top = cands[0]?.score ?? 0;
  const second = cands[1]?.score ?? 0;

  if (top <= 0) return 0;

  const mag = Math.min(1, top / 6);
  const sep = top > 0 ? Math.max(0, Math.min(1, (top - second) / Math.max(1, top))) : 0;

  const conf = 0.45 * mag + 0.55 * sep;
  return Math.max(0, Math.min(1, conf));
}

/* -------------------- schema -------------------- */

const PostSchema = z.object({
  tenantId: z.string().min(1),
  action: z.enum(["start", "answer", "reset"]),
  qid: z.string().optional(),
  answer: z.string().optional(),
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
      await writeAiAnalysis(tenantId, ai);

      return NextResponse.json({ ok: true, tenantId, industryInference: inf }, { status: 200 });
    }

    if (parsed.data.action === "start") {
      const nq = nextQuestionFor(inf);
      inf.nextQuestion = nq ? { ...nq } : null;

      ai.industryInference = { ...inf, meta: { updatedAt: now } };
      await writeAiAnalysis(tenantId, ai);

      return NextResponse.json({ ok: true, tenantId, industryInference: ai.industryInference }, { status: 200 });
    }

    // action === "answer"
    const qid = safeTrim(parsed.data.qid);
    const ans = safeTrim(parsed.data.answer);

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
    const needsConfirmation = true;

    const nextQ = status === "collecting" ? nextQuestionFor({ ...inf, answers }) : null;

    const next: IndustryInference = {
      mode: "interview",
      status,
      round,
      confidenceScore,
      suggestedIndustryKey,
      needsConfirmation,
      nextQuestion: nextQ ? { ...nextQ } : null,
      answers,
      candidates,
      meta: { updatedAt: now },
    };

    ai.industryInference = next;

    // keep compatibility with downstream (Step3 reads these)
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