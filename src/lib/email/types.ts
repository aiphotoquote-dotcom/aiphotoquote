// src/lib/email/types.ts

// Keep this union broad enough to cover what exists today + what you're adding next.
export type EmailProviderKey =
  | "resend"
  | "gmail_oauth"
  | "microsoft_oauth";

// What kinds of emails we send (must match all call sites)
export type EmailContextType =
  | "lead_new"
  | "customer_receipt"
  | "lead_customer_receipt"
  | "lead_render"
  | "customer_render"
  | "admin_notice";

// Basic email payload used by providers
export type EmailMessage = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[]; // match your usage: replyTo as array
  subject: string;
  html: string;
  text?: string;
};

// Result shape returned by providers and sendEmail()
export type EmailSendResult = {
  ok: boolean;
  provider: EmailProviderKey;
  providerMessageId: string | null;
  error: string | null;
  meta?: any;
};