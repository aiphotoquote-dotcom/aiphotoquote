import { NextResponse } from "next/server";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";
import { encryptToken } from "@/lib/crypto/emailTokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function verifyState(stateB64: string): { tenantId: string } {
  const secret = mustEnv("EMAIL_OAUTH_STATE_SECRET");
  const decoded = Buffer.from(stateB64, "base64url").toString("utf8");
  const dot = decoded.lastIndexOf(".");
  if (dot < 0) throw new Error("Bad state");

  const json = decoded.slice(0, dot);
  const sig = decoded.slice(dot + 1);

  const expected = crypto.createHmac("sha256", secret).update(json).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("State signature mismatch");
  }

  const payload = JSON.parse(json);
  if (!payload?.t) throw new Error("State missing tenant");
  return { tenantId: String(payload.t) };
}

async function exchangeCodeForTokens(code: string) {
  const body = new URLSearchParams();
  body.set("client_id", mustEnv("GOOGLE_OAUTH_CLIENT_ID"));
  body.set("client_secret", mustEnv("GOOGLE_OAUTH_CLIENT_SECRET"));
  body.set("redirect_uri", mustEnv("GOOGLE_OAUTH_REDIRECT_URI"));
  body.set("grant_type", "authorization_code");
  body.set("code", code);

  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const tj = await tr.json();
  if (!tr.ok) {
    const msg = tj?.error_description || tj?.error || "Google token exchange failed";
    throw new Error(msg);
  }

  return {
    accessToken: String(tj.access_token || ""),
    refreshToken: tj.refresh_token ? String(tj.refresh_token) : "",
  };
}

async function fetchEmailAddress(accessToken: string): Promise<string> {
  const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = await r.json();
  const email = (j?.email || "").toString().trim();
  if (!r.ok || !email) throw new Error(j?.error_description || "Failed to fetch user email");
  return email;
}

export async function GET(req: Request) {
  // Ensure user is still authenticated
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "").trim();
  const state = (url.searchParams.get("state") || "").trim();

  if (!code || !state) {
    return NextResponse.json({ ok: false, error: "BAD_REQUEST", message: "Missing code/state" }, { status: 400 });
  }

  // Verify signed state and ensure it matches active tenant
  const { tenantId } = verifyState(state);
  if (tenantId !== gate.tenantId) {
    return NextResponse.json({ ok: false, error: "TENANT_MISMATCH" }, { status: 403 });
  }

  try {
    const { accessToken, refreshToken } = await exchangeCodeForTokens(code);

    // If refresh token not returned, user previously consented; we forced prompt=consent but still possible.
    if (!refreshToken) {
      return NextResponse.json(
        {
          ok: false,
          error: "NO_REFRESH_TOKEN",
          message:
            "Google did not return a refresh_token. Remove the app from Google Account > Security > Third-party access, then reconnect.",
        },
        { status: 400 }
      );
    }

    const emailAddress = await fetchEmailAddress(accessToken);
    const refreshTokenEnc = encryptToken(refreshToken);

    const fromEmail = `AI Photo Quote <${emailAddress}>`; // you said mailbox From is fine

    // upsert email_identities for tenant/provider/email
    const upserted = await db.execute(sql`
      insert into email_identities (tenant_id, provider, email_address, from_email, refresh_token_enc, created_at, updated_at)
      values (${tenantId}::uuid, 'gmail_oauth', ${emailAddress}, ${fromEmail}, ${refreshTokenEnc}, now(), now())
      on conflict (tenant_id, provider, email_address)
      do update set
        from_email = excluded.from_email,
        refresh_token_enc = excluded.refresh_token_enc,
        updated_at = now()
      returning id
    `);

    const row: any = (upserted as any)?.rows?.[0] ?? null;
    const emailIdentityId = row?.id ? String(row.id) : null;
    if (!emailIdentityId) throw new Error("Failed to save email identity");

    // set tenant_settings to enterprise + pointer
    await db.execute(sql`
      update tenant_settings
      set email_send_mode = 'enterprise',
          email_identity_id = ${emailIdentityId}::uuid
      where tenant_id = ${tenantId}::uuid
    `);

    // send user back to settings page
    return NextResponse.redirect(new URL("/admin/settings?connected=gmail", req.url));
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "OAUTH_CONNECT_FAILED", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
