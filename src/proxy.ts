// src/proxy.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Only these routes should ever require a Clerk session.
 * Everything else (public quote flow + public APIs) must stay public for AIaaS.
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
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

/**
 * CRITICAL:
 * Do NOT match all `/api/*` routes here.
 * If you do, Clerk will execute on public ingestion endpoints and can return 401 HTML.
 */
export const config = {
  matcher: [
    "/admin(.*)",
    "/dashboard(.*)",
    "/onboarding(.*)",
    "/pcc(.*)",

    // Only protected API namespaces
    "/api/admin(.*)",
    "/api/pcc(.*)",
    "/api/tenant(.*)",
  ],
};
