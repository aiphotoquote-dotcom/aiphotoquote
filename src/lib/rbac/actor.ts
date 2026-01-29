// src/lib/rbac/actor.ts
import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { appUsers } from "@/lib/db/schema";
import { PLATFORM_ROLES, type PlatformRole, type ActorContext } from "./guards";

function normEmail(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase();
}

function parseEmailList(envVal: string | null | undefined) {
  return (envVal ?? "")
    .split(",")
    .map((x) => normEmail(x))
    .filter(Boolean);
}

function resolvePlatformRoleFromEmail(email: string | null): PlatformRole | null {
  const e = normEmail(email);
  if (!e) return "readonly";

  const owners = parseEmailList(process.env.PLATFORM_OWNER_EMAILS);
  const admins = parseEmailList(process.env.PLATFORM_ADMIN_EMAILS);
  const support = parseEmailList(process.env.PLATFORM_SUPPORT_EMAILS);
  const billing = parseEmailList(process.env.PLATFORM_BILLING_EMAILS);

  if (owners.includes(e)) return "platform_owner";
  if (admins.includes(e)) return "platform_admin";
  if (support.includes(e)) return "platform_support";
  if (billing.includes(e)) return "platform_billing";

  return "readonly";
}

async function upsertPortableUser(params: { clerkUserId: string; email: string | null; name: string | null }) {
  const { clerkUserId, email, name } = params;

  // If the user already exists, return it.
  const existing = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.authProvider, "clerk"))
    .where(eq(appUsers.authSubject, clerkUserId))
    .limit(1);

  if (existing?.[0]?.id) return existing[0].id;

  // Create new portable user.
  const inserted = await db
    .insert(appUsers)
    .values({
      authProvider: "clerk",
      authSubject: clerkUserId,
      email,
      name,
    })
    .returning({ id: appUsers.id });

  return inserted?.[0]?.id;
}

export async function getActorContext(): Promise<ActorContext> {
  const a = await auth();
  const clerkUserId = a?.userId;

  if (!clerkUserId) throw new Error("UNAUTHENTICATED");

  // Pull user from Clerk for email + display name (non-fatal if it fails).
  let email: string | null = null;
  let name: string | null = null;

  try {
    const client = await clerkClient();
    const u = await client.users.getUser(clerkUserId);

    email =
      u.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses?.[0]?.emailAddress ??
      null;

    name =
      (u.firstName || u.lastName ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null) ??
      (u.username ?? null);
  } catch {
    // ok: PCC can still run with readonly role if Clerk lookup fails
  }

  const appUserId = await upsertPortableUser({ clerkUserId, email, name });
  if (!appUserId) throw new Error("INTERNAL: failed to bootstrap app user");

  const platformRole = resolvePlatformRoleFromEmail(email);

  // Sanity: ensure role is one of our known values
  const safeRole: PlatformRole | null =
    platformRole && (PLATFORM_ROLES as readonly string[]).includes(platformRole) ? platformRole : "readonly";

  return {
    clerkUserId,
    appUserId,
    email,
    platformRole: safeRole,
  };
}