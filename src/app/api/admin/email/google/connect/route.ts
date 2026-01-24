import { NextResponse } from "next/server";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || "";
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || "";
  const appUrl = process.env.APP_URL?.trim() || ""; // e.g. https://aiphotoquote.com

  if (!clientId || !redirectUri || !appUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: "MISSING_GOOGLE_OAUTH_ENV",
        message:
          "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_REDIRECT_URI, and APP_URL in env.",
      },
      { status: 500 }
    );
  }

  // state binds the callback to the current tenant (simple, server-only trust boundary)
  // Optional hardening later: sign/encrypt state.
  const state = Buffer.from(
    JSON.stringify({ tenantId: gate.tenantId, ts: Date.now() }),
    "utf8"
  ).toString("base64url");

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("redirect_uri", redirectUri);
  params.set("response_type", "code");

  // MUST include offline + prompt=consent to get refresh_token reliably
  params.set("access_type", "offline");
  params.set("prompt", "consent");

  // scopes: send email + get account email address
  params.set(
    "scope",
    [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/gmail.send",
    ].join(" ")
  );

  params.set("state", state);

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return NextResponse.redirect(url);
}