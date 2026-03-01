// src/app/api/admin/quotes/[id]/email/send/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { sendComposerEmail } from "@/lib/emailComposer/sendComposerEmail";
import { buildQuoteCanvasEmailHtml, buildQuoteCanvasText } from "@/lib/emailComposer/templates/quoteCanvas";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function buildPlatformFrom(): string | null {
  const fallback = safeTrim(process.env.RESEND_FALLBACK_FROM) || safeTrim(process.env.PLATFORM_FROM_EMAIL);
  if (!fallback) return null;

  // If RESEND_FALLBACK_FROM already includes a display-name, keep it.
  // Otherwise optionally add PLATFORM_FROM_NAME.
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

// NOTE: label is REQUIRED by template typing (can be empty string)
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
 * 1) { featuredImage, galleryImages }
 * 2) { selectedImages: [{url,label}] } (we auto-pick first as featured)
 * 3) { images: [...] }
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

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const quoteId = safeTrim(id);

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
    const intro = String(body?.intro ?? "");
    const closing = String(body?.closing ?? "");

    // Branding (from preview payload)
    const shopName = safeTrim(body?.shopName ?? body?.brand?.shopName ?? body?.lead?.shopName ?? "");
    const shopLogoUrl = safeTrim(body?.shopLogoUrl ?? body?.brand?.shopLogoUrl ?? body?.logoUrl ?? "");
    const brandSubtitle = safeTrim(body?.brandSubtitle ?? "");

    // Images
    const { featuredImage, galleryImages } = deriveImages(body);

    // Quote blocks payload (forwarded)
    const qb = body?.quoteBlocks && typeof body.quoteBlocks === "object" ? body.quoteBlocks : null;

    // Template HTML/Text (now supports brand + quoteBlocks)
    const html = buildQuoteCanvasEmailHtml({
      headline: headline || subject,
      intro,
      closing,
      subject,
      shopName: shopName || null,
      shopLogoUrl: shopLogoUrl || null,
      brandSubtitle: brandSubtitle || null,
      featuredImage,
      galleryImages,
      quoteBlocks: qb,
    });

    const text = buildQuoteCanvasText({
      headline: headline || subject,
      intro,
      closing,
      shopName: shopName || null,
      quoteBlocks: qb,
    });

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

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}