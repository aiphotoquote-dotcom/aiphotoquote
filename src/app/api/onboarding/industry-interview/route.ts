// src/app/api/onboarding/industry-interview/route.ts

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* -------------------- helpers -------------------- */

const nowISO = () => new Date().toISOString();

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s || "";
}

function normalizeKey(raw: string) {
  return safeTrim(raw)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function firstRow(r: any) {
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray(r?.rows)) return r.rows[0] ?? null;
  return null;
}

async function requireAuthed() {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return userId;
}

async function requireMembership(userId: string, tenantId: string) {
  const r = await db.execute(sql`
    select 1 from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${userId}
      and status = 'active'
    limit 1
  `);
  if (!firstRow(r)) throw new Error("FORBIDDEN_TENANT");
}

/* -------------------- canonical shape -------------------- */

function emptyInference() {
  return {
    mode: "interview" as const,
    status: "collecting" as const,
    round: 1,
    confidenceScore: 0,
    suggestedIndustryKey: null as string | null,
    needsConfirmation: true,
    nextQuestion: null as any,
    answers: [] as any[],
    candidates: [] as any[],
    conflicts: [] as any[],
    meta: { updatedAt: nowISO() },
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
    const userId = await requireAuthed();
    const body = PostSchema.parse(await req.json());
    const tenantId = safeTrim(body.tenantId);

    await requireMembership(userId, tenantId);

    // Load existing ai_analysis
    const r = await db.execute(sql`
      select ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row = firstRow(r);
    const ai = typeof row?.ai_analysis === "object" && row.ai_analysis !== null ? row.ai_analysis : {};

    let inf = ai.industryInference ?? emptyInference();

    if (body.action === "reset") {
      inf = emptyInference();
    }

    if (body.action === "start" && !inf.nextQuestion) {
      inf.nextQuestion = {
        qid: "freeform",
        question: "Describe your business in one sentence.",
        help: "Example: “We sell and install custom window blinds and shades.”",
      };
    }

    if (body.action === "answer") {
      inf.answers = [...inf.answers, {
        qid: body.qid,
        question: body.qid,
        answer: safeTrim(body.answer),
        createdAt: nowISO(),
      }];

      // VERY IMPORTANT: always keep these defined
      inf.candidates = inf.candidates ?? [];
      inf.confidenceScore = inf.confidenceScore ?? 0;
      inf.status = inf.status ?? "collecting";
      inf.nextQuestion = {
        qid: "freeform",
        question: "Describe your business in one sentence.",
        help: "Short answers are fine.",
      };
    }

    ai.industryInference = inf;

    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, ai_analysis, updated_at)
      values (${tenantId}::uuid, ${JSON.stringify(ai)}::jsonb, now())
      on conflict (tenant_id)
      do update set ai_analysis = excluded.ai_analysis, updated_at = now()
    `);

    return NextResponse.json({ ok: true, tenantId, industryInference: inf });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}