import { NextResponse } from "next/server";
import { requireTenantRole } from "@/lib/auth/tenant";
import { sendEmail } from "@/lib/email";
import { getTenantEmailConfig, resolveFromAndReplyTo } from "@/lib/email/resolve";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

async function getEnterpriseMailboxEmail(emailIdentityId: string): Promise<string | null> {
  try {
    const r = await db.execute(sql`
      select email
      from tenant_email_identities
      where id = ${emailIdentityId}::uuid
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    const email = (row?.email ?? "").toString().trim().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

function pickMeta(res: any) {
  const m = (res?.meta ?? null) as any;
  if (!m || typeof m !== "object") return null;

  // Keep this tight + safe (no tokens, no giant blobs)
  return {
    mode: m.mode ?? null,
    status: typeof m.status === "number" ? m.status : null,
    attempt: typeof m.attempt === "number" ? m.attempt : null,
    fromRequested: m.fromRequested ?? null,
    fromUsed: m.fromUsed ?? null,
    fallbackReason: m.fallbackReason ?? null,
    emailIdentityId: m.emailIdentityId ?? null,
    fromActual: m.fromActual ?? null, // enterprise path in your email/index.ts
  };
}

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const url = new URL(req.url);
  const bccSelf = url.searchParams.get("bccSelf") !== "0"; // default ON
  const alsoToSelf = url.searchParams.get("alsoToSelf") === "1"; // default OFF

  const cfg = await getTenantEmailConfig(gate.tenantId);

  if (!cfg.leadToEmail) {
    return json({ ok: false, error: "MISSING_LEAD_TO_EMAIL", message: "Set Lead To Email first." }, 400);
  }

  const { from, replyTo } = resolveFromAndReplyTo(cfg);
  const business = cfg.businessName?.trim() || "your business";
  const replyToFirst = replyTo?.[0] || "";

  const mode =
    (cfg.emailSendMode ?? "standard").toString().trim().toLowerCase() === "enterprise"
      ? "enterprise"
      : "standard";

  const mailboxEmail =
    mode === "enterprise" && cfg.emailIdentityId ? await getEnterpriseMailboxEmail(cfg.emailIdentityId) : null;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#111">
      <h2 style="margin:0 0 8px;">Test email ✅</h2>
      <p style="margin:0 0 10px;color:#374151;">
        This is a test message from AI Photo Quote.
      </p>
      <div style="font-size:13px;color:#6b7280;">
        <div><b>Tenant</b>: ${escapeHtml(business)}</div>
        <div><b>Mode (requested)</b>: ${escapeHtml(mode)}</div>
        <div><b>To</b>: ${escapeHtml(cfg.leadToEmail)}</div>
        <div><b>From (resolved)</b>: ${escapeHtml(from)}</div>
        <div><b>Reply-To</b>: ${escapeHtml(replyToFirst || "(none)")}</div>
        ${
          mode === "enterprise"
            ? `<div><b>Connected mailbox (for send)</b>: ${escapeHtml(mailboxEmail || "(unknown)")}</div>`
            : ""
        }
        <div><b>alsoToSelf</b>: ${escapeHtml(String(alsoToSelf))}</div>
        <div><b>bccSelf</b>: ${escapeHtml(String(bccSelf))}</div>
      </div>
    </div>
  `;

  const text = `Test email: tenant=${business} mode=${mode} to=${cfg.leadToEmail} from=${from} replyTo=${replyToFirst}`;

  const message: any = {
    from,
    to: [cfg.leadToEmail],
    replyTo,
    subject: `Test email from AI Photo Quote (${business})`,
    html,
    text,

    // NOTE: your provider currently may not forward headers to Resend/Gmail unless implemented there.
    headers: {
      "X-AIPQ-Tenant": gate.tenantId,
      "X-AIPQ-Mode": mode,
      "X-AIPQ-Context": "lead_new",
    },
  };

  // Gmail reality: BCC to yourself often shows only in Sent/All Mail.
  // For testing, CC yourself if alsoToSelf=1 so it lands in Inbox.
  if (mailboxEmail && alsoToSelf) {
    message.cc = Array.from(new Set([...(message.cc || []), mailboxEmail]));
  } else if (bccSelf && mailboxEmail) {
    message.bcc = [mailboxEmail];
  }

  const res = await sendEmail({
    tenantId: gate.tenantId,
    context: { type: "lead_new" },
    message,
  });

  const meta = pickMeta(res);

  // Prefer “fromUsed” if provider supplied it (Resend will do this after our provider update)
  const fromUsed = meta?.fromUsed ?? meta?.fromActual ?? null;

  return json(
    {
      ok: res.ok,
      mode,
      provider: res.provider,
      providerMessageId: res.providerMessageId ?? null,

      // What we asked for (resolved from config)
      fromResolved: from,
      replyToUsed: replyToFirst || null,

      // What provider actually used (fallback / enterprise actual)
      fromUsed,

      // Enterprise debug
      emailIdentityId: cfg.emailIdentityId ?? null,
      mailboxEmail,
      alsoToSelf,
      bccSelf,

      // Helpful provider meta (safe subset)
      meta,

      error: res.error ?? null,
      note: res.ok
        ? "Provider accepted the message. If delivery is missing, check spam/quarantine and DMARC alignment."
        : null,
    },
    res.ok ? 200 : 500
  );
}

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}