// src/lib/rbac/guards.ts
import { getActorContext, type ActorContext, type PlatformRole } from "./actor";

/**
 * Simple role check.
 */
export function hasPlatformRole(actor: ActorContext, roles: PlatformRole[]) {
  if (!actor.platformRole) return false;
  return roles.includes(actor.platformRole);
}

/**
 * Throws FORBIDDEN if the signed-in user does not have one of the allowed roles.
 * Use this inside server components / server actions for PCC routes.
 */
export async function requirePlatformRole(roles: PlatformRole[]) {
  const actor = await getActorContext();

  if (!hasPlatformRole(actor, roles)) {
    throw new Error("FORBIDDEN");
  }

  return actor;
}

/**
 * Convenience: "any PCC access" (non-readonly).
 * If you want readonly to see PCC later, remove the readonly check.
 */
export async function requirePccAccess() {
  const actor = await getActorContext();

  if (!actor.platformRole || actor.platformRole === "readonly") {
    throw new Error("FORBIDDEN");
  }

  return actor;
}