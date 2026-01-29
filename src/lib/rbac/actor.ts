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
  // In your setup, auth() returns a Promise
  const a = await auth();
  const clerkUserId = a?.userId;

  if (!clerkUserId) throw new Error("UNAUTHENTICATED");

  // Optional: get email (nice for audit/debug)
  let email: string | null = null;
  try {
    // IMPORTANT: in your Clerk types, clerkClient is a function returning the client
    const client = await clerkClient();
    const u = await client.users.getUser(clerkUserId);

    email =
      u.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses?.[0]?.emailAddress ??
      null;
  } catch {
    // ignore (email is optional)
  }

  // TODO: load from DB (platform_users / platform_roles)
  const platformRole: PlatformRole | null = null;

  return { clerkUserId, email, platformRole };
}