// src/lib/emailComposer/templates/quoteCanvas.ts

type Img = { url: string; label: string };

type QuoteBlocks = {
  showPricing?: boolean;
  showSummary?: boolean;
  showScope?: boolean;
  showQuestions?: boolean;
  showAssumptions?: boolean;

  estimateText?: string;
  pricingMode?: "fixed" | "range";
  fixedPrice?: string;
  rangeLow?: string;
  rangeHigh?: string;

  summary?: string;
  visibleScope?: string[];
  questions?: string[];
  assumptions?: string[];
};

type Brand = {
  name?: string;

  // ✅ Back-compat
  logoUrl?: string;

  // ✅ Optional future-proofing (won't break current callers)
  // If provided, we’ll prefer these using a <picture> (best-effort in email clients).
  logoUrlLight?: string;
  logoUrlDark?: string;

  tagline?: string;
};

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function toLines(text: unknown) {
  return String(text ?? "")
    .split("\n")
    .map((x) => x.replace(/\r/g, ""))
    .join("\n");
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => safeTrim(x)).filter(Boolean);
}

function moneyFromString(v: unknown): number | null {
  const s = safeTrim(v);
  if (!s) return null;
  const cleaned = s.replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

function formatMoney(n: number) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n)}`;
  }
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderList(items: string[]) {
  if (!items.length) return "";
  const lis = items.map((x) => `<li style="margin:6px 0;">${escapeHtml(x)}</li>`).join("");
  return `<ul style="margin:10px 0 0 18px;padding:0;">${lis}</ul>`;
}

function computePricingDisplay(qb: QuoteBlocks | undefined): { title: string; detail: string } {
  const estimateText = safeTrim(qb?.estimateText);

  const mode = qb?.pricingMode === "range" ? "range" : "fixed";
  const fixed = moneyFromString(qb?.fixedPrice);
  const low = moneyFromString(qb?.rangeLow);
  const high = moneyFromString(qb?.rangeHigh);

  if (mode === "range" && low != null && high != null) {
    return { title: "Quote at a glance", detail: `${formatMoney(low)} — ${formatMoney(high)}` };
  }
  if (mode === "fixed" && fixed != null) {
    return { title: "Quote at a glance", detail: `${formatMoney(fixed)}` };
  }

  // ✅ fallback to AI estimate text (now sent in payload)
  if (estimateText) {
    return { title: "Quote at a glance", detail: estimateText };
  }

  return { title: "Quote at a glance", detail: "Estimate pending" };
}

function emailFromDisplay(fromLike: string): string {
  const s = safeTrim(fromLike);
  if (!s) return "";
  const m = s.match(/<([^>]+)>/);
  if (m && m[1]) return safeTrim(m[1]);
  return s;
}

function initials(name: string) {
  const s = safeTrim(name);
  if (!s) return "Y";
  const parts = s.split(/\s+/g).filter(Boolean);
  const a = parts[0]?.[0] ?? "Y";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (a + b).toUpperCase();
}

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
 * Email-safe “image card” using tables.
 * - Border radius is best-effort (many clients support; Outlook may not)
 * - Uses max-height constraints for big images
 */
function renderImageCard(args: {
  url: string;
  alt: string;
  label?: string;
  maxHeight?: number;
  radius?: number;
  showFooter?: boolean;
  footerRight?: string;
}) {
  const maxH = Number(args.maxHeight ?? 460);
  const radius = Number(args.radius ?? 16);
  const showFooter = args.showFooter !== false;

  // NOTE:
  // - Avoid object-fit in email HTML; many clients don’t respect it.
  // - We use width:100% and height:auto and rely on max-height.
  // - "max-height" is best-effort; still safe if ignored.
  const footer =
    showFooter && (safeTrim(args.label) || safeTrim(args.footerRight))
      ? `
      <tr>
        <td style="padding:10px 12px;background:#ffffff;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font-size:12px;color:#374151;font-weight:700;">
                ${escapeHtml(safeTrim(args.label) || "")}
              </td>
              <td align="right" style="font-size:12px;color:#6b7280;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;">
                ${escapeHtml(safeTrim(args.footerRight) || "")}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `
      : "";

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;border:1px solid #e5e7eb;border-radius:${radius}px;overflow:hidden;">
    <tr>
      <td style="padding:0;">
        <img
          src="${args.url}"
          alt="${escapeHtml(args.alt)}"
          style="display:block;width:100%;height:auto;max-height:${maxH}px;border:0;outline:none;text-decoration:none;background:#f3f4f6;"
        />
      </td>
    </tr>
    ${footer}
  </table>
  `;
}

/**
 * Email-safe 2-col Before/After layout.
 * Falls back gracefully to stacked on narrow screens / clients that don’t do media queries.
 */
function renderBeforeAfter(args: { before: Img; after: Img; title?: string; subtitle?: string }) {
  const title = safeTrim(args.title) || "Before / After";
  const subtitle = safeTrim(args.subtitle) || "A side-by-side look at your project.";

  // Simple “labels” as pills (no CSS classes, inline only)
  const labelPill = (txt: string, tone: "dark" | "light") => {
    const bg = tone === "dark" ? "#111827" : "#f3f4f6";
    const fg = tone === "dark" ? "#ffffff" : "#111827";
    const bd = tone === "dark" ? "#111827" : "#e5e7eb";
    return `<span style="display:inline-block;border:1px solid ${bd};background:${bg};color:${fg};border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800;letter-spacing:0.02em;">${escapeHtml(
      txt
    )}</span>`;
  };

  const beforeCard = renderImageCard({
    url: args.before.url,
    alt: args.before.label || "Before",
    label: args.before.label || "Before",
    maxHeight: 360,
    radius: 14,
    showFooter: false,
  });

  const afterCard = renderImageCard({
    url: args.after.url,
    alt: args.after.label || "After",
    label: args.after.label || "After",
    maxHeight: 360,
    radius: 14,
    showFooter: false,
  });

  return `
  <div style="margin-top:22px;">
    <div style="font-size:14px;font-weight:900;color:#111827;">${escapeHtml(title)}</div>
    <div style="margin-top:6px;font-size:13px;line-height:1.5;color:#6b7280;">${escapeHtml(subtitle)}</div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px;border-collapse:separate;border-spacing:0;">
      <tr>
        <td width="50%" valign="top" style="padding-right:8px;">
          <div style="margin-bottom:8px;">${labelPill("BEFORE", "light")}</div>
          ${beforeCard}
        </td>
        <td width="50%" valign="top" style="padding-left:8px;">
          <div style="margin-bottom:8px;">${labelPill("AFTER", "dark")}</div>
          ${afterCard}
        </td>
      </tr>
    </table>

    <div style="margin-top:10px;font-size:12px;color:#6b7280;">
      Tip: reply with changes if anything isn’t exactly what you want — we’ll revise the quote.
    </div>
  </div>
  `;
}

/**
 * Brand logo rendering:
 * - Avoid square crop. Use max-height/max-width and keep aspect ratio.
 * - If no logo, show initials badge (works for all tenants).
 * - If dark/light variants exist, use <picture> best-effort.
 */
function renderBrandMark(args: { brandName: string; brand: Brand | undefined }) {
  const brand = args.brand ?? {};
  const name = safeTrim(args.brandName) || "Your Shop";

  const light = safeTrim((brand as any).logoUrlLight);
  const dark = safeTrim((brand as any).logoUrlDark);
  const primary = safeTrim(brand.logoUrl);

  const logo = light || dark || primary;

  if (!logo) {
    const init = initials(name);
    return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;">
        <tr>
          <td
            style="width:40px;height:40px;border-radius:12px;background:#111827;color:#ffffff;text-align:center;vertical-align:middle;font-weight:900;font-size:12px;letter-spacing:0.06em;"
          >
            ${escapeHtml(init)}
          </td>
        </tr>
      </table>
    `;
  }

  // “Logo container” that won’t crop
  // - White background behind logo helps both dark/light modes.
  // - Max dims keep it from blowing up.
  const imgTag = (src: string) => `
    <img
      src="${src}"
      alt="${escapeHtml(name)}"
      style="display:block;border:0;outline:none;text-decoration:none;width:auto;height:auto;max-width:140px;max-height:40px;"
    />
  `;

  // Best-effort dark mode logo switching
  if (light && dark) {
    return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;">
        <tr>
          <td style="padding:8px 10px;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff;">
            <picture>
              <source media="(prefers-color-scheme: dark)" srcset="${dark}">
              ${imgTag(light)}
            </picture>
          </td>
        </tr>
      </table>
    `;
  }

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;">
      <tr>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff;">
          ${imgTag(logo)}
        </td>
      </tr>
    </table>
  `;
}

export function buildQuoteCanvasEmailHtml(args: {
  headline: string;
  intro: string;
  closing: string;
  subject: string;

  featuredImage?: Img | null;
  galleryImages?: Img[];

  brand?: Brand;
  quoteBlocks?: QuoteBlocks;

  // Optional: if you pass this later from route (e.g. the actual "from" address),
  // the mailto button will use it.
  replyToEmail?: string;
}) {
  const headline = escapeHtml(safeTrim(args.headline));
  const intro = escapeHtml(toLines(args.intro));
  const closing = escapeHtml(toLines(args.closing));

  const brandNameRaw = safeTrim(args.brand?.name) || "Your Shop";
  const brandName = escapeHtml(brandNameRaw);
  const brandTagline = escapeHtml(safeTrim(args.brand?.tagline) || "Quote ready to review");

  const qb: QuoteBlocks = args.quoteBlocks ?? {};
  const showPricing = qb.showPricing !== false;
  const showSummary = qb.showSummary !== false;
  const showScope = qb.showScope === true;
  const showQuestions = qb.showQuestions !== false;
  const showAssumptions = qb.showAssumptions === true;

  const pricing = computePricingDisplay(qb);

  const summary = safeTrim(qb.summary);
  const visibleScope = asStringArray(qb.visibleScope);
  const questions = asStringArray(qb.questions);
  const assumptions = asStringArray(qb.assumptions);

  const featured = normalizeImg(args.featuredImage ?? null);
  const galleryAll = normalizeImgs(args.galleryImages ?? []);

  // ✅ Before/After layout heuristic:
  // If we have a featured image and at least one other image, render a side-by-side “Before / After” section.
  // This matches how your builder prefers to pick:
  // - before_after template: featured = photo (before), first gallery = render (after)
  // For other templates it still looks good as a “comparison” section.
  const beforeAfterSection =
    featured && galleryAll.length
      ? renderBeforeAfter({
          before: featured,
          after: galleryAll[0],
          title: "Before / After",
          subtitle: "A side-by-side look at your project.",
        })
      : "";

  // After the before/after “hero”, keep remaining images as “included”
  const remainingGallery = featured && galleryAll.length ? galleryAll.slice(1) : galleryAll;

  const featuredBlock =
    featured && !galleryAll.length
      ? `
      <div style="margin-top:22px;">
        ${renderImageCard({
          url: featured.url,
          alt: featured.label || "Featured",
          label: safeTrim(featured.label) || "Featured",
          maxHeight: 460,
          radius: 16,
          showFooter: true,
          footerRight: "featured",
        })}
      </div>
    `
      : "";

  // ✅ Gallery in 2-col tables (email-safe)
  const galleryBlock =
    remainingGallery.length
      ? `
      <div style="margin-top:20px;">
        <div style="font-size:12px;font-weight:800;color:#6b7280;letter-spacing:0.02em;">Included images</div>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px;border-collapse:separate;border-spacing:0;">
          ${(() => {
            const rows: string[] = [];
            for (let i = 0; i < remainingGallery.length; i += 2) {
              const a = remainingGallery[i]!;
              const b = remainingGallery[i + 1] ?? null;

              const cellA = `
                <td width="50%" valign="top" style="padding-right:8px;">
                  ${renderImageCard({
                    url: a.url,
                    alt: a.label || "Image",
                    label: safeTrim(a.label) || "Image",
                    maxHeight: 260,
                    radius: 14,
                    showFooter: true,
                    footerRight: `#${i + 1}`,
                  })}
                </td>
              `;

              const cellB = b
                ? `
                <td width="50%" valign="top" style="padding-left:8px;">
                  ${renderImageCard({
                    url: b.url,
                    alt: b.label || "Image",
                    label: safeTrim(b.label) || "Image",
                    maxHeight: 260,
                    radius: 14,
                    showFooter: true,
                    footerRight: `#${i + 2}`,
                  })}
                </td>
              `
                : `
                <td width="50%" valign="top" style="padding-left:8px;"></td>
              `;

              rows.push(`
                <tr>
                  ${cellA}
                  ${cellB}
                </tr>
                <tr><td colspan="2" style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>
              `);
            }
            return rows.join("");
          })()}
        </table>
      </div>
    `
      : "";

  const replyTo = safeTrim(args.replyToEmail);
  const replyToEmail = replyTo ? emailFromDisplay(replyTo) : "";
  const mailto =
    replyToEmail
      ? `mailto:${encodeURIComponent(replyToEmail)}?subject=${encodeURIComponent(`Re: ${args.subject}`)}&body=${encodeURIComponent(
          "Approved"
        )}`
      : "";

  const brandMark = renderBrandMark({ brandName: brandNameRaw, brand: args.brand });

  const pricingBlock = showPricing
    ? `
      <div style="margin-top:22px;border:1px solid #e5e7eb;border-radius:16px;padding:18px;background:#ffffff;">
        <div style="font-size:14px;font-weight:900;color:#111827;">${escapeHtml(pricing.title)}</div>
        <div style="margin-top:8px;font-size:22px;font-weight:900;color:#111827;">${escapeHtml(pricing.detail)}</div>
        <div style="margin-top:10px;font-size:14px;line-height:1.6;color:#374151;">
          Reply to approve and we’ll schedule the job. If anything looks off, tell us what to adjust.
        </div>

        ${
          mailto
            ? `
            <a href="${mailto}" style="display:block;margin-top:14px;border-radius:12px;background:#111827;color:#ffffff;text-align:center;padding:12px 10px;font-weight:900;font-size:14px;text-decoration:none;">
              Reply “Approved” to schedule
            </a>
          `
            : `
            <div style="margin-top:14px;border-radius:12px;background:#111827;color:#ffffff;text-align:center;padding:12px 10px;font-weight:900;font-size:14px;">
              Reply “Approved” to schedule
            </div>
          `
        }

        <div style="margin-top:8px;font-size:12px;color:#6b7280;text-align:center;">
          (You can ask questions or request changes — we’ll update the quote.)
        </div>
      </div>
    `
    : "";

  const summaryBlock =
    showSummary && summary
      ? `
      <div style="margin-top:14px;border:1px solid #e5e7eb;border-radius:16px;padding:16px;background:#f9fafb;">
        <div style="font-size:14px;font-weight:900;color:#111827;">Summary</div>
        <div style="margin-top:8px;font-size:14px;line-height:1.6;color:#374151;white-space:pre-wrap;">${escapeHtml(
          toLines(summary)
        )}</div>
      </div>
    `
      : "";

  const scopeBlock =
    showScope && visibleScope.length
      ? `
      <div style="margin-top:14px;border:1px solid #e5e7eb;border-radius:16px;padding:16px;background:#f9fafb;">
        <div style="font-size:14px;font-weight:900;color:#111827;">Visible scope</div>
        <div style="font-size:14px;line-height:1.6;color:#374151;">${renderList(visibleScope)}</div>
      </div>
    `
      : "";

  const questionsBlock =
    showQuestions && questions.length
      ? `
      <div style="margin-top:14px;border:1px solid #e5e7eb;border-radius:16px;padding:16px;background:#f9fafb;">
        <div style="font-size:14px;font-weight:900;color:#111827;">A few quick questions (optional)</div>
        <div style="font-size:14px;line-height:1.6;color:#374151;">${renderList(questions)}</div>
      </div>
    `
      : "";

  const assumptionsBlock =
    showAssumptions && assumptions.length
      ? `
      <div style="margin-top:14px;border:1px solid #e5e7eb;border-radius:16px;padding:16px;background:#f9fafb;">
        <div style="font-size:14px;font-weight:900;color:#111827;">Assumptions</div>
        <div style="font-size:14px;line-height:1.6;color:#374151;">${renderList(assumptions)}</div>
      </div>
    `
      : "";

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;padding:28px;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:18px;padding:26px;border:1px solid #e5e7eb;">

      <!-- Brand bar -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;">
        <tr>
          <td valign="middle" style="padding:0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;">
              <tr>
                <td valign="middle" style="padding:0 10px 0 0;">
                  ${brandMark}
                </td>
                <td valign="middle" style="padding:0;">
                  <div style="font-size:14px;font-weight:900;color:#111827;">${brandName}</div>
                  <div style="margin-top:2px;font-size:12px;color:#6b7280;">${brandTagline}</div>
                </td>
              </tr>
            </table>
          </td>
          <td align="right" valign="middle" style="padding:0;font-size:12px;color:#9ca3af;">
            <!-- intentionally minimal (keeps header clean) -->
          </td>
        </tr>
      </table>

      <h1 style="margin:18px 0 0 0;font-size:26px;line-height:1.2;color:#111827;">
        ${headline}
      </h1>

      <div style="margin-top:12px;white-space:pre-wrap;font-size:14px;line-height:1.7;color:#374151;">
        ${intro}
      </div>

      ${pricingBlock}
      ${summaryBlock}
      ${scopeBlock}
      ${questionsBlock}
      ${assumptionsBlock}

      ${beforeAfterSection}
      ${featuredBlock}
      ${galleryBlock}

      <div style="margin-top:22px;white-space:pre-wrap;font-size:14px;line-height:1.7;color:#374151;">
        ${closing}
      </div>

      <div style="margin-top:18px;border-top:1px solid #e5e7eb;padding-top:12px;font-size:11px;color:#9ca3af;">
        This quote was generated from your photos. Reply to this email to approve, ask questions, or request changes.
      </div>
    </div>
  </div>
  `;
}

export function buildQuoteCanvasText(args: {
  headline: string;
  intro: string;
  closing: string;

  brand?: Brand;
  quoteBlocks?: QuoteBlocks;
}) {
  const brandName = safeTrim(args.brand?.name);
  const brandTagline = safeTrim(args.brand?.tagline);

  const qb: QuoteBlocks = args.quoteBlocks ?? {};
  const showPricing = qb.showPricing !== false;
  const showSummary = qb.showSummary !== false;
  const showScope = qb.showScope === true;
  const showQuestions = qb.showQuestions !== false;
  const showAssumptions = qb.showAssumptions === true;

  const pricing = computePricingDisplay(qb);

  const summary = safeTrim(qb.summary);
  const visibleScope = asStringArray(qb.visibleScope);
  const questions = asStringArray(qb.questions);
  const assumptions = asStringArray(qb.assumptions);

  const blocks: string[] = [];

  if (brandName || brandTagline) blocks.push([brandName, brandTagline].filter(Boolean).join(" — "));
  blocks.push(safeTrim(args.headline));
  blocks.push(toLines(args.intro));

  if (showPricing) blocks.push(`${pricing.title}: ${pricing.detail}`);
  if (showSummary && summary) blocks.push(`Summary:\n${toLines(summary)}`);
  if (showScope && visibleScope.length) blocks.push(`Visible scope:\n- ${visibleScope.join("\n- ")}`);
  if (showQuestions && questions.length) blocks.push(`Questions (optional):\n- ${questions.join("\n- ")}`);
  if (showAssumptions && assumptions.length) blocks.push(`Assumptions:\n- ${assumptions.join("\n- ")}`);

  blocks.push(toLines(args.closing));

  return blocks.filter(Boolean).join("\n\n").trim();
}