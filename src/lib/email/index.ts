// src/lib/email/index.ts
import type { EmailContextType, EmailMessage } from "./types";
import { makeResendProvider } from "./providers/resend";
import { getTenantEmailConfig } from "./resolve";

/**
 * Email provider routing based on tenant_settings.
 *
 * Modes:
 * - standard   -> Resend (platform email)
 * - enterprise -> OAuth mailbox (Google/Microsoft) [not implemented yet]
 *
 * NOTE: We only *route* here. OAuth token acquisition + storage will live elsewhere.
 */

type EmailSendMode = "standard" | "enterprise";

async function getTenantEmailMode(tenantId: string): Promise<{
  mode: EmailSendMode;
  emailIdentityId: string | null;
}> {
  try {
    const cfg = await getTenantEmailConfig(tenantId);
    const mode: EmailSendMode = cfg.emailSendMode === "enterprise" ? "enterprise" : "standard";
    const emailIdentityId = cfg.emailIdentityId ? String(cfg.emailIdentityId) : null;
    return { mode, emailIdentityId };
  } catch {
    // safest default
    return { mode: "standard", emailIdentityId: null };
  }
}

async function getProviderForTenant(
  tenantId: string
): Promise<
  | { ok: true; mode: EmailSendMode; provider: ReturnType<typeof makeResendProvider> }
  | { ok: false; mode: EmailSendMode; error: string }
> {
  const { mode, emailIdentityId } = await getTenantEmailMode(tenantId);

  if (mode === "standard") {
    return { ok: true, mode, provider: makeResendProvider() };
  }

  // Enterprise mode selected
  if (!emailIdentityId) {
    return { ok: false, mode, error: "MISSING_EMAIL_IDENTITY" };
  }

  // Placeholder until we implement Google/Microsoft providers + email_identities table
  return { ok: false, mode, error: "ENTERPRISE_OAUTH_NOT_IMPLEMENTED" };
}

export async function sendEmail(args: {
  tenantId: string;
  context: { type: EmailContextType; quoteLogId?: string };
  message: EmailMessage;
}) {
  const routed = await getProviderForTenant(args.tenantId);

  if (!routed.ok) {
    // Return a structured, provider-shaped failure.
    // In enterprise mode we report "gmail_oauth" as a neutral "OAuth mailbox" placeholder
    // until we add email_identities.provider and can return google vs microsoft precisely.
    const provider = routed.mode === "enterprise" ? "gmail_oauth" : "resend";

    return {
      ok: false,
      provider,
      providerMessageId: null,
      error: routed.error,
      meta: { mode: routed.mode },
    };
  }

  // future choke point: logging, retries, rate limits, provider selection
  return routed.provider.send({
    tenantId: args.tenantId,
    context: args.context,
    message: args.message,
  });
}