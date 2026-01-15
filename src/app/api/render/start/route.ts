import { NextResponse } from "next/server";
import { z } from "zod";
import { sql, eq } from "drizzle-orm";
import crypto from "crypto";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

const Req = z.object({
  quoteLogId: z.string().uuid(),
});

function json(data: any, status = 200, debugId?: string) {
  const res = NextResponse.json(debugId ? { debugId, ...data } : data, { status });
  if (debugId) res.headers.set("x-debug-id", debugId);
  return res;
}

function normalizeDbErr(err: any) {
  return {
    name: err?.name,
    message: err?.message ?? String(err),
    code: err?.code,
    detail: err?.detail,
    hint: err?.hint,
    constraint: err?.constraint,
    table: err?.table,
    column: err?.column,
    where: err?.where,
    causeMessage: err?.cause?.message,
    causeCode: err?.cause?.code,
    causeDetail: err?.cause?.detail,
  };
}

function safeJsonParse(v: any) {
  try {
    if (v == null) return null;
    if (typeof v === "object") return v;
    if (typeof v === "string") return JSON.parse(v);
    return v;
  } catch {
    return null;
  }
}

async function getTenantOpenAiKey(tenantId: string): Promise<string | null> {
  const r = await db.execute(
    sql`select openai_key_enc from tenant_secrets where tenant_id = ${tenantId} limit 1`
  );
  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  const enc = row?.openai_key_enc ?? null;
  if (!enc) return null;
  return decryptSecret(enc);
}

async function getTenantAiRenderingEnabled(tenantId: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      select ai_rendering_enabled
      from tenant_settings
      where tenant_id = ${tenantId}
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
    return row?.ai_rendering_enabled === true ? true : false;
  } catch {
    return false;
  }
}

async function updateQuoteLogOutput(quoteLogId: string, output: any) {
  const outputStr = JSON.stringify(output ?? {});
  await db.execute(sql`
    update quote_logs
    set output = ${outputStr}::jsonb
    where id = ${quoteLogId}::uuid
  `);
}

async function tryUpdateRenderScalars(args: {
  quoteLogId: string;
  renderOptIn?: boolean | null;
  status?: string | null;
  imageUrl?: string | null;
  prompt?: string | null;
  error?: string | null;
}) {
  const { quoteLogId, renderOptIn, status, imageUrl, prompt, error } = args;

  try {
    await db.execute(sql`
      update quote_logs
      set
        render_opt_in = ${renderOptIn ?? null},
        render_status = ${status ?? null},
        render_image_url = ${imageUrl ?? null},
        render_prompt = ${prompt ?? null},
        render_error = ${error ?? null},
        rendered_at = case when ${status ?? null} = 'rendered' then now() else rendered_at end
      where id = ${quoteLogId}::uuid
    `);
  } catch {
    // ignore if columns don't exist
  }
}

function buildRenderPrompt(args: {
  tenantName?: string;
  notes?: string;
  category?: string;
  assessment?: any;
  imageCount: number;
}) {
  const { tenantName, notes, category, assessment, imageCount } = args;

  const summary = assessment?.summary ? String(assessment.summary) : "";
  const visible = Array.isArray(assessment?.visible_scope) ? assessment.visible_scope : [];
  const assumptions = Array.isArray(assessment?.assumptions) ? assessment.assumptions : [];

  const lines: string[] = [];
  lines.push("Generate a photorealistic concept rendering of the finished upholstery/job outcome.");
  lines.push("Use the provided customer photos ONLY as reference for structure and context.");
  lines.push("Do NOT add logos, watermarks, text overlays, or framing.");
  lines.push("The result should look like a real finished product photo taken in good lighting.");
  lines.push("");
  if (tenantName) lines.push(`Business context: ${tenantName}`);
  if (category) lines.push(`Category: ${category}`);
  if (notes) lines.push(`Customer notes: ${notes}`);
  if (summary) lines.push(`Assessment summary: ${summary}`);
  if (visible.length) lines.push(`Visible scope: ${visible.join("; ")}`);
  if (assumptions.length) lines.push(`Assumptions: ${assumptions.join("; ")}`);
  lines.push("");
  lines.push(`Reference photos: ${imageCount} image(s).`);
  lines.push("Output: one single final image. No variations. No split panels.");

  return lines.join("\n");
}

async function uploadPngToVercelBlob(args: { quoteLogId: string; bytes: Buffer }) {
  // Lazy import so build won’t fail if @vercel/blob isn’t present in some env
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@vercel/blob") as typeof import("@vercel/blob");
    const put = mod.put;
    if (typeof put !== "function") throw new Error("put() not available from @vercel/blob");

    const path = `renders/${args.quoteLogId}.png`;
    const res = await put(path, args.bytes, {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: true,
    });

    return { ok: true as const, url: res.url, pathname: res.pathname };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? String(e) };
  }
}

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");
  const startedAt = Date.now();

  try {
    // Accept either JSON or form POST
    let raw: any = null;
    const ct = req.headers.get("content-type") || "";

    if (ct.includes("application/json")) {
      raw = await req.json().catch(() => null);
    } else {
      const fd = await req.formData().catch(() => null);
      if (fd) raw = { quoteLogId: String(fd.get("quoteLogId") || "") };
    }

    const parsed = Req.safeParse(raw);
    if (!parsed.success) {
      return json(
        { ok: false, error: "BAD_REQUEST_VALIDATION", issues: parsed.error.issues, received: raw },
        400,
        debugId
      );
    }

    const { quoteLogId } = parsed.data;

    // Load quote log
    const r = await db.execute(sql`
      select id, tenant_id, input, output, created_at
      from quote_logs
      where id = ${quoteLogId}::uuid
      limit 1
    `);
    const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);

    if (!row) {
      return json({ ok: false, error: "QUOTE_NOT_FOUND", quoteLogId }, 404, debugId);
    }

    const input = safeJsonParse(row.input) ?? {};
    const output = safeJsonParse(row.output) ?? {};

    const tenantId = String(row.tenant_id);

    // Verify tenant still exists (nice-to-have)
    const trows = await db.select().from(tenants).where(eq(tenants.id, tenantId as any)).limit(1);
    const tenant = trows[0] ?? null;

    // Tenant must have rendering enabled
    const tenantRenderingEnabled = await getTenantAiRenderingEnabled(tenantId);
    if (!tenantRenderingEnabled) {
      return json(
        { ok: false, error: "TENANT_RENDERING_DISABLED", tenantId, quoteLogId },
        403,
        debugId
      );
    }

    const existingRendering = output?.rendering ?? {};
    const requested = existingRendering?.requested === true || input?.render_opt_in === true;

    if (!requested) {
      return json(
        { ok: false, error: "RENDER_NOT_REQUESTED", message: "Customer did not opt-in for rendering." },
        400,
        debugId
      );
    }

    const images: string[] = (input?.images ?? []).map((x: any) => x?.url).filter(Boolean);
    if (!images.length) {
      return json({ ok: false, error: "NO_IMAGES", message: "No images found on quote input." }, 400, debugId);
    }

    // If already rendered, don’t redo unless you want that behavior later
    const currentStatus = String(existingRendering?.status ?? "");
    if (currentStatus === "rendered" && existingRendering?.imageUrl) {
      return json(
        {
          ok: true,
          quoteLogId,
          tenantId,
          rendering: existingRendering,
          message: "Already rendered.",
          durationMs: Date.now() - startedAt,
        },
        200,
        debugId
      );
    }

    const openAiKey = await getTenantOpenAiKey(tenantId);
    if (!openAiKey) {
      return json(
        {
          ok: false,
          error: "OPENAI_KEY_MISSING",
          message: "Tenant OpenAI key not configured in tenant_secrets.openai_key_enc.",
        },
        500,
        debugId
      );
    }

    const assessment = output?.assessment ?? null;
    const notes = input?.customer_context?.notes?.trim?.() || "";
    const category = input?.customer_context?.category?.trim?.() || "";

    const prompt = buildRenderPrompt({
      tenantName: tenant?.name ?? "",
      notes,
      category,
      assessment,
      imageCount: images.length,
    });

    // Mark queued/in_progress in output early
    const preRendering = {
      tenant_enabled: true,
      requested: true,
      status: "in_progress",
      imageUrl: null as string | null,
      error: null as string | null,
    };

    try {
      await updateQuoteLogOutput(quoteLogId, {
        ...output,
        rendering: preRendering,
      });
      await tryUpdateRenderScalars({
        quoteLogId,
        renderOptIn: true,
        status: "in_progress",
        imageUrl: null,
        prompt,
        error: null,
      });
    } catch {
      // non-fatal
    }

    // Generate image
    const openai = new OpenAI({ apiKey: openAiKey });

    // NOTE: We only provide a text prompt here (no image conditioning yet).
    // Next task can enhance to use reference images if you want.
    let imageBase64: string | null = null;

    try {
      const gen = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024",
      });

      // Node SDK shape may differ across versions; handle common cases
      const b64 =
        (gen as any)?.data?.[0]?.b64_json ??
        (gen as any)?.data?.[0]?.b64 ??
        (gen as any)?.data?.[0]?.base64 ??
        null;

      if (!b64) {
        throw new Error("Image generation returned no base64 payload.");
      }

      imageBase64 = String(b64);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      const failedRendering = {
        tenant_enabled: true,
        requested: true,
        status: "failed",
        imageUrl: null,
        error: msg,
      };

      try {
        await updateQuoteLogOutput(quoteLogId, { ...output, rendering: failedRendering });
        await tryUpdateRenderScalars({
          quoteLogId,
          renderOptIn: true,
          status: "failed",
          imageUrl: null,
          prompt,
          error: msg,
        });
      } catch {}

      return json(
        { ok: false, error: "RENDER_GENERATION_FAILED", message: msg, quoteLogId, tenantId },
        500,
        debugId
      );
    }

    // Upload to Blob (preferred) — fallback to data URL if blob not configured
    const pngBytes = Buffer.from(imageBase64!, "base64");

    const blobRes = await uploadPngToVercelBlob({ quoteLogId, bytes: pngBytes });

    const imageUrl = blobRes.ok
      ? blobRes.url
      : `data:image/png;base64,${imageBase64}`; // fallback (large, but works for dev)

    const finalRendering = {
      tenant_enabled: true,
      requested: true,
      status: "rendered",
      imageUrl,
      error: blobRes.ok ? null : `Blob upload failed: ${blobRes.error}`,
    };

    // Persist
    try {
      await updateQuoteLogOutput(quoteLogId, {
        ...output,
        rendering: finalRendering,
      });
      await tryUpdateRenderScalars({
        quoteLogId,
        renderOptIn: true,
        status: "rendered",
        imageUrl: blobRes.ok ? blobRes.url : null, // only store url in scalar if real url
        prompt,
        error: finalRendering.error,
      });
    } catch (e: any) {
      return json(
        {
          ok: true,
          quoteLogId,
          tenantId,
          rendering: finalRendering,
          warning: `quote_logs update failed: ${normalizeDbErr(e).message}`,
          durationMs: Date.now() - startedAt,
        },
        200,
        debugId
      );
    }

    return json(
      {
        ok: true,
        quoteLogId,
        tenantId,
        rendering: finalRendering,
        blob: blobRes,
        durationMs: Date.now() - startedAt,
      },
      200,
      debugId
    );
  } catch (err: any) {
    return json(
      { ok: false, error: "REQUEST_FAILED", message: err?.message ?? String(err) },
      500,
      debugId
    );
  }
}
