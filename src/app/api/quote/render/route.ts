// src/app/api/quote/render/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import OpenAI from "openai";
import { put } from "@vercel/blob";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";

const Req = z.object({
  tenantSlug: z.string().min(3),
  quoteLogId: z.string().uuid(),
});

// small helper: avoid leaking huge errors to client
function safeErr(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e ?? "Unknown error");
  return msg.slice(0, 2000);
}

export async function POST(req: Request) {
  const debugId = `dbg_${Math.random().toString(36).slice(2, 10)}`;

  try {
    const body = await req.json().catch(() => null);
    const parsed = Req.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "Invalid payload", issues: parsed.error.issues, debugId },
        { status: 400 }
      );
    }

    const { tenantSlug, quoteLogId } = parsed.data;

    // 1) Resolve tenant
    const tenantRows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1);

    const tenant = tenantRows[0];
    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND", message: "Invalid tenant link.", debugId },
        { status: 404 }
      );
    }

    // 2) Load quote log (must match tenant)
    const qRows = await db
      .select({
        id: quoteLogs.id,
        tenantId: quoteLogs.tenantId,
        input: quoteLogs.input,
        output: quoteLogs.output,
        renderOptIn: quoteLogs.renderOptIn,
        renderStatus: quoteLogs.renderStatus,
        renderImageUrl: quoteLogs.renderImageUrl,
      })
      .from(quoteLogs)
      .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)))
      .limit(1);

    const q = qRows[0];
    if (!q) {
      return NextResponse.json(
        { ok: false, error: "QUOTE_NOT_FOUND", message: "Quote not found for this tenant.", debugId },
        { status: 404 }
      );
    }

    // 3) If customer didn’t opt-in, do nothing
    if (!q.renderOptIn) {
      return NextResponse.json({
        ok: true,
        quoteLogId,
        status: "not_requested",
        imageUrl: q.renderImageUrl ?? null,
        debugId,
      });
    }

    // 4) If already rendered and has URL, return it (idempotent)
    if (q.renderStatus === "rendered" && q.renderImageUrl) {
      return NextResponse.json({
        ok: true,
        quoteLogId,
        status: "rendered",
        imageUrl: q.renderImageUrl,
        debugId,
      });
    }

    // Mark queued/running (best-effort)
    await db
      .update(quoteLogs)
      .set({
        renderStatus: "running",
        renderError: null,
      })
      .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

    // 5) Fetch tenant OpenAI key (tenant-owned, not platform)
    const secRows = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1);

    const sec = secRows[0];
    if (!sec?.openaiKeyEnc) {
      await db
        .update(quoteLogs)
        .set({
          renderStatus: "failed",
          renderError: "Missing tenant OpenAI key (tenant_secrets).",
        })
        .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_TENANT_KEY",
          message: "Tenant OpenAI key is not configured.",
          debugId,
        },
        { status: 500 }
      );
    }

    const apiKey = decryptSecret(sec.openaiKeyEnc);
    if (!apiKey) {
      await db
        .update(quoteLogs)
        .set({
          renderStatus: "failed",
          renderError: "Unable to decrypt tenant OpenAI key.",
        })
        .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

      return NextResponse.json(
        { ok: false, error: "BAD_TENANT_KEY", message: "Tenant OpenAI key could not be decrypted.", debugId },
        { status: 500 }
      );
    }

    const openai = new OpenAI({ apiKey });

    // 6) Build a prompt. Keep it simple + consistent.
    // Pull a little context from output if present.
    const outAny: any = q.output ?? {};
    const summary = typeof outAny?.summary === "string" ? outAny.summary : "";
    const serviceType =
      (q.input as any)?.customer_context?.service_type ||
      (q.input as any)?.customer_context?.category ||
      (q.input as any)?.customer_context?.category ||
      "";

    const prompt = [
      "Generate a realistic 'after' concept rendering based on the customer's photos.",
      "Do NOT add text or watermarks.",
      "Style: realistic, clean lighting, product photography feel.",
      serviceType ? `Service type: ${serviceType}` : "",
      summary ? `Estimate summary context: ${summary}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Persist prompt (best-effort)
    await db
      .update(quoteLogs)
      .set({ renderPrompt: prompt })
      .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

    // 7) Generate image (OpenAI Images API returns base64, not URL)
    // NOTE: gpt-image-1 returns data[0].b64_json
    const imgResp: any = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    const b64: string | undefined = imgResp?.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error("Image generation returned no b64_json.");
    }

    const bytes = Buffer.from(b64, "base64");

    // 8) Upload to Vercel Blob
    const key = `renders/${tenantSlug}/${quoteLogId}-${Date.now()}.png`;
    const blob = await put(key, bytes, {
      access: "public",
      contentType: "image/png",
    });

    const imageUrl = blob?.url;
    if (!imageUrl) {
      throw new Error("Blob upload returned no url.");
    }

    // 9) Save to DB + mark rendered
    await db
      .update(quoteLogs)
      .set({
        renderStatus: "rendered",
        renderImageUrl: imageUrl,
        renderError: null,
        renderedAt: new Date(),
      })
      .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

    return NextResponse.json({
      ok: true,
      quoteLogId,
      status: "rendered",
      imageUrl,
      debugId,
    });
  } catch (e) {
    const msg = safeErr(e);

    // Best-effort: mark failed if we can infer quoteLogId/tenantSlug from body
    try {
      const body = await req.clone().json().catch(() => null);
      const parsed = Req.safeParse(body);
      if (parsed.success) {
        const { tenantSlug, quoteLogId } = parsed.data;

        const tenantRows = await db
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.slug, tenantSlug))
          .limit(1);

        const tenant = tenantRows[0];
        if (tenant) {
          await db
            .update(quoteLogs)
            .set({
              renderStatus: "failed",
              renderError: msg,
            })
            .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));
        }
      }
    } catch {
      // ignore
    }

    return NextResponse.json(
      {
        ok: false,
        error: "REQUEST_FAILED",
        message: msg,
        debugId: `dbg_${Math.random().toString(36).slice(2, 10)}`,
      },
      { status: 500 }
    );
  }
}
