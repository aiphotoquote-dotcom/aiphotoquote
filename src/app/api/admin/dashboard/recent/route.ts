// src/app/api/admin/dashboard/recent/route.ts
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

function digitsOnly(s: string) {
  return (s || "").replace(/\D/g, "");
}
function formatUSPhone(raw: string) {
  const d = digitsOnly(raw).slice(0, 10);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (!d) return "";
  if (d.length <= 3) return a ? `(${a}` : "";
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function pickLead(input: any) {
  const c = input?.customer ?? input?.contact ?? input ?? null;

  const name = c?.name ?? input?.name ?? input?.customer_name ?? input?.customerName ?? null;

  const phone =
    c?.phone ??
    c?.phoneNumber ??
    input?.phone ??
    input?.customer_phone ??
    input?.customerPhone ??
    input?.customer_context?.phone ??
    null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";
  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : null,
  };
}

/**
 * Recent leads for active tenant (RBAC via requireTenantRole).
 */
export async function GET() {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error, message: gate.message }, gate.status);

  try {
    const rows = await db
      .select({
        id: quoteLogs.id,
        createdAt: quoteLogs.createdAt,
        stage: quoteLogs.stage,
        isRead: quoteLogs.isRead,
        input: quoteLogs.input,
      })
      .from(quoteLogs)
      .where(eq(quoteLogs.tenantId, gate.tenantId as any))
      .orderBy(desc(quoteLogs.createdAt))
      .limit(12);

    const leads = rows.map((r) => {
      const lead = pickLead(r.input);
      return {
        id: r.id,
        submittedAt: r.createdAt,
        stage: r.stage,
        isRead: r.isRead,
        customerName: lead.name,
        customerPhone: lead.phone,
      };
    });

    return json({ ok: true, leads });
  } catch (e: any) {
    return json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, 500);
  }
}