// src/lib/rbac/actor.ts
import { auth, clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { appUsers } from "@/lib/db/schema";

export type PlatformRole =
  | "platform_owner"
  | "platform_admin"
  | "platform_support"
  | "platform_billing"
  | "readonly";

export type ActorContext = {
  clerkUserId: string;
  email: string | null;
  appUserId: string;
  platformRole: PlatformRole;
};

function parseEmailList(s: string | undefined | null): string[] {
  if (!s) return [];
  return s
    .split(/[,\n]/g)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function pickPlatformRole(email: string | null): PlatformRole {
  const e = (email || "").trim().toLowerCase();

  const owners = parseEmailList(process.env.PCC_OWNER_EMAILS);
  const admins = parseEmailList(process.env.PCC_ADMIN_EMAILS);
  const support = parseEmailList(process.env.PCC_SUPPORT_EMAILS);
  const billing = parseEmailList(process.env.PCC_BILLING_EMAILS);

  if (e && owners.includes(e)) return "platform_owner";
  if (e && admins.includes(e)) return "platform_admin";
  if (e && support.includes(e)) return "platform_support";
  if (e && billing.includes(e)) return "platform_billing";
  return "readonly";
}

async function getClerkEmail(clerkUserId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const u = await client.users.getUser(clerkUserId);

    const primary =
      u.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses?.[0]?.emailAddress ??
      null;

    return primary ? String(primary).toLowerCase() : null;
  } catch {
    return null;
  }
}

async function getOrCreateAppUser(clerkUserId: string, email: string | null) {
  // Find existing
  const existing = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(eq(appUsers.authProvider, "clerk"))
    // drizzle doesn't support compound where easily unless using and()
    // so we just add a second filter via JS if needed:
    .limit(50);

  const match = existing.find(async (row) => {
    // can't async in find; so do the proper query below instead
    return false;
  });

  // Proper query:
  const row = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.authProvider, "clerk"))
    .limit(500);

  const found = row.find((r) => r.authSubject === clerkUserId);

  if (found) {
    // Best-effort keep email fresh
    if (email && found.email !== email) {
      await db
        .update(appUsers)
        .set({ email, updatedAt: new Date() })
        .where(eq(appUsers.id, found.id));
    }
    return found.id;
  }

  const inserted = await db
    .insert(appUsers)
    .values({
      authProvider: "clerk",
      authSubject: clerkUserId,
      email: email ?? null,
      name: null,
      updatedAt: new Date(),
    })
    .returning({ id: appUsers.id });

  const id = inserted?.[0]?.id;
  if (!id) throw new Error("FAILED_TO_CREATE_APP_USER");
  return id;
}

export async function getActorContext(): Promise<ActorContext> {
  const a = await auth();
  const clerkUserId = a?.userId;

  if (!clerkUserId) throw new Error("UNAUTHENTICATED");

  const email = await getClerkEmail(clerkUserId);
  const appUserId = await getOrCreateAppUser(clerkUserId, email);

  return {
    clerkUserId,
    email,
    appUserId,
    platformRole: pickPlatformRole(email),
  };
}