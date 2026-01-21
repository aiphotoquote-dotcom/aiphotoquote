// src/lib/http/cookies.ts
import { cookies } from "next/headers";

export async function getCookieJar() {
  // Next.js can type this as Promise<ReadonlyRequestCookies> in some builds
  // and as ReadonlyRequestCookies in others. This makes it consistent.
  const jar: any = cookies();
  return typeof jar?.then === "function" ? await jar : jar;
}
