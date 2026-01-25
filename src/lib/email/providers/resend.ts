// src/lib/email/providers/resend.ts
import { Resend } from "resend";
import type { EmailProvider } from "./base";

export function makeResendProvider(): EmailProvider {
  const resend = new Resend(process.env.RESEND_API_KEY);

  return {
    key: "resend",

    async send({ tenantId, context, message }) {
      try {
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