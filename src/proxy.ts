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

export default clerkMiddleware((auth, req) => {
  // IMPORTANT:
  // In this Clerk/Next combo, `auth().protect()` does NOT return a Response.
  // It enforces auth (redirect/throw internally) — so we must not `return` it.
  if (isProtectedRoute(req)) {
    auth().protect();
  }

  // Always continue the request for public routes (and after protect passes).
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