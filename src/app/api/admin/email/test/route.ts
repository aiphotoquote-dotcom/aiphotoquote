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

  const res = await sendEmail({
    tenantId: gate.tenantId,
    context: { type: "lead_new" },
    message: {
      from,
      to: [cfg.leadToEmail],
      replyTo,
      subject: `Test email from AI Photo Quote (${business})`,
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#111">
          <h2 style="margin:0 0 8px;">Test email ✅</h2>
          <p style="margin:0 0 10px;color:#374151;">
            This confirms your tenant can send email through the platform.
          </p>
          <div style="font-size:13px;color:#6b7280;">
            <div><b>Tenant</b>: ${escapeHtml(business)}</div>
            <div><b>From used</b>: ${escapeHtml(from)}</div>
            <div><b>Reply-To</b>: ${escapeHtml(replyTo?.[0] || "(none)")}</div>
            <div><b>Provider</b>: ${escapeHtml("resend")}</div>

          </div>
        </div>
      `,
      text: `Test email: tenant=${business} from=${from} replyTo=${replyTo?.[0] || ""} provider=${res.provider}`,
    },
  });

  return json({
    ok: res.ok,
    provider: res.provider,
    providerMessageId: res.providerMessageId ?? null,
    fromUsed: from,
    replyToUsed: replyTo?.[0] ?? null,
    error: res.error ?? null,
  }, res.ok ? 200 : 500);
}

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}