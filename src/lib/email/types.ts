// src/lib/email/types.ts

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
  replyTo?: string[]; // you use replyTo as array in multiple places
  subject: string;
  html: string;
  text?: string;

  // ✅ Needed by Resend provider (custom headers, e.g. for threading/metadata)
  headers?: Record<string, string>;
};

// Result shape returned by providers and sendEmail()
export type EmailSendResult = {
  ok: boolean;
  provider: EmailProviderKey;
  providerMessageId: string | null;
  error: string | null;
  meta?: any;
};