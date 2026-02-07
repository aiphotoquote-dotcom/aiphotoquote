// src/proxy.ts
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Recovery mode:
 * - Run Clerk middleware so `auth()` works in server components/routes.
 * - DO NOT call `protect()` here (it is rewriting to /404 with dev-browser-missing).
 *
 * Page/API handlers already enforce auth/roles.
 */
export default clerkMiddleware(() => {
  return NextResponse.next();
});

/**
 * IMPORTANT:
 * Match all NON-static routes so Clerk context is available anywhere `auth()` is used.
 * Do NOT include _next/static, _next/image, etc.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:css|js|map|png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)",
  ],
};