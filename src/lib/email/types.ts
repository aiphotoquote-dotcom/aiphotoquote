// src/lib/email/types.ts

export type EmailProviderKey = "resend" | "gmail_oauth" | "microsoft_oauth";

export type EmailContextType =
  | "lead_new"
  | "customer_receipt"
  | "lead_render"
  | "customer_render";

export type EmailMessage = {
  from: string;            // "Name <email@domain>" OR "email@domain"
  to: string[];            // required
  cc?: string[];
  bcc?: string[];

  // ergonomic + matches most SDKs
  replyTo?: string | string[];

  subject: string;
  html: string;
  text?: string;

  // provider-agnostic headers (some providers whitelist these)
  headers?: Record<string, string>;

  // optional future-proofing (safe to ignore in providers that don't support)
  tags?: string[];         // e.g. ["lead", "render"]
};

export type EmailSendResult = {
  ok: boolean;
  provider: EmailProviderKey;
  providerMessageId?: string | null;
  error?: string | null;

  // optional debug/meta you can persist in email_deliveries
  meta?: Record<string, any>;
};