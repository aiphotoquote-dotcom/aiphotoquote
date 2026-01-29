// src/lib/rbac/actor.ts
import { auth, clerkClient } from "@clerk/nextjs/server";
import type { ActorContext, PlatformRole } from "./types";

function parseCsv(v: string | undefined | null) {
  return String(v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function coercePlatformRole(v: unknown): PlatformRole | null {
  const s = String(v ?? "").trim();
  if (
    s === "platform_owner" ||
    s === "platform_admin" ||
    s === "platform_support" ||
    s === "platform_billing"
  ) {
    return s;
  }
  return null;
}

export async function getActorContext(): Promise<ActorContext> {
  // Clerk Next.js 16: auth() may be async in your setup
  const a = await auth();
  const clerkUserId = (a as any)?.userId as string | undefined;
  if (!clerkUserId) throw new Error("UNAUTHENTICATED");

  // 1) Try to read role from session claims (fast path)
  const claims = (a as any)?.sessionClaims as any;
  let platformRole: PlatformRole | null =
    coercePlatformRole(claims?.publicMetadata?.platformRole) ??
    coercePlatformRole(claims?.metadata?.platformRole) ??
    null;

  // 2) Pull email + publicMetadata from Clerk user (reliable path)
  let email: string | null = null;
  try {
    const client = await clerkClient();
    const u = await client.users.getUser(clerkUserId);

    email =
      u.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses?.[0]?.emailAddress ??
      null;

    // Role in publicMetadata is common
    platformRole = platformRole ?? coercePlatformRole((u.publicMetadata as any)?.platformRole);
  } catch {
    // If Clerk lookup fails, we still return with userId (but role likely null)
  }

  // 3) Bootstrap (safe allowlist) — ONLY for PCC bring-up
  // Comma separated list of allowed owner emails.
  // Example: PCC_BOOTSTRAP_EMAILS="joemaggio@gmail.com,joe@aiphotoquote.com"
  const allow = parseCsv(process.env.PCC_BOOTSTRAP_EMAILS);
  if (!platformRole && email && allow.includes(email.toLowerCase())) {
    platformRole = "platform_owner";
  }

  return { clerkUserId, email, platformRole };
}