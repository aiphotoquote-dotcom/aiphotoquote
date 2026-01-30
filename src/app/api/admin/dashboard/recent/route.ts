import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "drizzle-orm";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";
import { readActiveTenantIdFromCookies } from "@/lib/tenant/activeTenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TenantRole = "owner" | "admin" | "member";

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

function firstRow(r: any): any | null {
  return (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
}

async function getTenantRole(userId: string, tenantId: string): Promise<TenantRole | null> {
  const r = await db.execute(sql`
    SELECT role
    FROM tenant_members
    WHERE tenant_id = ${tenantId}::uuid
      AND clerk_user_id = ${userId}
      AND (status IS NULL OR status = 'active')
    LIMIT 1
  `);

  const row = firstRow(r);
  const role = String(row?.role ?? "").trim();
  if (role === "owner" || role === "admin" || role === "member") return role;
  return null;
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

export async function GET() {
  const { userId } = await auth();
  if (!userId) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);

  const tenantId = await readActiveTenantIdFromCookies();
  if (!tenantId) return json({ ok: false, error: "NO_ACTIVE_TENANT", message: "Select a tenant first." }, 400);

  const role = await getTenantRole(userId, tenantId);
  if (!role) return json({ ok: false, error: "FORBIDDEN", message: "No tenant access found for this user.", tenantId }, 403);

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

    return json({ ok: true, leads });
  } catch (e: any) {
    return json({ ok: false, error: "INTERNAL", message: e?.message ?? String(e) }, 500);
  }
}