import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appUsers } from "@/lib/db/schema";
import type { AuthIdentity } from "@/lib/auth";

/**
 * Ensure we have a stable internal user UUID for the authenticated identity.
 * This is the core of "mobility": your app logic uses app_users.id, not Clerk IDs.
 */
export async function ensureAppUser(identity: AuthIdentity): Promise<string> {
  const existing = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.authProvider, identity.provider), eq(appUsers.authSubject, identity.subject)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (existing?.id) return existing.id;

  const inserted = await db
    .insert(appUsers)
    .values({
      authProvider: identity.provider,
      authSubject: identity.subject,
      email: identity.email ?? null,
      name: identity.name ?? null,
    })
    .returning({ id: appUsers.id })
    .then((r) => r[0] ?? null);

  if (!inserted?.id) throw new Error("FAILED_TO_CREATE_APP_USER");
  return inserted.id;
}
