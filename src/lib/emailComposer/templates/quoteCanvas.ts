// src/lib/emailComposer/templates/quoteCanvas.ts

type Img = { url: string; label: string };

type QuoteBlocks = {
  showPricing?: boolean;
  showSummary?: boolean;
  showScope?: boolean;
  showQuestions?: boolean;
  showAssumptions?: boolean;

  estimateText?: string;

  pricingMode?: "none" | "fixed" | "range";
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
  logoUrl?: string;
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

  const mode = qb?.pricingMode === "range" ? "range" : qb?.pricingMode === "none" ? "none" : "fixed";
  if (mode === "none") return { title: "Quote at a glance", detail: "" };

  const fixed = moneyFromString(qb?.fixedPrice);
  const low = moneyFromString(qb?.rangeLow);
  const high = moneyFromString(qb?.rangeHigh);

  if (mode === "range" && low != null && high != null && low > 0 && high > 0) {
    return { title: "Quote at a glance", detail: `${formatMoney(low)} — ${formatMoney(high)}` };
  }
  if (mode === "fixed" && fixed != null && fixed > 0) {
    return { title: "Quote at a glance", detail: `${formatMoney(fixed)}` };
  }

  if (estimateText) {
    return { title: "Quote at a glance", detail: estimateText };
  }

  return { title: "Quote at a glance", detail: "" };
}

function emailFromDisplay(fromLike: string): string {
  const s = safeTrim(fromLike);
  if (!s) return "";
  const m = s.match(/<([^>]+)>/);
  if (m && m[1]) return safeTrim(m[1]);
  return s;
}

function renderBeforeAfterBlock(before: Img, after: Img) {
  const beforeLabel = escapeHtml(before.label || "Before");
  const afterLabel = escapeHtml(after.label || "After");

  // Use tables for best email client support.
  return `
    <div style="margin-top:18px;">
      <div style="font-size:16px;font-weight:900;color:#111827;">Before <span style="color:#9ca3af;">→</span> After</div>
      <div style="margin-top:6px;font-size:13px;color:#6b7280;">A side-by-side look at your project.</div>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:12px;border-collapse:separate;border-spacing:0;">
        <tr>
          <td width="50%" valign="top" style="padding:0 6px 0 0;">
            <div style="font-size:11px;font-weight:900;letter-spacing:0.04em;color:#111827;margin:0 0 8px 0;">
              <span style="display:inline-block;padding:6px 10px;border-radius:999px;background:#f3f4f6;">BEFORE</span>
            </div>
            <img src="${before.url}" alt="${beforeLabel}" style="width:100%;border-radius:16px;display:block;" />
            <div style="margin-top:8px;font-size:12px;color:#6b7280;">${beforeLabel}</div>
          </td>
          <td width="50%" valign="top" style="padding:0 0 0 6px;">
            <div style="font-size:11px;font-weight:900;letter-spacing:0.04em;color:#ffffff;margin:0 0 8px 0;">
              <span style="display:inline-block;padding:6px 10px;border-radius:999px;background:#111827;color:#ffffff;">AFTER</span>
            </div>
            <img src="${after.url}" alt="${afterLabel}" style="width:100%;border-radius:16px;display:block;" />
            <div style="margin-top:8px;font-size:12px;color:#6b7280;">${afterLabel}</div>
          </td>
        </tr>
      </table>

      <div style="margin-top:10px;font-size:12px;color:#6b7280;">
        Tip: reply with changes if anything isn’t exactly what you want — we’ll revise the quote.
      </div>
    </div>
  `;
}

export function buildQuoteCanvasEmailHtml(args: {
  templateKey?: "standard" | "before_after" | "visual_first";
  headline: string;
  intro: string;
  closing: string;
  subject: string;

  featuredImage?: Img | null;
  galleryImages?: Img[];

  beforeAfter?: { before: Img; after: Img };

  brand?: Brand;
  quoteBlocks?: QuoteBlocks;

  replyToEmail?: string;
}) {
  const headline = escapeHtml(safeTrim(args.headline));
  const intro = escapeHtml(toLines(args.intro));
  const closing = escapeHtml(toLines(args.closing));

  const brandName = escapeHtml(safeTrim(args.brand?.name) || "Your Shop");
  const brandTagline = escapeHtml(safeTrim(args.brand?.tagline) || "Quote ready to review");
  const brandLogoUrl = safeTrim(args.brand?.logoUrl);

  const qb: QuoteBlocks = args.quoteBlocks ?? {};
  const showPricing = qb.showPricing !== false && qb.pricingMode !== "none";
  const showSummary = qb.showSummary !== false;
  const showScope = qb.showScope === true;
  const showQuestions = qb.showQuestions !== false;
  const showAssumptions = qb.showAssumptions === true;

  const pricing = computePricingDisplay(qb);

  const summary = safeTrim(qb.summary);
  const visibleScope = asStringArray(qb.visibleScope);
  const questions = asStringArray(qb.questions);
  const assumptions = asStringArray(qb.assumptions);

  const replyTo = safeTrim(args.replyToEmail);
  const replyToEmail = replyTo ? emailFromDisplay(replyTo) : "";
  const mailto =
    replyToEmail
      ? `mailto:${encodeURIComponent(replyToEmail)}?subject=${encodeURIComponent(`Re: ${args.subject}`)}&body=${encodeURIComponent("Approved")}`
      : "";

  const brandLogo = brandLogoUrl
    ? `<img src="${brandLogoUrl}" alt="${brandName}" style="height:40px;max-width:180px;border-radius:10px;object-fit:contain;display:block;border:1px solid #e5e7eb;background:#ffffff;padding:6px 10px;" />`
    : `<div style="width:40px;height:40px;border-radius:10px;background:#111827;"></div>`;

  const pricingBlock = showPricing && safeTrim(pricing.detail)
    ? `
      <div style="margin-top:22px;border:1px solid #e5e7eb;border-radius:16px;padding:18px;background:#ffffff;">
        <div style="font-size:14px;font-weight:700;color:#111827;">${escapeHtml(pricing.title)}</div>
        <div style="margin-top:8px;font-size:22px;font-weight:800;color:#111827;">${escapeHtml(pricing.detail)}</div>
        <div style="margin-top:10px;font-size:14px;line-height:1.6;color:#374151;">
          Reply to approve and we’ll schedule the job. If anything looks off, tell us what to adjust.
        </div>

        ${
          mailto
            ? `
            <a href="${mailto}" style="display:block;margin-top:14px;border-radius:12px;background:#111827;color:#ffffff;text-align:center;padding:12px 10px;font-weight:800;font-size:14px;text-decoration:none;">
              Reply “Approved” to schedule
            </a>
          `
            : `
            <div style="margin-top:14px;border-radius:12px;background:#111827;color:#ffffff;text-align:center;padding:12px 10px;font-weight:800;font-size:14px;">
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
        <div style="font-size:14px;font-weight:800;color:#111827;">Summary</div>
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
        <div style="font-size:14px;font-weight:800;color:#111827;">Visible scope</div>
        <div style="font-size:14px;line-height:1.6;color:#374151;">${renderList(visibleScope)}</div>
      </div>
    `
      : "";

  const questionsBlock =
    showQuestions && questions.length
      ? `
      <div style="margin-top:14px;border:1px solid #e5e7eb;border-radius:16px;padding:16px;background:#f9fafb;">
        <div style="font-size:14px;font-weight:800;color:#111827;">A few quick questions (optional)</div>
        <div style="font-size:14px;line-height:1.6;color:#374151;">${renderList(questions)}</div>
      </div>
    `
      : "";

  const assumptionsBlock =
    showAssumptions && assumptions.length
      ? `
      <div style="margin-top:14px;border:1px solid #e5e7eb;border-radius:16px;padding:16px;background:#f9fafb;">
        <div style="font-size:14px;font-weight:800;color:#111827;">Assumptions</div>
        <div style="font-size:14px;line-height:1.6;color:#374151;">${renderList(assumptions)}</div>
      </div>
    `
      : "";

  // Image sections:
  const templateKey = args.templateKey ?? "standard";

  const beforeAfterHtml =
    templateKey === "before_after" && args.beforeAfter?.before?.url && args.beforeAfter?.after?.url
      ? renderBeforeAfterBlock(args.beforeAfter.before, args.beforeAfter.after)
      : "";

  const featuredHtml =
    !beforeAfterHtml && args.featuredImage?.url
      ? `
        <div style="margin-top:22px;">
          <img src="${args.featuredImage.url}" alt="${escapeHtml(args.featuredImage.label || "Featured")}" style="width:100%;border-radius:16px;display:block;" />
        </div>
      `
      : "";

  const galleryHtml =
    args.galleryImages?.length
      ? `
        <div style="margin-top:16px;">
          <div style="font-size:12px;font-weight:800;color:#6b7280;">Included images</div>
          ${args.galleryImages
            .map(
              (img) => `
              <div style="margin-top:12px;">
                <img src="${img.url}" alt="${escapeHtml(img.label || "Image")}" style="width:100%;border-radius:12px;display:block;" />
              </div>
            `
            )
            .join("")}
        </div>
      `
      : "";

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;padding:28px;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:18px;padding:26px;border:1px solid #e5e7eb;">
      
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="display:flex;align-items:center;gap:12px;">
          ${brandLogo}
          <div>
            <div style="font-size:14px;font-weight:800;color:#111827;">${brandName}</div>
            <div style="margin-top:2px;font-size:12px;color:#6b7280;">${brandTagline}</div>
          </div>
        </div>
      </div>

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

      ${beforeAfterHtml}
      ${featuredHtml}
      ${galleryHtml}

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
  const showPricing = qb.showPricing !== false && qb.pricingMode !== "none";
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

  if (showPricing && safeTrim(pricing.detail)) blocks.push(`${pricing.title}: ${pricing.detail}`);
  if (showSummary && summary) blocks.push(`Summary:\n${toLines(summary)}`);
  if (showScope && visibleScope.length) blocks.push(`Visible scope:\n- ${visibleScope.join("\n- ")}`);
  if (showQuestions && questions.length) blocks.push(`Questions (optional):\n- ${questions.join("\n- ")}`);
  if (showAssumptions && assumptions.length) blocks.push(`Assumptions:\n- ${assumptions.join("\n- ")}`);

  blocks.push(toLines(args.closing));

  return blocks.filter(Boolean).join("\n\n").trim();
}