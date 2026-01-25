// src/app/api/quote/render/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import OpenAI from "openai";
import { put } from "@vercel/blob";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, tenantSettings, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

import { sendEmail } from "@/lib/email";
import { getTenantEmailConfig } from "@/lib/email/tenantEmail";
import { renderCustomerRenderCompleteEmailHTML } from "@/lib/email/templates/renderCompleteCustomer";
import { renderLeadRenderCompleteEmailHTML } from "@/lib/email/templates/renderCompleteLead";

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

function getBaseUrlFromHeaders(h: Headers) {
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return host ? `${proto}://${host}` : "";
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

    // Mark running (best-effort)
    await db
      .update(quoteLogs)
      .set({
        renderStatus: "running",
        renderError: null,
      })
      .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

    // 5) Fetch tenant OpenAI key
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
        { ok: false, error: "MISSING_TENANT_KEY", message: "Tenant OpenAI key is not configured.", debugId },
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

    // 6) Build prompt (simple + consistent)
    const outAny: any = q.output ?? {};
    const summary = typeof outAny?.summary === "string" ? outAny.summary : "";

    const inputAny: any = q.input ?? {};
    const serviceType =
      inputAny?.customer_context?.service_type ||
      inputAny?.customer_context?.category ||
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

    // 7) Generate image
    const imgResp: any = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    const b64: string | undefined = imgResp?.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image generation returned no b64_json.");

    const bytes = Buffer.from(b64, "base64");

    // 8) Upload to Vercel Blob
    const key = `renders/${tenantSlug}/${quoteLogId}-${Date.now()}.png`;
    const blob = await put(key, bytes, {
      access: "public",
      contentType: "image/png",
    });

    const imageUrl = blob?.url;
    if (!imageUrl) throw new Error("Blob upload returned no url.");

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

    // 10) Send render-complete emails (best-effort; do NOT fail request)
    // Pull email config + branding
    let renderEmailResult: any = null;
    try {
      const cfg = await getTenantEmailConfig(tenant.id);

      const branding = await db
        .select({
          businessName: tenantSettings.businessName,
          brandLogoUrl: tenantSettings.brandLogoUrl,
          leadToEmail: tenantSettings.leadToEmail,
        })
        .from(tenantSettings)
        .where(eq(tenantSettings.tenantId, tenant.id))
        .limit(1)
        .then((r) => r[0] ?? null);

      const businessName = (cfg.businessName || branding?.businessName || "Your Business").trim();
      const brandLogoUrl = branding?.brandLogoUrl ?? null;

      const inputAny2: any = q.input ?? {};
      const customer = inputAny2?.customer ?? inputAny2?.contact ?? null;

      const customerName = String(customer?.name ?? "Customer").trim();
      const customerEmail = String(customer?.email ?? "").trim().toLowerCase();
      const customerPhone = String(customer?.phone ?? "").trim();

      const outAny2: any = q.output ?? {};
      const estimateLow = typeof outAny2?.estimate_low === "number" ? outAny2.estimate_low : null;
      const estimateHigh = typeof outAny2?.estimate_high === "number" ? outAny2.estimate_high : null;
      const summary2 = typeof outAny2?.summary === "string" ? outAny2.summary : "";

      const baseUrl = getBaseUrlFromHeaders(req.headers);
      const publicQuoteUrl = baseUrl ? `${baseUrl}/q/${encodeURIComponent(tenantSlug)}` : null;
      const adminQuoteUrl = baseUrl ? `${baseUrl}/admin/quotes/${encodeURIComponent(quoteLogId)}` : null;

      const configured = Boolean(
        cfg.fromEmail && cfg.leadToEmail && businessName && customerEmail
      );

      renderEmailResult = {
        configured,
        lead_render: { attempted: false, ok: false, id: null as string | null, error: null as string | null },
        customer_render: { attempted: false, ok: false, id: null as string | null, error: null as string | null },
      };

      // Tenant (lead) render email
      if (cfg.fromEmail && cfg.leadToEmail) {
        try {
          renderEmailResult.lead_render.attempted = true;

          const htmlLead = renderLeadRenderCompleteEmailHTML({
            businessName,
            brandLogoUrl,
            quoteLogId,
            tenantSlug,
            customerName,
            customerEmail,
            customerPhone,
            renderImageUrl: imageUrl,
            estimateLow,
            estimateHigh,
            summary: summary2,
            adminQuoteUrl,
          });

          const r1 = await sendEmail({
            tenantId: tenant.id,
            context: { type: "lead_render_complete", quoteLogId },
            message: {
              from: cfg.fromEmail,
              to: [cfg.leadToEmail],
              replyTo: [cfg.leadToEmail],
              subject: `Render complete — ${customerName}`,
              html: htmlLead,
            },
          });

          renderEmailResult.lead_render.ok = r1.ok;
          renderEmailResult.lead_render.id = r1.providerMessageId ?? null;
          renderEmailResult.lead_render.error = r1.error ?? null;
        } catch (e: any) {
          renderEmailResult.lead_render.error = e?.message ?? String(e);
        }
      }

      // Customer render email
      if (cfg.fromEmail && customerEmail) {
        try {
          renderEmailResult.customer_render.attempted = true;

          const htmlCust = renderCustomerRenderCompleteEmailHTML({
            businessName,
            brandLogoUrl,
            customerName,
            quoteLogId,
            renderImageUrl: imageUrl,
            estimateLow,
            estimateHigh,
            summary: summary2,
            publicQuoteUrl,
            replyToEmail: cfg.leadToEmail ?? null,
          });

          const r2 = await sendEmail({
            tenantId: tenant.id,
            context: { type: "customer_render_complete", quoteLogId },
            message: {
              from: cfg.fromEmail,
              to: [customerEmail],
              replyTo: cfg.leadToEmail ? [cfg.leadToEmail] : undefined,
              subject: `Your concept render is ready — ${businessName}`,
              html: htmlCust,
            },
          });

          renderEmailResult.customer_render.ok = r2.ok;
          renderEmailResult.customer_render.id = r2.providerMessageId ?? null;
          renderEmailResult.customer_render.error = r2.error ?? null;
        } catch (e: any) {
          renderEmailResult.customer_render.error = e?.message ?? String(e);
        }
      }

      // Persist email result into output.render_email (best-effort)
      try {
        const nextOutput = { ...(outAny2 ?? {}), render_email: renderEmailResult };
        await db.execute(sql`
          update quote_logs
          set output = ${JSON.stringify(nextOutput)}::jsonb
          where id = ${quoteLogId}::uuid
        `);
      } catch {
        // ignore
      }
    } catch {
      // ignore; render still succeeds
    }

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