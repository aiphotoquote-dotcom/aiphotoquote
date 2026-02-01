import { Resend } from "resend";
import type { EmailProvider } from "./base";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeStr(v: any, max = 4000) {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + "…(truncated)" : s;
  } catch {
    return String(v ?? "");
  }
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
      // Hard preflight (prevents "fake ok")
      if (!process.env.RESEND_API_KEY?.trim()) {
        return {
          ok: false,
          provider: "resend",
          providerMessageId: null,
          error: "Missing RESEND_API_KEY",
          meta: { tenantId, context },
        };
      }
      if (!message?.from?.trim()) {
        return {
          ok: false,
          provider: "resend",
          providerMessageId: null,
          error: "Missing message.from",
          meta: { tenantId, context },
        };
      }
      if (!Array.isArray(message?.to) || message.to.length === 0) {
        return {
          ok: false,
          provider: "resend",
          providerMessageId: null,
          error: "Missing message.to",
          meta: { tenantId, context },
        };
      }
      if (!message?.subject?.trim()) {
        return {
          ok: false,
          provider: "resend",
          providerMessageId: null,
          error: "Missing message.subject",
          meta: { tenantId, context },
        };
      }

      const replyTo = Array.isArray(message.replyTo) ? message.replyTo[0] : undefined;

      const fallbackFrom = getFallbackFrom();
      const backoffs = [350, 900, 1800]; // for 429 only

      async function rawSend(fromOverride?: string) {
        const fromUsed = fromOverride ?? message.from;

        const payload: any = {
          from: fromUsed,
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,
          replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
        };

        const out = await resend.emails.send(payload);
        const id = (out as any)?.id ?? null;

        // ✅ IMPORTANT: Resend success MUST include an id
        if (!id) {
          // Log for Vercel Function Logs
          console.error("[email][resend] Missing id from Resend response", {
            tenantId,
            context,
            fromRequested: message.from,
            fromUsed,
            to: message.to,
            subject: message.subject,
            out: safeStr(out),
          });

          throw new Error(`RESEND_NO_MESSAGE_ID: ${safeStr(out) || "(empty response)"}`);
        }

        return { id: String(id), out };
      }

      async function sendWith429Retries(fn: () => Promise<{ id: string; out: any }>) {
        for (let attempt = 0; attempt <= backoffs.length; attempt++) {
          try {
            const res = await fn();
            return { ...res, attempt };
          } catch (e: any) {
            if (!isRateLimitError(e)) throw e;

            if (attempt < backoffs.length) {
              const retryAfter = getRetryAfterMs(e);
              const waitMs = retryAfter ?? backoffs[attempt];
              const jitter = Math.floor(Math.random() * 150);
              console.warn("[email][resend] 429 rate limit, retrying", {
                tenantId,
                context,
                attempt,
                waitMs,
                status: getStatusCode(e),
                message: String(e?.message ?? ""),
              });
              await sleep(waitMs + jitter);
              continue;
            }
            throw e;
          }
        }
        // unreachable
        throw new Error("RESEND_UNKNOWN_RETRY_STATE");
      }

      // Attempt 1: requested sender
      try {
        const { id, attempt } = await sendWith429Retries(() => rawSend());
        return {
          ok: true,
          provider: "resend",
          providerMessageId: id,
          error: null,
          meta: { tenantId, context, attempt, fromUsed: message.from },
        };
      } catch (e1: any) {
        // Fallback if tenant domain not verified
        if (isDomainNotVerifiedError(e1) && fallbackFrom) {
          try {
            console.warn("[email][resend] Domain not verified, falling back to platform sender", {
              tenantId,
              context,
              fromRequested: message.from,
              fallbackFrom,
              message: String(e1?.message ?? ""),
            });

            const { id, attempt } = await sendWith429Retries(() => rawSend(fallbackFrom));
            return {
              ok: true,
              provider: "resend",
              providerMessageId: id,
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
            console.error("[email][resend] Fallback send failed", {
              tenantId,
              context,
              fromRequested: message.from,
              fallbackFrom,
              status: getStatusCode(e2),
              message: String(e2?.message ?? ""),
            });

            return {
              ok: false,
              provider: "resend",
              providerMessageId: null,
              error: e2?.message ?? String(e2),
              meta: { tenantId, context, status: getStatusCode(e2), fromRequested: message.from, fromUsed: fallbackFrom },
            };
          }
        }

        // Normal failure
        console.error("[email][resend] Send failed", {
          tenantId,
          context,
          status: getStatusCode(e1),
          message: String(e1?.message ?? ""),
          fromUsed: message.from,
          to: message.to,
        });

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