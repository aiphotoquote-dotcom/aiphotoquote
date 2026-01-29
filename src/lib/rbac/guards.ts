// src/lib/rbac/guards.ts
import type { ActorContext } from "./actor";

// Platform-wide roles (PCC)
export type PlatformRole =
  | "readonly"
  | "platform_owner"
  | "platform_admin"
  | "platform_support"
  | "platform_billing";

// Higher number = more privilege
const PLATFORM_ROLE_RANK: Record<PlatformRole, number> = {
  readonly: 0,
  platform_support: 10,
  platform_billing: 20,
  platform_admin: 30,
  platform_owner: 40,
};

export function hasPlatformRole(actor: ActorContext, roles: PlatformRole[]) {
  const r = actor.platformRole ?? "readonly";
  return roles.includes(r);
}

/**
 * Hierarchical check: allow any actor whose role rank >= any required role rank.
 * Example: requireMinPlatformRole("platform_admin") allows admin + owner.
 */
export function hasMinPlatformRole(actor: ActorContext, minRole: PlatformRole) {
  const r = actor.platformRole ?? "readonly";
  return (PLATFORM_ROLE_RANK[r] ?? 0) >= (PLATFORM_ROLE_RANK[minRole] ?? 0);
}

/**
 * Guard: throws FORBIDDEN if actor doesn't match one of the allowed roles.
 * Use this when a page/route is strict about specific roles.
 */
export function assertPlatformRole(actor: ActorContext, roles: PlatformRole[]) {
  if (!hasPlatformRole(actor, roles)) {
    throw new Error("FORBIDDEN");
  }
}

/**
 * Guard: throws FORBIDDEN if actor is below a minimum platform role.
 * Use this when you want hierarchy behavior.
 */
export function assertMinPlatformRole(actor: ActorContext, minRole: PlatformRole) {
  if (!hasMinPlatformRole(actor, minRole)) {
    throw new Error("FORBIDDEN");
  }
}