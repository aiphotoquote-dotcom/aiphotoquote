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

function sectionCard(args: { title: string; body: string; subtle?: boolean }) {
  const { title, body, subtle } = args;
  const bg = subtle ? "#f9fafb" : "#ffffff";
  return `
    <div style="border:1px solid #eef0f4;border-radius:16px;padding:14px 14px;background:${bg};">
      <div style="font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">${esc(title)}</div>
      <div style="margin-top:8px;font-size:14px;line-height:1.55;color:#111;">
        ${body}
      </div>
    </div>
  `;
}

function listItems(items: string[], max = 10) {
  const html = (items || [])
    .filter(Boolean)
    .slice(0, max)
    .map((x) => `<li style="margin:0 0 6px;">${esc(x)}</li>`)
    .join("");
  return html ? `<ul style="margin:0;padding-left:18px;">${html}</ul>` : "";
}

function twoColBullets(args: { leftTitle: string; left: string; rightTitle: string; right: string }) {
  const { leftTitle, left, rightTitle, right } = args;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:2px;">
      <tr>
        <td valign="top" style="padding-right:10px;width:50%;">
          <div style="font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">${esc(leftTitle)}</div>
          <div style="margin-top:6px;">${left}</div>
        </td>
        <td valign="top" style="padding-left:10px;width:50%;">
          <div style="font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">${esc(rightTitle)}</div>
          <div style="margin-top:6px;">${right}</div>
        </td>
      </tr>
    </table>
  `;
}

function buildPhotoGrid(imageUrls: string[]) {
  const photos = (imageUrls || []).filter(Boolean).slice(0, 12);
  if (!photos.length) return "";

  const rows: string[] = [];
  for (let i = 0; i < photos.length; i += 2) {
    const a = photos[i];
    const b = photos[i + 1];

    const cell = (u?: string) =>
      u
        ? `<td width="50%" valign="top" style="padding:6px;">
             <div style="border:1px solid #eef0f4;border-radius:14px;overflow:hidden;background:#fff;">
               <img src="${esc(u)}" alt="Customer photo" style="width:100%;display:block;line-height:0;" />
             </div>
           </td>`
        : `<td width="50%" style="padding:6px;"></td>`;

    rows.push(`<tr>${cell(a)}${cell(b)}</tr>`);
  }

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
      ${rows.join("")}
    </table>
  `;
}

export function renderLeadNewEmailHTML(args: {
  businessName: string;
  tenantSlug: string;
  quoteLogId: string;

  customer: { name: string; email: string; phone: string };
  notes?: string;
  imageUrls: string[];

  // branding
  brandLogoUrl?: string | null;

  // deep links
  adminQuoteUrl?: string | null;

  // AI details
  confidence?: "high" | "medium" | "low" | string | null;
  inspectionRequired?: boolean | null;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  summary?: string | null;
  visibleScope?: string[] | null;
  assumptions?: string[] | null;
  questions?: string[] | null;

  // render info
  renderOptIn?: boolean | null;

  /**
   * Plan (Phase 1 foundation):
   * If omitted:
   * - planWhat falls back to visibleScope
   * - planHow falls back to platform default steps
   */
  planWhat?: string[] | null;
  planHow?: string[] | null;

  /**
   * Dynamic sections (Phase 1 foundation)
   */
  sections?: Array<{ title: string; items?: string[]; note?: string | null; subtle?: boolean }> | null;
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
    planWhat,
    planHow,
    sections,
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
  const safeNotes = String(notes ?? "").trim();

  const scopeHtml = listItems(visibleScope || [], 10);
  const assumptionsHtml = listItems(assumptions || [], 10);
  const questionsHtml = listItems(questions || [], 10);

  const photoGrid = buildPhotoGrid(imageUrls || []);

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

  // Plan (Phase 1 foundation)
  const whatList = listItems((planWhat || visibleScope || []) as string[], 10);
  const howDefault = [
    "Review photos & notes",
    "Reply with questions if needed",
    "Confirm materials/scope",
    "Schedule / inspect (if recommended)",
  ];
  const howList = listItems((planHow || howDefault) as string[], 10);

  const planBlock =
    whatList || howList
      ? sectionCard({
          title: "Plan",
          body: twoColBullets({
            leftTitle: "What we’ll do",
            left: whatList || `<div style="color:#6b7280;">(Pending confirmation)</div>`,
            rightTitle: "How we’ll do it",
            right: howList || `<div style="color:#6b7280;">(Next steps coming soon)</div>`,
          }),
          subtle: true,
        })
      : "";

  // Dynamic sections (Phase 1 foundation)
  const dyn = (sections || [])
    .filter((s) => s && s.title)
    .slice(0, 6)
    .map((s) => {
      const items = listItems(s.items || [], 10);
      const note = s.note
        ? `<div style="margin-top:8px;color:#6b7280;font-size:12px;">${esc(s.note)}</div>`
        : "";
      const body = `${items || ""}${note || ""}` || `<div style="color:#6b7280;">(No details)</div>`;
      return sectionCard({ title: s.title, body, subtle: s.subtle });
    })
    .join(`<div style="height:12px;"></div>`);

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
                ${sectionCard({
                  title: "Customer",
                  body: `
                    <table role="presentation" width="100%">
                      <tr>
                        <td style="vertical-align:top;">
                          <div style="margin-top:2px;font-size:16px;font-weight:900;color:#111;">${esc(
                            customer?.name
                          )}</div>
                          <div style="margin-top:8px;font-size:13px;color:#111;">
                            <div><span style="color:#6b7280;font-weight:900;">Email:</span> ${esc(
                              customer?.email
                            )}</div>
                            <div style="margin-top:2px;"><span style="color:#6b7280;font-weight:900;">Phone:</span> ${esc(
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
                             <div style="margin-top:4px;font-size:18px;font-weight:900;color:#111;">${esc(
                               rangeText
                             )}</div>
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
                      safeNotes
                        ? `<div style="margin-top:12px;">
                             <div style="font-size:12px;color:#6b7280;font-weight:900;letter-spacing:.2px;">Customer notes</div>
                             <div style="margin-top:6px;font-size:14px;line-height:1.55;color:#111;white-space:pre-wrap;">${esc(
                               safeNotes
                             )}</div>
                           </div>`
                        : ""
                    }
                  `,
                })}
              </td>
            </tr>

            <!-- Plan -->
            ${
              planBlock
                ? `<tr>
                     <td style="padding:16px 20px 0;">
                       ${planBlock}
                     </td>
                   </tr>`
                : ""
            }

            <!-- AI detail cards -->
            ${
              scopeHtml
                ? `<tr><td style="padding:16px 20px 0;">
                     ${sectionCard({
                       title: "Visible scope",
                       body: scopeHtml,
                       subtle: true,
                     })}
                   </td></tr>`
                : ""
            }

            ${
              assumptionsHtml
                ? `<tr><td style="padding:16px 20px 0;">
                     ${sectionCard({
                       title: "Assumptions",
                       body: assumptionsHtml,
                     })}
                   </td></tr>`
                : ""
            }

            ${
              questionsHtml
                ? `<tr><td style="padding:16px 20px 0;">
                     ${sectionCard({
                       title: "Questions to confirm",
                       body: questionsHtml,
                       subtle: true,
                     })}
                   </td></tr>`
                : ""
            }

            <!-- Dynamic sections (Phase 1 foundation) -->
            ${
              dyn
                ? `<tr><td style="padding:16px 20px 0;">
                     ${dyn}
                   </td></tr>`
                : ""
            }

            <!-- Photos -->
            ${
              photoGrid
                ? `<tr>
                     <td style="padding:16px 20px 0;">
                       ${sectionCard({
                         title: "Customer photos",
                         body: `
                           ${photoGrid}
                           <div style="margin-top:10px;font-size:12px;color:#6b7280;">
                             Photos included inline for quick review.
                           </div>
                         `,
                       })}
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