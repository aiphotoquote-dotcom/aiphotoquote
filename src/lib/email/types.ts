// src/lib/email/types.ts

export type EmailSendMode = "standard" | "enterprise";

/**
 * EmailContextType is a strict union so we can tag emails consistently.
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

export type SendEmailMessage = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  replyTo?: string[];
};

export type SendEmailResult = {
  ok: boolean;
  provider: "resend";
  providerMessageId?: string | null;
  error?: string | null;
};

export type SendEmailArgs = {
  tenantId: string;
  context: EmailContext;
  message: SendEmailMessage;
};