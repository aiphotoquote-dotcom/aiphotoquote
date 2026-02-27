// src/app/api/admin/quotes/[id]/notes/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import OpenAI from "openai";
import crypto from "crypto";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { decryptSecret } from "@/lib/crypto";

import { resolveTenantLlm } from "@/lib/pcc/llm/resolveTenant";
import { getPlatformLlm } from "@/lib/pcc/llm/apply";
import { composeEstimatorPrompt } from "@/lib/pcc/llm/composePrompts";

import { computeEstimate } from "@/lib/pricing/computeEstimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  reassess: z.boolean().optional().default(false),
  engine: z.enum(["openai_assessment", "deterministic_only"]).optional().default("openai_assessment"),
  // if true, we link THIS new note to the created version (recommended)
  linkNoteToVersion: z.boolean().optional().default(true),
  // how many notes to include as context when re-running
  contextNotesLimit: z.number().int().min(1).max(200).optional().default(50),
});

type KeySource = "tenant" | "platform_grace" | null;

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
    jar.get("apq_activeTenantId")?.value,
    jar.get("apq_active_tenant_id")?.value,
    jar.get("__Host-activeTenantId")?.value,
    jar.get("__Host-active_tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

function sha256Hex(s: string) {
  const v = String(s ?? "");
  return crypto.createHash("sha256").update(v).digest("hex");
}

/* --------------------- image inlining for OpenAI vision --------------------- */
const OPENAI_VISION_MAX_IMAGES = 6;
const IMAGE_FETCH_TIMEOUT_MS = 12_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

function guessContentType(url: string): string {
  const u = url.toLowerCase();
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".gif")) return "image/gif";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function toBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64");
}

async function fetchAsDataUrl(url: string) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", signal: controller.signal });
    if (!res.ok) throw new Error(`IMAGE_FETCH_FAILED: HTTP ${res.status}`);

    const ct = (res.headers.get("content-type") || "").split(";")[0].trim();
    const contentType = ct || guessContentType(url);

    const ab = await res.arrayBuffer();
    if (ab.byteLength > IMAGE_MAX_BYTES) throw new Error(`IMAGE_TOO_LARGE: ${ab.byteLength} bytes`);

    const b64 = toBase64(ab);
    return `data:${contentType};base64,${b64}`;
  } finally {
    clearTimeout(t);
  }
}

async function buildOpenAiVisionContent(images: Array<{ url: string; shotType?: string }>) {
  const picked = (images || []).filter((x) => x?.url).slice(0, OPENAI_VISION_MAX_IMAGES);

  const content: any[] = [];
  for (const img of picked) {
    const u = String(img.url);
    try {
      const dataUrl = await fetchAsDataUrl(u);
      content.push({ type: "image_url", image_url: { url: dataUrl } });
    } catch {
      // fallback to direct URL if inline fails
      content.push({ type: "image_url", image_url: { url: u } });
    }
  }
  return content;
}

/* --------------------- output coercion --------------------- */
function coerceToNumber(v: any): number {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function coerceStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

function coerceAiCandidate(candidate: any) {
  if (!candidate || typeof candidate !== "object") return candidate;

  return {
    confidence: String(candidate.confidence ?? "").trim() || "low",
    inspection_required: Boolean(candidate.inspection_required),
    estimate_low: coerceToNumber(candidate.estimate_low),
    estimate_high: coerceToNumber(candidate.estimate_high),
    currency: String(candidate.currency ?? "USD"),
    summary: String(candidate.summary ?? ""),
    visible_scope: coerceStringArray(candidate.visible_scope),
    assumptions: coerceStringArray(candidate.assumptions),
    questions: coerceStringArray(candidate.questions),
  };
}

function clampMoney(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function ensureLowHigh(low: number, high: number) {
  const a = clampMoney(low);
  const b = clampMoney(high);
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

function applyAiModeToEstimates(policy: any, estimates: { estimate_low: number; estimate_high: number }) {
  const pricing_enabled = Boolean(policy?.pricing_enabled);
  const ai_mode = safeTrim(policy?.ai_mode) || "assessment_only";

  if (!pricing_enabled || ai_mode === "assessment_only") return { estimate_low: 0, estimate_high: 0 };

  const { low, high } = ensureLowHigh(estimates.estimate_low, estimates.estimate_high);

  if (ai_mode === "fixed") return { estimate_low: low, estimate_high: low };
  return { estimate_low: low, estimate_high: high };
}

/* --------------------- OpenAI client resolution --------------------- */
function platformOpenAiKey(): string | null {
  const k = process.env.OPENAI_API_KEY?.trim() || "";
  return k ? k : null;
}

async function loadTenantOpenAiKeyEnc(tenantId: string): Promise<string | null> {
  const r = await db.execute(sql`
    select openai_key_enc::text as "openai_key_enc"
    from tenant_secrets
    where tenant_id = ${tenantId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const enc = safeTrim(row?.openai_key_enc);
  return enc ? enc : null;
}

/**
 * For admin reassess:
 * - If llmKeySource snapshot exists, honor it
 * - Otherwise prefer tenant key, else platform key
 * - We do NOT consume grace credits here (admin action)
 */
async function resolveOpenAiClientForAdmin(args: { tenantId: string; forceKeySource: KeySource }) {
  const { tenantId, forceKeySource } = args;

  const enc = await loadTenantOpenAiKeyEnc(tenantId);
  const hasTenant = Boolean(enc);

  if (forceKeySource === "tenant") {
    if (!hasTenant) throw new Error("MISSING_OPENAI_KEY");
    return new OpenAI({ apiKey: decryptSecret(enc!) });
  }

  if (forceKeySource === "platform_grace") {
    const pk = platformOpenAiKey();
    if (!pk) throw new Error("MISSING_PLATFORM_OPENAI_KEY");
    return new OpenAI({ apiKey: pk });
  }

  // no force -> prefer tenant, else platform
  if (hasTenant) return new OpenAI({ apiKey: decryptSecret(enc!) });

  const pk = platformOpenAiKey();
  if (!pk) throw new Error("MISSING_PLATFORM_OPENAI_KEY");
  return new OpenAI({ apiKey: pk });
}

/* --------------------- model call --------------------- */
async function generateEstimateWithNotes(args: {
  openai: OpenAI;
  model: string;
  system: string;
  images: Array<{ url: string; shotType?: string }>;
  category: string;
  service_type: string;
  notes: string;
}) {
  const { openai, model, system, images, category, service_type, notes } = args;

  const userText = [
    `Category: ${category}`,
    `Service type: ${service_type}`,
    `Notes: ${notes || "(none)"}`,
    "",
    "Instructions:",
    "- Use the photos to identify the item, material type, and visible damage/wear.",
    "- Provide estimate_low and estimate_high (whole dollars).",
    "- Provide visible_scope as short bullet-style strings.",
    "- Provide assumptions and questions (3–8 items each is fine).",
  ].join("\n");

  const content: any[] = [{ type: "text", text: userText }];
  const vision = await buildOpenAiVisionContent(images);
  content.push(...vision);

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "quote_estimate",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            inspection_required: { type: "boolean" },
            estimate_low: { type: "number" },
            estimate_high: { type: "number" },
            currency: { type: "string" },
            summary: { type: "string" },
            visible_scope: { type: "array", items: { type: "string" } },
            assumptions: { type: "array", items: { type: "string" } },
            questions: { type: "array", items: { type: "string" } },
          },
          required: [
            "confidence",
            "inspection_required",
            "estimate_low",
            "estimate_high",
            "summary",
            "visible_scope",
            "assumptions",
            "questions",
          ],
        },
      },
    } as any,
  });

  const raw = completion.choices?.[0]?.message?.content ?? "{}";

  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const candidate0 =
    parsed &&
    typeof parsed === "object" &&
    parsed.properties &&
    typeof parsed.properties === "object"
      ? parsed.properties
      : parsed;

  const candidate = coerceAiCandidate(candidate0);

  // extremely defensive fallback
  const { low, high } = ensureLowHigh(Number(candidate?.estimate_low ?? 0), Number(candidate?.estimate_high ?? 0));

  return {
    confidence: (String(candidate?.confidence ?? "low") as any) || "low",
    inspection_required: Boolean(candidate?.inspection_required ?? true),
    estimate_low: low,
    estimate_high: high,
    currency: String(candidate?.currency ?? "USD") || "USD",
    summary: String(candidate?.summary ?? "").trim(),
    visible_scope: Array.isArray(candidate?.visible_scope) ? candidate.visible_scope : [],
    assumptions: Array.isArray(candidate?.assumptions) ? candidate.assumptions : [],
    questions: Array.isArray(candidate?.questions) ? candidate.questions : [],
    _raw: raw,
  };
}

/* --------------------- quote version writer (raw SQL) --------------------- */
async function createNextQuoteVersion(args: {
  tenantId: string;
  quoteLogId: string;
  createdBy: string;
  engine: "openai_assessment" | "deterministic_only";
  policy: any;
  output: any;
  meta: any;
}) {
  const { tenantId, quoteLogId, createdBy, engine, policy, output, meta } = args;

  // next version number
  const vr = await db.execute(sql`
    select coalesce(max(version), 0)::int as "maxv"
    from quote_versions
    where tenant_id = ${tenantId}::uuid
      and quote_log_id = ${quoteLogId}::uuid
  `);
  const maxv = Number((vr as any)?.rows?.[0]?.maxv ?? 0);
  const nextV = maxv + 1;

  const ai_mode = safeTrim(policy?.ai_mode) || "assessment_only";

  const inserted = await db.execute(sql`
    insert into quote_versions (
      tenant_id,
      quote_log_id,
      version,
      ai_mode,
      source,
      created_by,
      reason,
      output,
      meta,
      created_at
    )
    values (
      ${tenantId}::uuid,
      ${quoteLogId}::uuid,
      ${nextV}::int,
      ${ai_mode},
      'tenant',
      ${createdBy},
      'reassess_from_notes',
      ${JSON.stringify(output)}::jsonb,
      ${JSON.stringify(meta ?? {})}::jsonb,
      now()
    )
    returning id::text as "id", version::int as "version"
  `);

  const row: any = (inserted as any)?.rows?.[0] ?? (Array.isArray(inserted) ? (inserted as any)[0] : null);
  if (!row?.id) throw new Error("FAILED_TO_CREATE_VERSION");

  return { versionId: String(row.id), version: Number(row.version ?? nextV) };
}

/* --------------------- handler --------------------- */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });

  const p = await ctx.params;
  const quoteLogId = safeTrim((p as any)?.id);
  if (!quoteLogId) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

  const bodyJson = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues }, { status: 400 });
  }

  const { body, reassess, engine, linkNoteToVersion, contextNotesLimit } = parsed.data;

  // Load quote log + tenant
  const qr = await db.execute(sql`
    select
      id::text as "id",
      tenant_id::text as "tenant_id",
      input as "input",
      qa as "qa",
      output as "output"
    from quote_logs
    where id = ${quoteLogId}::uuid
    limit 1
  `);
  const qrow: any = (qr as any)?.rows?.[0] ?? (Array.isArray(qr) ? (qr as any)[0] : null);
  if (!qrow?.id || !qrow?.tenant_id) {
    return NextResponse.json({ ok: false, error: "QUOTE_NOT_FOUND" }, { status: 404 });
  }

  const tenantId = String(qrow.tenant_id);

  // Membership check: must be active member of this tenant
  const mr = await db.execute(sql`
    select 1 as ok
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${userId}
      and status = 'active'
    limit 1
  `);
  const mok = Boolean((mr as any)?.rows?.[0]?.ok);
  if (!mok) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  // Insert note (unlinked for now)
  const nr = await db.execute(sql`
    insert into quote_notes (
      quote_log_id,
      tenant_id,
      body,
      created_by,
      created_at
    )
    values (
      ${quoteLogId}::uuid,
      ${tenantId}::uuid,
      ${body},
      ${userId},
      now()
    )
    returning id::text as "id", created_at as "created_at"
  `);
  const nrow: any = (nr as any)?.rows?.[0] ?? (Array.isArray(nr) ? (nr as any)[0] : null);
  const noteId = String(nrow?.id ?? "");
  if (!noteId) return NextResponse.json({ ok: false, error: "FAILED_TO_CREATE_NOTE" }, { status: 500 });

  // Fast path: note only
  if (!reassess) {
    return NextResponse.json({ ok: true, noteId, reassessed: false });
  }

  // Pull context notes (latest first)
  const cnr = await db.execute(sql`
    select
      id::text as "id",
      created_at as "created_at",
      created_by::text as "created_by",
      body::text as "body"
    from quote_notes
    where quote_log_id = ${quoteLogId}::uuid
      and tenant_id = ${tenantId}::uuid
    order by created_at desc
    limit ${contextNotesLimit}::int
  `);
  const noteRows: any[] = (cnr as any)?.rows ?? (Array.isArray(cnr) ? (cnr as any) : []);

  const inputAny: any = qrow.input ?? {};
  const qaAny: any = qrow.qa ?? {};
  const outputAny: any = qrow.output ?? {};

  const customerNotes = safeTrim(inputAny?.customer_context?.notes);
  const category = safeTrim(inputAny?.customer_context?.category) || safeTrim(inputAny?.industryKeySnapshot) || "service";
  const service_type = safeTrim(inputAny?.customer_context?.service_type) || "upholstery";
  const images = Array.isArray(inputAny?.images) ? inputAny.images : [];

  const pricing_policy_snapshot = (inputAny?.pricing_policy_snapshot && typeof inputAny.pricing_policy_snapshot === "object")
    ? inputAny.pricing_policy_snapshot
    : { ai_mode: "assessment_only", pricing_enabled: false, pricing_model: null };

  const pricing_config_snapshot = inputAny?.pricing_config_snapshot ?? null;
  const pricing_rules_snapshot = inputAny?.pricing_rules_snapshot ?? null;

  const llmKeySourceRaw = safeTrim(inputAny?.llmKeySource);
  const forceKeySource: KeySource =
    llmKeySourceRaw === "tenant" ? "tenant" : llmKeySourceRaw === "platform_grace" ? "platform_grace" : null;

  // Build notes context string
  const internalNotesText = noteRows
    .map((n) => {
      const by = safeTrim(n.created_by) || "tenant";
      const ts = n.created_at ? new Date(String(n.created_at)).toISOString() : "";
      const b = safeTrim(n.body);
      return `- (${ts} / ${by}) ${b}`;
    })
    .filter(Boolean)
    .join("\n");

  const combinedNotes = [
    customerNotes ? `Customer notes:\n${customerNotes}` : "Customer notes:\n(none)",
    "",
    "Shop internal notes:",
    internalNotesText || "(none)",
  ].join("\n");

  // Compose prompt with PCC composition layer (so industry/policy is respected)
  const resolvedBase = await resolveTenantLlm(tenantId);
  const platformLlm = await getPlatformLlm();

  const composedEstimator = composeEstimatorPrompt({
    platform: platformLlm,
    tenant: {
      tenantStyleKey: resolvedBase.tenant.tenantStyleKey,
      tenantRenderNotes: resolvedBase.tenant.tenantRenderNotes,
      pricingEnabled: resolvedBase.tenant.pricingEnabled,
    },
    industryKey: safeTrim(inputAny?.industryKeySnapshot) || safeTrim(resolvedBase?.tenant?.industryKey) || category,
    pricingPolicy: pricing_policy_snapshot,
  });

  const ai_snapshot = {
    version: 1,
    capturedAt: new Date().toISOString(),
    phase: "admin_reassess",
    tenant: { tenantId, quoteLogId },
    engine,
    models: { estimatorModel: resolvedBase.models.estimatorModel },
    prompts: {
      quoteEstimatorSystemSha256: sha256Hex(composedEstimator),
      quoteEstimatorSystemLen: composedEstimator.length,
    },
    guardrails: resolvedBase.guardrails ?? null,
    policy: pricing_policy_snapshot ?? null,
    keySource: forceKeySource ?? null,
    contextNotesLimit,
    noteIdsUsed: noteRows.map((x) => x.id).filter(Boolean),
  };

  // Build AI output (or stub)
  let rawOutput: any = null;

  if (engine === "deterministic_only") {
    rawOutput = {
      confidence: "low",
      inspection_required: true,
      estimate_low: 0,
      estimate_high: 0,
      currency: "USD",
      summary:
        "Deterministic-only reassess: internal notes captured. Enable OpenAI assessment engine to generate scope + estimate range.",
      visible_scope: [],
      assumptions: [],
      questions: [],
    };
  } else {
    const openai = await resolveOpenAiClientForAdmin({ tenantId, forceKeySource });

    rawOutput = await generateEstimateWithNotes({
      openai,
      model: resolvedBase.models.estimatorModel,
      system: composedEstimator,
      images,
      category,
      service_type,
      notes: combinedNotes,
    });
  }

  // Deterministic pricing engine always runs (it can clamp/force inspection, etc.)
  const computed = computeEstimate({
    ai: rawOutput,
    imagesCount: Array.isArray(images) ? images.length : 0,
    policy: pricing_policy_snapshot,
    config: pricing_config_snapshot,
    rules: pricing_rules_snapshot,
  });

  const shaped = applyAiModeToEstimates(pricing_policy_snapshot, {
    estimate_low: computed.estimate_low,
    estimate_high: computed.estimate_high,
  });

  const qaContext = {
    questions: Array.isArray(qaAny?.questions) ? qaAny.questions : [],
    answers: Array.isArray(qaAny?.answers) ? qaAny.answers : [],
  };

  const output = {
    ...rawOutput,
    inspection_required: computed.inspection_required,
    estimate_low: shaped.estimate_low,
    estimate_high: shaped.estimate_high,
    pricing_basis: computed.basis,
    qa_context: qaContext,
    ai_snapshot,
  };

  // Create next quote version row
  const { versionId, version } = await createNextQuoteVersion({
    tenantId,
    quoteLogId,
    createdBy: userId,
    engine,
    policy: pricing_policy_snapshot,
    output,
    meta: { createdFrom: "admin.notes.reassess", ai_snapshot },
  });

  // Update quote_logs.output to newest (so admin view shows latest)
  await db.execute(sql`
    update quote_logs
    set output = ${JSON.stringify(output)}::jsonb
    where id = ${quoteLogId}::uuid
      and tenant_id = ${tenantId}::uuid
  `);

  // Link note -> version (optional)
  if (linkNoteToVersion) {
    await db.execute(sql`
      update quote_notes
      set quote_version_id = ${versionId}::uuid
      where id = ${noteId}::uuid
        and tenant_id = ${tenantId}::uuid
    `);
  }

  return NextResponse.json({
    ok: true,
    noteId,
    reassessed: true,
    engine,
    versionId,
    version,
  });
}