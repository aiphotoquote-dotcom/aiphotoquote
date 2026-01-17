import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Public (no auth) routes:
 * - /q/* : embedded quote intake
 * - /api/quote/* : submit + render pipeline
 * - /api/blob/* : blob token + uploads
 */
const isPublicRoute = createRouteMatcher([
  "/q(.*)",
  "/api/quote(.*)",
  "/api/blob(.*)",
]);

/**
 * Protected routes (auth required)
 */
const isProtectedRoute = createRouteMatcher([
  "/admin(.*)",
  "/dashboard(.*)",
  "/onboarding(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;
  if (isProtectedRoute(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};