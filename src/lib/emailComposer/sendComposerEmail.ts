import type { EmailMessage, EmailSendResult } from "@/lib/email/types";
import { makeResendProvider } from "@/lib/email/providers/resend";
import { makeGmailOAuthProvider } from "@/lib/email/providers/gmailOAuth";
import { resolveTenantEmailMode } from "./resolveTenantMode";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { decryptToken } from "@/lib/crypto/emailTokens";

async function getGmailIdentity(emailIdentityId: string) {
  const r = await db.execute(sql`
    select refresh_token_enc, email
    from tenant_email_identities
    where id = ${emailIdentityId}::uuid
    limit 1
  `);

  const row: any =
    (r as any)?.rows?.[0] ??
    (Array.isArray(r) ? (r as any)[0] : null);

  if (!row?.refresh_token_enc || !row?.email) {
    throw new Error("EMAIL_IDENTITY_INVALID");
  }

  return {
    refreshTokenEnc: String(row.refresh_token_enc),
    mailboxEmail: String(row.email),
  };
}

export async function sendComposerEmail(args: {
  tenantId: string;
  message: EmailMessage;
}): Promise<EmailSendResult> {
  const { mode, emailIdentityId } = await resolveTenantEmailMode(args.tenantId);

  // STANDARD (Resend)
  if (mode === "standard") {
    const provider = makeResendProvider();

    return provider.send({
      tenantId: args.tenantId,
      context: { type: "customer_receipt" }, // harmless context
      message: args.message,
    });
  }

  // ENTERPRISE (Gmail OAuth)
  if (!emailIdentityId) {
    return {
      ok: false,
      provider: "gmail_oauth",
      providerMessageId: null,
      error: "MISSING_EMAIL_IDENTITY",
    };
  }

  try {
    const identity = await getGmailIdentity(emailIdentityId);

    const provider = makeGmailOAuthProvider({
      refreshTokenEnc: identity.refreshTokenEnc,
      fromEmail: identity.mailboxEmail,
    });

    return provider.send({
      tenantId: args.tenantId,
      context: { type: "customer_receipt" },
      message: args.message,
    });
  } catch (e: any) {
    return {
      ok: false,
      provider: "gmail_oauth",
      providerMessageId: null,
      error: e?.message ?? String(e),
    };
  }
}