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

  // ✅ Onboarding APIs call auth() and must have clerkMiddleware present
  "/api/onboarding(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // IMPORTANT:
  // We allow Clerk middleware to run on ALL page routes (public + protected),
  // but we ONLY enforce auth on protected routes.
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

/**
 * CRITICAL:
 * - Do NOT match all `/api/*` routes here (keeps public ingestion endpoints public).
 * - But DO match all NON-API page routes so Clerk is present anywhere `auth()` might run
 *   (layouts/headers/server components), preventing "auth() called but no clerkMiddleware" crashes.
 */
export const config = {
  matcher: [
    // ✅ All NON-API pages (public + protected), excluding Next.js internals and common static assets.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:css|js|map|png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)",

    // ✅ Only protected API namespaces (do NOT include all /api)
    "/api/admin(.*)",
    "/api/pcc(.*)",
    "/api/tenant(.*)",

    // ✅ Onboarding APIs need Clerk middleware present (even if not always "protected")
    "/api/onboarding(.*)",
  ],
};