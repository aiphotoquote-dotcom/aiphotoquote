// src/proxy.ts
import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Only these routes require a Clerk session.
 * Public quote flow + public APIs must remain public.
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

export default clerkMiddleware(async (auth, req: NextRequest) => {
  // ✅ Protect only protected routes
  if (isProtectedRoute(req)) {
    // Clerk handles redirects/rewrites internally.
    // We still must allow the middleware to complete normally.
    await auth.protect();
  }

  // ✅ CRITICAL: Always return a response so Next never “hangs”
  return NextResponse.next();
});

/**
 * IMPORTANT:
 * - Do NOT match all `/api/*` routes (keeps public ingestion endpoints public).
 * - DO match all NON-API page routes so Clerk is present where `auth()` might run.
 * - Add specific protected API namespaces that require auth().
 */
export const config = {
  matcher: [
    // All NON-API pages (public + protected), excluding Next internals + common static assets
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:css|js|map|png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)",

    // Only protected API namespaces (do NOT include all /api)
    "/api/admin(.*)",
    "/api/pcc(.*)",
    "/api/tenant(.*)",
    "/api/onboarding(.*)",
  ],
};