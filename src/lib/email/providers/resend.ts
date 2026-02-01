// src/lib/email/providers/resend.ts
import { Resend } from "resend";
import type { EmailProvider } from "./base";

type ResendSendResponse =
  | { data?: { id?: string } | null; error?: { message?: string } | string | null }
  | { id?: string | null; error?: { message?: string } | string | null };

function extractErrorMessage(err: any): string | null {
  if (!err) return null;
  if (typeof err === "string") return err;
  if (typeof err?.message === "string" && err.message.trim()) return err.message.trim();
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function makeResendProvider(): EmailProvider {
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

        const resend = new Resend(apiKey);

        const replyTo = Array.isArray(message.replyTo)
          ? message.replyTo.filter(Boolean)[0]
          : message.replyTo || undefined;

        const out = (await resend.emails.send({
          from: message.from,
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,
          replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
        })) as ResendSendResponse;

        // ✅ Resend SDK commonly returns { data, error }
        const errMsg = extractErrorMessage((out as any)?.error);
        if (errMsg) {
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: errMsg,
            meta: { tenantId, context },
          };
        }

        const id =
          (out as any)?.data?.id ??
          (out as any)?.id ??
          null;

        // ✅ If we didn’t get an ID, treat as failure (prevents “ok:true id:null” lying)
        if (!id) {
          return {
            ok: false,
            provider: "resend",
            providerMessageId: null,
            error: "Resend returned no message id (data.id missing).",
            meta: { tenantId, context },
          };
        }

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