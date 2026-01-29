// src/lib/rbac/guards.ts
import { getActorContext } from "./actor";

export const PLATFORM_ROLES = [
  "platform_owner",
  "platform_admin",
  "platform_support",
  "platform_billing",
  "readonly",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ELEVATED_ROLES = [
  "platform_owner",
  "platform_admin",
  "platform_support",
  "platform_billing",
] as const;

export type PlatformElevatedRole = (typeof PLATFORM_ELEVATED_ROLES)[number];

export type ActorContext = {
  clerkUserId: string;
  appUserId: string;
  email: string | null;
  platformRole: PlatformRole | null; // null shouldn't really happen, but keep it safe
};

export function hasPlatformRole(actor: ActorContext, roles: PlatformElevatedRole[]) {
  const r = actor.platformRole ?? "readonly";
  // readonly is NOT elevated
  if (r === "readonly") return false;
  return roles.includes(r as PlatformElevatedRole);
}

export async function requireSignedIn(): Promise<ActorContext> {
  const actor = await getActorContext();
  // getActorContext throws UNAUTHENTICATED if not signed in
  return actor;
}

export async function requirePlatformRole(roles: PlatformElevatedRole[]): Promise<ActorContext> {
  const actor = await getActorContext();

  if (!hasPlatformRole(actor, roles)) {
    throw new Error("FORBIDDEN");
  }

  return actor;
}