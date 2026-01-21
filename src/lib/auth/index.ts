import { auth, currentUser } from "@clerk/nextjs/server";

export type AuthIdentity = {
  provider: "clerk";
  subject: string; // Clerk userId
  email?: string | null;
  name?: string | null;
};

export async function requireAuthIdentity(): Promise<AuthIdentity> {
  const a = await auth();
  if (!a.userId) throw new Error("UNAUTHENTICATED");

  // Best-effort enrichment (never fail auth if currentUser is unavailable)
  try {
    const u = await currentUser();
    const email = u?.emailAddresses?.[0]?.emailAddress ?? null;
    const name =
      u?.firstName || u?.lastName
        ? [u?.firstName, u?.lastName].filter(Boolean).join(" ")
        : (u?.username ?? null);

    return { provider: "clerk", subject: a.userId, email, name };
  } catch {
    return { provider: "clerk", subject: a.userId, email: null, name: null };
  }
}

export async function getAuthIdentity(): Promise<AuthIdentity | null> {
  try {
    return await requireAuthIdentity();
  } catch {
    return null;
  }
}
