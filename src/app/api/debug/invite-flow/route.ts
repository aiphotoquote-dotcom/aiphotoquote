// src/app/api/debug/invite-flow/route.ts
import { NextResponse } from "next/server";
import { and, desc, eq, gt, or } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { platformOnboardingSessions } from "@/lib/db/schema";
import { getPlatformConfig } from "@/lib/platform/getPlatformConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function pickParam(v: string | string[] | undefined): string | null {
  if (typeof v === "string") {
    const s = safeTrim(v);
    return s || null;
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = safeTrim(item);
      if (s) return s;
    }
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const onboardingSession = pickParam(url.searchParams.getAll("onboardingSession"));
  const invite = pickParam(url.searchParams.getAll("invite"));

  const authState = await auth();
  const clerkUserId = authState?.userId ?? null;
  const user = clerkUserId ? await currentUser().catch(() => null) : null;
  const email = safeTrim(user?.emailAddresses?.[0]?.emailAddress);
  const now = new Date();

  const cfg = await getPlatformConfig();

  let explicitSessionRow: any = null;
  if (onboardingSession) {
    const rows = await db
      .select({
        id: platformOnboardingSessions.id,
        status: platformOnboardingSessions.status,
        clerkUserId: platformOnboardingSessions.clerkUserId,
        email: platformOnboardingSessions.email,
        expiresAt: platformOnboardingSessions.expiresAt,
        createdAt: platformOnboardingSessions.createdAt,
      })
      .from(platformOnboardingSessions)
      .where(eq(platformOnboardingSessions.id, onboardingSession))
      .limit(1);

    explicitSessionRow = rows[0] ?? null;
  }

  const activeRows = clerkUserId || email
    ? await db
        .select({
          id: platformOnboardingSessions.id,
          status: platformOnboardingSessions.status,
          clerkUserId: platformOnboardingSessions.clerkUserId,
          email: platformOnboardingSessions.email,
          expiresAt: platformOnboardingSessions.expiresAt,
          createdAt: platformOnboardingSessions.createdAt,
        })
        .from(platformOnboardingSessions)
        .where(
          and(
            eq(platformOnboardingSessions.status, "active"),
            gt(platformOnboardingSessions.expiresAt, now),
            or(
              clerkUserId
                ? eq(platformOnboardingSessions.clerkUserId, clerkUserId)
                : eq(platformOnboardingSessions.email, email),
              email
                ? eq(platformOnboardingSessions.email, email)
                : clerkUserId
                  ? eq(platformOnboardingSessions.clerkUserId, clerkUserId)
                  : eq(platformOnboardingSessions.status, "___never___")
            )
          )
        )
        .orderBy(desc(platformOnboardingSessions.createdAt))
        .limit(5)
    : [];

  return NextResponse.json(
    {
      ok: true,
      path: url.pathname,
      search: url.search,
      onboardingMode: cfg.onboardingMode,
      auth: {
        clerkUserId,
        email: email || null,
      },
      explicit: {
        onboardingSession,
        invite,
        sessionRow: explicitSessionRow,
      },
      activeSessions: activeRows,
    },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        pragma: "no-cache",
        expires: "0",
      },
    }
  );
}