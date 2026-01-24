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

  if (!cfg.leadToEmail?.trim()) {
    return json(
      { ok: false, error: "MISSING_LEAD_TO_EMAIL", message: "Set Lead To Email first." },
      400
    );
  }

  const mode = cfg.emailSendMode === "enterprise" ? "enterprise" : "standard";
  const emailIdentityId = cfg.emailIdentityId || null;

  const { from, replyTo } = resolveFromAndReplyTo(cfg);
  const business = cfg.businessName?.trim() || "your business";
  const replyToFirst = replyTo?.[0] || "";

  // IMPORTANT: You cannot reference `res` inside this HTML, because `res` is created AFTER sendEmail() returns.
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#111">
      <h2 style="margin:0 0 8px;">Test email ✅</h2>
      <p style="margin:0 0 10px;color:#374151;">
        This confirms your tenant can send email through the platform.
      </p>

      <div style="font-size:13px;color:#6b7280;">
        <div><b>Tenant</b>: ${escapeHtml(business)}</div>
        <div><b>Mode</b>: ${escapeHtml(mode)}</div>
        <div><b>Email Identity ID</b>: ${escapeHtml(emailIdentityId || "(none)")}</div>
        <div><b>From (requested)</b>: ${escapeHtml(from)}</div>
        <div><b>Reply-To</b>: ${escapeHtml(replyToFirst || "(none)")}</div>
      </div>

      <p style="margin:12px 0 0;color:#6b7280;font-size:12px;">
        Provider details are returned in the API response (not embedded in the email body).
      </p>
    </div>
  `;

  const text = `Test email: tenant=${business} mode=${mode} emailIdentityId=${emailIdentityId || ""} from=${from} replyTo=${replyToFirst}`;

  const res = await sendEmail({
    tenantId: gate.tenantId,
    context: { type: "lead_new" },
    message: {
      from,
      to: [cfg.leadToEmail],
      replyTo,
      subject: `Test email from AI Photo Quote (${business})`,
      html,
      text,
    },
  });

  return json(
    {
      ok: res.ok,
      mode,
      provider: res.provider,
      providerMessageId: res.providerMessageId ?? null,
      fromUsed: from,
      replyToUsed: replyToFirst || null,
      emailIdentityId,
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