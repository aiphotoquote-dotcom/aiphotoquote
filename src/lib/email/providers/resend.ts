// src/lib/email/providers/resend.ts
import { Resend } from "resend";
import type { EmailProvider } from "./base";

export function makeResendProvider(): EmailProvider {
  return {
    key: "resend",

    async send({ tenantId, context, message }) {
      const resendKey = process.env.RESEND_API_KEY?.trim() || "";
      if (!resendKey) {
        return {
          ok: false,
          provider: "resend",
          providerMessageId: null,
          error: "Missing RESEND_API_KEY",
          meta: { tenantId, context },
        };
      }

      // normalize replyTo to string[] (your types allow string|string[])
      const replyToArr =
        message.replyTo == null
          ? undefined
          : Array.isArray(message.replyTo)
          ? message.replyTo
          : [message.replyTo];

      try {
        const resend = new Resend(resendKey);

        const res = await resend.emails.send({
          from: message.from,
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,

          // avoid SDK drift by sending the most compatible shape
          reply_to: replyToArr?.[0], // Resend uses a single reply_to
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers,

          // optional: tag by context for analytics/triage (if you add tags to types)
          // tags: [{ name: "type", value: context.type }, { name: "tenantId", value: tenantId }],
        } as any);

        if ((res as any)?.error) {
          const msg = (res as any).error?.message ?? "Resend error";
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: msg,
            meta: { tenantId, context, providerError: (res as any).error },
          };
        }

        const id = (res as any)?.data?.id ?? null;
        return {
          ok: true,
          provider: "resend",
          providerMessageId: id,
          error: null,
          meta: { tenantId, context },
        };
      } catch (e: any) {
        return {
          ok: false,
          provider: "resend",
          providerMessageId: null,
          error: e?.message ?? String(e),
          meta: { tenantId, context },
        };
      }
    },
  };
}