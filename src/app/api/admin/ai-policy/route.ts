// src/app/api/admin/ai-policy/route.ts

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

// DB stores pricing_model as TEXT (we treat it as optional)
const PricingModel = z.enum([
  "flat_per_job",
  "hourly_plus_materials",
  "per_unit",
  "packages",
  "line_items",
  "inspection_only",
  "assessment_fee",
]);

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

  // IMPORTANT: pricing_model is NOT managed by this endpoint yet (onboarding owns it)
  // so we do NOT accept it here to avoid accidental overwrites.
});

async function getRow(tenantId: string) {
  const r = await db.execute(sql`
    select
      ai_mode,
      pricing_enabled,
      pricing_model,
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

function normalizePricingModel(v: any): z.infer<typeof PricingModel> | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const parsed = PricingModel.safeParse(s);
  return parsed.success ? parsed.data : null;
}

function normalizeAiMode(v: any): z.infer<typeof AiMode> {
  const s = String(v ?? "").trim();
  const parsed = AiMode.safeParse(s);
  return parsed.success ? parsed.data : "assessment_only";
}

/**
 * ✅ Server-side truth:
 * If pricing is disabled, force ai_mode to assessment_only.
 */
function enforcePricingRule(ai_mode: z.infer<typeof AiMode>, pricing_enabled: boolean): z.infer<typeof AiMode> {
  return pricing_enabled ? ai_mode : "assessment_only";
}

function normalizeRow(row: any) {
  const pricing_enabled = !!(row?.pricing_enabled ?? false);

  const ai_mode_raw = normalizeAiMode(row?.ai_mode ?? "assessment_only");
  const ai_mode = enforcePricingRule(ai_mode_raw, pricing_enabled);

  // ✅ onboarding-saved field
  const pricing_model = normalizePricingModel(row?.pricing_model);

  const rendering_enabled = !!(row?.rendering_enabled ?? false);

  const rendering_style_raw = String(row?.rendering_style ?? "photoreal").trim();
  const rendering_style =
    rendering_style_raw === "photoreal" || rendering_style_raw === "clean_oem" || rendering_style_raw === "custom"
      ? rendering_style_raw
      : "photoreal";

  const rendering_notes = String(row?.rendering_notes ?? "");
  const rendering_max_per_day = clampInt(row?.rendering_max_per_day, 20, 0, 1000);
  const rendering_customer_opt_in_required = !!(row?.rendering_customer_opt_in_required ?? true);

  // Live Q&A
  const live_qa_enabled = !!(row?.live_qa_enabled ?? false);
  const live_qa_max_questions = clampInt(row?.live_qa_max_questions, 3, 1, 10);

  return {
    ai_mode,
    pricing_enabled,
    pricing_model, // ✅ now visible to admin UI

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
    const incoming = parsed.data;

    // ✅ enforce rule on write
    const pricing_enabled = Boolean(incoming.pricing_enabled);
    const ai_mode = enforcePricingRule(incoming.ai_mode, pricing_enabled);

    const upd = await db.execute(sql`
      update tenant_settings
      set
        ai_mode = ${ai_mode},
        pricing_enabled = ${pricing_enabled},

        rendering_enabled = ${incoming.rendering_enabled},
        rendering_style = ${incoming.rendering_style},
        rendering_notes = ${incoming.rendering_notes ?? ""},
        rendering_max_per_day = ${clampInt(incoming.rendering_max_per_day, 20, 0, 1000)},
        rendering_customer_opt_in_required = ${incoming.rendering_customer_opt_in_required},

        live_qa_enabled = ${Boolean(incoming.live_qa_enabled)},
        live_qa_max_questions = ${clampInt(incoming.live_qa_max_questions, 3, 1, 10)},

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
          (gen_random_uuid(), ${gate.tenantId}::uuid, 'auto', ${ai_mode}, ${pricing_enabled},
           ${incoming.rendering_enabled}, ${incoming.rendering_style}, ${incoming.rendering_notes ?? ""}, ${clampInt(
             incoming.rendering_max_per_day,
             20,
             0,
             1000
           )}, ${incoming.rendering_customer_opt_in_required},
           ${Boolean(incoming.live_qa_enabled)}, ${clampInt(incoming.live_qa_max_questions, 3, 1, 10)},
           now())
      `);
    }

    const row = await getRow(gate.tenantId);
    const normalized = normalizeRow(row ?? { ...incoming, ai_mode, pricing_enabled });

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