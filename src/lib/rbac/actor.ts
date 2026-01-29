// src/lib/rbac/actor.ts
import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { appUsers } from "@/lib/db/schema";
import type { PlatformRole } from "./guards";

export type ActorContext = {
  clerkUserId: string; // Clerk subject
  appUserId: string; // app_users.id
  email: string | null;
  name: string | null;
  platformRole: PlatformRole; // PCC role
};

function parseEmailList(v: string | undefined) {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function resolvePlatformRole(email: string | null): PlatformRole {
  const e = (email ?? "").toLowerCase();

  // Accept either naming convention so you can evolve envs without breaking.
  const owners = new Set([
    ...parseEmailList(process.env.PCC_OWNER_EMAILS),
    ...parseEmailList(process.env.PLATFORM_OWNER_EMAILS),
  ]);
  const admins = new Set([
    ...parseEmailList(process.env.PCC_ADMIN_EMAILS),
    ...parseEmailList(process.env.PLATFORM_ADMIN_EMAILS),
  ]);
  const billing = new Set([
    ...parseEmailList(process.env.PCC_BILLING_EMAILS),
    ...parseEmailList(process.env.PLATFORM_BILLING_EMAILS),
  ]);
  const support = new Set([
    ...parseEmailList(process.env.PCC_SUPPORT_EMAILS),
    ...parseEmailList(process.env.PLATFORM_SUPPORT_EMAILS),
  ]);

  if (e && owners.has(e)) return "platform_owner";
  if (e && admins.has(e)) return "platform_admin";
  if (e && billing.has(e)) return "platform_billing";
  if (e && support.has(e)) return "platform_support";
  return "readonly";
}

// Your Clerk import shape (in this project) behaves like an async factory.
// This wrapper keeps TS happy and prevents “users does not exist on type () => Promise<ClerkClient>”.
async function getClerk() {
  // clerkClient is a function in your current setup
  const anyClient: any = clerkClient as any;
  return typeof anyClient === "function" ? await anyClient() : anyClient;
}

async function fetchClerkProfile(clerkUserId: string): Promise<{ email: string | null; name: string | null }> {
  try {
    const client = await getClerk();
    const u = await client.users.getUser(clerkUserId);

    const email =
      u.emailAddresses?.find((e: any) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses?.[0]?.emailAddress ??
      null;

    const name =
      [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
      (u.username ? String(u.username) : null) ||
      null;

    return { email: email ? String(email) : null, name: name ? String(name) : null };
  } catch {
    return { email: null, name: null };
  }
}

/**
 * Actor context for RBAC:
 * - ensures we have a durable app_users row
 * - derives platformRole from allowlisted emails (env)
 */
export async function getActorContext(): Promise<ActorContext> {
  const a = await auth();
  const clerkUserId = a?.userId;

  if (!clerkUserId) throw new Error("UNAUTHENTICATED");

  // Fetch email/name from Clerk (best-effort)
  const { email, name } = await fetchClerkProfile(clerkUserId);

  // Upsert app_user (portable anchor)
  const provider = "clerk";
  const subject = clerkUserId;

  // Try find existing
  const existing = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.authProvider, provider), eq(appUsers.authSubject, subject)))
    .limit(1);

  let appUserId: string;

  if (existing.length) {
    appUserId = existing[0]!.id;

    // keep profile fresh (non-breaking)
    await db
      .update(appUsers)
      .set({
        email: email ?? null,
        name: name ?? null,
        updatedAt: new Date(),
      })
      .where(eq(appUsers.id, appUserId));
  } else {
    const inserted = await db
      .insert(appUsers)
      .values({
        authProvider: provider,
        authSubject: subject,
        email: email ?? null,
        name: name ?? null,
        updatedAt: new Date(),
      })
      .returning({ id: appUsers.id });

    appUserId = inserted[0]!.id;
  }

  const platformRole = resolvePlatformRole(email);

  return {
    clerkUserId,
    appUserId,
    email,
    name,
    platformRole,
  };
}