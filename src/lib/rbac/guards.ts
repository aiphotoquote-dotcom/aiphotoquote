// src/lib/rbac/guards.ts
import "server-only";

import { getActorContext, type ActorContext } from "./actor";

/**
 * Canonical platform roles for the PCC.
 * This is the SINGLE source of truth the guards enforce.
 */
export type GuardedPlatformRole =
  | "platform_owner"
  | "platform_admin"
  | "platform_support"
  | "platform_billing";

/**
 * Map actor.platformRole → guarded role space.
 * This lets us evolve DB / auth vocab without breaking guards.
 */
function normalizePlatformRole(
  role: ActorContext["platformRole"]
): GuardedPlatformRole | null {
  switch (role) {
    case "super_admin":
      return "platform_owner";
    case "platform_admin":
      return "platform_admin";
    case "support":
      return "platform_support";
    case "billing":
      return "platform_billing";
    default:
      return null; // readonly or unset
  }
}

export function hasPlatformRole(
  actor: ActorContext,
  allowed: GuardedPlatformRole[]
): boolean {
  if (!actor.platformRole) return false;

  const normalized = normalizePlatformRole(actor.platformRole);
  if (!normalized) return false;

  return allowed.includes(normalized);
}

export async function requirePlatformRole(
  allowed: GuardedPlatformRole[]
): Promise<ActorContext> {
  const actor = await getActorContext();

  if (!hasPlatformRole(actor, allowed)) {
    throw new Error("FORBIDDEN");
  }

  return actor;
}