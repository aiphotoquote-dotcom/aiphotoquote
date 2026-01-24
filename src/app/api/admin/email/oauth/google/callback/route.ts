// src/app/api/admin/email/oauth/google/callback/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { encryptToken } from "@/lib/crypto/emailTokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function verifyState(stateB64Url: string) {
  const secret = mustEnv("EMAIL_OAUTH_STATE_SECRET");
  const raw = Buffer.from(stateB64Url, "base64url").toString("utf8"); // "json.sig"
  const i = raw.lastIndexOf(".");
  if (i < 0) throw new Error("OAUTH_STATE_MALFORMED");

  const json = raw.slice(0, i);
  const sig = raw.slice(i + 1);

  const expected = crypto.createHmac("sha256", secret).update(json).digest("hex");
  if (sig !== expected) throw new Error("OAUTH_STATE_MISMATCH");

  return JSON.parse(json) as { t: string; ts: number; nonce: string };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";

  if (!code) return NextResponse.json({ ok: false, error: "MISSING_CODE" }, { status: 400 });
  if (!state) return NextResponse.json({ ok: false, error: "MISSING_STATE" }, { status: 400 });

  const { t: tenantId } = verifyState(state);

  const clientId = mustEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = mustEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const redirectUri = mustEnv("GOOGLE_OAUTH_REDIRECT_URI");

  // 1) Exchange code -> tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code,
    }),
  });

  const tokenJson: any = await tokenRes.json();
  if (!tokenRes.ok) {
    return NextResponse.json(
      { ok: false, error: "GOOGLE_TOKEN_EXCHANGE_FAILED", detail: tokenJson },
      { status: 500 }
    );
  }

  const accessToken = String(tokenJson.access_token || "");
  const refreshToken = String(tokenJson.refresh_token || ""); // can be empty sometimes
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "MISSING_ACCESS_TOKEN" }, { status: 500 });
  }

  // 2) Fetch user email (identity)
  const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meJson: any = await meRes.json();
  if (!meRes.ok) {
    return NextResponse.json(
      { ok: false, error: "GOOGLE_USERINFO_FAILED", detail: meJson },
      { status: 500 }
    );
  }

  const emailAddress = String(meJson.email || "").trim().toLowerCase();
  if (!emailAddress) {
    return NextResponse.json({ ok: false, error: "MISSING_GOOGLE_EMAIL" }, { status: 500 });
  }

  // 3) Persist identity
  // NOTE: if refresh token is missing, we can't send later.
  // We still store identity row, but mark missing token as error.
  const refreshTokenEnc = refreshToken ? encryptToken(refreshToken) : "";

  // Choose from_email. You said: "from is fine for mailbox".
  const fromEmail = `${emailAddress}`;

  // Upsert email_identities row (unique tenant+provider+email)
  const up = await db.execute(sql`
    insert into email_identities (tenant_id, provider, email_address, from_email, refresh_token_enc)
    values (${tenantId}::uuid, 'gmail_oauth', ${emailAddress}, ${fromEmail}, ${refreshTokenEnc})
    on conflict (tenant_id, provider, email_address)
    do update set
      from_email = excluded.from_email,
      refresh_token_enc = case
        when excluded.refresh_token_enc <> '' then excluded.refresh_token_enc
        else email_identities.refresh_token_enc
      end,
      updated_at = now()
    returning id
  `);

  const row: any = (up as any)?.rows?.[0] ?? null;
  const emailIdentityId = row?.id ? String(row.id) : null;
  if (!emailIdentityId) {
    return NextResponse.json({ ok: false, error: "EMAIL_IDENTITY_UPSERT_FAILED" }, { status: 500 });
  }

  // Link tenant_settings to identity + switch to enterprise mode
  await db.execute(sql`
    update tenant_settings
    set email_send_mode = 'enterprise',
        email_identity_id = ${emailIdentityId}::uuid,
        updated_at = now()
    where tenant_id = ${tenantId}::uuid
  `);

  // 4) Redirect back (ABSOLUTE)
  const dest = new URL(`/admin/settings?oauth=google_connected`, req.url);

  // If refresh token missing, hint the UI
  if (!refreshToken) dest.searchParams.set("warn", "missing_refresh_token");

  return NextResponse.redirect(dest);
}