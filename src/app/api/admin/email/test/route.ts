// src/app/api/admin/email/test/route.ts
import { NextResponse } from "next/server";
import { requireTenantRole } from "@/lib/auth/tenant";
import { sendEmail } from "@/lib/email";
import { getTenantEmailConfig, resolveFromAndReplyTo } from "@/lib/email/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST() {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const cfg = await getTenantEmailConfig(gate.tenantId);

  if (!cfg.leadToEmail) {
    return json(
      { ok: false, error: "MISSING_LEAD_TO_EMAIL", message: "Set Lead To Email first." },
      400
    );
  }

  const { from, replyTo } = resolveFromAndReplyTo(cfg);
  const business = cfg.businessName?.trim() || "your business";
  const replyToFirst = replyTo?.[0] || "";

  // Send first (so we can report real provider/mode/fromActual)
  const res = await sendEmail({
    tenantId: gate.tenantId,
    context: { type: "lead_new" },
    message: {
      from,
      to: [cfg.leadToEmail],
      replyTo,
      subject: `Test email from AI Photo Quote (${business})`,
      html: "(placeholder)", // replaced below
      text: "(placeholder)", // replaced below
    },
  });

  // Now build the email body with accurate info
  const mode = (res.meta as any)?.mode ?? cfg.emailSendMode ?? "standard";
  const fromActual = (res.meta as any)?.fromActual ?? null;
  const fromRequested = (res.meta as any)?.fromRequested ?? from;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#111">
      <h2 style="margin:0 0 8px;">Test email ✅</h2>
      <p style="margin:0 0 10px;color:#374151;">
        This confirms your tenant can send email through the platform.
      </p>
      <div style="font-size:13px;color:#6b7280;">
        <div><b>Tenant</b>: ${escapeHtml(business)}</div>
        <div><b>Mode</b>: ${escapeHtml(String(mode))}</div>
        <div><b>sendEmail() provider</b>: ${escapeHtml(res.provider)}</div>
        <div><b>From (requested)</b>: ${escapeHtml(String(fromRequested))}</div>
        <div><b>From (actual)</b>: ${escapeHtml(fromActual ? String(fromActual) : "(same as requested)")}</div>
        <div><b>To</b>: ${escapeHtml(cfg.leadToEmail)}</div>
        <div><b>Reply-To</b>: ${escapeHtml(replyToFirst || "(none)")}</div>
        ${res.ok ? "" : `<div><b>Error</b>: ${escapeHtml(res.error || "(unknown)")}</div>`}
      </div>
    </div>
  `;

  const text = `Test email: tenant=${business} mode=${mode} provider=${res.provider} fromRequested=${fromRequested} fromActual=${fromActual ?? ""} to=${cfg.leadToEmail} replyTo=${replyToFirst} ok=${res.ok} error=${res.error || ""}`;

  // If it succeeded, we’re done; if it failed, return details
  return json(
    {
      ok: res.ok,
      mode,
      provider: res.provider,
      providerMessageId: res.providerMessageId ?? null,
      fromRequested,
      fromActual,
      replyToUsed: replyToFirst || null,
      emailIdentityId: cfg.emailIdentityId ?? null,
      error: res.error ?? null,
      note:
        res.ok
          ? "Provider accepted the message. If delivery is missing, check recipient spam/quarantine and DMARC alignment."
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