import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function normalizeStage(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "new";
  if (s === "quoted" || s === "quote") return "quoted";
  if (s === "read") return "read";
  if (s === "new") return "new";
  if (s === "estimate" || s === "estimated") return "estimate";
  return s;
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

  const email =
    c?.email ??
    input?.email ??
    input?.customer_email ??
    input?.customerEmail ??
    input?.customer_context?.email ??
    null;

  const phoneDigits = phone ? digitsOnly(String(phone)) : "";

  return {
    name: String(name || "New customer"),
    phone: phoneDigits ? formatUSPhone(phoneDigits) : "",
    email: email ? String(email) : "",
  };
}

function getTenantIdFromCookies(jar: ReadonlyRequestCookies) {
  return (
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value ||
    null
  );
}

export async function GET(req: Request) {
  try {
    // Auth hard-stop (admin API)
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(25, Number(url.searchParams.get("limit") || 8)));

    // IMPORTANT: `await cookies()` is safe whether Next types it sync or async
    const jar = await cookies();
    const tenantId = getTenantIdFromCookies(jar);

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "NO_ACTIVE_TENANT", message: "Select a tenant first." },
        { status: 400 }
      );
    }

    const rows = await db
      .select({
        id: quoteLogs.id,
        createdAt: quoteLogs.createdAt,
        input: quoteLogs.input,
        stage: quoteLogs.stage,
        isRead: quoteLogs.isRead,
      })
      .from(quoteLogs)
      .where(eq(quoteLogs.tenantId, tenantId))
      .orderBy(desc(quoteLogs.createdAt))
      .limit(limit);

    const leads = rows.map((r) => {
      const lead = pickLead(r.input);
      const stage = normalizeStage(r.stage);

      return {
        id: r.id,
        createdAt: r.createdAt,
        stage,
        isRead: Boolean(r.isRead),
        customerName: lead.name,
        customerPhone: lead.phone,
        customerEmail: lead.email,
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