// src/app/api/admin/quotes/[id]/email/send/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { sendComposerEmail } from "@/lib/emailComposer/sendComposerEmail";
import {
  buildQuoteCanvasEmailHtml,
  buildQuoteCanvasText,
} from "@/lib/emailComposer/templates/quoteCanvas";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function buildPlatformFrom(): string | null {
  const fallback =
    safeTrim(process.env.RESEND_FALLBACK_FROM) ||
    safeTrim(process.env.PLATFORM_FROM_EMAIL);

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

// NOTE: label is REQUIRED because buildQuoteCanvasEmailHtml expects it.
type Img = { url: string; label: string };

function normalizeImg(v: any): Img | null {
  const url = safeTrim(v?.url ?? v?.publicUrl ?? v?.blobUrl ?? v);
  if (!url) return null;

  // Always provide a label (can be empty string)
  const label = safeTrim(v?.label ?? "");
  return { url, label };
}

function normalizeImgs(v: any): Img[] {
  if (!Array.isArray(v)) return [];
  return v.map(normalizeImg).filter(Boolean) as Img[];
}

/**
 * Accept a few possible client payloads:
 * 1) { featuredImage, galleryImages } (your current route)
 * 2) { selectedImages: [{url,label,kind}] } (easy add if you want)
 * 3) { images: [...] } (generic)
 */
function deriveImages(body: any): { featuredImage: Img | null; galleryImages: Img[] } {
  // Preferred: explicit featured + gallery
  const featured = normalizeImg(body?.featuredImage);
  const gallery = normalizeImgs(body?.galleryImages);

  if (featured || gallery.length) {
    return { featuredImage: featured, galleryImages: gallery };
  }

  // Alternative: selectedImages array (we can auto-pick first as featured)
  const selected = normalizeImgs(body?.selectedImages ?? body?.images ?? []);
  if (selected.length) {
    return { featuredImage: selected[0], galleryImages: selected.slice(1) };
  }

  return { featuredImage: null, galleryImages: [] };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const quoteId = safeTrim(id);

    const body: any = await req.json().catch(() => ({}));

    const tenantId = safeTrim(body?.tenantId);
    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "Missing tenantId" },
        { status: 400 }
      );
    }

    const to = asStringArray(body?.to);
    if (!to.length) {
      return NextResponse.json(
        { ok: false, error: "Missing to" },
        { status: 400 }
      );
    }

    const subject = safeTrim(body?.subject);
    if (!subject) {
      return NextResponse.json(
        { ok: false, error: "Missing subject" },
        { status: 400 }
      );
    }

    const headline = safeTrim(body?.headline);
    const intro = safeTrim(body?.intro);
    const closing = safeTrim(body?.closing);

    // Images: accept multiple shapes
    const { featuredImage, galleryImages } = deriveImages(body);

    // Template HTML/Text
    const html = buildQuoteCanvasEmailHtml({
      headline,
      intro,
      closing,
      subject,
      featuredImage,
      galleryImages,
    });

    const text = buildQuoteCanvasText({
      headline,
      intro,
      closing,
    });

    // Ensure From exists (providers require it)
    const from =
      safeTrim(body?.from) ||
      buildPlatformFrom() ||
      null;

    if (!from) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing from and no PLATFORM_FROM_EMAIL/RESEND_FALLBACK_FROM configured",
        },
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
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}