// src/proxy.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Only these routes should ever require a Clerk session.
 * Everything else must stay public.
 */
const isProtectedRoute = createRouteMatcher([
  "/admin(.*)",
  "/dashboard(.*)",
  "/onboarding(.*)",
  "/pcc(.*)",

  // Protected API namespaces only (do NOT include all /api)
  "/api/admin(.*)",
  "/api/pcc(.*)",
  "/api/tenant(.*)",
  "/api/onboarding(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
  return NextResponse.next();
});

/**
 * CRITICAL:
 * Keep matcher STRICTLY to protected surfaces only.
 * Do NOT include /sign-in or broad "all pages" matchers, or you can stall auth pages.
 */
export const config = {
  matcher: [
    "/admin(.*)",
    "/dashboard(.*)",
    "/onboarding(.*)",
    "/pcc(.*)",

    "/api/admin(.*)",
    "/api/pcc(.*)",
    "/api/tenant(.*)",
    "/api/onboarding(.*)",
  ],
};