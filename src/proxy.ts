// src/proxy.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * IMPORTANT:
 * - Middleware should only protect PAGE routes.
 * - Do NOT protect /api/* here; API handlers should return JSON 401/403 themselves.
 *   (Avoid Clerk protect rewrites on APIs that look like 404/hangs to clients.)
 */
const isProtectedPage = createRouteMatcher([
  "/admin(.*)",
  "/dashboard(.*)",
  "/onboarding(.*)",
  "/pcc(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedPage(req)) {
    await auth.protect();
  }
  return NextResponse.next();
});

/**
 * Match ONLY protected page surfaces.
 * Do NOT match broad "all pages" patterns and do NOT match /api/*.
 */
export const config = {
  matcher: ["/admin(.*)", "/dashboard(.*)", "/onboarding(.*)", "/pcc(.*)"],
};