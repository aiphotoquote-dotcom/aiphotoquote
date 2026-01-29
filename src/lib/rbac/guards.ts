// src/lib/rbac/guards.ts
import { getActorContext } from "./actor";

// Keep the source-of-truth union here so includes() typing stays clean.
export const PLATFORM_ROLES = [
  "platform_owner",
  "platform_admin",
  "platform_support",
  "platform_billing",
  "readonly",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export type ActorContext = {
  clerkUserId: string;
  appUserId: string;
  email: string | null;

  // platform role is optional until bootstrap assigns one
  platformRole: PlatformRole | null;
};

export function hasPlatformRole(actor: ActorContext, roles: readonly PlatformRole[]) {
  if (!actor.platformRole) return false;
  return roles.includes(actor.platformRole);
}

export async function requirePlatformRole(roles: readonly PlatformRole[]) {
  const actor = (await getActorContext()) as ActorContext;
  if (!hasPlatformRole(actor, roles)) throw new Error("FORBIDDEN");
  return actor;
}