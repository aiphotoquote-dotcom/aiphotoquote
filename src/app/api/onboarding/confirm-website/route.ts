import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function firstRow(r: any): any | null {
  if (!r) return null;
  if (Array.isArray(r)) return r[0] ?? null;
  if (Array.isArray(r.rows)) return r.rows[0] ?? null;
  return null;
}

async function requireAuthed(): Promise<{ clerkUserId: string }> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHENTICATED");
  return { clerkUserId: userId };
}

async function requireMembership(clerkUserId: string, tenantId: string): Promise<void> {
  const r = await db.execute(sql`
    select 1 as ok
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${clerkUserId}
    limit 1
  `);
  const row = firstRow(r);
  if (!row?.ok) throw new Error("FORBIDDEN_TENANT");
}

function clamp(s: string, n: number) {
  const t = safeTrim(s);
  return t.length <= n ? t : t.slice(0, n) + "…";
}

export async function POST(req: Request) {
  try {
    const { clerkUserId } = await requireAuthed();

    const body = await req.json().catch(() => null);
    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });

    await requireMembership(clerkUserId, tenantId);

    const answer = safeTrim(body?.answer).toLowerCase(); // "yes" | "no"
    const feedback = clamp(safeTrim(body?.feedback), 2000);

    if (answer !== "yes" && answer !== "no") {
      return NextResponse.json({ ok: false, error: "ANSWER_REQUIRED", message: "answer must be yes|no" }, { status: 400 });
    }

    const r = await db.execute(sql`
      select ai_analysis
      from tenant_onboarding
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? null;
    const prev = row?.ai_analysis ?? null;

    const prevConfidence = Number(prev?.confidenceScore ?? 0.55);
    const nextConfidence =
      answer === "yes"
        ? Math.max(prevConfidence, 0.85)
        : Math.max(prevConfidence, 0.70); // we learned something, but still need more

    const needsConfirmation = nextConfidence < 0.8 && answer !== "yes";

    const nextAnalysis = {
      ...(prev && typeof prev === "object" ? prev : {}),
      confidenceScore: Math.min(0.95, nextConfidence),
      needsConfirmation,
      userConfirmation: {
        answeredAt: new Date().toISOString(),
        answer,
        feedback: feedback || undefined,
      },
      // If they say “no”, we preserve the original guess but add “userProvidedDescription”
      userProvidedDescription: answer === "no" && feedback ? feedback : (prev?.userProvidedDescription ?? undefined),
      // If they say “yes”, treat the guess as “confirmed”
      businessConfirmed:
        answer === "yes"
          ? {
              confirmedAt: new Date().toISOString(),
              businessDescription: safeTrim(prev?.businessGuess) || undefined,
            }
          : prev?.businessConfirmed ?? undefined,
    };

    await db.execute(sql`
      insert into tenant_onboarding (tenant_id, ai_analysis, current_step, completed, created_at, updated_at)
      values (${tenantId}::uuid, ${JSON.stringify(nextAnalysis)}::jsonb, 2, false, now(), now())
      on conflict (tenant_id) do update
      set ai_analysis = excluded.ai_analysis,
          current_step = greatest(tenant_onboarding.current_step, 2),
          updated_at = now()
    `);

    return NextResponse.json({ ok: true, tenantId, aiAnalysis: nextAnalysis }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const status = msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN_TENANT" ? 403 : 500;
    return NextResponse.json({ ok: false, error: "INTERNAL", message: msg }, { status });
  }
}