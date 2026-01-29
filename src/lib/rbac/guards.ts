// src/lib/rbac/guards.ts
import { getActorContext, type ActorContext } from "@/lib/rbac/actor";
import type { PlatformRole } from "@/lib/db/pccSchema";

export function hasPlatformRole(actor: ActorContext, roles: PlatformRole[]) {
  if (!actor.platformRole) return false;
  return roles.includes(actor.platformRole);
}

export async function requirePlatformRole(roles: PlatformRole[]) {
  const actor = await getActorContext();
  if (!actor.platformRole) throw new Error("FORBIDDEN_PLATFORM_REQUIRED");
  if (!roles.includes(actor.platformRole)) throw new Error("FORBIDDEN_PLATFORM_ROLE");
  return actor;
}