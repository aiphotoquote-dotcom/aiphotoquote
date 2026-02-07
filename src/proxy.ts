// src/proxy.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

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
  "/api/onboarding(.*)", // ✅ onboarding APIs call auth()/currentUser()
]);

export default clerkMiddleware(async (auth, req) => {
  // Clerk runs on ALL matched routes, but we ONLY enforce auth on protected routes.
  if (isProtectedRoute(req)) {
    // IMPORTANT:
    // In your Clerk version, `auth.protect()` exists on `auth` (NOT on `auth()`).
    // Also: do NOT return its value — always return a middleware Response.
    await auth.protect();
  }

  return NextResponse.next();
});

/**
 * CRITICAL:
 * - Do NOT match all `/api/*` routes here (keeps public ingestion endpoints public).
 * - DO match all NON-API page routes so Clerk is present anywhere `auth()` might run.
 * - Add specific protected API namespaces that require auth().
 */
export const config = {
  matcher: [
    // ✅ All NON-API pages (public + protected), excluding Next.js internals + common static assets.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:css|js|map|png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)",

    // ✅ Only protected API namespaces (do NOT include all /api)
    "/api/admin(.*)",
    "/api/pcc(.*)",
    "/api/tenant(.*)",
    "/api/onboarding(.*)",
  ],
};