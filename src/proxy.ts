import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes that should NOT require auth
const isPublicRoute = createRouteMatcher([
  "/", // marketing/home
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/q(.*)", // public quote flow
]);

// Everything else (including /api/*) is protected
export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;
  await auth.protect();
});

export const config = {
  matcher: [
    // all routes except static/next internals
    "/((?!_next|.*\\..*).*)",
    // explicitly include api
    "/api/(.*)",
  ],
};