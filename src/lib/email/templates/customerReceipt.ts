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

type BrandLogoVariant = "auto" | "light" | "dark";

function normalizeVariant(v: unknown): BrandLogoVariant {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "light") return "light";
  if (s === "dark") return "dark";
  return "auto";
}

/**
 * Renders a logo that stays visible even if the uploaded asset is white/low-contrast.
 *
 * - auto/light: render directly (current behavior)
 * - dark: render the logo on a dark “pill” background so white logos show up on the top bar
 *
 * NOTE: We only have one logo URL today; variant is a rendering hint only.
 */
function renderTopLogo(args: { brandLogoUrl?: string | null; businessName: string; brandLogoVariant?: BrandLogoVariant | null }) {
  const { brandLogoUrl, businessName } = args;
  const variant = normalizeVariant(args.brandLogoVariant);

  if (!brandLogoUrl) {
    return `<div style="font-weight:900;font-size:14px;letter-spacing:.2px;color:#111;">${esc(businessName)}</div>`;
  }

  const img = `<img src="${esc(brandLogoUrl)}" alt="${esc(businessName)}"
      style="height:28px;max-width:180px;object-fit:contain;display:block;" />`;

  // If the logo is intended for dark backgrounds (often white logo), ensure contrast.
  if (variant === "dark") {
    return `
      <div style="display:inline-block;padding:8px 10px;border-radius:12px;background:#0b0b0b;border:1px solid #111827;">
        ${img}
      </div>
    `;
  }

  // auto / light
  return img;
}

export function renderCustomerReceiptEmailHTML(args: {
  businessName: string;
  customerName: string;

  // Core AI estimate
  summary: string;
  estimateLow: number;
  estimateHigh: number;

  // AI details (Phase 1 baseline)
  confidence?: "high" | "medium" | "low" | string | null;
  inspectionRequired?: boolean | null;
  visibleScope?: string[] | null;
  assumptions?: string[] | null;
  questions?: string[] | null;

  // Customer submitted photos
  imageUrls?: string[] | null;

  // Optional branding
  brandLogoUrl?: string | null;

  // ✅ NEW: rendering hint to avoid contrast issues
  brandLogoVariant?: BrandLogoVariant | null;

  // Optional support hint
  replyToEmail?: string | null;

  /**
   * Dynamic section support (Phase 1 foundation)
   */
  sections?: Array<{ title: string; items?: string[]; note?: string | null; subtle?: boolean }> | null;

  /**
   * Plan sections (Phase 1 foundation; later industry defaults + tenant overrides)
   * If omitted:
   * - planWhat falls back to visibleScope
   * - planHow falls back to platform default steps
   */
  planWhat?: string[] | null;
  planHow?: string[] | null;

  // Back-compat ONLY (not shown)
  quoteLogId?: string;
}) {
  const {
    businessName,
    customerName,
    summary,
    estimateLow,
    estimateHigh,
    confidence,
    inspectionRequired,
    visibleScope,
    assumptions,
    questions,
    imageUrls,
    brandLogoUrl,
    brandLogoVariant,
    replyToEmail,
    sections,
    planWhat,
    planHow,
  } = args;

  const preheader = "We received your photos — your estimate range is ready.";

  const topLogo = renderTopLogo({
    brandLogoUrl,
    businessName,
    brandLogoVariant,
  });

  const rangeText = `${money(estimateLow)} – ${money(estimateHigh)}`;
  const safeSummary = String(summary ?? "").trim();

  const conf = String(confidence ?? "").toLowerCase().trim();
  const confBadge =
    conf === "high"
      ? badge("High confidence", "#ecfdf5", "#065f46")
      : conf === "medium"
      ? badge("Medium confidence", "#eff6ff", "#1d4ed8")
      : conf === "low"
      ? badge("Low confidence", "#fff7ed", "#9a3412")
      : "";

  const inspect = inspectionRequired === true;

  const inspectCallout = inspect
    ? `<div style="margin-top:10px;padding:10px 12px;border-radius:14px;background:#fff7ed;border:1px solid #fed7aa;">
         <div style="font-size:12px;font-weight:900;color:#9a3412;letter-spacing:.2px;">Inspection recommended</div>
         <div style="margin-top:4px;font-size:13px;color:#7c2d12;line-height:1.45;">
           Based on the photos, we may need a quick inspection to confirm scope/materials before final pricing.
         </div>
       </div>`
    : "";

  const replyLine = replyToEmail
    ? `<div style="margin-top:10px;color:#6b7280;font-size:12px;">
         Questions? Reply to this email or contact <span style="font-weight:800;color:#111;">${esc(
           replyToEmail
         )}</span>.
       </div>`
    : "";

  // --- Customer photo gallery (2-up grid) ---
  const photos = (imageUrls || []).filter(Boolean).slice(0, 10);
  const photoGrid = (() => {
    if (!photos.length) return "";
    const rows: string[] = [];
    for (let i = 0; i < photos.length; i += 2) {
      const a = photos[i];
      const b = photos[i + 1];

      const cell = (u?: string) =>
        u
          ? `<td width="50%" valign="top" style="padding:6px;">
               <div style="border:1px solid #eef0f4;border-radius:14px;overflow:hidden;background:#fff;">
                 <img src="${esc(u)}" alt="Your photo" style="width:100%;display:block;line-height:0;" />
               </div>
             </td>`
          : `<td width="50%" style="padding:6px;"></td>`;

      rows.push(`<tr>${cell(a)}${cell(b)}</tr>`);
    }

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
        ${rows.join("")}
      </table>
      <div style="margin-top:10px;font-size:12px;color:#6b7280;">
        These are the photos you submitted — helpful for reference if you share this email.
      </div>
    `;
  })();

  // --- AI detail lists ---
  const scopeHtml = listItems(visibleScope || [], 10);
  const assumptionsHtml = listItems(assumptions || [], 10);
  const questionsHtml = listItems(questions || [], 10);

  // --- Dynamic sections (Phase 1 foundation) ---
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

  // --- Plan: What we’ll do + How we’ll do it (Phase 1 foundation) ---
  const whatList = listItems((planWhat || visibleScope || []) as string[], 10);
  const howDefault = [
    "Confirm materials & scope (fast questions if needed)",
    "Provide a final quote and timeline",
    "Schedule service or inspection (if recommended)",
    "Complete the work and share progress/photos as available",
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
        })
      : "";

  // --- “What happens next” (platform default) ---
  const nextSteps = `
    <ol style="margin:0;padding-left:18px;">
      <li style="margin:0 0 8px;"><b>Review your photos</b> and confirm scope/materials.</li>
      <li style="margin:0 0 8px;"><b>Follow up with questions</b> if anything is unclear.</li>
      <li style="margin:0 0 8px;"><b>Schedule / inspect</b> (if recommended) to lock in final pricing.</li>
      <li style="margin:0;"><b>Start the work</b> once you approve the plan.</li>
    </ol>
    <div style="margin-top:10px;color:#6b7280;font-size:12px;">
      This estimate is a starting point — final scope/pricing can change after inspection.
    </div>
  `;

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

            <!-- Top bar -->
            <tr>
              <td style="padding:18px 20px;border-bottom:1px solid #eef0f4;">
                <table role="presentation" width="100%">
                  <tr>
                    <td align="left" style="vertical-align:middle;">
                      ${topLogo}
                    </td>
                    <td align="right" style="vertical-align:middle;">
                      <div style="font-size:12px;color:#6b7280;font-weight:900;">AI Photo Quote</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Title -->
            <tr>
              <td style="padding:18px 20px 0;">
                <div style="font-size:22px;font-weight:900;letter-spacing:-.2px;margin:0 0 6px;">
                  Your estimate is ready ✅
                </div>
                <div style="font-size:14px;line-height:1.5;color:#374151;">
                  Hi ${esc(customerName)}, here’s your preliminary estimate range based on your photos.
                </div>
                <div style="margin-top:10px;">
                  ${confBadge}
                </div>
              </td>
            </tr>

            <!-- Estimate card -->
            <tr>
              <td style="padding:16px 20px 0;">
                ${sectionCard({
                  title: "Estimate range",
                  body: `
                    <div style="font-size:20px;font-weight:900;color:#111;margin-top:-2px;">
                      ${esc(rangeText)}
                    </div>
                    <div style="margin-top:8px;font-size:12px;color:#6b7280;">
                      Final pricing can change after inspection and confirming materials/scope.
                    </div>
                    ${inspectCallout}
                  `,
                })}
              </td>
            </tr>

            <!-- AI Summary -->
            ${
              safeSummary
                ? `<tr><td style="padding:16px 20px 0;">
                     ${sectionCard({
                       title: "AI summary",
                       body: `<div style="white-space:pre-wrap;">${esc(safeSummary)}</div>`,
                       subtle: true,
                     })}
                   </td></tr>`
                : ""
            }

            <!-- Plan -->
            ${
              planBlock
                ? `<tr><td style="padding:16px 20px 0;">
                     ${planBlock}
                   </td></tr>`
                : ""
            }

            <!-- Photos they submitted -->
            ${
              photoGrid
                ? `<tr><td style="padding:16px 20px 0;">
                     ${sectionCard({
                       title: "Your submitted photos",
                       body: photoGrid,
                     })}
                   </td></tr>`
                : ""
            }

            <!-- AI Assessment cards -->
            ${
              scopeHtml
                ? `<tr><td style="padding:16px 20px 0;">
                     ${sectionCard({
                       title: "What this estimate includes",
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
                       title: "Quick questions (to confirm details)",
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

            <!-- Next steps -->
            <tr>
              <td style="padding:16px 20px 0;">
                ${sectionCard({
                  title: "What happens next",
                  body: nextSteps,
                })}
              </td>
            </tr>

            <!-- Footer content -->
            <tr>
              <td style="padding:18px 20px 22px;">
                ${replyLine}
                <div style="margin-top:14px;color:#6b7280;font-size:12px;">
                  — ${esc(businessName)}
                </div>
              </td>
            </tr>

            <!-- Dark footer -->
            <tr>
              <td style="padding:18px 20px;background:#0b0b0b;">
                <div style="color:#e5e7eb;font-size:12px;line-height:1.5;">
                  <div style="font-weight:900;color:#fff;margin-bottom:6px;">${esc(businessName)}</div>
                  This email includes an estimate range only. Final scope and pricing may change after inspection.
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