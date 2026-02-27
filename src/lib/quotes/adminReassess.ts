// src/lib/quotes/adminReassess.ts
import OpenAI from "openai";
import crypto from "crypto";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { decryptSecret } from "@/lib/crypto";

import { resolveTenantLlm } from "@/lib/pcc/llm/resolveTenant";
import { getPlatformLlm } from "@/lib/pcc/llm/apply";
import { composeEstimatorPrompt } from "@/lib/pcc/llm/composePrompts";

import { computeEstimate } from "@/lib/pricing/computeEstimate";

export type AdminReassessEngine = "openai_assessment" | "deterministic_only";
export type KeySource = "tenant" | "platform_grace" | null;

type QuoteLogRow = {
  id: string;
  tenant_id: string;
  input: any;
  qa: any;
  output: any;
};

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
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
 * Admin reassess key rules:
 * - If forceKeySource snapshot exists, honor it strictly
 * - Otherwise prefer tenant key, else platform key
 * - We do NOT consume grace credits here (admin action)
 */
async function resolveOpenAiClientForAdmin(args: { tenantId: string; forceKeySource: KeySource }) {
  const { tenantId, forceKeySource } = args;

  const enc = await loadTenantOpenAiKeyEnc(tenantId);
  const hasTenant = Boolean(enc);

  if (forceKeySource === "tenant") {
    if (!hasTenant) throw new Error("MISSING_OPENAI_KEY");
    return { openai: new OpenAI({ apiKey: decryptSecret(enc!) }), keySource: "tenant" as const };
  }

  if (forceKeySource === "platform_grace") {
    const pk = platformOpenAiKey();
    if (!pk) throw new Error("MISSING_PLATFORM_OPENAI_KEY");
    return { openai: new OpenAI({ apiKey: pk }), keySource: "platform_grace" as const };
  }

  if (hasTenant) return { openai: new OpenAI({ apiKey: decryptSecret(enc!) }), keySource: "tenant" as const };

  const pk = platformOpenAiKey();
  if (!pk) throw new Error("MISSING_PLATFORM_OPENAI_KEY");
  return { openai: new OpenAI({ apiKey: pk }), keySource: "platform_grace" as const };
}

/* --------------------- model call --------------------- */
async function generateEstimateWithNotes(args: {
  openai: OpenAI;
  model: string;
  system: string;
  maxOutputTokens: number;
  images: Array<{ url: string; shotType?: string }>;
  category: string;
  service_type: string;
  notes: string;
}) {
  const { openai, model, system, maxOutputTokens, images, category, service_type, notes } = args;

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
    max_tokens: Math.max(200, Math.min(4000, Math.floor(Number(maxOutputTokens) || 1200))),
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
    parsed && typeof parsed === "object" && parsed.properties && typeof parsed.properties === "object"
      ? parsed.properties
      : parsed;

  const candidate = coerceAiCandidate(candidate0);

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

/* --------------------- notes context (deterministic + hashed + bounded) --------------------- */
function normalizeNoteLine(line: string) {
  return line.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function clampTextByChars(s: string, maxChars: number) {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars);
}

async function buildNotesContext(args: {
  tenantId: string;
  quoteLogId: string;
  limit: number;
  maxChars: number;
}) {
  const { tenantId, quoteLogId, limit, maxChars } = args;

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
    limit ${limit}::int
  `);

  const rows: any[] = (cnr as any)?.rows ?? (Array.isArray(cnr) ? (cnr as any) : []);
  const stable = rows
    .map((n) => ({
      id: safeTrim(n?.id),
      created_at: n?.created_at ? new Date(String(n.created_at)) : null,
      created_by: safeTrim(n?.created_by) || "tenant",
      body: safeTrim(n?.body),
    }))
    .filter((n) => n.id && n.body)
    .sort((a, b) => {
      const ta = a.created_at ? a.created_at.getTime() : 0;
      const tb = b.created_at ? b.created_at.getTime() : 0;
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });

  const lines = stable.map((n) => {
    const ts = n.created_at ? n.created_at.toISOString() : "";
    return normalizeNoteLine(`- (${ts} / ${n.created_by}) ${n.body}`);
  });

  const text0 = lines.join("\n");
  const text = clampTextByChars(text0, maxChars);
  const hash = sha256Hex(text);

  return {
    ids: stable.map((n) => n.id),
    count: stable.length,
    text,
    sha256: hash,
    maxChars,
    limit,
  };
}

/* --------------------- quote version writer (atomic version increment) --------------------- */
async function createNextQuoteVersionAtomic(args: {
  tenantId: string;
  quoteLogId: string;
  createdBy: string;
  ai_mode: string;
  source: string;
  reason: string | null;
  output: any;
  meta: any;
}) {
  const { tenantId, quoteLogId, createdBy, ai_mode, source, reason, output, meta } = args;

  const inserted = await db.execute(sql`
    with nextv as (
      select (coalesce(max(version), 0) + 1)::int as v
      from quote_versions
      where tenant_id = ${tenantId}::uuid
        and quote_log_id = ${quoteLogId}::uuid
    )
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
    select
      ${tenantId}::uuid,
      ${quoteLogId}::uuid,
      nextv.v,
      ${ai_mode},
      ${source},
      ${createdBy},
      ${reason},
      ${JSON.stringify(output)}::jsonb,
      ${JSON.stringify(meta ?? {})}::jsonb,
      now()
    from nextv
    returning id::text as "id", version::int as "version"
  `);

  const row: any = (inserted as any)?.rows?.[0] ?? (Array.isArray(inserted) ? (inserted as any)[0] : null);
  if (!row?.id) throw new Error("FAILED_TO_CREATE_VERSION");

  return { versionId: String(row.id), version: Number(row.version) };
}

/* --------------------- public service API --------------------- */
export async function adminReassessQuote(args: {
  quoteLog: QuoteLogRow;
  createdBy: string;
  engine: AdminReassessEngine;
  contextNotesLimit: number;

  // ✅ allow callers (route) to stamp provenance
  source?: string;
  reason?: string;
}) {
  const { quoteLog, createdBy, engine, contextNotesLimit } = args;

  const source = safeTrim(args.source) || "admin";
  const reason = safeTrim(args.reason) || "reassess_from_notes";

  if (engine !== "deterministic_only" && engine !== "openai_assessment") {
    throw new Error("INVALID_ENGINE");
  }

  const quoteLogId = safeTrim(quoteLog.id);
  const tenantId = safeTrim(quoteLog.tenant_id);
  if (!quoteLogId || !tenantId) throw new Error("MISSING_CONTEXT");

  const inputAny: any = quoteLog.input ?? {};
  const qaAny: any = quoteLog.qa ?? {};

  const customerNotes = safeTrim(inputAny?.customer_context?.notes);
  const category = safeTrim(inputAny?.customer_context?.category) || safeTrim(inputAny?.industryKeySnapshot) || "service";
  const service_type = safeTrim(inputAny?.customer_context?.service_type) || "upholstery";
  const images = Array.isArray(inputAny?.images) ? inputAny.images : [];

  const pricing_policy_snapshot =
    inputAny?.pricing_policy_snapshot && typeof inputAny.pricing_policy_snapshot === "object"
      ? inputAny.pricing_policy_snapshot
      : { ai_mode: "assessment_only", pricing_enabled: false, pricing_model: null };

  const pricing_config_snapshot = inputAny?.pricing_config_snapshot ?? null;
  const pricing_rules_snapshot = inputAny?.pricing_rules_snapshot ?? null;

  const llmKeySourceRaw = safeTrim(inputAny?.llmKeySource);
  const forceKeySource: KeySource =
    llmKeySourceRaw === "tenant" ? "tenant" : llmKeySourceRaw === "platform_grace" ? "platform_grace" : null;

  // Deterministic notes context (stable + hashed).
  const notesCtx = await buildNotesContext({
    tenantId,
    quoteLogId,
    limit: contextNotesLimit,
    maxChars: 18_000,
  });

  const combinedNotes = [
    customerNotes ? `Customer notes:\n${customerNotes}` : "Customer notes:\n(none)",
    "",
    "Shop internal notes:",
    notesCtx.text || "(none)",
  ].join("\n");

  // Resolve tenant effective bundle (gives us PCC meta + guardrails)
  const resolvedBase = await resolveTenantLlm(tenantId);

  // Compose prompt through PCC composition layer (policy-aware)
  const platformLlm = await getPlatformLlm();
  const industryKey = safeTrim(inputAny?.industryKeySnapshot) || category;

  const composedEstimator = composeEstimatorPrompt({
    platform: platformLlm,
    tenant: {
      tenantStyleKey: resolvedBase.tenant.tenantStyleKey,
      tenantRenderNotes: resolvedBase.tenant.tenantRenderNotes,
      pricingEnabled: resolvedBase.tenant.pricingEnabled,
    },
    industryKey,
    pricingPolicy: pricing_policy_snapshot,
  });

  const estimatorSystemSha = sha256Hex(composedEstimator);

  // Pull maxOutputTokens from PCC platform cfg (authoritative)
  const maxOutputTokens = Number((resolvedBase as any)?.platform?.guardrails?.maxOutputTokens ?? 1200) || 1200;

  // AI output
  let rawOutput: any = null;
  let keySourceUsed: KeySource = forceKeySource;

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
    const { openai, keySource } = await resolveOpenAiClientForAdmin({ tenantId, forceKeySource });
    keySourceUsed = keySource;

    rawOutput = await generateEstimateWithNotes({
      openai,
      model: resolvedBase.models.estimatorModel,
      system: composedEstimator,
      maxOutputTokens,
      images,
      category,
      service_type,
      notes: combinedNotes,
    });
  }

  // Deterministic pricing always runs.
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

  // Stronger immutable snapshot
  const ai_snapshot = {
    version: 3,
    capturedAt: new Date().toISOString(),
    phase: "admin_reassess",
    tenant: { tenantId, quoteLogId },
    engine,

    models: {
      estimatorModel: resolvedBase.models.estimatorModel,
      qaModel: resolvedBase.models.qaModel,
      renderModel: resolvedBase.models.renderModel,
    },

    prompts: {
      quoteEstimatorSystemSha256: estimatorSystemSha,
      quoteEstimatorSystemLen: composedEstimator.length,
    },

    guardrails: {
      ...(resolvedBase.guardrails ?? null),
      maxOutputTokens,
    },

    pricing_policy_snapshot: pricing_policy_snapshot ?? null,

    keySource: keySourceUsed ?? null,

    notes_context: {
      limit: notesCtx.limit,
      maxChars: notesCtx.maxChars,
      count: notesCtx.count,
      sha256: notesCtx.sha256,
      noteIdsUsed: notesCtx.ids,
    },

    pcc_meta: {
      industryKey: (resolvedBase.meta?.industryKey ?? null) as any,
      hasIndustryPack: Boolean(resolvedBase.meta?.hasIndustryPack),
      hasTenantOverrides: Boolean(resolvedBase.meta?.hasTenantOverrides),
      tenantOverridesUpdatedAt: resolvedBase.meta?.tenantOverridesUpdatedAt ?? null,
      effectiveVersion: resolvedBase.meta?.effectiveVersion ?? null,
      platformUpdatedAt: resolvedBase.meta?.platformUpdatedAt ?? null,
      tenant: {
        planTier: resolvedBase.tenant.planTier ?? null,
        pricingEnabled: Boolean(resolvedBase.tenant.pricingEnabled),
        aiMode: resolvedBase.tenant.aiMode ?? null,
      },
    },
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

  const ai_mode = safeTrim(pricing_policy_snapshot?.ai_mode) || "assessment_only";

  const meta = {
    createdFrom: source,
    ai_snapshot,
    hashes: {
      estimatorSystemSha256: estimatorSystemSha,
      notesContextSha256: notesCtx.sha256,
    },
  };

  const { versionId, version } = await createNextQuoteVersionAtomic({
    tenantId,
    quoteLogId,
    createdBy,
    ai_mode,
    source,
    reason: reason || null,
    output,
    meta,
  });

  // Advance "current" snapshot.
  await db.execute(sql`
    update quote_logs
    set output = ${JSON.stringify(output)}::jsonb
    where id = ${quoteLogId}::uuid
      and tenant_id = ${tenantId}::uuid
  `);

  return { versionId, version, output };
}

export type { QuoteLogRow };