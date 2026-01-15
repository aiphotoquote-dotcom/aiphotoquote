import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

async function columnExists(tableName: string, columnName: string) {
  const r = await db.execute(sql`
    select 1 as ok
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${tableName}
      and column_name = ${columnName}
    limit 1
  `);
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return !!row;
}

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const tenantId = gate.tenantId;

  // --- Step: OpenAI key present? ---
  const secretR = await db.execute(sql`
    select openai_key_enc
    from tenant_secrets
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const secretRow: any =
    (secretR as any)?.rows?.[0] ?? (Array.isArray(secretR) ? (secretR as any)[0] : null);

  const openaiConfigured = !!(secretRow?.openai_key_enc && String(secretRow.openai_key_enc).trim().length > 0);

  // --- Step: Email settings present? ---
  const emailR = await db.execute(sql`
    select business_name, lead_to_email, resend_from_email
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);
  const emailRow: any =
    (emailR as any)?.rows?.[0] ?? (Array.isArray(emailR) ? (emailR as any)[0] : null);

  const businessNameOk = (emailRow?.business_name ?? "").trim().length > 0;
  const leadToOk = (emailRow?.lead_to_email ?? "").trim().length > 0;
  const fromOk = (emailRow?.resend_from_email ?? "").trim().length > 0;

  const emailConfigured = businessNameOk && leadToOk && fromOk;

  // --- Step: AI policy present? (optional columns; we detect safely) ---
  const aiModeExists = await columnExists("tenant_settings", "ai_mode");
  const pricingEnabledExists = await columnExists("tenant_settings", "pricing_enabled");

  let aiPolicyConfigured = false;

  if (aiModeExists || pricingEnabledExists) {
    const cols = [
      aiModeExists ? sql`ai_mode` : sql`null as ai_mode`,
      pricingEnabledExists ? sql`pricing_enabled` : sql`null as pricing_enabled`,
    ];

    const aiR = await db.execute(sql`
      select ${sql.join(cols, sql`, `)}
      from tenant_settings
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const aiRow: any =
      (aiR as any)?.rows?.[0] ?? (Array.isArray(aiR) ? (aiR as any)[0] : null);

    const aiMode = (aiRow?.ai_mode ?? "").toString().trim(); // e.g. assessment_only|range|fixed
    const pricingEnabled = aiRow?.pricing_enabled;

    // Minimal: require ai_mode set to something non-empty.
    // pricing_enabled can be null/false; still okay if ai_mode is chosen.
    aiPolicyConfigured = aiMode.length > 0 || pricingEnabled === true || pricingEnabled === false;
  } else {
    // Not implemented yet, so not configured.
    aiPolicyConfigured = false;
  }

  // --- Step: Widget configured? (redirect_url / thank_you_url often used; detect safely) ---
  const redirectExists = await columnExists("tenant_settings", "redirect_url");
  const thankYouExists = await columnExists("tenant_settings", "thank_you_url");

  let widgetConfigured = false;

  if (redirectExists || thankYouExists) {
    const cols = [
      redirectExists ? sql`redirect_url` : sql`null as redirect_url`,
      thankYouExists ? sql`thank_you_url` : sql`null as thank_you_url`,
    ];

    const wR = await db.execute(sql`
      select ${sql.join(cols, sql`, `)}
      from tenant_settings
      where tenant_id = ${tenantId}::uuid
      limit 1
    `);

    const wRow: any =
      (wR as any)?.rows?.[0] ?? (Array.isArray(wR) ? (wR as any)[0] : null);

    const redirectUrl = (wRow?.redirect_url ?? "").toString().trim();
    const thankYouUrl = (wRow?.thank_you_url ?? "").toString().trim();

    // Consider configured if at least redirect exists (thankyou optional)
    widgetConfigured = redirectUrl.length > 0;
  } else {
    widgetConfigured = false;
  }

  // --- Step: Test quote exists? (any quote log for this tenant) ---
  const qR = await db.execute(sql`
    select id, created_at
    from quote_logs
    where tenant_id = ${tenantId}::uuid
    order by created_at desc
    limit 1
  `);
  const qRow: any =
    (qR as any)?.rows?.[0] ?? (Array.isArray(qR) ? (qR as any)[0] : null);

  const testQuoteDone = !!qRow?.id;

  // Steps ordering + next step
  const steps = [
    {
      key: "openai_key",
      title: "Add OpenAI API key",
      complete: openaiConfigured,
      description: "Required to generate AI assessments.",
      href: "/admin/setup/openai",
    },
    {
      key: "email",
      title: "Configure email routing",
      complete: emailConfigured,
      description: "Business name, lead inbox, and Resend From address.",
      href: "/admin/settings",
    },
    {
      key: "ai_policy",
      title: "Choose AI & pricing policy",
      complete: aiPolicyConfigured,
      description: "Assessment-only vs estimate ranges (tenant-controlled).",
      href: "/admin/setup/ai-policy",
    },
    {
      key: "widget",
      title: "Install widget & set redirects",
      complete: widgetConfigured,
      description: "Embed snippet and redirect URL for your site.",
      href: "/admin/setup/widget",
    },
    {
      key: "test",
      title: "Run a test quote",
      complete: testQuoteDone,
      description: "Make sure AI + email + logging work end-to-end.",
      href: "/quote",
    },
  ];

  const completedCount = steps.filter((s) => s.complete).length;
  const totalCount = steps.length;
  const next = steps.find((s) => !s.complete) ?? null;

  return json({
    ok: true,
    tenantId,
    role: gate.role,
    progress: {
      completedCount,
      totalCount,
      pct: totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100),
    },
    steps,
    nextStep: next,
    latestQuoteLogId: qRow?.id ?? null,
  });
}
