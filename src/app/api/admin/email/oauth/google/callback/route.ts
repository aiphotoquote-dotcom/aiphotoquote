import crypto from "crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";

import { requireTenantRole } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { encryptToken } from "@/lib/crypto/emailTokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function exchangeCode(args: {
  code: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}) {
  const body = new URLSearchParams();
  body.set("code", args.code);
  body.set("client_id", args.clientId);
  body.set("client_secret", args.clientSecret);
  body.set("redirect_uri", args.redirectUri);
  body.set("grant_type", "authorization_code");
  body.set("code_verifier", args.verifier);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const j = await r.json();
  if (!r.ok) throw new Error(j?.error_description || j?.error || "Google token exchange failed");
  return j as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
}

async function getGoogleEmail(accessToken: string) {
  const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Failed to fetch Google userinfo");
  return (j?.email as string) || "";
}

export async function GET(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const u = new URL(req.url);
  const code = u.searchParams.get("code") || "";
  const state = u.searchParams.get("state") || "";

  const jar = await cookies();
  const cookieState = jar.get("g_oauth_state")?.value || "";
  const verifier = jar.get("g_oauth_verifier")?.value || "";

  // clear pkce cookies no matter what
  jar.set("g_oauth_state", "", { maxAge: 0, path: "/" });
  jar.set("g_oauth_verifier", "", { maxAge: 0, path: "/" });

  if (!code || !state || !verifier || !cookieState || state !== cookieState) {
    return NextResponse.json({ ok: false, error: "OAUTH_STATE_MISMATCH" }, { status: 400 });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || "";
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || "";
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ ok: false, error: "MISSING_GOOGLE_OAUTH_ENV" }, { status: 500 });
  }

  try {
    const tok = await exchangeCode({ code, verifier, redirectUri, clientId, clientSecret });

    // IMPORTANT: we need refresh_token to send later without user present
    const refresh = tok.refresh_token;
    if (!refresh) {
      return NextResponse.json(
        {
          ok: false,
          error: "NO_REFRESH_TOKEN",
          message:
            "Google did not return a refresh token. Make sure prompt=consent and access_type=offline, then try connecting again.",
        },
        { status: 400 }
      );
    }

    const email = await getGoogleEmail(tok.access_token);
    if (!email) {
      return NextResponse.json({ ok: false, error: "NO_GOOGLE_EMAIL" }, { status: 400 });
    }

    const identityId = crypto.randomUUID();

    // store identity
    await db.execute(sql`
      insert into email_identities
        (id, tenant_id, provider, email, refresh_token_enc, scope, created_at, updated_at)
      values
        (${identityId}::uuid, ${gate.tenantId}::uuid, 'gmail_oauth', ${email}, ${encryptToken(refresh)}, ${tok.scope || ""}, now(), now())
    `);

    // point tenant to enterprise + identity
    await db.execute(sql`
      update tenant_settings
      set
        email_send_mode = 'enterprise',
        email_identity_id = ${identityId}::uuid,
        updated_at = now()
      where tenant_id = ${gate.tenantId}::uuid
    `);

    return NextResponse.redirect("/admin/settings?oauth=google_success");
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "OAUTH_CALLBACK_FAILED", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}