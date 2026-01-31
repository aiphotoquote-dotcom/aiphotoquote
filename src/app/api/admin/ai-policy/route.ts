import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { requireTenantRole } from "@/lib/auth/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

const AiMode = z.enum(["assessment_only", "range", "fixed"]);
const RenderingStyle = z.enum(["photoreal", "clean_oem", "custom"]);

// NOTE: Live Q&A fields are OPTIONAL to avoid breaking older clients that POST without them.
const PostBody = z.object({
  ai_mode: AiMode,
  pricing_enabled: z.boolean(),

  // Rendering policy (tenant-level)
  rendering_enabled: z.boolean(),
  rendering_style: RenderingStyle,
  rendering_notes: z.string().max(2000),
  rendering_max_per_day: z.number().int().min(0).max(1000),
  rendering_customer_opt_in_required: z.boolean(),

  // Live Q&A (tenant-level)
  live_qa_enabled: z.boolean().optional().default(false),
  live_qa_max_questions: z.number().int().min(1).max(10).optional().default(3),
});

async function getRow(tenantId: string) {
  const r = await db.execute(sql`
    select
      ai_mode,
      pricing_enabled,
      rendering_enabled,
      rendering_style,
      rendering_notes,
      rendering_max_per_day,
      rendering_customer_opt_in_required,
      live_qa_enabled,
      live_qa_max_questions
    from tenant_settings
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  return row ?? null;
}

function clampInt(n: any, fallback: number, min: number, max: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function normalizeRow(row: any) {
  const ai_mode = (row?.ai_mode ?? "assessment_only").toString();
  const pricing_enabled = !!(row?.pricing_enabled ?? false);

  const rendering_enabled = !!(row?.rendering_enabled ?? false);

  const rendering_style_raw = (row?.rendering_style ?? "photoreal").toString();
  const rendering_style =
    rendering_style_raw === "photoreal" || rendering_style_raw === "clean_oem" || rendering_style_raw === "custom"
      ? rendering_style_raw
      : "photoreal";

  const rendering_notes = (row?.rendering_notes ?? "").toString();
  const rendering_max_per_day = Number.isFinite(Number(row?.rendering_max_per_day))
    ? Math.max(0, Number(row?.rendering_max_per_day))
    : 20;

  const rendering_customer_opt_in_required = !!(row?.rendering_customer_opt_in_required ?? true);

  // Live Q&A
  const live_qa_enabled = !!(row?.live_qa_enabled ?? false);
  const live_qa_max_questions = clampInt(row?.live_qa_max_questions, 3, 1, 10);

  return {
    ai_mode,
    pricing_enabled,
    rendering_enabled,
    rendering_style,
    rendering_notes,
    rendering_max_per_day,
    rendering_customer_opt_in_required,

    live_qa_enabled,
    live_qa_max_questions,
  };
}

export async function GET() {
  const gate = await requireTenantRole(["owner", "admin", "member"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const row = await getRow(gate.tenantId);
  const normalized = normalizeRow(row);

  return json({
    ok: true,
    tenantId: gate.tenantId,
    role: gate.role,
    ai_policy: normalized,
  });
}

export async function POST(req: Request) {
  const gate = await requireTenantRole(["owner", "admin"]);
  if (!gate.ok) return json({ ok: false, error: gate.error }, gate.status);

  const body = await req.json().catch(() => null);
  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  try {
    const data = parsed.data;

    const upd = await db.execute(sql`
      update tenant_settings
      set
        ai_mode = ${data.ai_mode},
        pricing_enabled = ${data.pricing_enabled},

        rendering_enabled = ${data.rendering_enabled},
        rendering_style = ${data.rendering_style},
        rendering_notes = ${data.rendering_notes},
        rendering_max_per_day = ${data.rendering_max_per_day},
        rendering_customer_opt_in_required = ${data.rendering_customer_opt_in_required},

        live_qa_enabled = ${data.live_qa_enabled},
        live_qa_max_questions = ${data.live_qa_max_questions},

        updated_at = now()
      where tenant_id = ${gate.tenantId}::uuid
      returning tenant_id
    `);

    const updatedRow: any = (upd as any)?.rows?.[0] ?? (Array.isArray(upd) ? (upd as any)[0] : null);

    if (!updatedRow?.tenant_id) {
      // If tenant_settings row doesn't exist yet, create one.
      // (industry_key can be refined later during onboarding)
      await db.execute(sql`
        insert into tenant_settings
          (id, tenant_id, industry_key, ai_mode, pricing_enabled,
           rendering_enabled, rendering_style, rendering_notes, rendering_max_per_day, rendering_customer_opt_in_required,
           live_qa_enabled, live_qa_max_questions,
           created_at)
        values
          (gen_random_uuid(), ${gate.tenantId}::uuid, 'auto', ${data.ai_mode}, ${data.pricing_enabled},
           ${data.rendering_enabled}, ${data.rendering_style}, ${data.rendering_notes}, ${data.rendering_max_per_day}, ${data.rendering_customer_opt_in_required},
           ${data.live_qa_enabled}, ${data.live_qa_max_questions},
           now())
      `);
    }

    const row = await getRow(gate.tenantId);
    const normalized = normalizeRow(row ?? parsed.data);

    return json({
      ok: true,
      tenantId: gate.tenantId,
      role: gate.role,
      ai_policy: normalized,
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "DB_WRITE_FAILED",
        message: e?.message ?? String(e),
        code: e?.code,
        detail: e?.detail,
        hint: e?.hint,
      },
      500
    );
  }
}