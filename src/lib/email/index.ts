// src/lib/email/index.ts
import type { EmailContextType, EmailSendResult, EmailMessage } from "./types";
import { makeResendProvider } from "./providers/resend";

/**
 * Standard mode only (Resend) for now.
 * Later: add Gmail/Microsoft OAuth providers and route based on tenant_settings.email_mode/email_provider.
 */

async function getProviderForTenant(_tenantId: string) {
  // TODO: read tenant_settings once we add email_mode/email_provider fields.
  return makeResendProvider();
}

export async function sendEmail(args: {
  tenantId: string;
  context: { type: EmailContextType; quoteLogId?: string };
  message: EmailMessage;
}): Promise<EmailSendResult> {
  const provider = await getProviderForTenant(args.tenantId);

  // future choke point: logging, retries, rate limits, provider selection
  return provider.send({
    tenantId: args.tenantId,
    context: args.context,
    message: args.message,
  });
}