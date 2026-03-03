// src/lib/email/index.ts
import type { EmailContextType, EmailSendResult, EmailMessage } from "./types";
import { makeResendProvider } from "./providers/resend";
import { makeGmailOAuthProvider } from "./providers/gmailOAuth";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

type EmailSendMode = "standard" | "enterprise";

async function getTenantEmailMode(
  tenantId: string
): Promise<{
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

async function getGmailIdentity(
  emailIdentityId: string
): Promise<{
  refreshTokenEnc: string;
  mailboxEmail: string;
}> {
  // NOTE: your DB table is tenant_email_identities and the column is `email`
  const r = await db.execute(sql`
    select refresh_token_enc, email
    from tenant_email_identities
    where id = ${emailIdentityId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

  const refreshTokenEnc = (row?.refresh_token_enc ?? "").toString();
  const mailboxEmail = (row?.email ?? "").toString();

  if (!refreshTokenEnc) throw new Error("EMAIL_IDENTITY_MISSING_REFRESH_TOKEN");
  if (!mailboxEmail) throw new Error("EMAIL_IDENTITY_MISSING_EMAIL");

  return { refreshTokenEnc, mailboxEmail };
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function safeJsonParse(v: unknown): any | null {
  try {
    if (v == null) return null;
    if (typeof v === "object") return v;
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) return null;
      return JSON.parse(s);
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeToList(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => safeTrim(x)).filter(Boolean);
  return [safeTrim(v)].filter(Boolean);
}

async function logEmailToDb(args: {
  tenantId: string;
  quoteLogId?: string;
  contextType: EmailContextType;
  source: "sendEmail";
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
        ${String(args.contextType)},
        ${args.source},
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
    // never block email delivery on logging
  }
}

function buildPlatformFrom(): string | null {
  const email = safeTrim(process.env.PLATFORM_FROM_EMAIL);
  if (!email) return null;

  const name = safeTrim(process.env.PLATFORM_FROM_NAME);
  return name ? `${name} <${email}>` : email;
}

/**
 * Detect errors where Resend rejected the sender/from domain, so we can fall back
 * to the platform domain (aiphotoquote.com) and still deliver.
 */
function shouldFallbackToPlatformFrom(res: EmailSendResult): boolean {
  if (res.ok) return false;
  if (res.provider !== "resend") return false;

  const msg = String(res.error ?? "").toLowerCase();

  // Known Resend "from" failures / verification blockers
  if (msg.includes("domain is not verified")) return true;
  if (msg.includes("from") && msg.includes("not verified")) return true;
  if (msg.includes("sender") && msg.includes("not verified")) return true;
  if (msg.includes("from address") && (msg.includes("not allowed") || msg.includes("rejected"))) return true;
  if (msg.includes("you can only send from")) return true;
  if (msg.includes("verify your domain")) return true;

  return false;
}

/**
 * ✅ Fix for the screenshot issue:
 * Some Resend responses include { data: { id: "..." }, error: null } but our provider
 * may return RESEND_NO_MESSAGE_ID anyway.
 *
 * This normalizes those cases so UI doesn't show a red "error" when the send succeeded.
 */
function normalizeResendNoMessageId(res: EmailSendResult): EmailSendResult {
  if (res.provider !== "resend") return res;

  // Already fine
  if (res.ok && res.providerMessageId) return res;

  // Only try to heal "no message id" style failures
  const err = String(res.error ?? "");
  if (!err) return res;

  const looksLikeNoId =
    err === "RESEND_NO_MESSAGE_ID" ||
    err.toLowerCase().includes("no_message_id") ||
    err.toLowerCase().includes("no message id");

  if (!looksLikeNoId) return res;

  // meta might be the raw Resend response OR a JSON string of it
  const metaObj = safeJsonParse((res as any)?.meta) ?? (res as any)?.meta ?? null;

  const id =
    safeTrim(metaObj?.data?.id) ||
    safeTrim(metaObj?.id) ||
    safeTrim(metaObj?.data?.messageId) ||
    safeTrim(metaObj?.messageId);

  const metaError = safeTrim(metaObj?.error?.message) || safeTrim(metaObj?.error) || null;

  // If Resend said error: null and we have an id, treat as success.
  if (id && !metaError) {
    return {
      ...res,
      ok: true,
      providerMessageId: id,
      error: null,
      meta: metaObj ?? res.meta,
    };
  }

  // Otherwise, keep as-is but ensure meta is an object for debugging
  if (metaObj && typeof metaObj === "object") {
    return { ...res, meta: metaObj };
  }

  return res;
}

export async function sendEmail(args: {
  tenantId: string;
  context: { type: EmailContextType; quoteLogId?: string };
  message: EmailMessage;
}): Promise<EmailSendResult> {
  const { mode, emailIdentityId } = await getTenantEmailMode(args.tenantId);

  // ----------------
  // STANDARD (Resend)
  // ----------------
  if (mode === "standard") {
    const provider = makeResendProvider();

    const requestedFrom = args.message.from;
    const firstRaw = await provider.send({
      tenantId: args.tenantId,
      context: args.context,
      message: args.message,
    });

    // ✅ normalize RESEND_NO_MESSAGE_ID false-negative
    const first = normalizeResendNoMessageId(firstRaw);

    // Success: attach useful meta for debugging
    if (first.ok) {
      const out: EmailSendResult = {
        ...first,
        meta: {
          ...(first.meta || {}),
          mode,
          fromRequested: requestedFrom,
          fromActual: requestedFrom,
          fallbackUsed: false,
        },
      };

      await logEmailToDb({
        tenantId: args.tenantId,
        quoteLogId: args.context.quoteLogId,
        contextType: args.context.type,
        source: "sendEmail",
        message: args.message,
        result: out,
      });

      return out;
    }

    // If Resend rejected the tenant domain/sender, retry with platform From
    if (shouldFallbackToPlatformFrom(first)) {
      const platformFrom = buildPlatformFrom();

      // If platform fallback isn't configured, return the original failure + meta
      if (!platformFrom) {
        const out: EmailSendResult = {
          ...first,
          meta: {
            ...(first.meta || {}),
            mode,
            fromRequested: requestedFrom,
            fromActual: requestedFrom,
            fallbackUsed: false,
            fallbackReason: "PLATFORM_FROM_EMAIL_NOT_SET",
          },
        };

        await logEmailToDb({
          tenantId: args.tenantId,
          quoteLogId: args.context.quoteLogId,
          contextType: args.context.type,
          source: "sendEmail",
          message: args.message,
          result: out,
        });

        return out;
      }

      const secondRaw = await provider.send({
        tenantId: args.tenantId,
        context: args.context,
        message: {
          ...args.message,
          from: platformFrom,
        },
      });

      // ✅ normalize RESEND_NO_MESSAGE_ID false-negative on retry too
      const second = normalizeResendNoMessageId(secondRaw);

      // Return the retry result but preserve the original failure for visibility
      const out: EmailSendResult = {
        ...second,
        meta: {
          ...(second.meta || {}),
          mode,
          fromRequested: requestedFrom,
          fromActual: platformFrom,
          fallbackUsed: true,
          fallbackReason: first.error ?? "resend_from_rejected",
          originalProviderMessageId: first.providerMessageId ?? null,
          originalError: first.error ?? null,
        },
      };

      await logEmailToDb({
        tenantId: args.tenantId,
        quoteLogId: args.context.quoteLogId,
        contextType: args.context.type,
        source: "sendEmail",
        message: args.message,
        result: out,
      });

      return out;
    }

    // Non-fallback failure: return as-is with meta
    const out: EmailSendResult = {
      ...first,
      meta: {
        ...(first.meta || {}),
        mode,
        fromRequested: requestedFrom,
        fromActual: requestedFrom,
        fallbackUsed: false,
      },
    };

    await logEmailToDb({
      tenantId: args.tenantId,
      quoteLogId: args.context.quoteLogId,
      contextType: args.context.type,
      source: "sendEmail",
      message: args.message,
      result: out,
    });

    return out;
  }

  // -----------------
  // ENTERPRISE (Gmail)
  // -----------------
  if (!emailIdentityId) {
    const out: EmailSendResult = {
      ok: false,
      provider: "gmail_oauth",
      providerMessageId: null,
      error: "MISSING_EMAIL_IDENTITY",
      meta: { mode },
    };

    await logEmailToDb({
      tenantId: args.tenantId,
      quoteLogId: args.context.quoteLogId,
      contextType: args.context.type,
      source: "sendEmail",
      message: args.message,
      result: out,
    });

    return out;
  }

  try {
    const identity = await getGmailIdentity(emailIdentityId);

    // ✅ Enterprise rule: send "From" as the connected mailbox (deliverability + DMARC alignment)
    const provider = makeGmailOAuthProvider({
      refreshTokenEnc: identity.refreshTokenEnc,
      fromEmail: identity.mailboxEmail,
    });

    const res = await provider.send({
      tenantId: args.tenantId,
      context: args.context,
      message: args.message,
    });

    const out: EmailSendResult = {
      ...res,
      meta: {
        ...(res.meta || {}),
        mode,
        emailIdentityId,
        fromRequested: args.message.from,
        fromActual: identity.mailboxEmail,
      },
    };

    await logEmailToDb({
      tenantId: args.tenantId,
      quoteLogId: args.context.quoteLogId,
      contextType: args.context.type,
      source: "sendEmail",
      message: args.message,
      result: out,
    });

    return out;
  } catch (e: any) {
    const out: EmailSendResult = {
      ok: false,
      provider: "gmail_oauth",
      providerMessageId: null,
      error: e?.message ?? String(e),
      meta: { mode, emailIdentityId },
    };

    await logEmailToDb({
      tenantId: args.tenantId,
      quoteLogId: args.context.quoteLogId,
      contextType: args.context.type,
      source: "sendEmail",
      message: args.message,
      result: out,
    });

    return out;
  }
}