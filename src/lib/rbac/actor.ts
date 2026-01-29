// src/lib/rbac/actor.ts
import "server-only";

import { auth, clerkClient } from "@clerk/nextjs/server";

export type ActorContext = {
  clerkUserId: string;
  email: string | null;
};

export async function getActorContext(): Promise<ActorContext> {
  // ✅ auth() is async in your current Clerk version/type defs
  const a = await auth();
  const clerkUserId = a?.userId;

  if (!clerkUserId) {
    throw new Error("UNAUTHENTICATED");
  }

  // Optional: pull email for audit logs / RBAC debugging
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

  return { clerkUserId, email };
}