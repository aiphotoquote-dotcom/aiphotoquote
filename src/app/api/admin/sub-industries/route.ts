// src/app/api/admin/sub-industries/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { eq, and } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { tenantSubIndustries } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* --------------------- utils --------------------- */

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizeKey(raw: unknown) {
  const s = safeTrim(raw).toLowerCase();
  if (!s) return "";
  return s
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/* --------------------- schema --------------------- */

const PostSchema = z.object({
  tenantId: z.string().uuid(),
  industryKey: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
});

/**
 * POST: Upsert a tenant sub-industry override
 * (Admin utility endpoint)
 */
export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const bodyRaw = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(bodyRaw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, { status: 400 });
  }

  const tenantId = parsed.data.tenantId;
  const industryKey = normalizeKey(parsed.data.industryKey);
  const key = normalizeKey(parsed.data.key);
  const label = safeTrim(parsed.data.label);

  if (!industryKey) {
    return NextResponse.json({ ok: false, error: "INVALID_INDUSTRY_KEY" }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ ok: false, error: "INVALID_SUB_INDUSTRY_KEY" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ ok: false, error: "MISSING_LABEL" }, { status: 400 });
  }

  // ✅ Critical: include industryKey (new required column)
  await db
    .insert(tenantSubIndustries)
    .values({
      id: crypto.randomUUID(),
      tenantId,
      industryKey,
      key,
      label,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [tenantSubIndustries.tenantId, tenantSubIndustries.industryKey, tenantSubIndustries.key],
      set: {
        label,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true, tenantId, industryKey, key, label }, { status: 200 });
}

/**
 * GET: basic list (optional convenience)
 * /api/admin/sub-industries?tenantId=...&industryKey=...
 */
export async function GET(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const u = new URL(req.url);
  const tenantId = safeTrim(u.searchParams.get("tenantId"));
  const industryKey = normalizeKey(u.searchParams.get("industryKey"));

  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "TENANT_ID_REQUIRED" }, { status: 400 });
  }
  if (!industryKey) {
    return NextResponse.json({ ok: false, error: "INDUSTRY_KEY_REQUIRED" }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(tenantSubIndustries)
    .where(and(eq(tenantSubIndustries.tenantId, tenantId), eq(tenantSubIndustries.industryKey, industryKey)));

  return NextResponse.json(
    {
      ok: true,
      tenantId,
      industryKey,
      subIndustries: rows.map((r: any) => ({
        id: String(r.id),
        key: String(r.key),
        label: String(r.label),
        updatedAt: r.updatedAt ?? null,
      })),
    },
    { status: 200 }
  );
}