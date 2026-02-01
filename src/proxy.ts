// src/proxy.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Explicitly define which routes REQUIRE auth
 */
const isProtectedRoute = createRouteMatcher([
  "/admin(.*)",
  "/dashboard(.*)",
  "/onboarding(.*)",
  "/pcc(.*)",
  "/api/admin(.*)",
  "/api/pcc(.*)",
  "/api/tenant(.*)",
]);

/**
 * Explicitly define PUBLIC routes
 * (critical for AIaaS + customer quote flow)
 */
const publicRoutes = [
  "/",
  "/q(.*)",

  // Quote flow APIs
  "/api/quote/submit",
  "/api/quote/render",
  "/api/render/start",

  // Cron is protected by CRON_SECRET, NOT Clerk
  "/api/cron/render",
];

export default clerkMiddleware(
  async (auth, req) => {
    if (isProtectedRoute(req)) {
      await auth.protect();
    }
  },
  {
    publicRoutes,
  }
);

export const config = {
  matcher: [
    // Only run middleware where Clerk is relevant
    "/admin(.*)",
    "/dashboard(.*)",
    "/onboarding(.*)",
    "/pcc(.*)",
    "/api/(.*)",
  ],
};