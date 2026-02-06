// src/lib/email/templates/renderCompleteCustomer.ts

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return `$${Math.round(v).toLocaleString()}`;
}

export function renderCustomerRenderCompleteEmailHTML(args: {
  businessName: string;

  // branding
  brandLogoUrl?: string | null;
  brandLogoVariant?: "light" | "dark" | null;

  customerName: string;
  quoteLogId: string; // kept for API compatibility (not shown to customer)

  renderImageUrl: string;

  estimateLow?: number | null;
  estimateHigh?: number | null;
  summary?: string | null;

  // optional deep links
  publicQuoteUrl?: string | null; // kept for compatibility (not used)
  replyToEmail?: string | null;
}) {
  const { businessName, brandLogoUrl, brandLogoVariant, customerName, renderImageUrl, estimateLow, estimateHigh, summary, replyToEmail } =
    args;

  const hasRange = typeof estimateLow === "number" && typeof estimateHigh === "number";
  const rangeText = hasRange ? `${money(estimateLow)} – ${money(estimateHigh)}` : "";

  const safeSummary = String(summary ?? "").trim();

  const logoVariant = brandLogoVariant ?? "dark";

  const topLogo = brandLogoUrl
    ? logoVariant === "light"
      ? `<div style="background:#0b0b0b;padding:10px 12px;border-radius:10px;display:inline-block;">
           <img src="${esc(brandLogoUrl)}" alt="${esc(
             businessName
           )}" style="height:28px;max-width:180px;object-fit:contain;display:block;" />
         </div>`
      : `<img src="${esc(brandLogoUrl)}" alt="${esc(
          businessName
        )}" style="height:28px;max-width:180px;object-fit:contain;display:block;" />`
    : `<div style="font-weight:800;font-size:14px;letter-spacing:.2px;color:#111;">${esc(businessName)}</div>`;

  const preheader = `Your concept rendering is ready — a vision for what’s possible.`;

  const replyLine = replyToEmail
    ? `<div style="margin-top:10px;color:#6b7280;font-size:12px;">
         Questions? Reply to this email or contact <span style="font-weight:700;color:#111;">${esc(
           replyToEmail
         )}</span>.
       </div>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Concept Rendering Ready</title>
  </head>
  <body style="margin:0;background:#f6f7fb;color:#111;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${esc(preheader)}
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f7fb;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
            style="max-width:640px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 12px 40px rgba(17,24,39,.12);">

            <!-- Top bar -->
            <tr>
              <td style="padding:18px 20px;border-bottom:1px solid #eef0f4;">
                <table role="presentation" width="100%">
                  <tr>
                    <td align="left" style="vertical-align:middle;">
                      ${topLogo}
                    </td>
                    <td align="right" style="vertical-align:middle;">
                      <div style="font-size:12px;color:#6b7280;font-weight:700;">Concept Render</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Hero -->
            <tr>
              <td style="padding:18px 20px 0;">
                <div style="font-size:22px;font-weight:900;letter-spacing:-.2px;margin:0 0 6px;">
                  Your concept is ready ✨
                </div>
                <div style="font-size:14px;line-height:1.5;color:#374151;">
                  Hi ${esc(customerName)}, here’s a sharp visual concept of what your finished result could look like.
                </div>
              </td>
            </tr>

            <!-- Image -->
            <tr>
              <td style="padding:16px 20px 0;">
                <div style="border-radius:16px;overflow:hidden;border:1px solid #eef0f4;background:#f9fafb;">
                  <img src="${esc(renderImageUrl)}" alt="Concept rendering"
                       style="width:100%;display:block;line-height:0;" />
                </div>
                <div style="margin-top:10px;font-size:12px;color:#6b7280;">
                  This is a concept rendering generated from your photos and notes — final results depend on materials and inspection.
                </div>
              </td>
            </tr>

            <!-- Summary + Range -->
            <tr>
              <td style="padding:16px 20px 0;">
                <div style="border:1px solid #eef0f4;border-radius:16px;padding:14px 14px;background:#ffffff;">
                  ${
                    rangeText
                      ? `<div style="font-size:12px;color:#6b7280;font-weight:800;">Estimate range</div>
                         <div style="margin-top:6px;font-size:18px;font-weight:900;color:#111;">${esc(
                           rangeText
                         )}</div>`
                      : `<div style="font-size:12px;color:#6b7280;font-weight:800;">Estimate</div>
                         <div style="margin-top:6px;font-size:16px;font-weight:900;color:#111;">Pending inspection</div>`
                  }

                  ${
                    safeSummary
                      ? `<div style="margin-top:12px;">
                           <div style="font-size:12px;color:#6b7280;font-weight:800;">Summary</div>
                           <div style="margin-top:6px;font-size:14px;line-height:1.5;color:#111;white-space:pre-wrap;">${esc(
                             safeSummary
                           )}</div>
                         </div>`
                      : ""
                  }
                </div>
              </td>
            </tr>

            <!-- Contact line (optional) -->
            <tr>
              <td style="padding:16px 20px 22px;">
                ${replyLine}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:18px 20px;background:#0b0b0b;">
                <div style="color:#e5e7eb;font-size:12px;line-height:1.5;">
                  <div style="font-weight:900;color:#fff;margin-bottom:6px;">${esc(businessName)}</div>
                  Concept renders are visual aids — final scope and pricing may change after inspection.
                </div>
                <div style="margin-top:10px;color:#9ca3af;font-size:11px;">
                  Powered by AI Photo Quote
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}