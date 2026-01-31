// src/app/api/admin/email/oauth/google/start/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { requireTenantRole } from "@/lib/auth/tenant";
import { randomState, randomVerifier, challengeS256 } from "@/lib/oauth/pkce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cookieOpts(maxAgeSeconds: number) {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd, // ✅ don't force true; localhost often uses http
    maxAge: maxAgeSeconds,
    path: "/",
  };
}

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error, message: gate.message },
      { status: gate.status, headers: { "cache-control": "no-store, max-age=0" } }
    );
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || "";
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || "";
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { ok: false, error: "MISSING_GOOGLE_OAUTH_ENV", message: "Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_REDIRECT_URI" },
      { status: 500, headers: { "cache-control": "no-store, max-age=0" } }
    );
  }

  const state = randomState();
  const verifier = randomVerifier();
  const challenge = challengeS256(verifier);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ["openid", "email", "https://www.googleapis.com/auth/gmail.send"].join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  // Store state + verifier + tenant binding for 10 minutes
  const jar = await cookies();
  jar.set("g_oauth_state", state, cookieOpts(600));
  jar.set("g_oauth_verifier", verifier, cookieOpts(600));

  // ✅ Bind flow to tenant to prevent cross-tenant callback confusion
  jar.set("g_oauth_tenant", gate.tenantId, cookieOpts(600));

  return NextResponse.redirect(url.toString(), {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}