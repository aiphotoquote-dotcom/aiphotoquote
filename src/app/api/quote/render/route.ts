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

// ✅ NEW: PCC config (render prompt template + style presets live here)
import { loadPlatformLlmConfig } from "@/lib/pcc/llm/store";

export const runtime = "nodejs";

const Req = z.object({
  tenantSlug: z.string().min(3),
  quoteLogId: z.string().uuid(),
});

function safeErr(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e ?? "Unknown error");
  return msg.slice(0, 2000);
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function containsDenylistedText(s: string, denylist: string[]) {
  const hay = String(s ?? "").toLowerCase();
  return denylist.some((w) => hay.includes(String(w).toLowerCase()));
}

type RenderGuardrails = {
  enabledByPlatform: boolean;
  denylist?: string[];
  extraPromptPreamble?: string;
  maxDailyPerTenant?: number;
};

function loadRenderGuardrails(): RenderGuardrails {
  // optional JSON override
  const raw = process.env.PCC_RENDER_GUARDRAILS?.trim();
  if (raw) {
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === "object") return j as RenderGuardrails;
    } catch {
      // ignore
    }
  }

  return {
    enabledByPlatform: true,
    extraPromptPreamble: [
      "You are generating a safe, non-violent, non-sexual concept render for legitimate service work.",
      "Do NOT add text, watermarks, logos, brand marks, or UI overlays.",
      "No nudity, no explicit content, no weapons, no illegal activity.",
    ].join("\n"),
    denylist: ["weapon", "gun", "bomb", "explosive", "nude", "porn", "sex", "credit card", "ssn", "social security"],
    maxDailyPerTenant: 250, // soft cap; later PCC will be per-tenant billing
  };
}

function getBaseUrl(req: Request) {
  const envBase = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || "";
  if (envBase) return envBase.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`.replace(/\/+$/, "");

  return "";
}

function joinDedupeStrings(...lists: Array<Array<string> | undefined | null>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const arr of lists) {
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      const s = String(raw ?? "").trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

function fillTemplate(template: string, vars: Record<string, string>) {
  let t = String(template ?? "");
  for (const [k, v] of Object.entries(vars)) {
    t = t.split(`{${k}}`).join(v ?? "");
  }
  // remove repeated blank lines
  t = t
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((line, idx, arr) => !(line.trim() === "" && (arr[idx - 1]?.trim() === "")))
    .join("\n")
    .trim();

  return t;
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
    const tenant = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND", message: "Invalid tenant link.", debugId },
        { status: 404 }
      );
    }

    // 2) Load quote log (must match tenant)
    const q = await db
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
      .limit(1)
      .then((r) => r[0] ?? null);

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

    // ---- platform/tenant rendering policy (v1) ----
    const platform = loadRenderGuardrails();
    if (!platform.enabledByPlatform) {
      await db
        .update(quoteLogs)
        .set({ renderStatus: "failed", renderError: "Rendering disabled by platform policy." })
        .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

      return NextResponse.json(
        { ok: false, error: "RENDERING_DISABLED", message: "Rendering is currently disabled.", debugId },
        { status: 403 }
      );
    }

    const settings = await db
      .select({
        renderingEnabled: tenantSettings.renderingEnabled,
        renderingStyle: tenantSettings.renderingStyle,
        renderingNotes: tenantSettings.renderingNotes,
        renderingMaxPerDay: tenantSettings.renderingMaxPerDay,
        businessName: tenantSettings.businessName,
        brandLogoUrl: tenantSettings.brandLogoUrl,
        leadToEmail: tenantSettings.leadToEmail,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    // Tenant must allow rendering too
    if (settings?.renderingEnabled === false) {
      await db
        .update(quoteLogs)
        .set({ renderStatus: "failed", renderError: "Rendering disabled by tenant settings." })
        .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

      return NextResponse.json(
        { ok: false, error: "RENDERING_DISABLED", message: "Tenant has disabled rendering.", debugId },
        { status: 403 }
      );
    }

    // Optional per-tenant/per-platform daily cap (soft enforcement)
    const tenantCap = Number(settings?.renderingMaxPerDay ?? 0) || 0;
    const platformCap = Number(platform.maxDailyPerTenant ?? 0) || 0;
    const effectiveCap =
      tenantCap > 0 && platformCap > 0 ? Math.min(tenantCap, platformCap) : tenantCap > 0 ? tenantCap : platformCap;

    if (effectiveCap > 0) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);

      const rows: any[] = await db.execute(sql`
        select count(*)::int as n
        from quote_logs
        where tenant_id = ${tenant.id}::uuid
          and render_status = 'rendered'
          and rendered_at >= ${day.toISOString()}::timestamptz
      `);

      const n = Number((rows as any)?.[0]?.n ?? (rows as any)?.rows?.[0]?.n ?? 0);
      if (Number.isFinite(n) && n >= effectiveCap) {
        await db
          .update(quoteLogs)
          .set({ renderStatus: "failed", renderError: `Render daily cap reached (${effectiveCap}).` })
          .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

        return NextResponse.json({ ok: false, error: "RENDER_LIMIT", message: "Daily render limit reached.", debugId }, { status: 429 });
      }
    }

    // Mark running
    await db
      .update(quoteLogs)
      .set({ renderStatus: "running", renderError: null })
      .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

    // 5) Fetch tenant OpenAI key
    const sec = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!sec?.openaiKeyEnc) {
      await db
        .update(quoteLogs)
        .set({ renderStatus: "failed", renderError: "Missing tenant OpenAI key (tenant_secrets)." })
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
        .set({ renderStatus: "failed", renderError: "Unable to decrypt tenant OpenAI key." })
        .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

      return NextResponse.json(
        { ok: false, error: "BAD_TENANT_KEY", message: "Tenant OpenAI key could not be decrypted.", debugId },
        { status: 500 }
      );
    }

    const openai = new OpenAI({ apiKey });

    // ✅ 6) Load PCC config (render prompt + presets + model)
    const pcc = await loadPlatformLlmConfig();

    // 7) Build prompt inputs
    const outAny: any = q.output ?? {};
    const summary = typeof outAny?.summary === "string" ? outAny.summary : "";
    const inputAny: any = q.input ?? {};
    const serviceType = inputAny?.customer_context?.service_type || inputAny?.customer_context?.category || "";
    const customerNotes = String(inputAny?.customer_context?.notes ?? "").trim();

    // Tenant-controlled selector + notes
    const tenantStyleKey = safeTrim(settings?.renderingStyle) || "photoreal";
    const tenantRenderNotes = safeTrim(settings?.renderingNotes) || "";

    // PCC-controlled presets (text)
    const presets = pcc?.prompts?.renderStylePresets ?? ({} as any);
    const presetText =
      tenantStyleKey === "clean_oem"
        ? safeTrim(presets.clean_oem)
        : tenantStyleKey === "custom"
        ? safeTrim(presets.custom)
        : safeTrim(presets.photoreal);

    // final style text fallback (should never be empty)
    const styleText =
      presetText ||
      "photorealistic, natural colors, clean lighting, product photography look, high detail";

    // Denylist = env/platform denylist + PCC blockedTopics (dedupe)
    const denylist = joinDedupeStrings(platform.denylist, pcc?.guardrails?.blockedTopics);

    const combinedTextForScan = [serviceType, summary, customerNotes, tenantRenderNotes, styleText].filter(Boolean).join("\n");
    if (denylist.length && containsDenylistedText(combinedTextForScan, denylist)) {
      await db
        .update(quoteLogs)
        .set({
          renderStatus: "failed",
          renderError: "Blocked by platform rendering denylist.",
        })
        .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

      return NextResponse.json(
        { ok: false, error: "CONTENT_BLOCKED", message: "This request can’t be rendered.", debugId },
        { status: 400 }
      );
    }

    // PCC-owned render preamble + template (fallback to env/platform defaults)
    const renderPromptPreamble =
      safeTrim(pcc?.prompts?.renderPromptPreamble) ||
      safeTrim(platform.extraPromptPreamble) ||
      "";

    const renderPromptTemplate =
      safeTrim(pcc?.prompts?.renderPromptTemplate) ||
      [
        "{renderPromptPreamble}",
        "Generate a realistic 'after' concept rendering based on the customer's photos.",
        "Do NOT add text or watermarks.",
        "Style: {style}",
        "{serviceTypeLine}",
        "{summaryLine}",
        "{customerNotesLine}",
        "{tenantRenderNotesLine}",
      ].join("\n");

    const prompt = fillTemplate(renderPromptTemplate, {
      renderPromptPreamble,

      style: styleText,

      serviceTypeLine: serviceType ? `Service type: ${serviceType}` : "",
      summaryLine: summary ? `Estimate summary context: ${summary}` : "",
      customerNotesLine: customerNotes ? `Customer notes: ${customerNotes}` : "",
      tenantRenderNotesLine: tenantRenderNotes ? `Tenant render notes: ${tenantRenderNotes}` : "",
    });

    await db
      .update(quoteLogs)
      .set({ renderPrompt: prompt })
      .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

    // 8) Generate image (model comes from PCC)
    const renderModel = safeTrim(pcc?.models?.renderModel) || "gpt-image-1";

    const imgResp: any = await openai.images.generate({
      model: renderModel,
      prompt,
      size: "1024x1024",
    });

    const b64: string | undefined = imgResp?.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image generation returned no b64_json.");

    const bytes = Buffer.from(b64, "base64");

    // 9) Upload to Vercel Blob
    const key = `renders/${tenantSlug}/${quoteLogId}-${Date.now()}.png`;
    const blob = await put(key, bytes, { access: "public", contentType: "image/png" });
    const imageUrl = blob?.url;
    if (!imageUrl) throw new Error("Blob upload returned no url.");

    // 10) Save to DB + mark rendered
    await db
      .update(quoteLogs)
      .set({
        renderStatus: "rendered",
        renderImageUrl: imageUrl,
        renderError: null,
        renderedAt: new Date(),
      })
      .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));

    // 11) Send render-complete emails (best-effort)
    try {
      const cfg = await getTenantEmailConfig(tenant.id);

      const businessName = (cfg.businessName || settings?.businessName || tenant.name || "Your Business").trim();
      const brandLogoUrl = settings?.brandLogoUrl ?? null;

      const customer = inputAny?.customer ?? inputAny?.contact ?? null;
      const customerName = String(customer?.name ?? "Customer").trim();
      const customerEmail = String(customer?.email ?? "").trim().toLowerCase();
      const customerPhone = String(customer?.phone ?? "").trim();

      const estimateLow = typeof outAny?.estimate_low === "number" ? outAny.estimate_low : null;
      const estimateHigh = typeof outAny?.estimate_high === "number" ? outAny.estimate_high : null;
      const summary2 = typeof outAny?.summary === "string" ? outAny.summary : "";

      const baseUrl = getBaseUrl(req);
      const publicQuoteUrl = baseUrl ? `${baseUrl}/q/${encodeURIComponent(tenantSlug)}` : null;
      const adminQuoteUrl = baseUrl ? `${baseUrl}/admin/quotes/${encodeURIComponent(quoteLogId)}` : null;

      const renderEmailResult: any = {
        lead_render: { attempted: false, ok: false, id: null as string | null, error: null as string | null },
        customer_render: { attempted: false, ok: false, id: null as string | null, error: null as string | null },
      };

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

      // Persist into output.render_email (best effort)
      try {
        const nextOutput = { ...(outAny ?? {}), render_email: renderEmailResult };
        await db.execute(sql`
          update quote_logs
          set output = ${JSON.stringify(nextOutput)}::jsonb
          where id = ${quoteLogId}::uuid
        `);
      } catch {
        // ignore
      }
    } catch {
      // ignore
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

    try {
      const body = await req.clone().json().catch(() => null);
      const parsed = Req.safeParse(body);
      if (parsed.success) {
        const { tenantSlug, quoteLogId } = parsed.data;

        const tenant = await db
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.slug, tenantSlug))
          .limit(1)
          .then((r) => r[0] ?? null);

        if (tenant) {
          await db
            .update(quoteLogs)
            .set({ renderStatus: "failed", renderError: msg })
            .where(and(eq(quoteLogs.id, quoteLogId), eq(quoteLogs.tenantId, tenant.id)));
        }
      }
    } catch {
      // ignore
    }

    return NextResponse.json(
      { ok: false, error: "REQUEST_FAILED", message: msg, debugId: `dbg_${Math.random().toString(36).slice(2, 10)}` },
      { status: 500 }
    );
  }
}