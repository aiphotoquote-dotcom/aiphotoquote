// src/lib/rbac/actor.ts
import "server-only";

import { auth, clerkClient } from "@clerk/nextjs/server";

export type PlatformRole = "super_admin" | "platform_admin" | "support" | "billing" | "readonly";

export type ActorContext = {
  clerkUserId: string;
  email: string | null;
  platformRole: PlatformRole | null;
};

/**
 * Actor = current signed-in Clerk user + platform role (later from DB).
 * For now: role is null until we add platform_users bootstrap.
 */
export async function getActorContext(): Promise<ActorContext> {
  const a = await auth(); // ✅ in your setup, this is async
  const clerkUserId = a?.userId;

  if (!clerkUserId) {
    // Middleware should prevent reaching here for protected routes,
    // but keep the error for correctness.
    throw new Error("UNAUTHENTICATED");
  }

  let email: string | null = null;

  try {
    const client = await clerkClient(); // ✅ your clerkClient is async
    const u = await client.users.getUser(clerkUserId);

    email =
      u.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses?.[0]?.emailAddress ??
      null;
  } catch {
    // Don’t fail the whole request if email lookup fails.
    email = null;
  }

  return {
    clerkUserId,
    email,
    platformRole: null, // ✅ v1: no DB role yet
  };
}