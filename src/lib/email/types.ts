// src/lib/email/types.ts

export type EmailSendMode = "standard" | "enterprise";

/**
 * Provider keys used across the email system.
 * Keep in sync with providers you actually implement.
 */
export type EmailProviderKey = "resend" | "gmail_oauth" | "microsoft_oauth";

/**
 * Strict union so emails are categorized consistently.
 * Add new types here whenever a new email flow is introduced.
 */
export type EmailContextType =
  | "lead_new"
  | "customer_receipt"
  // render flow
  | "lead_render"
  | "customer_render"
  | "lead_render_complete"
  | "customer_render_complete";

export type EmailContext = {
  type: EmailContextType;
  quoteLogId?: string | null;
};

/**
 * Message shape used by email providers
 */
export type EmailMessage = {
  from: string;
  to: string[];
  subject: string;

  // content
  html: string;
  text?: string; // optional plain-text version (used by Resend)

  // optional addressing
  replyTo?: string[];
  cc?: string[];
  bcc?: string[];

  // custom headers (provider may inject these into raw MIME)
  headers?: Record<string, string | number | boolean>;
};

/**
 * Result shape returned by sendEmail (and providers).
 * NOTE: meta is optional and used for debugging/telemetry (e.g., enterprise fromActual).
 */
export type EmailSendResult = {
  ok: boolean;
  provider: EmailProviderKey;
  providerMessageId?: string | null;
  error?: string | null;

  // Optional debug/telemetry payload (safe to omit)
  meta?: Record<string, any>;
};

/**
 * Canonical args for sendEmail
 */
export type SendEmailArgs = {
  tenantId: string;
  context: EmailContext;
  message: EmailMessage;
};

/**
 * Back-compat aliases (in case some files use older names)
 */
export type SendEmailMessage = EmailMessage;
export type SendEmailResult = EmailSendResult;