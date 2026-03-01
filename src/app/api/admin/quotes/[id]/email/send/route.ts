import { NextResponse } from "next/server";
import { sendComposerEmail } from "@/lib/emailComposer/sendComposerEmail";
import { buildQuoteCanvasEmailHtml, buildQuoteCanvasText } from "@/lib/emailComposer/templates/quoteCanvas";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();

    const {
      tenantId,
      to,
      cc,
      bcc,
      subject,
      headline,
      intro,
      closing,
      featuredImage,
      galleryImages,
    } = body;

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

    const result = await sendComposerEmail({
      tenantId,
      message: {
        from: body.from,
        to: Array.isArray(to) ? to : [to],
        cc,
        bcc,
        subject,
        html,
        text,
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