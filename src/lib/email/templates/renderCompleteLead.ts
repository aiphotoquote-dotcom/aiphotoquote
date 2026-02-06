// src/lib/email/templates/renderCompleteLead.ts

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

type BrandLogoVariant = "light" | "dark" | null | undefined;

function renderTopLogo(args: {
  businessName: string;
  brandLogoUrl?: string | null;
  brandLogoVariant?: BrandLogoVariant;
}) {
  const { businessName, brandLogoUrl, brandLogoVariant } = args;

  if (!brandLogoUrl) {
    return `<div style="font-weight:900;font-size:14px;letter-spacing:.2px;color:#111;">${esc(businessName)}</div>`;
  }

  // If logo is "light", put it on a dark chip so it is visible in light-mode layouts.
  const isLight = String(brandLogoVariant ?? "").toLowerCase().trim() === "light";

  const img = `<img src="${esc(brandLogoUrl)}" alt="${esc(
    businessName
  )}" style="height:26px;max-width:180px;object-fit:contain;display:block;" />`;

  if (!isLight) return img;

  return `
    <div style="display:inline-block;background:#0b0b0b;border-radius:12px;padding:8px 10px;">
      ${img}
    </div>
  `;
}

export function renderLeadRenderCompleteEmailHTML(args: {
  businessName: string;

  // branding
  brandLogoUrl?: string | null;
  brandLogoVariant?: "light" | "dark" | null;

  quoteLogId: string;
  tenantSlug: string;

  customerName: string;
  customerEmail: string;
  customerPhone: string;

  renderImageUrl: string;

  estimateLow?: number | null;
  estimateHigh?: number | null;
  summary?: string | null;

  adminQuoteUrl?: string | null;
}) {
  const {
    businessName,
    brandLogoUrl,
    brandLogoVariant,
    quoteLogId,
    tenantSlug,
    customerName,
    customerEmail,
    customerPhone,
    renderImageUrl,
    estimateLow,
    estimateHigh,
    summary,
    adminQuoteUrl,
  } = args;

  const hasRange = typeof estimateLow === "number" && typeof estimateHigh === "number";
  const rangeText = hasRange ? `${money(estimateLow)} – ${money(estimateHigh)}` : "Pending inspection";

  const topLogo = renderTopLogo({ businessName, brandLogoUrl, brandLogoVariant });

  const safeSummary = String(summary ?? "").trim();

  const btn = adminQuoteUrl
    ? `<a href="${esc(adminQuoteUrl)}" target="_blank" rel="noopener"
         style="display:inline-block;background:#111;color:#fff;text-decoration:none;
                padding:11px 14px;border-radius:12px;font-weight:900;font-size:13px;">
         Open in Admin
       </a>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Render Complete</title>
  </head>
  <body style="margin:0;background:#f6f7fb;color:#111;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f7fb;">
      <tr>
        <td align="center" style="padding:22px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
            style="max-width:680px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 12px 40px rgba(17,24,39,.12);">

            <!-- Header -->
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #eef0f4;">
                <table role="presentation" width="100%">
                  <tr>
                    <td>${topLogo}</td>
                    <td align="right">
                      <div style="font-size:12px;color:#6b7280;font-weight:900;">RENDER COMPLETE</div>
                      <div style="font-size:11px;color:#9ca3af;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">
                        ${esc(quoteLogId)}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:16px 20px 0;">
                <div style="font-size:18px;font-weight:900;margin:0 0 8px;">
                  Concept render generated for ${esc(customerName)}
                </div>

                <div style="font-size:13px;line-height:1.5;color:#374151;">
                  Tenant: <b>${esc(tenantSlug)}</b> • Estimate: <b>${esc(rangeText)}</b>
                </div>
              </td>
            </tr>

            <!-- Image -->
            <tr>
              <td style="padding:14px 20px 0;">
                <div style="border-radius:16px;overflow:hidden;border:1px solid #eef0f4;background:#f9fafb;">
                  <img src="${esc(renderImageUrl)}" alt="Concept rendering" style="width:100%;display:block;" />
                </div>
              </td>
            </tr>

            <!-- Details -->
            <tr>
              <td style="padding:14px 20px 18px;">
                <div style="border:1px solid #eef0f4;border-radius:16px;padding:14px;">
                  <div style="font-size:12px;color:#6b7280;font-weight:900;">Customer</div>
                  <div style="margin-top:6px;font-size:13px;line-height:1.55;">
                    <div><b>${esc(customerName)}</b></div>
                    <div>${esc(customerEmail)} • ${esc(customerPhone)}</div>
                  </div>

                  ${
                    safeSummary
                      ? `<div style="margin-top:12px;">
                           <div style="font-size:12px;color:#6b7280;font-weight:900;">Summary</div>
                           <div style="margin-top:6px;font-size:13px;line-height:1.55;white-space:pre-wrap;">${esc(
                             safeSummary
                           )}</div>
                         </div>`
                      : ""
                  }

                  <div style="margin-top:14px;">
                    ${btn}
                  </div>
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:16px 20px;background:#0b0b0b;">
                <div style="color:#e5e7eb;font-size:12px;line-height:1.5;">
                  <div style="font-weight:900;color:#fff;margin-bottom:6px;">${esc(businessName)}</div>
                  This concept render is a visual aid — confirm scope/materials before final pricing.
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