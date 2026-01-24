import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function signState(payload: any) {
  const secret = mustEnv("EMAIL_OAUTH_STATE_SECRET");
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(json).digest("hex");
  return Buffer.from(`${json}.${sig}`, "utf8").toString("base64url");
}

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const clientId = mustEnv("GOOGLE_OAUTH_CLIENT_ID");
  const redirectUri = mustEnv("GOOGLE_OAUTH_REDIRECT_URI");

  // keep state small + signed
  const state = signState({
    t: gate.tenantId,
    ts: Date.now(),
    nonce: crypto.randomUUID(),
  });

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("redirect_uri", redirectUri);
  params.set("response_type", "code");
  params.set("access_type", "offline"); // refresh_token
  params.set("prompt", "consent");      // force refresh_token issuance in many cases
  params.set(
  "scope",
  "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send"
);
  params.set("include_granted_scopes", "true");
  params.set("state", state);

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  // direct redirect keeps it simple
  return NextResponse.redirect(url);
}