// src/lib/email/providers/gmailOAuth.ts
import type { EmailProvider } from "./base";
import { decryptToken } from "@/lib/crypto/emailTokens";

function b64url(input: string) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function headerLine(name: string, value: string) {
  // Prevent header injection
  const safe = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  return `${name}: ${safe}`;
}

export function makeGmailOAuthProvider(args: {
  refreshTokenEnc: string;
  fromEmail: string; // authenticated mailbox email, e.g. maggioupholstery@gmail.com
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

        // 1) refresh access token
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

        const tj: any = await tr.json().catch(() => ({}));
        if (!tr.ok) {
          return {
            ok: false,
            provider: "gmail_oauth",
            providerMessageId: null,
            error: tj?.error_description || "Google refresh failed",
            meta: { tenantId, context, tj },
          };
        }

        const accessToken = String(tj.access_token || "");
        if (!accessToken) {
          return {
            ok: false,
            provider: "gmail_oauth",
            providerMessageId: null,
            error: "Missing access token after refresh",
            meta: { tenantId, context, tj },
          };
        }

        // 2) build RFC2822 raw email (HTML)
        const toLine = (message.to || []).join(", ");
        const ccLine = (message.cc || []).join(", ");
        const bccLine = (message.bcc || []).join(", ");
        const replyTo = Array.isArray(message.replyTo) ? message.replyTo[0] : undefined;

        // NOTE: Gmail will typically override/normalize the From to the authenticated mailbox.
        // We'll set From to args.fromEmail to match what Gmail will actually send as.
        const baseHeaders: (string | null)[] = [
          headerLine("From", args.fromEmail),
          headerLine("To", toLine || args.fromEmail), // To is required-ish; fallback prevents weirdness
          ccLine ? headerLine("Cc", ccLine) : null,
          bccLine ? headerLine("Bcc", bccLine) : null,
          replyTo ? headerLine("Reply-To", replyTo) : null,
          headerLine("Subject", message.subject),
          headerLine("MIME-Version", "1.0"),
          headerLine("Content-Type", "text/html; charset=UTF-8"),
        ];

        // Custom headers (optional)
        const extra = message.headers && typeof message.headers === "object"
          ? Object.entries(message.headers)
              .filter(([k, v]) => k && v != null)
              .map(([k, v]) => headerLine(k, String(v)))
          : [];

        const headers = [...baseHeaders.filter(Boolean), ...extra].join("\r\n");

        const rawMime = `${headers}\r\n\r\n${message.html || ""}`;
        const raw = b64url(rawMime);

        // 3) send via Gmail API
        const sr = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw }),
        });

        const sj: any = await sr.json().catch(() => ({}));
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
          meta: {
            tenantId,
            context,
            // super useful for your test endpoint:
            fromActual: args.fromEmail,
          },
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