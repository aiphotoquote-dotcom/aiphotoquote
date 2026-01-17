import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Req = z.object({
  tenantSlug: z.string().min(3),
  quoteLogId: z.string().uuid(),
});

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function safeJsonParse(v: any) {
  try {
    if (!v) return null;
    if (typeof v === "object") return v;
    return JSON.parse(v);
  } catch {
    return null;
  }
}

async function getTenantBySlug(slug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return rows[0] ?? null;
}

async function getTenantOpenAiKey(tenantId: string) {
  const r = await db.execute(
    sql`select openai_key_enc from tenant_secrets where tenant_id = ${tenantId}::uuid limit 1`
  );
  const row: any = (r as any)?.rows?.[0];
  if (!row?.openai_key_enc) return null;
  return decryptSecret(row.openai_key_enc);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = Req.safeParse(body);
    if (!parsed.success) {
      return json({ ok: false, error: "BAD_REQUEST" }, 400);
    }

    const { tenantSlug, quoteLogId } = parsed.data;

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404);

    const tenantId = String((tenant as any).id);

    const r = await db.execute(sql`
      select input, output
      from quote_logs
      where id = ${quoteLogId}::uuid
      limit 1
    `);

    const row: any = (r as any)?.rows?.[0];
    if (!row) return json({ ok: false, error: "QUOTE_NOT_FOUND" }, 404);

    const input = safeJsonParse(row.input) ?? {};
    const output = safeJsonParse(row.output) ?? {};

    // ✅ THIS IS THE FIX
    const renderOptIn = output?.render_opt_in === true;

    if (!renderOptIn) {
      return json(
        {
          ok: false,
          error: "NOT_OPTED_IN",
          message: "Customer did not opt in to AI rendering.",
        },
        400
      );
    }

    const images: string[] = Array.isArray(input?.images)
      ? input.images.map((x: any) => x?.url).filter(Boolean)
      : [];

    if (!images.length) {
      return json({ ok: false, error: "NO_IMAGES" }, 400);
    }

    const openAiKey = await getTenantOpenAiKey(tenantId);
    if (!openAiKey) {
      return json({ ok: false, error: "OPENAI_KEY_MISSING" }, 500);
    }

    const openai = new OpenAI({ apiKey: openAiKey });

    const prompt = [
      "Create a realistic 'after' rendering of the finished upholstery work.",
      "Do not add text or labels.",
      "Preserve perspective and proportions.",
      "Make it look like a professional shop result.",
    ].join("\n");

    const img = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    } as any);

    const imageUrl = img?.data?.[0]?.url;
    if (!imageUrl) throw new Error("No image returned");

    return json({
      ok: true,
      imageUrl,
    });
  } catch (err: any) {
    return json(
      {
        ok: false,
        error: "RENDER_FAILED",
        message: err?.message ?? String(err),
      },
      500
    );
  }
}
