// src/lib/email/providers/resend.ts
import { Resend } from "resend";
import type { EmailProvider } from "./base";

export function makeResendProvider(): EmailProvider {
  return {
    key: "resend",
    async send({ message }) {
      const resendKey = process.env.RESEND_API_KEY?.trim() || "";
      if (!resendKey) {
        return { ok: false, provider: "resend", providerMessageId: null, error: "Missing RESEND_API_KEY" };
      }

      try {
        const resend = new Resend(resendKey);
        const res = await resend.emails.send({
          from: message.from,
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,
          replyTo: message.replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers,
        } as any);

        if ((res as any)?.error) {
          const msg = (res as any).error?.message ?? "Resend error";
          return { ok: false, provider: "resend", providerMessageId: null, error: msg };
        }

        const id = (res as any)?.data?.id ?? null;
        return { ok: true, provider: "resend", providerMessageId: id, error: null };
      } catch (e: any) {
        return { ok: false, provider: "resend", providerMessageId: null, error: e?.message ?? String(e) };
      }
    },
  };
}