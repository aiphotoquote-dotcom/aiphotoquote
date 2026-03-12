// src/lib/emailComposer/sendComposerEmail.ts
import type { EmailMessage, EmailSendResult } from "@/lib/email/types";
import { makeResendProvider } from "@/lib/email/providers/resend";
import { makeGmailOAuthProvider } from "@/lib/email/providers/gmailOAuth";
import { resolveTenantEmailMode } from "./resolveTenantMode";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeToList(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => safeTrim(x)).filter(Boolean);
  return [safeTrim(v)].filter(Boolean);
}

async function logComposerEmailToDb(args: {
  tenantId: string;
  quoteLogId?: string;
  message: EmailMessage;
  result: EmailSendResult;
  metaExtra?: Record<string, any>;
}) {
  try {
    const quoteLogId = safeTrim(args.quoteLogId);
    const fromEmail = safeTrim((args.message as any)?.from);
    const toEmails = normalizeToList((args.message as any)?.to);
    const subject = safeTrim((args.message as any)?.subject);

    const metaMerged =
      args.metaExtra || (args.result as any)?.meta
        ? { ...(args.metaExtra || {}), ...(((args.result as any)?.meta as any) || {}) }
        : {};

    await db.execute(sql`
      insert into quote_email_logs (
        id,
        tenant_id,
        quote_log_id,
        quote_version_id,
        context_type,
        source,
        from_email,
        to_emails,
        subject,
        provider,
        provider_message_id,
        ok,
        error,
        meta,
        created_at
      )
      values (
        gen_random_uuid(),
        ${args.tenantId}::uuid,
        ${quoteLogId ? sql`${quoteLogId}::uuid` : sql`null`},
        null,
        ${"composer_email"},
        ${"emailComposer"},
        ${fromEmail || null},
        ${JSON.stringify(toEmails)}::jsonb,
        ${subject || null},
        ${String(args.result.provider ?? "") || null},
        ${args.result.providerMessageId ?? null},
        ${Boolean(args.result.ok)},
        ${args.result.error ?? null},
        ${JSON.stringify(metaMerged ?? {})}::jsonb,
        now()
      )
    `);
  } catch {
    // never block sending on logging
  }
}

async function getGmailIdentity(emailIdentityId: string) {
  const r = await db.execute(sql`
    select refresh_token_enc, email
    from tenant_email_identities
    where id = ${emailIdentityId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

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
  quoteLogId?: string; // ✅ for quote_email_logs
}): Promise<EmailSendResult> {
  const { mode, emailIdentityId } = await resolveTenantEmailMode(args.tenantId);

  // STANDARD (Resend)
  if (mode === "standard") {
    const provider = makeResendProvider();

    const res = await provider.send({
      tenantId: args.tenantId,
      context: { type: "customer_receipt" }, // harmless context
      message: args.message,
    });

    await logComposerEmailToDb({
      tenantId: args.tenantId,
      quoteLogId: args.quoteLogId,
      message: args.message,
      result: res,
      metaExtra: { mode },
    });

    return res;
  }

  // ENTERPRISE (Gmail OAuth)
  if (!emailIdentityId) {
    const res: EmailSendResult = {
      ok: false,
      provider: "gmail_oauth",
      providerMessageId: null,
      error: "MISSING_EMAIL_IDENTITY",
    };

    await logComposerEmailToDb({
      tenantId: args.tenantId,
      quoteLogId: args.quoteLogId,
      message: args.message,
      result: res,
      metaExtra: { mode },
    });

    return res;
  }

  try {
    const identity = await getGmailIdentity(emailIdentityId);

    const provider = makeGmailOAuthProvider({
      refreshTokenEnc: identity.refreshTokenEnc,
      fromEmail: identity.mailboxEmail,
    });

    const res = await provider.send({
      tenantId: args.tenantId,
      context: { type: "customer_receipt" },
      message: args.message,
    });

    await logComposerEmailToDb({
      tenantId: args.tenantId,
      quoteLogId: args.quoteLogId,
      message: args.message,
      result: res,
      metaExtra: { mode, emailIdentityId, fromActual: identity.mailboxEmail },
    });

    return res;
  } catch (e: any) {
    const res: EmailSendResult = {
      ok: false,
      provider: "gmail_oauth",
      providerMessageId: null,
      error: e?.message ?? String(e),
    };

    await logComposerEmailToDb({
      tenantId: args.tenantId,
      quoteLogId: args.quoteLogId,
      message: args.message,
      result: res,
      metaExtra: { mode, emailIdentityId },
    });

    return res;
  }
}