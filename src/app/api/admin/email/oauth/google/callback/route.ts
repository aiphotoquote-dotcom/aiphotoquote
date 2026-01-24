// src/app/api/admin/email/oauth/google/callback/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function timingSafeEq(a: string, b: string) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifyState(stateB64Url: string): { tenantId: string; ts: number; nonce: string } {
  const secret = mustEnv("EMAIL_OAUTH_STATE_SECRET");

  let decoded: string;
  try {
    decoded = Buffer.from(stateB64Url, "base64url").toString("utf8");
  } catch {
    throw new Error("BAD_STATE_ENCODING");
  }

  // decoded is `${json}.${sigHex}` (sig is hex)
  const lastDot = decoded.lastIndexOf(".");
  if (lastDot < 0) throw new Error("BAD_STATE_FORMAT");

  const json = decoded.slice(0, lastDot);
  const sigHex = decoded.slice(lastDot + 1);

  const expected = crypto.createHmac("sha256", secret).update(json).digest("hex");
  if (!timingSafeEq(sigHex, expected)) throw new Error("BAD_STATE_SIGNATURE");

  let payload: any;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error("BAD_STATE_JSON");
  }

  const tenantId = String(payload?.t || "");
  const ts = Number(payload?.ts || 0);
  const nonce = String(payload?.nonce || "");

  if (!tenantId || !ts || !nonce) throw new Error("BAD_STATE_PAYLOAD");

  // 10 minute max age
  const maxAgeMs = 10 * 60 * 1000;
  if (Date.now() - ts > maxAgeMs) throw new Error("STATE_EXPIRED");

  return { tenantId, ts, nonce };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  if (err) {
    return NextResponse.json({ ok: false, error: "GOOGLE_OAUTH_ERROR", detail: err }, { status: 400 });
  }

  if (!code || !state) {
    return NextResponse.json({ ok: false, error: "MISSING_CODE_OR_STATE" }, { status: 400 });
  }

  let tenantId: string;
  try {
    ({ tenantId } = verifyState(state));
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "OAUTH_STATE_MISMATCH", detail: e?.message ?? String(e) },
      { status: 400 }
    );
  }

  // ✅ From here: exchange code -> tokens, encrypt refresh token, upsert email_identities, update tenant_settings.email_identity_id
  // I’m not rewriting your whole token/db section since you already have it — just keep using `tenantId` from state.

  return NextResponse.redirect(new URL("/admin/settings?oauth=google_connected", req.url));
}