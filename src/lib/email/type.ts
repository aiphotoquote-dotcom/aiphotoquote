// src/lib/email/types.ts

export type EmailProviderKey = "resend" | "gmail_oauth" | "microsoft_oauth";

export type EmailContextType = "lead_new" | "customer_receipt" | "lead_render" | "customer_render";

export type EmailMessage = {
  from: string; // keep as a raw RFC-ish string: "Name <email@domain>" OR "email@domain"
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[]; // most providers support this
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
};

export type EmailSendResult = {
  ok: boolean;
  provider: EmailProviderKey;
  providerMessageId?: string | null;
  error?: string | null;
};