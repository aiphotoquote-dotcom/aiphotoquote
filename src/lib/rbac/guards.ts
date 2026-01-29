// src/lib/rbac/guards.ts
import { getActorContext } from "./actor";

export type PlatformRole =
  | "platform_owner"
  | "platform_admin"
  | "platform_support"
  | "platform_billing"
  | "readonly";

/**
 * Returns true if actor has ANY of the required roles.
 * Note: "platform_owner" implicitly satisfies all platform roles.
 */
export function hasPlatformRole(
  actor: { platformRole: PlatformRole },
  roles: PlatformRole[]
) {
  const r = actor.platformRole;

  if (r === "platform_owner") return true;
  return roles.includes(r);
}

/**
 * Use inside Server Components / route handlers to enforce access.
 * Throws:
 * - UNAUTHENTICATED if user is not signed in
 * - FORBIDDEN if signed in but role not allowed
 */
export async function requirePlatformRole(roles: PlatformRole[]) {
  const actor = await getActorContext(); // may throw UNAUTHENTICATED

  if (!hasPlatformRole(actor, roles)) {
    throw new Error("FORBIDDEN");
  }

  return actor;
}