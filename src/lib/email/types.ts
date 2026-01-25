// src/lib/email/types.ts

export type EmailSendMode = "standard" | "enterprise";

// ✅ Add the two new context types here
export type EmailContextType =
  | "lead_new"
  | "customer_receipt"
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