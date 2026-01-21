// src/app/api/auth/session/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { appUsers } from "@/lib/db/schema";
import { requireAuthIdentity } from "@/lib/auth";
import { ensureAppUser } from "@/lib/auth/ensureAppUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getActiveTenantId() {
  const jar = await cookies();
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

    // ensureAppUser(identity) -> appUserId
    const appUserId = await ensureAppUser(identity);

    const user = await db
      .select({
        id: appUsers.id,
        email: appUsers.email,
        name: appUsers.name,
        authProvider: appUsers.authProvider,
      })
      .from(appUsers)
      .where(eq(appUsers.id, appUserId))
      .limit(1)
      .then((r) => r[0] ?? null);

    const activeTenantId = await getActiveTenantId();

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