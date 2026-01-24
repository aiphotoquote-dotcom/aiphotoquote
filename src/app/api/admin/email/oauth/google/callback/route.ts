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

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const debug = url.searchParams.get("debug") === "1";

    if (!code) return json({ ok: false, error: "MISSING_CODE" }, 400);
    if (!state) return json({ ok: false, error: "MISSING_STATE" }, 400);

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
      return json({ ok: false, error: "GOOGLE_TOKEN_EXCHANGE_FAILED", detail: tokenJson }, 500);
    }

    const accessToken = String(tokenJson.access_token || "");
    const refreshToken = String(tokenJson.refresh_token || "");
    const scopeStr = String(tokenJson.scope || "");

    if (!accessToken) return json({ ok: false, error: "MISSING_ACCESS_TOKEN" }, 500);

    // 2) Fetch user email
    const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const meJson: any = await meRes.json();
    if (!meRes.ok) {
      return json({ ok: false, error: "GOOGLE_USERINFO_FAILED", detail: meJson }, 500);
    }

    const email = String(meJson.email || "").trim().toLowerCase();
    if (!email) return json({ ok: false, error: "MISSING_GOOGLE_EMAIL" }, 500);

    // 3) Persist identity
    const refreshTokenEnc = refreshToken ? encryptToken(refreshToken) : "";
    const provider = "gmail_oauth";
    const displayName = email; // keep it simple for now
    const status = refreshToken ? "active" : "needs_reconnect";
    const scopes = scopeStr
      ? scopeStr.split(" ").filter(Boolean)
      : ["openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/gmail.send"];

    // This is what the Gmail provider will use as "From"
    const fromEmail = email;

    const up = await db.execute(sql`
      insert into tenant_email_identities
        (tenant_id, provider, email, display_name, status, scopes, last_error, from_email, refresh_token_enc)
      values
        (${tenantId}::uuid, ${provider}, ${email}, ${displayName}, ${status},
         ${JSON.stringify(scopes)}::jsonb, null, ${fromEmail}, ${refreshTokenEnc})
      on conflict (tenant_id, provider, email)
      do update set
        display_name = excluded.display_name,
        status = excluded.status,
        scopes = excluded.scopes,
        last_error = null,
        from_email = excluded.from_email,
        refresh_token_enc = case
          when excluded.refresh_token_enc <> '' then excluded.refresh_token_enc
          else tenant_email_identities.refresh_token_enc
        end,
        updated_at = now()
      returning id
    `);

    const row: any = (up as any)?.rows?.[0] ?? (Array.isArray(up) ? (up as any)[0] : null);
    const emailIdentityId = row?.id ? String(row.id) : null;
    if (!emailIdentityId) return json({ ok: false, error: "EMAIL_IDENTITY_UPSERT_FAILED" }, 500);

    // 4) Upsert tenant_settings and flip to enterprise
    await db.execute(sql`
      insert into tenant_settings (tenant_id, industry_key, email_send_mode, email_identity_id, updated_at)
      values (${tenantId}::uuid, 'auto', 'enterprise', ${emailIdentityId}::uuid, now())
      on conflict (tenant_id)
      do update set
        email_send_mode = 'enterprise',
        email_identity_id = excluded.email_identity_id,
        updated_at = now()
    `);

    if (debug) {
      const check = await db.execute(sql`
        select tenant_id, email_send_mode, email_identity_id
        from tenant_settings
        where tenant_id = ${tenantId}::uuid
        limit 1
      `);
      const checkRow: any =
        (check as any)?.rows?.[0] ?? (Array.isArray(check) ? (check as any)[0] : null);

      return json({
        ok: true,
        tenantId,
        email,
        refreshTokenReturned: !!refreshToken,
        emailIdentityId,
        tenantSettings: checkRow ?? null,
      });
    }

    // 5) Redirect back (ABSOLUTE)
    const dest = new URL(req.url);
    dest.pathname = "/admin/settings";
    dest.search = "";
    dest.searchParams.set("oauth", "google_connected");
    if (!refreshToken) dest.searchParams.set("warn", "missing_refresh_token");

    return NextResponse.redirect(dest);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "OAUTH_CALLBACK_FAILED", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}