// src/lib/email/templates/customerReceipt.ts

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

export function renderCustomerReceiptEmailHTML(args: {
  businessName: string;
  customerName: string;

  summary: string;
  estimateLow: number;
  estimateHigh: number;
  questions: string[];

  // Optional branding
  brandLogoUrl?: string | null;

  // Optional support hint
  replyToEmail?: string | null;

  // Back-compat ONLY (not shown)
  quoteLogId?: string;
}) {
  const { businessName, customerName, summary, estimateLow, estimateHigh, questions, brandLogoUrl, replyToEmail } =
    args;

  const preheader = "We received your photos — your estimate range is ready.";

  const topLogo = brandLogoUrl
    ? `<img src="${esc(brandLogoUrl)}" alt="${esc(businessName)}"
         style="height:28px;max-width:180px;object-fit:contain;display:block;" />`
    : `<div style="font-weight:900;font-size:14px;letter-spacing:.2px;color:#111;">${esc(
        businessName
      )}</div>`;

  const rangeText = `${money(estimateLow)} – ${money(estimateHigh)}`;
  const safeSummary = String(summary ?? "").trim();

  const q = (questions || [])
    .slice(0, 8)
    .map((x) => `<li style="margin:0 0 6px;">${esc(x)}</li>`)
    .join("");

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
    <title>Your AI Photo Quote</title>
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

            <tr>
              <td style="padding:18px 20px;border-bottom:1px solid #eef0f4;">
                <table role="presentation" width="100%">
                  <tr>
                    <td align="left" style="vertical-align:middle;">
                      ${topLogo}
                    </td>
                    <td align="right" style="vertical-align:middle;">
                      <div style="font-size:12px;color:#6b7280;font-weight:800;">AI Photo Quote</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 20px 0;">
                <div style="font-size:22px;font-weight:900;letter-spacing:-.2px;margin:0 0 6px;">
                  Your estimate is ready ✅
                </div>
                <div style="font-size:14px;line-height:1.5;color:#374151;">
                  Hi ${esc(customerName)}, we received your photos. Here’s your preliminary estimate range.
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 20px 0;">
                <div style="border:1px solid #eef0f4;border-radius:16px;padding:14px 14px;background:#ffffff;">
                  <div style="font-size:12px;color:#6b7280;font-weight:800;">Estimate range</div>
                  <div style="font-size:18px;font-weight:900;color:#111;margin-top:2px;">
                    ${esc(rangeText)}
                  </div>
                  <div style="margin-top:8px;font-size:12px;color:#6b7280;">
                    Final pricing can change after inspection and confirming materials/scope.
                  </div>

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

            ${
              q
                ? `<tr>
                     <td style="padding:16px 20px 0;">
                       <div style="border:1px solid #eef0f4;border-radius:16px;padding:14px 14px;background:#f9fafb;">
                         <div style="font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">Quick questions</div>
                         <div style="margin-top:8px;font-size:14px;line-height:1.55;color:#111;">
                           <ul style="margin:0;padding-left:18px;">${q}</ul>
                         </div>
                       </div>
                     </td>
                   </tr>`
                : ""
            }

            <tr>
              <td style="padding:18px 20px 22px;">
                ${replyLine}
                <div style="margin-top:14px;color:#6b7280;font-size:12px;">
                  — ${esc(businessName)}
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 20px;background:#0b0b0b;">
                <div style="color:#e5e7eb;font-size:12px;line-height:1.5;">
                  <div style="font-weight:900;color:#fff;margin-bottom:6px;">${esc(businessName)}</div>
                  This message includes an estimate range only. Final scope and pricing may change after inspection.
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