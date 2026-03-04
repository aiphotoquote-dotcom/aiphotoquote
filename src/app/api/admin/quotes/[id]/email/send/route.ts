// src/app/api/admin/quotes/[id]/email/send/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { sendComposerEmail } from "@/lib/emailComposer/sendComposerEmail";
import { buildQuoteCanvasEmailHtml, buildQuoteCanvasText } from "@/lib/emailComposer/templates/quoteCanvas";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function buildPlatformFrom(): string | null {
  const fallback = safeTrim(process.env.RESEND_FALLBACK_FROM) || safeTrim(process.env.PLATFORM_FROM_EMAIL);
  if (!fallback) return null;

  const name = safeTrim(process.env.PLATFORM_FROM_NAME);
  if (fallback.includes("<") && fallback.includes(">")) return fallback;
  return name ? `${name} <${fallback}>` : fallback;
}

function asStringArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => safeTrim(x)).filter(Boolean);
  const s = safeTrim(v);
  return s ? [s] : [];
}

function asOptionalStringArray(v: any): string[] | undefined {
  const xs = asStringArray(v);
  return xs.length ? xs : undefined;
}

// NOTE: label is REQUIRED because buildQuoteCanvasEmailHtml expects it.
type Img = { url: string; label: string };

function normalizeImg(v: any): Img | null {
  const url = safeTrim(v?.url ?? v?.publicUrl ?? v?.blobUrl ?? v);
  if (!url) return null;
  const label = safeTrim(v?.label ?? "");
  return { url, label };
}

function normalizeImgs(v: any): Img[] {
  if (!Array.isArray(v)) return [];
  return v.map(normalizeImg).filter(Boolean) as Img[];
}

/**
 * Accept a few possible client payloads:
 * 1) { featuredImage, galleryImages } (preferred)
 * 2) { selectedImages: [{url,label,kind}] } (fallback)
 * 3) { images: [...] } (generic)
 */
function deriveImages(body: any): { featuredImage: Img | null; galleryImages: Img[] } {
  const featured = normalizeImg(body?.featuredImage);
  const gallery = normalizeImgs(body?.galleryImages);

  if (featured || gallery.length) {
    return { featuredImage: featured, galleryImages: gallery };
  }

  const selected = normalizeImgs(body?.selectedImages ?? body?.images ?? []);
  if (selected.length) {
    return { featuredImage: selected[0], galleryImages: selected.slice(1) };
  }

  return { featuredImage: null, galleryImages: [] };
}

function deriveBrand(body: any): { name?: string; logoUrl?: string; tagline?: string } | undefined {
  const b = body?.brand ?? null;
  const name = safeTrim(b?.name ?? body?.shopName ?? "");
  const logoUrl = safeTrim(b?.logoUrl ?? body?.shopLogoUrl ?? "");
  const tagline = safeTrim(b?.tagline ?? body?.brandSubtitle ?? body?.brandTagline ?? "");

  const out = {
    ...(name ? { name } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(tagline ? { tagline } : {}),
  };

  return Object.keys(out).length ? out : undefined;
}

/**
 * Best-effort email send logging.
 * IMPORTANT: We cannot assume every environment already has the “rich” columns.
 * So we attempt a rich insert first, then fall back to the minimal insert shape.
 */
async function logQuoteEmailSend(args: {
  tenantId: string;
  quoteLogId: string;

  kind: string; // "composer" etc.
  initiatedBy: "tenant" | "system";

  from: string;
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;

  subject: string;
  html: string;
  text: string;

  result: {
    ok: boolean;
    provider?: string;
    providerMessageId?: string | null;
    error?: string | null;
    meta?: any;
  };
}) {
  // Normalize for logging
  const provider = String(args.result.provider ?? "") || null;
  const providerMessageId = args.result.providerMessageId ?? null;
  const ok = Boolean(args.result.ok);
  const error = ok ? null : (args.result.error ?? "UNKNOWN_EMAIL_ERROR");

  // Meta is safe even if we later choose to not store html/text columns (viewer can use it later)
  const metaObj = {
    initiatedBy: args.initiatedBy,
    // store recipients + payload for later read-only viewing
    message: {
      from: args.from,
      to: args.to,
      cc: args.cc ?? [],
      bcc: args.bcc ?? [],
      subject: args.subject,
    },
    content: {
      html: args.html,
      text: args.text,
    },
    providerResult: args.result.meta ?? null,
  };

  // Attempt 1: rich schema (if columns exist)
  try {
    await db.execute(sql`
      insert into quote_email_sends (
        id,
        tenant_id,
        quote_log_id,
        kind,
        initiated_by,
        from_email,
        to_emails,
        cc_emails,
        bcc_emails,
        subject,
        provider,
        provider_message_id,
        ok,
        error,
        html,
        text,
        meta,
        created_at
      )
      values (
        gen_random_uuid(),
        ${args.tenantId}::uuid,
        ${args.quoteLogId}::uuid,
        ${args.kind},
        ${args.initiatedBy},
        ${args.from},
        ${JSON.stringify(args.to)}::jsonb,
        ${JSON.stringify(args.cc ?? [])}::jsonb,
        ${JSON.stringify(args.bcc ?? [])}::jsonb,
        ${args.subject},
        ${provider},
        ${providerMessageId},
        ${ok},
        ${error},
        ${args.html},
        ${args.text},
        ${JSON.stringify(metaObj)}::jsonb,
        now()
      )
    `);

    return; // success
  } catch {
    // fall through
  }

  // Attempt 2: minimal schema (what you already had)
  try {
    await db.execute(sql`
      insert into quote_email_sends (
        id,
        tenant_id,
        quote_log_id,
        kind,
        to_emails,
        subject,
        provider,
        provider_message_id,
        ok,
        error,
        created_at
      )
      values (
        gen_random_uuid(),
        ${args.tenantId}::uuid,
        ${args.quoteLogId}::uuid,
        ${args.kind},
        ${JSON.stringify(args.to)}::jsonb,
        ${args.subject},
        ${provider},
        ${providerMessageId},
        ${ok},
        ${error},
        now()
      )
    `);
  } catch {
    // logging should never break the send response
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const quoteId = safeTrim(id);
    if (!quoteId) return NextResponse.json({ ok: false, error: "Missing quote id" }, { status: 400 });

    const body: any = await req.json().catch(() => ({}));

    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Missing tenantId" }, { status: 400 });
    }

    const to = asStringArray(body?.to);
    if (!to.length) {
      return NextResponse.json({ ok: false, error: "Missing to" }, { status: 400 });
    }

    const subject = safeTrim(body?.subject);
    if (!subject) {
      return NextResponse.json({ ok: false, error: "Missing subject" }, { status: 400 });
    }

    const headline = safeTrim(body?.headline);
    const intro = safeTrim(body?.intro);
    const closing = safeTrim(body?.closing);

    const { featuredImage, galleryImages } = deriveImages(body);

    // Ensure From exists (providers require it)
    const from = safeTrim(body?.from) || buildPlatformFrom() || null;
    if (!from) {
      return NextResponse.json(
        { ok: false, error: "Missing from and no PLATFORM_FROM_EMAIL/RESEND_FALLBACK_FROM configured" },
        { status: 400 }
      );
    }

    const cc = asOptionalStringArray(body?.cc);
    const bcc = asOptionalStringArray(body?.bcc);

    const brand = deriveBrand(body);
    const quoteBlocks = body?.quoteBlocks ?? undefined;

    // Template HTML/Text
    const html = buildQuoteCanvasEmailHtml({
      headline,
      intro,
      closing,
      subject,
      featuredImage,
      galleryImages,
      brand,
      quoteBlocks,
      // ✅ make the “Approved” button clickable via mailto
      replyToEmail: from,
    });

    const text = buildQuoteCanvasText({
      headline,
      intro,
      closing,
      brand,
      quoteBlocks,
    });

    const result = await sendComposerEmail({
      tenantId,
      message: {
        from,
        to,
        cc,
        bcc,
        subject,
        html,
        text,
        headers: {
          "X-APQ-Composer": "1",
          ...(quoteId ? { "X-APQ-QuoteId": quoteId } : {}),
        },
      },
    });

    // ✅ log send (best-effort)
    await logQuoteEmailSend({
      tenantId,
      quoteLogId: quoteId,
      kind: "composer",
      initiatedBy: "tenant",
      from,
      to,
      cc,
      bcc,
      subject,
      html,
      text,
      result: {
        ok: Boolean((result as any)?.ok),
        provider: (result as any)?.provider,
        providerMessageId: (result as any)?.providerMessageId ?? null,
        error: (result as any)?.error ?? null,
        meta: (result as any)?.meta ?? null,
      },
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}