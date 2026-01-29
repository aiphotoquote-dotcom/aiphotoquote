// src/lib/rbac/types.ts
export type PlatformRole =
  | "platform_owner"
  | "platform_admin"
  | "platform_support"
  | "platform_billing";

export type ActorContext = {
  clerkUserId: string;
  email: string | null;
  platformRole: PlatformRole | null;
};