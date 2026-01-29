// src/lib/rbac/guards.ts
import { getActorContext, type ActorContext } from "./actor";

export type PlatformRole =
  | "platform_owner"
  | "platform_admin"
  | "platform_support"
  | "platform_billing"
  | "readonly";

export function hasPlatformRole(actor: ActorContext, roles: PlatformRole[]) {
  // Always safe (readonly is a valid role)
  return roles.includes(actor.platformRole);
}

export async function requirePlatformRole(roles: PlatformRole[]) {
  const actor = await getActorContext();
  if (!hasPlatformRole(actor, roles)) throw new Error("FORBIDDEN");
  return actor;
}

// Common presets (optional helpers)
export const PCC_ADMIN_ROLES: PlatformRole[] = ["platform_owner", "platform_admin"];
export const PCC_SUPPORT_ROLES: PlatformRole[] = ["platform_owner", "platform_admin", "platform_support"];
export const PCC_BILLING_ROLES: PlatformRole[] = ["platform_owner", "platform_admin", "platform_billing"];