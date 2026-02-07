// src/app/api/pcc/tenants/[tenantId]/delete/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { requirePlatformRole } from "@/lib/rbac/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  confirm: z.string().min(3),
});

function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

async function countWhere(table: string, tenantId: string, column: string = "tenant_id"): Promise<number> {
  // table/column are controlled constants below (not user input)
  const q = sql.raw(`SELECT count(*)::int AS c FROM ${table} WHERE ${column} = $1::uuid`);
  const r = await db.execute(sql`${q}`.bind(sql, tenantId as any) as any).catch(() => null);
  const rr = r ? rows(r) : [];
  const c = rr?.[0]?.c;
  return typeof c === "number" ? c : Number(c ?? 0);
}

async function tenantExists(tenantId: string) {
  const r = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(sql`${tenants.id} = ${tenantId}::uuid`)
    .limit(1)
    .then((x) => x?.[0] ?? null);

  return r;
}

export async function GET(_: Request, ctx: { params: Promise<{ tenantId: string }> | { tenantId: string } }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const p = await ctx.params;
  const tenantId = String((p as any)?.tenantId ?? "").trim();
  if (!tenantId) return NextResponse.json({ ok: false, error: "MISSING_TENANT_ID" }, { status: 400 });

  const t = await tenantExists(tenantId);
  if (!t) return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });

  // Preview counts (tables we know about from your schema + expected core tables)
  // NOTE: Some tables may not exist in all envs; we harden by treating failures as 0.
  const counts: Array<{ key: string; label: string; table: string; col?: string }> = [
    { key: "tenant_members", label: "Tenant members", table: "tenant_members" },
    { key: "tenant_settings", label: "Tenant settings", table: "tenant_settings" },
    { key: "tenant_secrets", label: "Tenant secrets", table: "tenant_secrets" },
    { key: "tenant_pricing_rules", label: "Pricing rules", table: "tenant_pricing_rules" },
    { key: "tenant_sub_industries", label: "Sub-industries", table: "tenant_sub_industries" },
    { key: "tenant_email_identities", label: "Email identities", table: "tenant_email_identities" },

    // PCC schema tables (no FK in drizzle definitions)
    { key: "tenant_plans", label: "Tenant plan", table: "tenant_plans" },
    { key: "tenant_usage_monthly", label: "Tenant usage (monthly)", table: "tenant_usage_monthly" },

    // Audit events (nullable tenant_id)
    { key: "audit_events", label: "Audit events", table: "audit_events" },

    // Core lead data (exists in your app; we delete explicitly even if FK is cascade)
    { key: "quote_logs", label: "Quote logs (leads)", table: "quote_logs" },
  ];

  const out = [];
  const notes: string[] = [
    "This operation deletes DB records. External objects (e.g. uploaded images in Blob) are not automatically purged unless you add a storage cleanup step.",
  ];

  for (const c of counts) {
    try {
      const col = c.col ?? "tenant_id";
      const n = await countWhere(c.table, tenantId, col);
      out.push({ key: c.key, label: c.label, count: n });
    } catch {
      out.push({ key: c.key, label: c.label, count: 0 });
    }
  }

  return NextResponse.json({
    ok: true,
    tenant: { id: String(t.id), name: String(t.name), slug: String(t.slug ?? "") || null },
    counts: out,
    notes,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> | { tenantId: string } }) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const p = await ctx.params;
  const tenantId = String((p as any)?.tenantId ?? "").trim();
  if (!tenantId) return NextResponse.json({ ok: false, error: "MISSING_TENANT_ID" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues }, { status: 400 });
  }

  const t = await tenantExists(tenantId);
  if (!t) return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });

  const slug = String(t.slug ?? "");
  const required = `DELETE ${slug}`;
  if (parsed.data.confirm.trim() !== required) {
    return NextResponse.json(
      { ok: false, error: "CONFIRM_MISMATCH", message: `Confirmation must match exactly: "${required}"` },
      { status: 400 }
    );
  }

  // ✅ Transactional delete: remove non-cascade / non-FK tables first, then tenant
  await db.transaction(async (tx) => {
    // PCC/no-FK tables
    await tx.execute(sql`DELETE FROM tenant_usage_monthly WHERE tenant_id = ${tenantId}::uuid`).catch(() => null);
    await tx.execute(sql`DELETE FROM tenant_plans WHERE tenant_id = ${tenantId}::uuid`).catch(() => null);

    // Audit
    await tx.execute(sql`DELETE FROM audit_events WHERE tenant_id = ${tenantId}::uuid`).catch(() => null);

    // Core lead table
    await tx.execute(sql`DELETE FROM quote_logs WHERE tenant_id = ${tenantId}::uuid`).catch(() => null);

    // App tenant tables (some may already cascade, but we do explicit deletes safely)
    await tx.execute(sql`DELETE FROM tenant_email_identities WHERE tenant_id = ${tenantId}::uuid`).catch(() => null);
    await tx.execute(sql`DELETE FROM tenant_sub_industries WHERE tenant_id = ${tenantId}::uuid`).catch(() => null);
    await tx.execute(sql`DELETE FROM tenant_pricing_rules WHERE tenant_id = ${tenantId}::uuid`).catch(() => null);
    await tx.execute(sql`DELETE FROM tenant_secrets WHERE tenant_id = ${tenantId}::uuid`).catch(() => null);
    await tx.execute(sql`DELETE FROM tenant_settings WHERE tenant_id = ${tenantId}::uuid`).catch(() => null);
    await tx.execute(sql`DELETE FROM tenant_members WHERE tenant_id = ${tenantId}::uuid`).catch(() => null);

    // Finally, tenant row
    await tx.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
  });

  return NextResponse.json({ ok: true });
}