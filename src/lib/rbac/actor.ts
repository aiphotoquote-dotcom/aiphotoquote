// src/lib/rbac/actor.ts
import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { appUsers } from "@/lib/db/schema";
import type { PlatformRole } from "./guards";

export type ActorContext = {
  clerkUserId: string;
  appUserId: string;
  email: string | null;
  platformRole: PlatformRole; // always at least "readonly"
};

function csvEnv(name: string): string[] {
  const raw = process.env[name] || "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function resolvePlatformRoleByEmail(email: string | null): PlatformRole {
  const e = (email || "").trim().toLowerCase();
  if (!e) return "readonly";

  // Highest wins
  const owners = csvEnv("PCC_OWNER_EMAILS");
  if (owners.includes(e)) return "platform_owner";

  const admins = csvEnv("PCC_ADMIN_EMAILS");
  if (admins.includes(e)) return "platform_admin";

  const support = csvEnv("PCC_SUPPORT_EMAILS");
  if (support.includes(e)) return "platform_support";

  const billing = csvEnv("PCC_BILLING_EMAILS");
  if (billing.includes(e)) return "platform_billing";

  return "readonly";
}

async function getPrimaryEmail(clerkUserId: string): Promise<string | null> {
  try {
    // In your Clerk version, clerkClient is a function returning Promise<ClerkClient>
    const client = await clerkClient();
    const u = await client.users.getUser(clerkUserId);

    const primary =
      u.emailAddresses?.find((x) => x.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses?.[0]?.emailAddress ??
      null;

    return primary ? String(primary) : null;
  } catch {
    return null;
  }
}

export async function getActorContext(): Promise<ActorContext> {
  // In your Clerk version, auth() can be typed as Promise<...>
  const a = await auth();
  const clerkUserId = (a as any)?.userId as string | null;

  if (!clerkUserId) throw new Error("UNAUTHENTICATED");

  const email = await getPrimaryEmail(clerkUserId);

  // Portable user upsert (auth_provider + auth_subject)
  const provider = "clerk";
  const subject = clerkUserId;

  const existing = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.authProvider, provider), eq(appUsers.authSubject, subject)))
    .limit(1);

  let appUserId: string;

  if (existing.length) {
    appUserId = existing[0]!.id;

    await db
      .update(appUsers)
      .set({
        email: email ?? null,
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
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: appUsers.id });

    appUserId = inserted[0]!.id;
  }

  const platformRole = resolvePlatformRoleByEmail(email);

  return {
    clerkUserId,
    appUserId,
    email,
    platformRole,
  };
}