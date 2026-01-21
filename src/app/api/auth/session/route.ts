// src/app/api/auth/session/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { db } from "@/lib/db/client";
import { appUsers } from "@/lib/db/schema";
import { requireAuthIdentity } from "@/lib/auth";
import { ensureAppUserId } from "@/lib/auth/ensureAppUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getActiveTenantId() {
  const jar = cookies();
  return (
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null
  );
}

export async function GET() {
  try {
    const identity = await requireAuthIdentity();
    const appUserId = await ensureAppUserId(identity);

    const user = await db
      .select({
        id: appUsers.id,
        email: appUsers.email,
        name: appUsers.name,
        authProvider: appUsers.authProvider,
      })
      .from(appUsers)
      .where((appUsers.id as any).eq ? (appUsers.id as any).eq(appUserId) : undefined)
      .limit(1)
      .then((r) => r[0] ?? null);

    // Fallback if drizzle eq import isn’t used here
    // (keeps this file independent and stable)
    const activeTenantId = getActiveTenantId();

    return NextResponse.json({
      ok: true,
      identity,
      appUserId,
      user,
      activeTenantId,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHENTICATED", message: e?.message ?? String(e) },
      { status: 401 }
    );
  }
}