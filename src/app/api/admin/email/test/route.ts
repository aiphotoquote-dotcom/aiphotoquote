// src/app/api/admin/email/test/route.ts
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

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const url = new URL(req.url);
  const bccSelf = url.searchParams.get("bccSelf") !== "0"; // default ON

  const cfg = await getTenantEmailConfig(gate.tenantId);

  if (!cfg.leadToEmail) {
    return json({ ok: false, error: "MISSING_LEAD_TO_EMAIL", message: "Set Lead To Email first." }, 400);
  }

  const { from, replyTo } = resolveFromAndReplyTo(cfg);
  const business = cfg.businessName?.trim() || "your business";
  const replyToFirst = replyTo?.[0] || "";

  // Determine if we're enterprise and (optionally) BCC the connected mailbox
  const mode = (cfg.emailSendMode ?? "standard").toString().trim().toLowerCase() === "enterprise"
    ? "enterprise"
    : "standard";

  const mailboxEmail =
    mode === "enterprise" && cfg.emailIdentityId ? await getEnterpriseMailboxEmail(cfg.emailIdentityId) : null;

  // ✅ Real email body (no placeholder)
  const preHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#111">
      <h2 style="margin:0 0 8px;">Test email ✅</h2>
      <p style="margin:0 0 10px;color:#374151;">
        This is a test message from AI Photo Quote.
      </p>
      <div style="font-size:13px;color:#6b7280;">
        <div><b>Tenant</b>: ${escapeHtml(business)}</div>
        <div><b>Mode (requested)</b>: ${escapeHtml(mode)}</div>
        <div><b>To</b>: ${escapeHtml(cfg.leadToEmail)}</div>
        <div><b>Reply-To</b>: ${escapeHtml(replyToFirst || "(none)")}</div>
        ${
          mode === "enterprise"
            ? `<div><b>Connected mailbox (for send)</b>: ${escapeHtml(mailboxEmail || "(unknown)")}</div>`
            : ""
        }
      </div>
    </div>
  `;

  const preText = `Test email: tenant=${business} mode=${mode} to=${cfg.leadToEmail} replyTo=${replyToFirst}`;

  // Optional BCC-to-self on tests so you always see delivery
  // NOTE: EmailMessage may not currently include bcc in your types/provider.
  // If your EmailMessage supports it, this works immediately.
  // If it doesn't, you can skip this and I’ll show the small type/provider patch next.
  const message: any = {
    from,
    to: [cfg.leadToEmail],
    replyTo,
    subject: `Test email from AI Photo Quote (${business})`,
    html: preHtml,
    text: preText,
  };

  if (bccSelf && mailboxEmail) {
    message.bcc = [mailboxEmail];
  }

  const res = await sendEmail({
    tenantId: gate.tenantId,
    context: { type: "lead_new" },
    message,
  });

  const fromActual = (res.meta as any)?.fromActual ?? null;

  return json(
    {
      ok: res.ok,
      mode,
      provider: res.provider,
      providerMessageId: res.providerMessageId ?? null,
      fromRequested: from,
      fromActual,
      replyToUsed: replyToFirst || null,
      emailIdentityId: cfg.emailIdentityId ?? null,
      bccSelfApplied: Boolean(bccSelf && mailboxEmail),
      bccSelfAddress: mailboxEmail,
      error: res.error ?? null,
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