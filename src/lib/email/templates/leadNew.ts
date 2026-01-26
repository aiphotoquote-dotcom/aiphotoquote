// src/lib/email/templates/leadNew.ts

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

function badge(text: string, bg: string, fg: string) {
  return `<span style="display:inline-block;padding:6px 10px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:900;letter-spacing:.2px;">${esc(
    text
  )}</span>`;
}

export function renderLeadNewEmailHTML(args: {
  businessName: string;
  tenantSlug: string;
  quoteLogId: string;

  customer: { name: string; email: string; phone: string };
  notes?: string;
  imageUrls: string[];

  // NEW (optional) branding
  brandLogoUrl?: string | null;

  // NEW (optional) deep links
  adminQuoteUrl?: string | null;

  // AI details (NEW / optional)
  confidence?: "high" | "medium" | "low" | string | null;
  inspectionRequired?: boolean | null;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  summary?: string | null;
  visibleScope?: string[] | null;
  assumptions?: string[] | null;
  questions?: string[] | null;

  // render info (optional)
  renderOptIn?: boolean | null;
}) {
  const {
    businessName,
    tenantSlug,
    quoteLogId,
    customer,
    notes,
    imageUrls,
    brandLogoUrl,
    adminQuoteUrl,
    confidence,
    inspectionRequired,
    estimateLow,
    estimateHigh,
    summary,
    visibleScope,
    assumptions,
    questions,
    renderOptIn,
  } = args;

  const topLogo = brandLogoUrl
    ? `<img src="${esc(brandLogoUrl)}" alt="${esc(businessName)}"
         style="height:28px;max-width:180px;object-fit:contain;display:block;" />`
    : `<div style="font-weight:900;font-size:14px;letter-spacing:.2px;color:#111;">${esc(
        businessName
      )}</div>`;

  const conf = String(confidence ?? "").toLowerCase().trim();
  const confBadge =
    conf === "high"
      ? badge("High confidence", "#ecfdf5", "#065f46")
      : conf === "medium"
      ? badge("Medium confidence", "#eff6ff", "#1d4ed8")
      : conf === "low"
      ? badge("Low confidence", "#fff7ed", "#9a3412")
      : badge("AI assessment", "#f3f4f6", "#111827");

  const inspect = inspectionRequired === true;

  const hasRange = typeof estimateLow === "number" && typeof estimateHigh === "number";
  const rangeText = hasRange ? `${money(estimateLow)} – ${money(estimateHigh)}` : "";

  const safeSummary = String(summary ?? "").trim();

  const scopeList = (visibleScope || [])
    .slice(0, 10)
    .map((x) => `<li style="margin:0 0 6px;">${esc(x)}</li>`)
    .join("");

  const assumptionsList = (assumptions || [])
    .slice(0, 10)
    .map((x) => `<li style="margin:0 0 6px;">${esc(x)}</li>`)
    .join("");

  const qList = (questions || [])
    .slice(0, 10)
    .map((x) => `<li style="margin:0 0 6px;">${esc(x)}</li>`)
    .join("");

  const imgs = (imageUrls || [])
    .slice(0, 12)
    .map(
      (u) => `
        <td style="padding:6px;" width="50%" valign="top">
          <div style="border:1px solid #eef0f4;border-radius:14px;overflow:hidden;background:#fff;">
            <img src="${esc(u)}" alt="Customer photo"
              style="width:100%;display:block;line-height:0;" />
          </div>
        </td>
      `
    )
    .join("");

  const imgRows = (() => {
    const cells = (imageUrls || []).slice(0, 12).map((u) => u);
    if (cells.length === 0) return "";
    const pairs: string[][] = [];
    for (let i = 0; i < cells.length; i += 2) pairs.push(cells.slice(i, i + 2));
    const rows = pairs
      .map((pair) => {
        const left = pair[0]
          ? `<td style="padding:6px;" width="50%" valign="top">
               <div style="border:1px solid #eef0f4;border-radius:14px;overflow:hidden;background:#fff;">
                 <img src="${esc(pair[0])}" alt="Customer photo"
                   style="width:100%;display:block;line-height:0;" />
               </div>
             </td>`
          : `<td style="padding:6px;" width="50%"></td>`;

        const right = pair[1]
          ? `<td style="padding:6px;" width="50%" valign="top">
               <div style="border:1px solid #eef0f4;border-radius:14px;overflow:hidden;background:#fff;">
                 <img src="${esc(pair[1])}" alt="Customer photo"
                   style="width:100%;display:block;line-height:0;" />
               </div>
             </td>`
          : `<td style="padding:6px;" width="50%"></td>`;

        return `<tr>${left}${right}</tr>`;
      })
      .join("");

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
        ${rows}
      </table>
    `;
  })();

  const adminBtn = adminQuoteUrl
    ? `<a href="${esc(adminQuoteUrl)}" target="_blank" rel="noopener"
         style="display:inline-block;background:#111;color:#fff;text-decoration:none;
                padding:12px 16px;border-radius:12px;font-weight:900;font-size:14px;">
         Open in Admin
       </a>`
    : "";

  const renderLine =
    typeof renderOptIn === "boolean"
      ? renderOptIn
        ? badge("Customer opted-in to concept render", "#ecfdf5", "#065f46")
        : badge("No concept render requested", "#f3f4f6", "#111827")
      : "";

  const inspectCallout = inspect
    ? `<div style="margin-top:10px;padding:10px 12px;border-radius:14px;background:#fff7ed;border:1px solid #fed7aa;">
         <div style="font-size:12px;font-weight:900;color:#9a3412;letter-spacing:.2px;">Inspection recommended</div>
         <div style="margin-top:4px;font-size:13px;color:#7c2d12;line-height:1.45;">
           AI flagged this as likely needing inspection to confirm scope/materials.
         </div>
       </div>`
    : "";

  const preheader = `New quote request — ${customer?.name || "Customer"} — ${rangeText || "AI assessment ready"}.`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>New Photo Quote</title>
  </head>
  <body style="margin:0;background:#f6f7fb;color:#111;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${esc(preheader)}
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f7fb;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
            style="max-width:720px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 12px 40px rgba(17,24,39,.12);">

            <!-- Top bar -->
            <tr>
              <td style="padding:18px 20px;border-bottom:1px solid #eef0f4;">
                <table role="presentation" width="100%">
                  <tr>
                    <td align="left" style="vertical-align:middle;">
                      ${topLogo}
                    </td>
                    <td align="right" style="vertical-align:middle;">
                      <div style="font-size:12px;color:#6b7280;font-weight:900;">New lead</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Header -->
            <tr>
              <td style="padding:18px 20px 0;">
                <div style="font-size:22px;font-weight:900;letter-spacing:-.2px;margin:0 0 6px;">
                  New Photo Quote Request
                </div>
                <div style="font-size:14px;line-height:1.5;color:#374151;">
                  A new customer submission is ready to review.
                </div>
                <div style="margin-top:10px;">
                  ${confBadge}
                  <span style="display:inline-block;width:10px;"></span>
                  ${renderLine}
                </div>
              </td>
            </tr>

            <!-- Customer card -->
            <tr>
              <td style="padding:16px 20px 0;">
                <div style="border:1px solid #eef0f4;border-radius:16px;padding:14px 14px;background:#ffffff;">
                  <table role="presentation" width="100%">
                    <tr>
                      <td style="vertical-align:top;">
                        <div style="font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">Customer</div>
                        <div style="margin-top:4px;font-size:16px;font-weight:900;color:#111;">${esc(
                          customer?.name
                        )}</div>
                        <div style="margin-top:6px;font-size:13px;color:#111;">
                          <div><span style="color:#6b7280;font-weight:800;">Email:</span> ${esc(
                            customer?.email
                          )}</div>
                          <div style="margin-top:2px;"><span style="color:#6b7280;font-weight:800;">Phone:</span> ${esc(
                            customer?.phone
                          )}</div>
                        </div>
                      </td>

                      <td align="right" style="vertical-align:top;">
                        <div style="font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">Tenant</div>
                        <div style="margin-top:4px;font-size:13px;font-weight:900;color:#111;">${esc(
                          tenantSlug
                        )}</div>

                        <div style="margin-top:10px;font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">Internal ID</div>
                        <div style="margin-top:4px;font-size:12px;font-weight:900;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;color:#111;">
                          ${esc(quoteLogId)}
                        </div>
                      </td>
                    </tr>
                  </table>

                  ${
                    rangeText
                      ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid #eef0f4;">
                           <div style="font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">AI estimate range</div>
                           <div style="margin-top:4px;font-size:18px;font-weight:900;color:#111;">
                             ${esc(rangeText)}
                           </div>
                         </div>`
                      : ""
                  }

                  ${inspectCallout}

                  ${
                    safeSummary
                      ? `<div style="margin-top:12px;">
                           <div style="font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">AI summary</div>
                           <div style="margin-top:6px;font-size:14px;line-height:1.55;color:#111;white-space:pre-wrap;">${esc(
                             safeSummary
                           )}</div>
                         </div>`
                      : ""
                  }

                  ${
                    notes
                      ? `<div style="margin-top:12px;">
                           <div style="font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">Customer notes</div>
                           <div style="margin-top:6px;font-size:14px;line-height:1.55;color:#111;white-space:pre-wrap;">${esc(
                             notes
                           )}</div>
                         </div>`
                      : ""
                  }
                </div>
              </td>
            </tr>

            <!-- Scope / assumptions / questions -->
            ${
              scopeList || assumptionsList || qList
                ? `<tr>
                     <td style="padding:16px 20px 0;">
                       <div style="border:1px solid #eef0f4;border-radius:16px;padding:14px 14px;background:#f9fafb;">
                         ${
                           scopeList
                             ? `<div style="font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">Visible scope</div>
                                <div style="margin-top:8px;font-size:14px;line-height:1.55;color:#111;">
                                  <ul style="margin:0;padding-left:18px;">${scopeList}</ul>
                                </div>`
                             : ""
                         }

                         ${
                           assumptionsList
                             ? `<div style="margin-top:12px;font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">Assumptions</div>
                                <div style="margin-top:8px;font-size:14px;line-height:1.55;color:#111;">
                                  <ul style="margin:0;padding-left:18px;">${assumptionsList}</ul>
                                </div>`
                             : ""
                         }

                         ${
                           qList
                             ? `<div style="margin-top:12px;font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">Questions to confirm</div>
                                <div style="margin-top:8px;font-size:14px;line-height:1.55;color:#111;">
                                  <ul style="margin:0;padding-left:18px;">${qList}</ul>
                                </div>`
                             : ""
                         }
                       </div>
                     </td>
                   </tr>`
                : ""
            }

            <!-- Images -->
            ${
              imgRows
                ? `<tr>
                     <td style="padding:16px 20px 0;">
                       <div style="font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;margin-bottom:8px;">Customer photos</div>
                       ${imgRows}
                     </td>
                   </tr>`
                : ""
            }

            <!-- CTA -->
            <tr>
              <td style="padding:18px 20px 22px;">
                <table role="presentation" width="100%">
                  <tr>
                    <td align="left">
                      ${adminBtn}
                    </td>
                    <td align="right">
                      <div style="font-size:12px;color:#6b7280;font-weight:900;">Next step</div>
                      <div style="font-size:13px;font-weight:900;color:#111;">Review & follow up</div>
                    </td>
                  </tr>
                </table>

                <div style="margin-top:14px;color:#6b7280;font-size:12px;">
                  — ${esc(businessName)}
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:18px 20px;background:#0b0b0b;">
                <div style="color:#e5e7eb;font-size:12px;line-height:1.5;">
                  <div style="font-weight:900;color:#fff;margin-bottom:6px;">${esc(businessName)}</div>
                  AI outputs are guidance — confirm scope/materials with the customer before final pricing.
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