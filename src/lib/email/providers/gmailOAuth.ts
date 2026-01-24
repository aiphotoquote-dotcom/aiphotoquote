import type { EmailProvider } from "./base";
import { decryptToken } from "@/lib/crypto/emailTokens";

export function makeGmailOAuthProvider(args: {
  refreshTokenEnc: string;
  fromEmail: string;
}): EmailProvider {
  return {
    key: "gmail_oauth",

    async send({ tenantId, context, message }) {
      try {
        const refreshToken = decryptToken(args.refreshTokenEnc);

        const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || "";
        const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || "";
        if (!clientId || !clientSecret) {
          return {
            ok: false,
            provider: "gmail_oauth",
            providerMessageId: null,
            error: "Missing GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET",
            meta: { tenantId, context },
          };
        }

        // refresh access token
        const body = new URLSearchParams();
        body.set("client_id", clientId);
        body.set("client_secret", clientSecret);
        body.set("grant_type", "refresh_token");
        body.set("refresh_token", refreshToken);

        const tr = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });

        const tj = await tr.json();
        if (!tr.ok) {
          return {
            ok: false,
            provider: "gmail_oauth",
            providerMessageId: null,
            error: tj?.error_description || "Google refresh failed",
            meta: { tenantId, context, tj },
          };
        }

        const accessToken = tj.access_token as string;

        // RFC2822 raw email (HTML)
        const toLine = message.to.join(", ");
        const replyTo = Array.isArray(message.replyTo) ? message.replyTo[0] : message.replyTo;

        const headers = [
          `From: ${args.fromEmail}`,
          `To: ${toLine}`,
          replyTo ? `Reply-To: ${replyTo}` : null,
          `Subject: ${message.subject}`,
          `MIME-Version: 1.0`,
          `Content-Type: text/html; charset=UTF-8`,
        ]
          .filter(Boolean)
          .join("\r\n");

        const raw = Buffer.from(`${headers}\r\n\r\n${message.html}`, "utf8")
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/g, "");

        const sr = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw }),
        });

        const sj = await sr.json();
        if (!sr.ok) {
          return {
            ok: false,
            provider: "gmail_oauth",
            providerMessageId: null,
            error: sj?.error?.message || "Gmail send failed",
            meta: { tenantId, context, sj },
          };
        }

        return {
          ok: true,
          provider: "gmail_oauth",
          providerMessageId: sj?.id ?? null,
          error: null,
          meta: { tenantId, context },
        };
      } catch (e: any) {
        return {
          ok: false,
          provider: "gmail_oauth",
          providerMessageId: null,
          error: e?.message ?? String(e),
          meta: { tenantId, context },
        };
      }
    },
  };
}
