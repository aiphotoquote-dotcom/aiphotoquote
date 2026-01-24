// src/lib/email/index.ts
import type { EmailContextType, EmailSendResult, EmailMessage } from "./types";
import { makeResendProvider } from "./providers/resend";
import { makeGmailOAuthProvider } from "./providers/gmailOAuth";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

type EmailSendMode = "standard" | "enterprise";

async function getTenantEmailMode(tenantId: string): Promise<{
  mode: EmailSendMode;
  emailIdentityId: string | null;
}> {
  try {
    const r = await db.execute(sql`
      select email_send_mode, email_identity_id
      from tenant_settings
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

    const rawMode = (row?.email_send_mode ?? "standard").toString().trim().toLowerCase();
    const mode: EmailSendMode = rawMode === "enterprise" ? "enterprise" : "standard";

    const emailIdentityId = row?.email_identity_id ? String(row.email_identity_id) : null;

    return { mode, emailIdentityId };
  } catch {
    return { mode: "standard", emailIdentityId: null };
  }
}

async function getTenantEmailIdentity(emailIdentityId: string): Promise<{
  provider: string;
  email: string;
  fromEmail: string;
  refreshTokenEnc: string;
  status: string;
}> {
  // ✅ IMPORTANT: your DB table is tenant_email_identities (NOT email_identities)
  const r = await db.execute(sql`
    select provider, email, from_email, refresh_token_enc, status
    from tenant_email_identities
    where id = ${emailIdentityId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  const provider = String(row?.provider ?? "").trim();
  const email = String(row?.email ?? "").trim().toLowerCase();

  // from_email may be null/blank; fallback to mailbox email
  const fromEmailRaw = String(row?.from_email ?? "").trim();
  const fromEmail = fromEmailRaw || email;

  const refreshTokenEnc = String(row?.refresh_token_enc ?? "").trim();
  const status = String(row?.status ?? "active").trim();

  if (!provider || !email) throw new Error("EMAIL_IDENTITY_NOT_FOUND");
  if (!refreshTokenEnc) throw new Error("MISSING_REFRESH_TOKEN");
  if (status && status !== "active") throw new Error(`EMAIL_IDENTITY_NOT_ACTIVE:${status}`);

  return { provider, email, fromEmail, refreshTokenEnc, status };
}

export async function sendEmail(args: {
  tenantId: string;
  context: { type: EmailContextType; quoteLogId?: string };
  message: EmailMessage;
}): Promise<EmailSendResult> {
  const { mode, emailIdentityId } = await getTenantEmailMode(args.tenantId);

  if (mode === "standard") {
    const provider = makeResendProvider();
    return provider.send({
      tenantId: args.tenantId,
      context: args.context,
      message: args.message,
    });
  }

  // enterprise
  if (!emailIdentityId) {
    return {
      ok: false,
      provider: "gmail_oauth",
      providerMessageId: null,
      error: "MISSING_EMAIL_IDENTITY",
      meta: { mode },
    };
  }

  try {
    const ident = await getTenantEmailIdentity(emailIdentityId);

    // For now we only support Google first
    if (ident.provider !== "gmail_oauth") {
      return {
        ok: false,
        provider: "gmail_oauth",
        providerMessageId: null,
        error: `UNSUPPORTED_EMAIL_PROVIDER:${ident.provider}`,
        meta: { mode },
      };
    }

    const provider = makeGmailOAuthProvider({
      refreshTokenEnc: ident.refreshTokenEnc,
      fromEmail: ident.fromEmail,
    });

    return provider.send({
      tenantId: args.tenantId,
      context: args.context,
      message: args.message,
    });
  } catch (e: any) {
    return {
      ok: false,
      provider: "gmail_oauth",
      providerMessageId: null,
      error: e?.message ?? String(e),
      meta: { mode },
    };
  }
}