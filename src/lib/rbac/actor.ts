// src/lib/rbac/actor.ts
import { auth } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { platformMembers, type PlatformRole } from "@/lib/db/pccSchema";

export type ActorContext = {
  clerkUserId: string;
  platformRole: PlatformRole | null;
};

async function ensureBootstrapOwner() {
  const bootId = process.env.PLATFORM_OWNER_CLERK_USER_ID?.trim();
  if (!bootId) return;

  // If no platform members exist, upsert the boot user as platform_owner.
  const rows = await db.select({ c: sql<number>`count(*)` }).from(platformMembers);
  const count = Number(rows?.[0]?.c ?? 0);
  if (count > 0) return;

  await db
    .insert(platformMembers)
    .values({ clerkUserId: bootId, role: "platform_owner" })
    .onConflictDoNothing();
}

export async function getActorContext(): Promise<ActorContext> {
  const a = await auth(); // <-- FIX: auth() is async in this Clerk/Next setup
  const clerkUserId = a?.userId;
  if (!clerkUserId) throw new Error("UNAUTHENTICATED");

  // Bootstrap on first authenticated request.
  await ensureBootstrapOwner();

  const pm = await db
    .select({ role: platformMembers.role })
    .from(platformMembers)
    .where(eq(platformMembers.clerkUserId, clerkUserId))
    .limit(1);

  const platformRole = (pm?.[0]?.role as PlatformRole | undefined) ?? null;

  return { clerkUserId, platformRole };
}