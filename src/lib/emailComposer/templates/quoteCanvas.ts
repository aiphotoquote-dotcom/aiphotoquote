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

  const brandName = escapeHtml(safeTrim(args.brand?.name) || "Your Shop");
  const brandTagline = escapeHtml(safeTrim(args.brand?.tagline) || "Quote ready to review");
  const brandLogoUrl = safeTrim(args.brand?.logoUrl);

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

  const featured = args.featuredImage?.url
    ? `
      <div style="margin-top:22px;">
        <img src="${args.featuredImage.url}" alt="${escapeHtml(args.featuredImage.label || "Featured")}" style="width:100%;border-radius:16px;display:block;" />
      </div>
    `
    : "";

  const gallery =
    args.galleryImages?.length
      ? args.galleryImages
          .map(
            (img) => `
            <div style="margin-top:14px;">
              <img src="${img.url}" alt="${escapeHtml(img.label || "Image")}" style="width:100%;border-radius:12px;display:block;" />
            </div>
          `
          )
          .join("")
      : "";

  const replyTo = safeTrim(args.replyToEmail);
  const replyToEmail = replyTo ? emailFromDisplay(replyTo) : ""; // safe if already email
  const mailto =
    replyToEmail
      ? `mailto:${encodeURIComponent(replyToEmail)}?subject=${encodeURIComponent(`Re: ${args.subject}`)}&body=${encodeURIComponent("Approved")}`
      : "";

  const brandLogo = brandLogoUrl
    ? `<img src="${brandLogoUrl}" alt="${brandName}" style="width:36px;height:36px;border-radius:10px;object-fit:cover;display:block;" />`
    : `<div style="width:36px;height:36px;border-radius:10px;background:#111827;"></div>`;

  const pricingBlock = showPricing
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

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;padding:28px;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:18px;padding:26px;border:1px solid #e5e7eb;">
      
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="display:flex;align-items:center;gap:10px;">
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

      ${featured}
      ${gallery}

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