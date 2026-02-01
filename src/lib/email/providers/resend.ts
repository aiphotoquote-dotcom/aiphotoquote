// src/lib/email/providers/resend.ts
import { Resend } from "resend";
import type { EmailProvider } from "./base";

export function makeResendProvider(): EmailProvider {
  const resend = new Resend(process.env.RESEND_API_KEY);

  return {
    key: "resend",

    async send({ tenantId, context, message }) {
      try {
        const apiKey = process.env.RESEND_API_KEY?.trim();
        if (!apiKey) {
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: "Missing RESEND_API_KEY",
            meta: { tenantId, context },
          };
        }

        const replyTo = Array.isArray(message.replyTo) ? message.replyTo[0] : undefined;

        // Resend SDK commonly returns { data, error }
        const out: any = await resend.emails.send({
          from: message.from,
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,
          replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });

        const errorObj = out?.error ?? null;
        const id =
          out?.data?.id ??
          out?.id ??
          null;

        // If Resend returns an error, treat as failure (and surface it!)
        if (errorObj) {
          const errMsg =
            typeof errorObj === "string"
              ? errorObj
              : errorObj?.message
                ? String(errorObj.message)
                : JSON.stringify(errorObj);

          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: `Resend error: ${errMsg}`.slice(0, 2000),
            meta: {
              tenantId,
              context,
              // safe debugging payload
              resend: {
                hasData: Boolean(out?.data),
                hasId: Boolean(id),
              },
            },
          };
        }

        // If no error but also no id, treat as failure (this is your current “ghost send”)
        if (!id) {
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: "Resend returned no message id (unexpected response shape).",
            meta: {
              tenantId,
              context,
              resend: {
                keys: out ? Object.keys(out) : null,
                hasData: Boolean(out?.data),
              },
            },
          };
        }

        return {
          ok: true,
          provider: "resend",
          providerMessageId: String(id),
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