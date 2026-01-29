// src/lib/rbac/actor.ts
import "server-only";

import { auth, clerkClient } from "@clerk/nextjs/server";

export type PlatformRole = "super_admin" | "platform_admin" | "support" | "billing" | "readonly";

export type ActorContext = {
  clerkUserId: string;
  email: string | null;

  // Platform-wide role (PCC). We'll wire this to DB later.
  platformRole: PlatformRole | null;
};

export async function getActorContext(): Promise<ActorContext> {
  // Clerk auth() is async in your current setup
  const a = await auth();
  const clerkUserId = a?.userId;

  if (!clerkUserId) throw new Error("UNAUTHENTICATED");

  // Optional: get email for audit/debug
  let email: string | null = null;
  try {
    const u = await clerkClient.users.getUser(clerkUserId);
    email =
      u.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses?.[0]?.emailAddress ??
      null;
  } catch {
    // ignore
  }

  // TODO: load from DB (platform_users / platform_roles)
  const platformRole: PlatformRole | null = null;

  return { clerkUserId, email, platformRole };
}