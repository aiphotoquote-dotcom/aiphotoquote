import { Resend } from "resend";
import type { EmailProvider } from "./base";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStatusCode(e: any): number | null {
  const s =
    e?.statusCode ??
    e?.status ??
    e?.response?.status ??
    e?.response?.statusCode ??
    null;
  return typeof s === "number" ? s : null;
}

function getRetryAfterMs(e: any): number | null {
  // Try common shapes:
  // - e.response.headers["retry-after"]
  // - e.headers["retry-after"]
  // - e.retryAfter
  const ra =
    e?.response?.headers?.["retry-after"] ??
    e?.headers?.["retry-after"] ??
    e?.retryAfter ??
    null;

  if (ra == null) return null;

  // retry-after can be seconds or a date; we’ll handle seconds
  const n = Number(ra);
  if (Number.isFinite(n) && n > 0) return Math.min(30_000, Math.round(n * 1000));

  return null;
}

function isRateLimitError(e: any): boolean {
  const status = getStatusCode(e);
  if (status === 429) return true;

  const msg = String(e?.message ?? "").toLowerCase();
  return msg.includes("too many requests") || msg.includes("rate limit") || msg.includes("429");
}

export function makeResendProvider(): EmailProvider {
  const resend = new Resend(process.env.RESEND_API_KEY);

  return {
    key: "resend",

    async send({ tenantId, context, message }) {
      if (!process.env.RESEND_API_KEY?.trim()) {
        return {
          ok: false,
          provider: "resend",
          providerMessageId: null,
          error: "Missing RESEND_API_KEY",
          meta: { tenantId, context },
        };
      }

      const replyTo = Array.isArray(message.replyTo) ? message.replyTo[0] : undefined;

      // Small, conservative retry plan for 429s.
      // Keeps UX snappy but avoids “customer email never sends”.
      const backoffs = [350, 900, 1800]; // ms

      let lastErr: any = null;

      for (let attempt = 0; attempt <= backoffs.length; attempt++) {
        try {
          const out = await resend.emails.send({
            from: message.from,
            to: message.to,
            cc: message.cc,
            bcc: message.bcc,
            replyTo,
            subject: message.subject,
            html: message.html,
            text: message.text,
          });

          return {
            ok: true,
            provider: "resend",
            providerMessageId: (out as any)?.id ?? null,
            error: null,
            meta: { tenantId, context, attempt },
          };
        } catch (e: any) {
          lastErr = e;

          // If not rate-limit, fail immediately.
          if (!isRateLimitError(e)) {
            return {
              ok: false,
              provider: "resend",
              providerMessageId: null,
              error: e?.message ?? String(e),
              meta: { tenantId, context, attempt, status: getStatusCode(e) },
            };
          }

          // Rate-limit: retry if we have attempts left.
          if (attempt < backoffs.length) {
            const retryAfter = getRetryAfterMs(e);
            const waitMs = retryAfter ?? backoffs[attempt];

            // Add a tiny jitter to avoid thundering herd in concurrent lambdas.
            const jitter = Math.floor(Math.random() * 150);
            await sleep(waitMs + jitter);
            continue;
          }

          // Out of retries
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: e?.message ?? String(e),
            meta: { tenantId, context, attempt, status: getStatusCode(e), rateLimited: true },
          };
        }
      }

      // should never reach, but just in case:
      return {
        ok: false,
        provider: "resend",
        providerMessageId: null,
        error: lastErr?.message ?? String(lastErr ?? "Unknown Resend error"),
        meta: { tenantId, context },
      };
    },
  };
}