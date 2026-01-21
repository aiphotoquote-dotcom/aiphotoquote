// src/app/api/admin/dashboard/recent/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getTenantIdFromCookies(jar: any) {
  return (
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null
  );
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

  const name =
    c?.name ??
    input?.name ??
    input?.customer_name ??
    input?.customerName ??
    null;

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

export async function GET() {
  try {
    const jar = await cookies();
    const tenantId = getTenantIdFromCookies(jar);
    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "NO_ACTIVE_TENANT", message: "No active tenant selected." },
        { status: 400 }
      );
    }

    const rows = await db
      .select({
        id: quoteLogs.id,
        createdAt: quoteLogs.createdAt,
        stage: quoteLogs.stage,
        isRead: quoteLogs.isRead,
        input: quoteLogs.input,
      })
      .from(quoteLogs)
      .where(eq(quoteLogs.tenantId, tenantId))
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

    return NextResponse.json({ ok: true, leads });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}