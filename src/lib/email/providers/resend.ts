// src/lib/email/providers/resend.ts
import { Resend } from "resend";
import type { EmailProvider } from "./base";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export function makeResendProvider(): EmailProvider {
  const resend = new Resend(process.env.RESEND_API_KEY);

  return {
    key: "resend",

    async send({ tenantId, context, message }) {
      try {
        const apiKey = safeTrim(process.env.RESEND_API_KEY);
        if (!apiKey) {
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: "Missing RESEND_API_KEY",
            meta: { tenantId, context },
          };
        }

        const from = safeTrim(message.from);
        const subject = safeTrim(message.subject);

        const to = Array.isArray(message.to) ? message.to.map((x) => safeTrim(x)).filter(Boolean) : [];
        const cc = Array.isArray(message.cc) ? message.cc.map((x) => safeTrim(x)).filter(Boolean) : undefined;
        const bcc = Array.isArray(message.bcc) ? message.bcc.map((x) => safeTrim(x)).filter(Boolean) : undefined;

        const replyTo = Array.isArray(message.replyTo) ? safeTrim(message.replyTo[0]) || undefined : undefined;

        if (!from) {
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: "Missing from address",
            meta: { tenantId, context },
          };
        }
        if (!to.length) {
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: "Missing to address",
            meta: { tenantId, context },
          };
        }
        if (!subject) {
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: "Missing subject",
            meta: { tenantId, context },
          };
        }
        if (!safeTrim(message.html) && !safeTrim(message.text)) {
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: "Missing email body (html or text)",
            meta: { tenantId, context },
          };
        }

        // Resend SDK responses can vary by version:
        // - { id: "..." }
        // - { data: { id: "..." }, error: null }
        // - { data: null, error: { message: "...", ... } }
        const out: any = await resend.emails.send({
          from,
          to,
          cc,
          bcc,
          replyTo,
          subject,
          html: message.html,
          text: message.text,
        });

        const id =
          safeTrim(out?.id) ||
          safeTrim(out?.data?.id) ||
          safeTrim(out?.data?.messageId) ||
          safeTrim(out?.messageId);

        const errMsg =
          safeTrim(out?.error?.message) ||
          safeTrim(out?.error) ||
          safeTrim(out?.message) ||
          "";

        // If we have an explicit error, fail.
        if (errMsg && !id) {
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: errMsg,
            meta: {
              tenantId,
              context,
              resend: {
                hasData: Boolean(out?.data),
                hasError: Boolean(out?.error),
              },
            },
          };
        }

        // If we have NO id, treat as failure (this is your current “ghost success” bug)
        if (!id) {
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: "Resend returned no message id",
            meta: {
              tenantId,
              context,
              resend: {
                keys: out && typeof out === "object" ? Object.keys(out).slice(0, 20) : [],
                hasData: Boolean(out?.data),
                hasError: Boolean(out?.error),
              },
            },
          };
        }

        return {
          ok: true,
          provider: "resend",
          providerMessageId: id,
          error: null,
          meta: {
            tenantId,
            context,
            resend: { idPresent: true },
          },
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