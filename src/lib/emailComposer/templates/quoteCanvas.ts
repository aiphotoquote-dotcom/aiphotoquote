export function buildQuoteCanvasEmailHtml(args: {
  headline: string;
  intro: string;
  closing: string;
  subject: string;
  featuredImage?: { url: string; label: string } | null;
  galleryImages?: Array<{ url: string; label: string }>;
}) {
  const gallery =
    args.galleryImages?.map(
      (img) => `
        <div style="margin-top:16px;">
          <img src="${img.url}" style="width:100%;border-radius:12px;" />
        </div>
      `
    ).join("") ?? "";

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;padding:32px;">
    <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:16px;padding:32px;">
      
      <h1 style="margin-top:0;font-size:24px;">
        ${args.headline}
      </h1>

      <div style="white-space:pre-wrap;font-size:15px;line-height:1.6;">
        ${args.intro}
      </div>

      ${
        args.featuredImage
          ? `
          <div style="margin-top:24px;">
            <img src="${args.featuredImage.url}" style="width:100%;border-radius:16px;" />
          </div>
        `
          : ""
      }

      ${gallery}

      <div style="margin-top:32px;white-space:pre-wrap;font-size:14px;">
        ${args.closing}
      </div>

    </div>
  </div>
  `;
}

export function buildQuoteCanvasText(args: {
  headline: string;
  intro: string;
  closing: string;
}) {
  return `
${args.headline}

${args.intro}

${args.closing}
`.trim();
}