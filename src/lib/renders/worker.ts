// src/lib/renders/worker.ts
import OpenAI from "openai";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { safeTrim } from "@/lib/admin/quotes/utils";

/**
 * Minimal durable render worker:
 * - claim 1 queued job (SKIP LOCKED)
 * - set running + started_at
 * - call OpenAI images.generate (first working pipeline)
 * - save data-url to image_url
 * - set rendered|failed + completed_at
 *
 * NOTE: this is intentionally "v1". Later we'll swap storage to Vercel Blob/S3
 * and use real photo-driven editing instead of pure generation.
 */

type ClaimedJob = {
  id: string;
  tenantId: string;
  quoteLogId: string;
  quoteVersionId: string | null;

  attempt: number;
  status: string;

  prompt: string | null;
  shopNotes: string | null;

  // tenant settings layer
  renderingEnabled: boolean | null;
  aiRenderingEnabled: boolean | null;
  renderingPromptAddendum: string | null;
  renderingNegativeGuidance: string | null;

  // version snapshot (optional)
  versionNumber: number | null;
  versionOutput: any | null;

  // quote input (optional)
  quoteInput: any | null;
};

function asText(x: any) {
  const t = safeTrim(x);
  return t || "";
}

function tryExtractAnyPhotoUrl(input: any): string | null {
  if (!input || typeof input !== "object") return null;

  // common shapes we've used across branches
  const candidates: any[] = [];

  // input.photos: [{ url }]
  if (Array.isArray((input as any).photos)) candidates.push(...(input as any).photos);
  if (Array.isArray((input as any).images)) candidates.push(...(input as any).images);
  if (Array.isArray((input as any).photo_urls)) candidates.push(...(input as any).photo_urls);

  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string" && c.startsWith("http")) return c;
    if (typeof c === "object") {
      const u = (c as any).url || (c as any).src || (c as any).href;
      if (typeof u === "string" && u.startsWith("http")) return u;
    }
  }

  // some older inputs store a single url
  const single =
    (input as any).photoUrl ||
    (input as any).photo_url ||
    (input as any).imageUrl ||
    (input as any).image_url;
  if (typeof single === "string" && single.startsWith("http")) return single;

  return null;
}

function buildRenderPrompt(job: ClaimedJob) {
  const shopNotes = asText(job.shopNotes);
  const addendum = asText(job.renderingPromptAddendum);
  const negative = asText(job.renderingNegativeGuidance);

  // We can optionally reference a single photo URL, but v1 uses pure generation.
  const photoUrl = tryExtractAnyPhotoUrl(job.quoteInput);

  const versionHint =
    job.versionNumber != null
      ? `This render is for quote version v${job.versionNumber}.`
      : `This render is for a quote version snapshot.`;

  const parts: string[] = [];

  parts.push(
    `You are generating a service-industry "concept render" image for a quote review tool.`,
    versionHint
  );

  if (photoUrl) {
    parts.push(
      `A reference photo URL exists (for future photo-driven edits): ${photoUrl}`,
      `For now, generate a plausible render consistent with the request (do not mention URLs).`
    );
  }

  if (shopNotes) {
    parts.push(`Shop notes / instructions: ${shopNotes}`);
  } else {
    parts.push(`Shop notes / instructions: none provided.`);
  }

  if (addendum) {
    parts.push(`Tenant prompt addendum (must follow): ${addendum}`);
  }

  if (negative) {
    parts.push(`Negative guidance (avoid these): ${negative}`);
  }

  parts.push(
    `Output: a single realistic image suitable for showing a customer. No text overlays, no watermarks, no UI elements.`
  );

  return parts.join("\n\n");
}

async function claimOneQueuedJob(): Promise<ClaimedJob | null> {
  // Transaction: claim exactly one job safely
  return await db.transaction(async (tx: any) => {
    const claimed = await tx.execute(sql`
      with picked as (
        select r.id
        from quote_renders r
        where r.status = 'queued'
        order by r.created_at asc
        for update skip locked
        limit 1
      )
      update quote_renders r
      set
        status = 'running',
        started_at = now(),
        updated_at = now()
      from picked
      where r.id = picked.id
      returning
        r.id::text as "id",
        r.tenant_id::text as "tenantId",
        r.quote_log_id::text as "quoteLogId",
        r.quote_version_id::text as "quoteVersionId",
        r.attempt as "attempt",
        r.status as "status",
        r.prompt as "prompt",
        r.shop_notes as "shopNotes"
    `);

    const r0 = (claimed as any)?.rows?.[0];
    if (!r0?.id) return null;

    // Hydrate with version + quote input + tenant settings
    const hydrated = await tx.execute(sql`
      select
        r.id::text as "id",
        r.tenant_id::text as "tenantId",
        r.quote_log_id::text as "quoteLogId",
        r.quote_version_id::text as "quoteVersionId",
        r.attempt as "attempt",
        r.status as "status",
        r.prompt as "prompt",
        r.shop_notes as "shopNotes",

        ts.rendering_enabled as "renderingEnabled",
        ts.ai_rendering_enabled as "aiRenderingEnabled",
        ts.rendering_prompt_addendum as "renderingPromptAddendum",
        ts.rendering_negative_guidance as "renderingNegativeGuidance",

        v.version as "versionNumber",
        v.output as "versionOutput",
        q.input as "quoteInput"
      from quote_renders r
      left join tenant_settings ts
        on ts.tenant_id = r.tenant_id
      left join quote_versions v
        on v.id = r.quote_version_id
      left join quote_logs q
        on q.id = r.quote_log_id
      where r.id = ${r0.id}::uuid
      limit 1
    `);

    const j = (hydrated as any)?.rows?.[0] ?? null;
    return j as ClaimedJob | null;
  });
}

async function markFailed(jobId: string, err: any) {
  const msg =
    safeTrim(err?.message) ||
    safeTrim(err?.cause?.message) ||
    safeTrim(String(err)) ||
    "Render failed";

  await db.execute(sql`
    update quote_renders
    set
      status = 'failed',
      error = ${msg},
      completed_at = now(),
      updated_at = now()
    where id = ${jobId}::uuid
  `);
}

async function markRendered(jobId: string, imageUrl: string) {
  await db.execute(sql`
    update quote_renders
    set
      status = 'rendered',
      image_url = ${imageUrl},
      error = null,
      completed_at = now(),
      updated_at = now()
    where id = ${jobId}::uuid
  `);
}

export async function processOneQueuedRender() {
  const job = await claimOneQueuedJob();
  if (!job) return { ok: true, didWork: false, message: "No queued jobs." };

  // Feature gates (tenant-scoped)
  // - renderingEnabled (legacy) OR aiRenderingEnabled (new) should allow work
  const allowed = Boolean(job.aiRenderingEnabled ?? job.renderingEnabled ?? false);
  if (!allowed) {
    await markFailed(job.id, new Error("Rendering is disabled for this tenant."));
    return { ok: true, didWork: true, message: "Claimed job but tenant has rendering disabled.", jobId: job.id };
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY (platform key).");

    const client = new OpenAI({ apiKey });

    const prompt = buildRenderPrompt(job);

    // V1: generate an image (photo-driven edit comes later)
    const resp = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      // safest for storage without external deps:
      response_format: "b64_json",
    } as any);

    const b64 = (resp as any)?.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI did not return b64_json image data.");

    const dataUrl = `data:image/png;base64,${b64}`;

    await markRendered(job.id, dataUrl);

    return {
      ok: true,
      didWork: true,
      message: "Rendered 1 job.",
      jobId: job.id,
      quoteLogId: job.quoteLogId,
      quoteVersionId: job.quoteVersionId,
    };
  } catch (e: any) {
    await markFailed(job.id, e);
    return { ok: false, didWork: true, message: "Job failed.", jobId: job.id, error: safeTrim(e?.message) || String(e) };
  }
}