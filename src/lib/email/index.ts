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

async function getGmailIdentity(emailIdentityId: string): Promise<{
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
    const first = await provider.send({
      tenantId: args.tenantId,
      context: args.context,
      message: args.message,
    });

    // Success: attach useful meta for debugging
    if (first.ok) {
      return {
        ...first,
        meta: {
          ...(first.meta || {}),
          mode,
          fromRequested: requestedFrom,
          fromActual: requestedFrom,
          fallbackUsed: false,
        },
      };
    }

    // If Resend rejected the tenant domain/sender, retry with platform From
    if (shouldFallbackToPlatformFrom(first)) {
      const platformFrom = buildPlatformFrom();

      // If platform fallback isn't configured, return the original failure + meta
      if (!platformFrom) {
        return {
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
      }

      const second = await provider.send({
        tenantId: args.tenantId,
        context: args.context,
        message: {
          ...args.message,
          from: platformFrom,
        },
      });

      // Return the retry result but preserve the original failure for visibility
      return {
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
    }

    // Non-fallback failure: return as-is with meta
    return {
      ...first,
      meta: {
        ...(first.meta || {}),
        mode,
        fromRequested: requestedFrom,
        fromActual: requestedFrom,
        fallbackUsed: false,
      },
    };
  }

  // -----------------
  // ENTERPRISE (Gmail)
  // -----------------
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

    return {
      ...res,
      meta: {
        ...(res.meta || {}),
        mode,
        emailIdentityId,
        fromRequested: args.message.from,
        fromActual: identity.mailboxEmail,
      },
    };
  } catch (e: any) {
    return {
      ok: false,
      provider: "gmail_oauth",
      providerMessageId: null,
      error: e?.message ?? String(e),
      meta: { mode, emailIdentityId },
    };
  }
}