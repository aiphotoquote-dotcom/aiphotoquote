// src/app/api/quote/submit/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";

import { db } from "@/lib/db/client";
import { tenants, tenantSecrets, tenantSettings, quoteLogs } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

import { sendEmail } from "@/lib/email";
import { getTenantEmailConfig } from "@/lib/email/tenantEmail";
import { renderLeadNewEmailHTML } from "@/lib/email/templates/leadNew";
import { renderCustomerReceiptEmailHTML } from "@/lib/email/templates/customerReceipt";

export const runtime = "nodejs";

const CustomerSchema = z.object({
  name: z.string().min(2, "Name is required"),
  phone: z.string().min(7, "Phone is required"),
  email: z.string().email("Valid email is required"),
});

const Req = z.object({
  tenantSlug: z.string().min(3),
  images: z
    .array(z.object({ url: z.string().url(), shotType: z.string().optional() }))
    .min(1)
    .max(12),

  customer: CustomerSchema.optional(),
  contact: CustomerSchema.optional(),

  render_opt_in: z.boolean().optional(),
  customer_context: z
    .object({
      notes: z.string().optional(),
      service_type: z.string().optional(),
      category: z.string().optional(),
    })
    .optional(),
});

function normalizePhone(raw: string) {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d;
}

const AiOutputSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  inspection_required: z.boolean(),
  estimate_low: z.number().nonnegative(),
  estimate_high: z.number().nonnegative(),
  currency: z.string().default("USD"),
  summary: z.string(),
  visible_scope: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
});

function clampMoney(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function ensureLowHigh(low: number, high: number) {
  const a = clampMoney(low);
  const b = clampMoney(high);
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = Req.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "INVALID_BODY", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tenantSlug, images } = parsed.data;

    // Accept customer OR contact (but require one)
    const incoming = parsed.data.customer ?? parsed.data.contact;
    if (!incoming) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_CUSTOMER",
          message: "Customer info is required (name, phone, email).",
        },
        { status: 400 }
      );
    }

    const customer = {
      name: safeTrim(incoming.name),
      phone: normalizePhone(incoming.phone),
      email: safeTrim(incoming.email).toLowerCase(),
    };

    if (customer.phone.replace(/\D/g, "").length < 10) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PHONE", message: "Phone must include at least 10 digits." },
        { status: 400 }
      );
    }

    // Tenant lookup
    const tenant = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!tenant) {
      return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    }

    // Settings (optional) - include branding fields
    const settings = await db
      .select({
        tenantId: tenantSettings.tenantId,
        industryKey: tenantSettings.industryKey,
        aiRenderingEnabled: tenantSettings.aiRenderingEnabled,
        brandLogoUrl: tenantSettings.brandLogoUrl,
        businessName: tenantSettings.businessName,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    const industryKey = settings?.industryKey ?? "service";
    const aiRenderingEnabled = settings?.aiRenderingEnabled === true;

    // Branding (best-effort)
    const brandLogoUrl = safeTrim(settings?.brandLogoUrl) || null;
    const businessNameFromSettings = safeTrim(settings?.businessName) || null;

    // Decrypt OpenAI key
    const secretRow = await db
      .select({ openaiKeyEnc: tenantSecrets.openaiKeyEnc })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, tenant.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!secretRow?.openaiKeyEnc) {
      return NextResponse.json({ ok: false, error: "MISSING_OPENAI_KEY" }, { status: 400 });
    }

    const openaiKey = decryptSecret(secretRow.openaiKeyEnc);
    const openai = new OpenAI({ apiKey: openaiKey });

    // Only allow render opt-in if tenant enabled it
    const renderOptIn = aiRenderingEnabled ? Boolean(parsed.data.render_opt_in) : false;

    const customer_context = parsed.data.customer_context ?? {};
    const category = customer_context.category ?? industryKey ?? "service";
    const service_type = customer_context.service_type ?? "upholstery";
    const notes = customer_context.notes ?? "";

    // --- Build input we store (consistent, includes customer) ---
    const inputToStore = {
      tenantSlug,
      images,
      render_opt_in: renderOptIn,
      customer,
      customer_context: {
        category,
        service_type,
        notes,
      },
      createdAt: new Date().toISOString(),
    };

    // -------------------------
    // AI estimate (vision)
    // -------------------------
    const system = [
      "You are an expert estimator for service work based on photos and customer notes.",
      "Be conservative: return a realistic RANGE, not a single number.",
      "If photos are insufficient or ambiguous, set confidence low and inspection_required true.",
      "Do not invent brand/model/year—ask questions instead.",
      "Return ONLY valid JSON matching the provided schema.",
    ].join("\n");

    const userText = [
      `Category: ${category}`,
      `Service type: ${service_type}`,
      `Customer notes: ${notes || "(none)"}`,
      "",
      "Instructions:",
      "- Use the photos to identify the item, material type, and visible damage/wear.",
      "- Provide estimate_low and estimate_high (whole dollars).",
      "- Provide visible_scope as short bullet-style strings.",
      "- Provide assumptions and questions (3–8 items each is fine).",
    ].join("\n");

    const content: any[] = [{ type: "text", text: userText }];
    for (const img of images) {
      content.push({ type: "image_url", image_url: { url: img.url } });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
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

    let outputParsed: any = null;
    try {
      outputParsed = JSON.parse(raw);
    } catch {
      outputParsed = null;
    }

    let output: any;
    const safe = AiOutputSchema.safeParse(outputParsed);
    if (!safe.success) {
      output = {
        confidence: "low",
        inspection_required: true,
        estimate_low: 0,
        estimate_high: 0,
        currency: "USD",
        summary:
          "We couldn't generate a structured estimate from this submission. Please add 2–6 clear photos and any details you can.",
        visible_scope: [],
        assumptions: [],
        questions: ["Can you add a wide shot and 1–2 close-ups of the problem area?"],
        _raw: raw,
      };
    } else {
      const v = safe.data;
      const { low, high } = ensureLowHigh(v.estimate_low, v.estimate_high);
      output = {
        confidence: v.confidence,
        inspection_required: Boolean(v.inspection_required),
        estimate_low: low,
        estimate_high: high,
        currency: v.currency || "USD",
        summary: String(v.summary || "").trim(),
        visible_scope: Array.isArray(v.visible_scope) ? v.visible_scope : [],
        assumptions: Array.isArray(v.assumptions) ? v.assumptions : [],
        questions: Array.isArray(v.questions) ? v.questions : [],
      };
    }

    // Save quote log
    const inserted = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input: inputToStore,
        output,
        renderOptIn,
      })
      .returning({ id: quoteLogs.id })
      .then((r) => r[0] ?? null);

    const quoteLogId = inserted?.id ? String(inserted.id) : null;

    // -------------------------
    // Email (best effort)
    // -------------------------
    let emailResult: any = null;

    if (quoteLogId) {
      try {
        const cfg = await getTenantEmailConfig(tenant.id);

        // Prefer tenant_settings.business_name if present (branding)
        const effectiveBusinessName = businessNameFromSettings || cfg.businessName || tenant.name;

        const configured = Boolean(
          process.env.RESEND_API_KEY?.trim() &&
            effectiveBusinessName &&
            cfg.leadToEmail &&
            cfg.fromEmail
        );

        emailResult = {
          configured,
          mode: cfg.sendMode ?? "standard",
          lead_new: {
            attempted: false,
            ok: false,
            provider: "resend",
            id: null as string | null,
            error: null as string | null,
          },
          customer_receipt: {
            attempted: false,
            ok: false,
            provider: "resend",
            id: null as string | null,
            error: null as string | null,
          },
          missing: {
            RESEND_API_KEY: !Boolean(process.env.RESEND_API_KEY?.trim()),
            business_name: !Boolean(effectiveBusinessName),
            lead_to_email: !cfg.leadToEmail,
            resend_from_email: !cfg.fromEmail,
          },
        };

        if (configured) {
          // Lead: New submission
          try {
            emailResult.lead_new.attempted = true;

            const leadHtml = renderLeadNewEmailHTML({
              businessName: effectiveBusinessName!,
              tenantSlug,
              quoteLogId,
              customer,
              notes,
              imageUrls: images.map((x) => x.url),
              // If your leadNew template ignores this, no harm. If it supports it later, it’s ready.
              brandLogoUrl: brandLogoUrl,
            } as any);

            const r1 = await sendEmail({
              tenantId: tenant.id,
              context: { type: "lead_new", quoteLogId },
              message: {
                from: cfg.fromEmail!,
                to: [cfg.leadToEmail!],
                replyTo: [cfg.leadToEmail!],
                subject: `New Photo Quote — ${customer.name}`,
                html: leadHtml,
              },
            });

            emailResult.lead_new.ok = r1.ok;
            emailResult.lead_new.id = r1.providerMessageId ?? null;
            emailResult.lead_new.error = r1.error ?? null;
          } catch (e: any) {
            emailResult.lead_new.error = e?.message ?? String(e);
          }

         // Customer: Receipt
try {
  emailResult.customer_receipt.attempted = true;

  const custHtml = renderCustomerReceiptEmailHTML({
    businessName: effectiveBusinessName!,
    customerName: customer.name,

    // core estimate
    summary: output.summary ?? "",
    estimateLow: output.estimate_low ?? 0,
    estimateHigh: output.estimate_high ?? 0,

    // AI details (NEW)
    confidence: output.confidence ?? null,
    inspectionRequired: output.inspection_required ?? null,
    visibleScope: output.visible_scope ?? [],
    assumptions: output.assumptions ?? [],
    questions: output.questions ?? [],

    // photos submitted (NEW)
    imageUrls: images.map((x) => x.url),

    // branding/support
    brandLogoUrl: brandLogoUrl,
    replyToEmail: cfg.leadToEmail ?? null,

    // back-compat only (not displayed)
    quoteLogId,
  });

  const r2 = await sendEmail({
    tenantId: tenant.id,
    context: { type: "customer_receipt", quoteLogId },
    message: {
      from: cfg.fromEmail!,
      to: [customer.email],
      replyTo: [cfg.leadToEmail!],
      subject: `Your AI Photo Quote — ${effectiveBusinessName}`,
      html: custHtml,
    },
  });

  emailResult.customer_receipt.ok = r2.ok;
  emailResult.customer_receipt.id = r2.providerMessageId ?? null;
  emailResult.customer_receipt.error = r2.error ?? null;
} catch (e: any) {
  emailResult.customer_receipt.error = e?.message ?? String(e);
}

        // Persist into quote_logs.output.email (best effort)
        try {
          const nextOutput = { ...(output ?? {}), email: emailResult };
          await db.execute(sql`
            update quote_logs
            set output = ${JSON.stringify(nextOutput)}::jsonb
            where id = ${quoteLogId}::uuid
          `);
          output = nextOutput;
        } catch {
          // ignore
        }
      } catch (e: any) {
        emailResult = { configured: false, error: e?.message ?? String(e) };
        output = { ...(output ?? {}), email: emailResult };
      }
    }

    return NextResponse.json({
      ok: true,
      quoteLogId,
      output,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "INTERNAL", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}