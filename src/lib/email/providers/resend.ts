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
  const ra =
    e?.response?.headers?.["retry-after"] ??
    e?.headers?.["retry-after"] ??
    e?.retryAfter ??
    null;

  if (ra == null) return null;

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

function isDomainNotVerifiedError(e: any): boolean {
  const msg = String(e?.message ?? "").toLowerCase();
  return msg.includes("domain is not verified") || msg.includes("not verified");
}

function getFallbackFrom(): string | null {
  // Configure ONE of these in Vercel env (Production):
  // - RESEND_FALLBACK_FROM="AI Photo Quote <notifications@aiphotoquote.com>"
  // - PLATFORM_FROM_EMAIL="AI Photo Quote <notifications@aiphotoquote.com>"
  const raw =
    (process.env.RESEND_FALLBACK_FROM ?? "").trim() ||
    (process.env.PLATFORM_FROM_EMAIL ?? "").trim();

  return raw || null;
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

      const backoffs = [350, 900, 1800]; // only for 429
      const fallbackFrom = getFallbackFrom();

      async function attemptSend(fromOverride?: string) {
        const from = fromOverride ?? message.from;

        const out = await resend.emails.send({
          from,
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,
          replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });

        return out;
      }

      // 1) First attempt: requested sender
      // 2) If domain not verified: retry once with fallback sender (if configured)
      // 3) If rate limited: retry with backoff (still honoring requested sender unless we switched to fallback)

      let lastErr: any = null;

      // helper that performs 429 retries around a single send function
      async function sendWith429Retries(sendFn: () => Promise<any>) {
        for (let attempt = 0; attempt <= backoffs.length; attempt++) {
          try {
            const out = await sendFn();
            return { out, attempt };
          } catch (e: any) {
            lastErr = e;

            if (!isRateLimitError(e)) throw e;

            if (attempt < backoffs.length) {
              const retryAfter = getRetryAfterMs(e);
              const waitMs = retryAfter ?? backoffs[attempt];
              const jitter = Math.floor(Math.random() * 150);
              await sleep(waitMs + jitter);
              continue;
            }

            throw e;
          }
        }

        throw lastErr ?? new Error("Unknown Resend error");
      }

      try {
        const { out, attempt } = await sendWith429Retries(() => attemptSend());

        return {
          ok: true,
          provider: "resend",
          providerMessageId: (out as any)?.id ?? null,
          error: null,
          meta: { tenantId, context, attempt, fromUsed: message.from },
        };
      } catch (e1: any) {
        // If the tenant domain isn't verified, retry using platform sender (one time).
        if (isDomainNotVerifiedError(e1) && fallbackFrom) {
          try {
            const { out, attempt } = await sendWith429Retries(() => attemptSend(fallbackFrom));

            return {
              ok: true,
              provider: "resend",
              providerMessageId: (out as any)?.id ?? null,
              error: null,
              meta: {
                tenantId,
                context,
                attempt,
                fromRequested: message.from,
                fromUsed: fallbackFrom,
                fallbackReason: "domain_not_verified",
              },
            };
          } catch (e2: any) {
            return {
              ok: false,
              provider: "resend",
              providerMessageId: null,
              error: e2?.message ?? String(e2),
              meta: {
                tenantId,
                context,
                status: getStatusCode(e2),
                fromRequested: message.from,
                fromTriedFallback: fallbackFrom,
              },
            };
          }
        }

        // non-fallback path
        return {
          ok: false,
          provider: "resend",
          providerMessageId: null,
          error: e1?.message ?? String(e1),
          meta: { tenantId, context, status: getStatusCode(e1), fromUsed: message.from },
        };
      }
    },
  };
}