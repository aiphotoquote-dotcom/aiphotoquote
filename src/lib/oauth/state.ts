// src/lib/oauth/state.ts
import crypto from "crypto";

function base64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function hmac(secret: string, data: string) {
  return base64url(crypto.createHmac("sha256", secret).update(data).digest());
}

function getSecret() {
  const s = process.env.EMAIL_OAUTH_STATE_SECRET?.trim() || "";
  if (s.length < 32) throw new Error("Missing/weak EMAIL_OAUTH_STATE_SECRET (need 32+ chars).");
  return s;
}

export type OAuthStatePayload = {
  t: string;      // tenantId
  ts: number;     // issued at (ms)
  nonce: string;  // random UUID
};

export function signOAuthState(payload: OAuthStatePayload): string {
  const secret = getSecret();
  const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = hmac(secret, body);
  return `${body}.${sig}`;
}

export function verifyOAuthState(state: string, maxAgeMs = 10 * 60 * 1000): OAuthStatePayload {
  const secret = getSecret();

  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("BAD_STATE_FORMAT");

  const expected = hmac(secret, body);
  // constant time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("BAD_STATE_SIGNATURE");

  const json = Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const payload = JSON.parse(json) as OAuthStatePayload;

  if (!payload?.t || !payload?.ts || !payload?.nonce) throw new Error("BAD_STATE_PAYLOAD");
  if (Date.now() - payload.ts > maxAgeMs) throw new Error("STATE_EXPIRED");

  return payload;
}