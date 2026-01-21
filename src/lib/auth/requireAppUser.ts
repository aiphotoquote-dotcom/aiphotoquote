import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { appUsers } from "@/lib/db/schema";

/**
 * Canonical auth identity used internally by the app.
 * This is the portability layer between Clerk and your DB.
 */
export type AuthIdentity = {
  provider: "clerk";
  subject: string;
  email: string | null;
  name: string | null;
};

/**
 * Resolve the authenticated Clerk user into a portable AuthIdentity.
 * Throws if unauthenticated.
 */
export async function requireAuthIdentity(): Promise<AuthIdentity> {
  const a = await auth();
  if (!a.userId) {
    throw new Error("UNAUTHENTICATED");
  }

  try {
    const u = await currentUser();
    const email = u?.emailAddresses?.[0]?.emailAddress ?? null;

    const name =
      u?.firstName || u?.lastName
        ? [u?.firstName, u?.lastName].filter(Boolean).join(" ")
        : u?.username ?? null;

    return {
      provider: "clerk",
      subject: a.userId,
      email,
      name,
    };
  } catch {
    // Clerk user fetch failed, still return stable identity
    return {
      provider: "clerk",
      subject: a.userId,
      email: null,
      name: null,
    };
  }
}

/**
 * Ensure an app_users row exists for the authenticated user
 * and return the app_user.id.
 *
 * This is the CORE mobility primitive.
 */
export async function requireAppUserId(): Promise<string> {
  const identity = await requireAuthIdentity();

  const existing = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.authProvider, identity.provider),
        eq(appUsers.authSubject, identity.subject)
      )
    )
    .limit(1)
    .then((r) => r[0] ?? null);

  if (existing?.id) {
    return existing.id;
  }

  const inserted = await db
    .insert(appUsers)
    .values({
      authProvider: identity.provider,
      authSubject: identity.subject,
      email: identity.email,
      name: identity.name,
    })
    .returning({ id: appUsers.id })
    .then((r) => r[0] ?? null);

  if (!inserted?.id) {
    throw new Error("FAILED_TO_CREATE_APP_USER");
  }

  return inserted.id;
}