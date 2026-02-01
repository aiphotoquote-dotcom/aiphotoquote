// src/proxy.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Protect ONLY routes that must require an authenticated Clerk session.
 * Public quote flow APIs (submit, render/start, blob upload, etc.) MUST remain public.
 *
 * This fixes: public client calling /api/render/start receiving 401 HTML instead of JSON.
 */
const isProtectedRoute = createRouteMatcher([
  // UI
  "/admin(.*)",
  "/dashboard(.*)",
  "/onboarding(.*)",
  "/pcc(.*)",

  // Private APIs (admin / internal tools)
  "/api/admin(.*)",
  "/api/pcc(.*)",
  "/api/tenant(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // ✅ ONLY run middleware on protected routes.
    // (Running it on all /api was causing 401 HTML responses for public endpoints.)
    "/admin(.*)",
    "/dashboard(.*)",
    "/onboarding(.*)",
    "/pcc(.*)",
    "/api/admin(.*)",
    "/api/pcc(.*)",
    "/api/tenant(.*)",
  ],
};