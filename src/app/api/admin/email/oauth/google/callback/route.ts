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

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return { ok: res.ok, json: JSON.parse(text) };
  } catch {
    return { ok: res.ok, json: { raw: text } };
  }
}

function dbErr(e: any) {
  return {
    message: e?.message ?? String(e),
    code: e?.code ?? null,
    detail: e?.detail ?? null,
    constraint: e?.constraint ?? null,
    table: e?.table ?? null,
    column: e?.column ?? null,
    schema: e?.schema ?? null,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  try {
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const debug = url.searchParams.get("debug") === "1";

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

    const tj = await safeJson(tokenRes);
    if (!tj.ok) {
      return NextResponse.json(
        { ok: false, error: "GOOGLE_TOKEN_EXCHANGE_FAILED", detail: tj.json },
        { status: 500 }
      );
    }

    const accessToken = String((tj.json as any).access_token || "");
    const refreshToken = String((tj.json as any).refresh_token || "");
    if (!accessToken) {
      return NextResponse.json({ ok: false, error: "MISSING_ACCESS_TOKEN" }, { status: 500 });
    }

    // 2) Fetch user email
    const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const mj = await safeJson(meRes);
    if (!mj.ok) {
      return NextResponse.json(
        { ok: false, error: "GOOGLE_USERINFO_FAILED", detail: mj.json },
        { status: 500 }
      );
    }

    const email = String((mj.json as any).email || "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ ok: false, error: "MISSING_GOOGLE_EMAIL" }, { status: 500 });
    }

    const refreshTokenEnc = refreshToken ? encryptToken(refreshToken) : "";
    const fromEmail = email;

    // 3) Upsert identity
    let emailIdentityId: string | null = null;
    try {
      const up = await db.execute(sql`
        insert into tenant_email_identities (tenant_id, provider, email, from_email, refresh_token_enc)
        values (${tenantId}::uuid, 'gmail_oauth', ${email}, ${fromEmail}, ${refreshTokenEnc})
        on conflict (tenant_id, provider, email)
        do update set
          from_email = excluded.from_email,
          refresh_token_enc = case
            when excluded.refresh_token_enc <> '' then excluded.refresh_token_enc
            else tenant_email_identities.refresh_token_enc
          end,
          updated_at = now()
        returning id
      `);

      const row: any =
        (up as any)?.rows?.[0] ?? (Array.isArray(up) ? (up as any)[0] : null);

      emailIdentityId = row?.id ? String(row.id) : null;
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: "EMAIL_IDENTITY_UPSERT_FAILED",
          tenantId,
          email,
          dbError: dbErr(e),
        },
        { status: 500 }
      );
    }

    if (!emailIdentityId) {
      return NextResponse.json({ ok: false, error: "EMAIL_IDENTITY_ID_MISSING" }, { status: 500 });
    }

    // 4) Upsert tenant_settings (flip enterprise)
    try {
      await db.execute(sql`
        insert into tenant_settings (tenant_id, industry_key, email_send_mode, email_identity_id)
        values (${tenantId}::uuid, 'auto', 'enterprise', ${emailIdentityId}::uuid)
        on conflict (tenant_id)
        do update set
          email_send_mode = 'enterprise',
          email_identity_id = excluded.email_identity_id,
          updated_at = now()
      `);
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: "TENANT_SETTINGS_UPSERT_FAILED",
          tenantId,
          emailIdentityId,
          dbError: dbErr(e),
        },
        { status: 500 }
      );
    }

    if (debug) {
      const check = await db.execute(sql`
        select tenant_id, email_send_mode, email_identity_id
        from tenant_settings
        where tenant_id = ${tenantId}::uuid
        limit 1
      `);
      const checkRow: any =
        (check as any)?.rows?.[0] ?? (Array.isArray(check) ? (check as any)[0] : null);

      return NextResponse.json({
        ok: true,
        tenantId,
        email,
        refreshTokenReturned: !!refreshToken,
        emailIdentityId,
        tenantSettings: checkRow ?? null,
      });
    }

    // 5) Redirect back ABSOLUTE
    const dest = new URL("/admin/settings", url.origin);
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