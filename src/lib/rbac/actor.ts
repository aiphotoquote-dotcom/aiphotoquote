// src/lib/rbac/actor.ts
import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { appUsers } from "@/lib/db/schema";
import type { PlatformRole } from "./guards";

export type ActorContext = {
  clerkUserId: string;
  email: string | null;

  // Internal portable user (app_users.id)
  userId: string;

  // Platform-wide RBAC (PCC)
  platformRole: PlatformRole;
};

/**
 * Resolve a platform role for the currently signed-in user.
 * PCC v1: role is derived from allowlists to avoid schema churn right now.
 *
 * Env options (comma-separated):
 * - PLATFORM_OWNER_EMAILS
 * - PLATFORM_ADMIN_EMAILS
 * - PLATFORM_SUPPORT_EMAILS
 * - PLATFORM_BILLING_EMAILS
 *
 * If none match, defaults to "readonly".
 */
function derivePlatformRoleFromEmail(email: string | null): PlatformRole {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return "readonly";

  const list = (v?: string | null) =>
    String(v ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);

  const owners = list(process.env.PLATFORM_OWNER_EMAILS);
  const admins = list(process.env.PLATFORM_ADMIN_EMAILS);
  const support = list(process.env.PLATFORM_SUPPORT_EMAILS);
  const billing = list(process.env.PLATFORM_BILLING_EMAILS);

  if (owners.includes(e)) return "platform_owner";
  if (admins.includes(e)) return "platform_admin";
  if (support.includes(e)) return "platform_support";
  if (billing.includes(e)) return "platform_billing";

  return "readonly";
}

async function getClerkEmail(clerkUserId: string): Promise<string | null> {
  try {
    // Clerk SDK shape differs by version: sometimes clerkClient is a function, sometimes an object.
    const client: any = typeof clerkClient === "function" ? await (clerkClient as any)() : (clerkClient as any);
    const u = await client.users.getUser(clerkUserId);

    const primary = u.emailAddresses?.find((x: any) => x.id === u.primaryEmailAddressId)?.emailAddress;
    return (primary ?? u.emailAddresses?.[0]?.emailAddress ?? null) as string | null;
  } catch {
    return null;
  }
}

async function getOrCreateAppUser(params: {
  authProvider: string;
  authSubject: string;
  email: string | null;
}): Promise<{ id: string }> {
  const { authProvider, authSubject, email } = params;

  const existing = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.authProvider, authProvider), eq(appUsers.authSubject, authSubject)))
    .limit(1);

  if (existing[0]?.id) return { id: existing[0].id };

  const inserted = await db
    .insert(appUsers)
    .values({
      authProvider,
      authSubject,
      email: email ?? null,
      // name can be filled later (or from Clerk user object if you want)
    })
    .returning({ id: appUsers.id });

  return { id: inserted[0]!.id };
}

export async function getActorContext(): Promise<ActorContext> {
  // IMPORTANT: Clerk auth is async in your environment.
  const a: any = await auth();
  const clerkUserId: string | null | undefined = a?.userId;

  if (!clerkUserId) throw new Error("UNAUTHENTICATED");

  const email = await getClerkEmail(clerkUserId);

  // Portable user record (app_users)
  const appUser = await getOrCreateAppUser({
    authProvider: "clerk",
    authSubject: clerkUserId,
    email,
  });

  const platformRole = derivePlatformRoleFromEmail(email);

  return {
    clerkUserId,
    email,
    userId: appUser.id,
    platformRole,
  };
}