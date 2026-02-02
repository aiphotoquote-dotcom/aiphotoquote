// src/app/api/cron/abandoned/route.ts
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sendEmail } from "@/lib/email";
import { getTenantEmailConfig } from "@/lib/email/tenantEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function authOk(req: Request) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;

  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice("Bearer ".length).trim() : "";
  return token && token === secret;
}

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function minutesAgo(n: number) {
  return new Date(Date.now() - n * 60_000);
}

async function sendAbandonedFollowup(args: {
  tenantId: string;
  tenantSlug: string;
  businessName: string;
  quoteLogId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}) {
  const { tenantId, tenantSlug, businessName, quoteLogId, customerName, customerEmail, customerPhone } = args;

  const cfg = await getTenantEmailConfig(tenantId);

  // platform prerequisites
  if (!process.env.RESEND_API_KEY?.trim()) return { ok: false, error: "MISSING_RESEND_API_KEY" };
  if (!cfg?.fromEmail?.trim()) return { ok: false, error: "MISSING_FROM_EMAIL" };
  if (!cfg?.leadToEmail?.trim()) return { ok: false, error: "MISSING_LEAD_TO_EMAIL" };

  // Option A for now: simple “you started but didn’t finish”
  const subjectCustomer = `Finish your quote anytime — ${businessName}`;

  const htmlCustomer = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#111">
      <h2 style="margin:0 0 8px;">Finish your quote</h2>
      <p style="margin:0 0 10px;color:#374151;">
        We noticed you started a quote but didn’t finish. If you want help, just reply to this email.
      </p>
      <div style="font-size:13px;color:#6b7280;">
        <div><b>Business</b>: ${escapeHtml(businessName)}</div>
        <div><b>Quote ID</b>: ${escapeHtml(quoteLogId)}</div>
      </div>
    </div>
  `;

  // customer follow-up
  const rCustomer = await sendEmail({
    tenantId,
    context: { type: "abandoned_followup", quoteLogId },
    message: {
      from: cfg.fromEmail,
      to: [customerEmail],
      replyTo: [cfg.leadToEmail],
      subject: subjectCustomer,
      html: htmlCustomer,
      text: `Finish your quote. Business=${businessName} Quote=${quoteLogId}`,
    },
  });

  // shop notification (goes to shop inbox)
  const rShop = await sendEmail({
    tenantId,
    context: { type: "abandoned_followup_shop", quoteLogId },
    message: {
      from: cfg.fromEmail,
      to: [cfg.leadToEmail],
      replyTo: [cfg.leadToEmail],
      subject: `Abandoned quote follow-up sent — ${customerName}`,
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#111">
          <h3 style="margin:0 0 8px;">Abandoned follow-up sent</h3>
          <div style="font-size:14px;color:#111">
            <div><b>Name:</b> ${escapeHtml(customerName)}</div>
            <div><b>Email:</b> ${escapeHtml(customerEmail)}</div>
            <div><b>Phone:</b> ${escapeHtml(customerPhone)}</div>
            <div><b>Quote ID:</b> ${escapeHtml(quoteLogId)}</div>
            <div><b>Tenant:</b> ${escapeHtml(tenantSlug)}</div>
          </div>
        </div>
      `,
      text: `Abandoned follow-up sent: ${customerName} ${customerEmail} ${customerPhone} quote=${quoteLogId} tenant=${tenantSlug}`,
    },
  });

  return {
    ok: Boolean(rCustomer.ok && rShop.ok),
    customer: { ok: rCustomer.ok, id: rCustomer.providerMessageId ?? null, error: rCustomer.error ?? null },
    shop: { ok: rShop.ok, id: rShop.providerMessageId ?? null, error: rShop.error ?? null },
  };
}

async function runScan() {
  // Hobby = daily cron, so abandon threshold can be wider
  const minutesRaw = Number(process.env.ABANDONED_MINUTES ?? 60);
  const minutes = Number.isFinite(minutesRaw) ? Math.max(10, Math.min(24 * 60, Math.floor(minutesRaw))) : 60;
  const threshold = minutesAgo(minutes);

  // Abandoned criteria:
  // - older than threshold
  // - no estimate_low/high
  // - no abandoned_followup_sent_at marker
  const rows = (await db.execute(sql`
    select
      q.id,
      q.tenant_id,
      t.slug as tenant_slug,
      coalesce(ts.business_name, t.name) as business_name,
      q.input,
      q.output
    from quote_logs q
    join tenants t on t.id = q.tenant_id
    left join tenant_settings ts on ts.tenant_id = q.tenant_id
    where
      q.created_at < ${threshold}::timestamptz
      and coalesce((q.output->>'estimate_low')::int, null) is null
      and coalesce((q.output->>'estimate_high')::int, null) is null
      and coalesce((q.output->>'abandoned_followup_sent_at')::text, '') = ''
    order by q.created_at asc
    limit 50
  `)) as any;

  const list: any[] = Array.isArray((rows as any)?.rows) ? (rows as any).rows : (Array.isArray(rows) ? rows : []);
  let emailed = 0;
  let skipped = 0;
  const details: any[] = [];

  for (const r of list) {
    const quoteLogId = String(r.id);
    const tenantId = String(r.tenant_id);
    const tenantSlug = String(r.tenant_slug ?? "");
    const businessName = String(r.business_name ?? "");

    const input = r.input ?? {};
    const customer = input.customer ?? input.contact ?? {};
    const customerName = String(customer.name ?? "").trim();
    const customerEmail = String(customer.email ?? "").trim().toLowerCase();
    const customerPhone = String(customer.phone ?? "").trim();

    if (!customerName || !customerEmail) {
      skipped++;
      details.push({ quoteLogId, action: "skip", reason: "missing_customer" });
      continue;
    }

    const sendRes = await sendAbandonedFollowup({
      tenantId,
      tenantSlug,
      businessName,
      quoteLogId,
      customerName,
      customerEmail,
      customerPhone,
    });

    if (sendRes.ok) {
      emailed++;

      // mark sent in output jsonb (minimal DB change)
      await db.execute(sql`
        update quote_logs
        set output = jsonb_set(
          coalesce(output, '{}'::jsonb),
          '{abandoned_followup_sent_at}',
          to_jsonb(now()::text),
          true
        )
        where id = ${quoteLogId}::uuid
      `);

      details.push({ quoteLogId, action: "emailed", sendRes });
    } else {
      details.push({ quoteLogId, action: "failed", sendRes });
    }
  }

  return {
    ok: true,
    thresholdIso: threshold.toISOString(),
    minutes,
    scanned: list.length,
    emailed,
    skipped,
    details,
  };
}

export async function GET(req: Request) {
  if (!authOk(req)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const out = await runScan();
  return json(out, 200);
}

export async function POST(req: Request) {
  return GET(req);
}