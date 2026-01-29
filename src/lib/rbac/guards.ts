// src/lib/rbac/guards.ts
import type { ActorContext, PlatformRole } from "./types";
import { getActorContext } from "./actor";

export function hasPlatformRole(actor: ActorContext, roles: PlatformRole[]) {
  if (!actor.platformRole) return false;
  return roles.includes(actor.platformRole);
}

export async function requirePlatformRole(roles: PlatformRole[]) {
  const actor = await getActorContext();
  if (!hasPlatformRole(actor, roles)) {
    // Keep message stable for debugging
    throw new Error("FORBIDDEN");
  }
  return actor;
}