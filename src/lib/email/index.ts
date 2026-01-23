// src/lib/email/index.ts
import type { EmailContextType, EmailSendResult } from "./types";
import { makeResendProvider } from "./providers/resend";
import type { EmailMessage } from "./types";

/**
 * Standard mode only (Resend) for now.
 * Later: add Gmail/Microsoft OAuth providers and route based on tenant_settings.email_send_mode/email_provider.
 */
const provider = makeResendProvider();

export async function sendEmail(args: {
  tenantId: string;
  context: { type: EmailContextType; quoteLogId?: string };
  message: EmailMessage;
}): Promise<EmailSendResult> {
  // One choke point for future: logging, retries, rate limits, provider selection
  return provider.send({
    tenantId: args.tenantId,
    context: args.context,
    message: args.message,
  });
}