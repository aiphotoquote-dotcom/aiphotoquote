// src/proxy.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Only these routes should ever require a Clerk session.
 * Everything else (public quote flow + public APIs) must stay public.
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
 * IMPORTANT:
 * Keep matcher NARROW.
 * If we match all non-API pages, we can accidentally stall public pages / auth routes.
 * Only run middleware where Clerk is needed.
 */
export const config = {
  matcher: [
    // UI areas (protected)
    "/admin(.*)",
    "/dashboard(.*)",
    "/onboarding(.*)",
    "/pcc(.*)",

    // Clerk auth pages (public but should have Clerk middleware)
    "/sign-in(.*)",
    "/sign-up(.*)",

    // Protected API namespaces
    "/api/admin(.*)",
    "/api/pcc(.*)",
    "/api/tenant(.*)",
    "/api/onboarding(.*)",
  ],
};