// src/lib/email/types.ts

export type EmailSendMode = "standard" | "enterprise";

/**
 * Strict union so emails are categorized consistently.
 * Add new types here whenever a new email flow is introduced.
 */
export type EmailContextType =
  | "lead_new"
  | "customer_receipt"
  // render flow (start + complete)
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
 * (keep this name because src/lib/email/index.ts imports EmailMessage)
 */
export type EmailMessage = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  replyTo?: string[];
};

/**
 * Result shape returned by sendEmail
 * (keep this name because src/lib/email/index.ts imports EmailSendResult)
 */
export type EmailSendResult = {
  ok: boolean;
  provider: "resend" | "gmail_oauth" | "microsoft_oauth";
  providerMessageId?: string | null;
  error?: string | null;
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
 * Back-compat aliases (in case some routes/providers use the older names)
 */
export type SendEmailMessage = EmailMessage;
export type SendEmailResult = EmailSendResult;