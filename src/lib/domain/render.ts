import { sql } from "drizzle-orm";
import crypto from "crypto";
import { db } from "@/lib/db/client";

export type RenderJobStatus = "queued" | "running" | "rendered" | "failed";

export type RenderJobRow = {
  id: string;
  tenant_id: string;
  quote_log_id: string;
  status: RenderJobStatus;
  prompt: string | null;
  image_url: string | null;
  error: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
};

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

export function buildRenderPromptFromQuoteInput(inputJson: any) {
  const input = safeJsonParse(inputJson) ?? {};
  const cc = input?.customer_context ?? {};

  const notes = String(cc?.notes ?? "").trim();
  const category = String(cc?.category ?? "").trim();
  const serviceType = String(cc?.service_type ?? "").trim();

  return [
    "Create a realistic concept 'after' rendering of the finished upholstery/service outcome.",
    "This is a second-step visual preview. Do NOT provide pricing. Do NOT provide text overlays.",
    "Preserve the subject and original photo perspective as much as possible.",
    "Output should look like a professional shop result, clean and plausible.",
    category ? `Category: ${category}` : "",
    serviceType ? `Service type: ${serviceType}` : "",
    notes ? `Customer notes: ${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function getRenderJobByQuoteLogId(quoteLogId: string): Promise<RenderJobRow | null> {
  const r = await db.execute(sql`
    select id, tenant_id, quote_log_id, status, prompt, image_url, error, created_at, started_at, completed_at
    from render_jobs
    where quote_log_id = ${quoteLogId}::uuid
    limit 1
  `);

  const row: any = (r as any)?.rows?.[0] ?? (Array.isArray(r) ? (r as any)[0] : null);
  if (!row) return null;

  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    quote_log_id: String(row.quote_log_id),
    status: String(row.status ?? "queued") as RenderJobStatus,
    prompt: row.prompt != null ? String(row.prompt) : null,
    image_url: row.image_url != null ? String(row.image_url) : null,
    error: row.error != null ? String(row.error) : null,
    created_at: row.created_at != null ? String(row.created_at) : null,
    started_at: row.started_at != null ? String(row.started_at) : null,
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
  };
}

export async function createRenderJobIfMissing(args: {
  tenantId: string;
  quoteLogId: string;
  prompt: string;
}): Promise<{ jobId: string; alreadyExisted: boolean }> {
  const { tenantId, quoteLogId, prompt } = args;

  const existing = await getRenderJobByQuoteLogId(quoteLogId);
  if (existing?.id) {
    return { jobId: existing.id, alreadyExisted: true };
  }

  const jobId = crypto.randomUUID();

  await db.execute(sql`
    insert into render_jobs (id, tenant_id, quote_log_id, status, prompt, created_at)
    values (${jobId}::uuid, ${tenantId}::uuid, ${quoteLogId}::uuid, 'queued', ${prompt}, now())
  `);

  return { jobId, alreadyExisted: false };
}

export async function markRenderRunning(jobId: string) {
  await db.execute(sql`
    update render_jobs
    set status = 'running', started_at = coalesce(started_at, now())
    where id = ${jobId}::uuid
  `);
}

export async function markRenderCompleted(args: {
  jobId: string;
  imageUrl: string | null;
  error: string | null;
}) {
  const { jobId, imageUrl, error } = args;

  await db.execute(sql`
    update render_jobs
    set
      status = ${error ? "failed" : "rendered"},
      image_url = ${imageUrl},
      error = ${error},
      completed_at = now()
    where id = ${jobId}::uuid
  `);
}
