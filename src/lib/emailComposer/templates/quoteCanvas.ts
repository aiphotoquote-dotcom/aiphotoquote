// src/lib/emailComposer/templates/quoteCanvas.ts

type Img = { url: string; label: string };

type PricingMode = "auto" | "fixed" | "range";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function escapeHtml(input: unknown) {
  const s = String(input ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escAttr(input: unknown) {
  // for attributes like src/href
  return escapeHtml(input);
}

function toLines(text: unknown) {
  // preserve newlines for pre-wrap blocks
  return String(text ?? "").replace(/\r/g, "");
}

function formatMoney(n: number) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n)}`;
  }
}

function parseMoneyMaybe(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pill(label: string) {
  return `
    <span style="
      display:inline-block;
      border:1px solid #E5E7EB;
      background:#FFFFFF;
      color:#111827;
      border-radius:999px;
      padding:6px 10px;
      font-size:12px;
      font-weight:700;
      margin:0 8px 8px 0;
    ">${escapeHtml(label)}</span>
  `;
}

function sectionCard(title: string, innerHtml: string) {
  return `
    <div style="
      border:1px solid #E5E7EB;
      background:#F9FAFB;
      border-radius:14px;
      padding:16px;
      margin-top:12px;
    ">
      <div style="font-size:14px;font-weight:800;color:#111827;">${escapeHtml(title)}</div>
      <div style="margin-top:8px;font-size:14px;line-height:1.6;color:#1F2937;">
        ${innerHtml}
      </div>
    </div>
  `;
}

function list(items: string[]) {
  if (!items?.length) return "";
  const lis = items
    .map((x) => `<li style="margin:0 0 6px 0;">${escapeHtml(x)}</li>`)
    .join("");
  return `<ul style="margin:8px 0 0 18px;padding:0;">${lis}</ul>`;
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

function derivePricing(args: {
  pricingMode?: PricingMode;
  priceFixed?: any;
  priceLow?: any;
  priceHigh?: any;
  estimateText?: string;
}) {
  const mode: PricingMode = (args.pricingMode as PricingMode) || "auto";

  const fixed = parseMoneyMaybe(args.priceFixed);
  const low = parseMoneyMaybe(args.priceLow);
  const high = parseMoneyMaybe(args.priceHigh);

  if (mode === "fixed") {
    if (fixed != null) return { mode, label: formatMoney(fixed) };
    // fallback to estimateText if provided
    const est = safeTrim(args.estimateText);
    return { mode, label: est || "—" };
  }

  if (mode === "range") {
    if (low != null && high != null) return { mode, label: `${formatMoney(low)} — ${formatMoney(high)}` };
    if (low != null) return { mode, label: `${formatMoney(low)}+` };
    if (high != null) return { mode, label: `Up to ${formatMoney(high)}` };
    const est = safeTrim(args.estimateText);
    return { mode, label: est || "—" };
  }

  // auto
  const est = safeTrim(args.estimateText);
  return { mode: "auto" as const, label: est || "—" };
}

export function buildQuoteCanvasEmailHtml(args: {
  // required copy
  headline: string;
  intro: string;
  closing: string;
  subject: string;

  // branding (optional)
  shopName?: string | null;
  shopLogoUrl?: string | null;
  brandSubtitle?: string | null;

  // images
  featuredImage?: Img | null;
  galleryImages?: Img[];

  // quote blocks / toggles (optional)
  quoteBlocks?: {
    showPricing?: boolean;
    showSummary?: boolean;
    showScope?: boolean;
    showQuestions?: boolean;
    showAssumptions?: boolean;

    // pricing
    pricingMode?: PricingMode; // "auto" | "fixed" | "range"
    priceFixed?: number | string | null;
    priceLow?: number | string | null;
    priceHigh?: number | string | null;

    estimateText?: string; // used by auto mode (or fallback)
    confidence?: string;
    inspectionRequired?: boolean | null;

    summary?: string;
    visibleScope?: string[];
    questions?: string[];
    assumptions?: string[];
  } | null;
}) {
  const featured = normalizeImg(args.featuredImage);
  const gallery = normalizeImgs(args.galleryImages);

  const qb = args.quoteBlocks || {};

  const showPricing = qb.showPricing !== false; // default true
  const showSummary = qb.showSummary !== false; // default true
  const showScope = qb.showScope === true; // default false
  const showQuestions = qb.showQuestions !== false; // default true
  const showAssumptions = qb.showAssumptions === true; // default false

  const shopName = safeTrim(args.shopName) || "Your Shop";
  const shopLogoUrl = safeTrim(args.shopLogoUrl);
  const brandSubtitle = safeTrim(args.brandSubtitle) || "Quote ready to review";

  const headline = safeTrim(args.headline);
  const intro = toLines(args.intro);
  const closing = toLines(args.closing);

  const estimateText = safeTrim(qb.estimateText);
  const confidence = safeTrim(qb.confidence);
  const inspectionRequired = qb.inspectionRequired === true;

  const pricing = derivePricing({
    pricingMode: qb.pricingMode,
    priceFixed: qb.priceFixed,
    priceLow: qb.priceLow,
    priceHigh: qb.priceHigh,
    estimateText,
  });

  const summary = toLines(qb.summary);
  const visibleScope = Array.isArray(qb.visibleScope) ? qb.visibleScope.map(safeTrim).filter(Boolean) : [];
  const questions = Array.isArray(qb.questions) ? qb.questions.map(safeTrim).filter(Boolean) : [];
  const assumptions = Array.isArray(qb.assumptions) ? qb.assumptions.map(safeTrim).filter(Boolean) : [];

  const pillsHtml = [
    showPricing && pricing.label && pricing.label !== "—" ? pill(`Price: ${pricing.label}`) : "",
    confidence ? pill(`Confidence: ${confidence}`) : "",
    inspectionRequired ? pill("Inspection required") : "",
  ]
    .filter(Boolean)
    .join("");

  const pricingBlock = showPricing
    ? `
      <div style="
        border:1px solid #E5E7EB;
        background:#FFFFFF;
        border-radius:16px;
        padding:18px;
        margin-top:18px;
      ">
        <div style="font-size:14px;font-weight:800;color:#111827;">Quote at a glance</div>
        <div style="margin-top:10px;font-size:22px;font-weight:900;color:#111827;">
          ${escapeHtml(pricing.label || "—")}
        </div>
        <div style="margin-top:10px;font-size:14px;line-height:1.6;color:#1F2937;">
          Reply to approve and we’ll schedule the job. If anything looks off, tell us what to adjust.
        </div>
        <div style="
          margin-top:14px;
          border-radius:12px;
          background:#111827;
          color:#FFFFFF;
          text-align:center;
          font-size:14px;
          font-weight:900;
          padding:12px 14px;
        ">
          Reply “Approved” to schedule
        </div>
        <div style="margin-top:8px;font-size:12px;color:#6B7280;text-align:center;">
          (You can ask questions or request changes — we’ll update the quote.)
        </div>
      </div>
    `
    : "";

  const summaryBlock =
    showSummary && safeTrim(summary)
      ? sectionCard("Summary", `<div style="white-space:pre-wrap;">${escapeHtml(summary)}</div>`)
      : "";

  const scopeBlock =
    showScope && visibleScope.length
      ? sectionCard("Visible scope", list(visibleScope))
      : "";

  const questionsBlock =
    showQuestions && questions.length
      ? sectionCard("A few quick questions (optional)", list(questions))
      : "";

  const assumptionsBlock =
    showAssumptions && assumptions.length
      ? sectionCard("Assumptions", list(assumptions))
      : "";

  const featuredHtml = featured
    ? `
      <div style="margin-top:18px;overflow:hidden;border-radius:16px;border:1px solid #E5E7EB;">
        <img src="${escAttr(featured.url)}" alt="${escAttr(featured.label)}" style="width:100%;display:block;max-height:520px;object-fit:cover;" />
        ${
          featured.label
            ? `<div style="padding:10px 12px;font-size:12px;color:#4B5563;display:flex;justify-content:space-between;gap:10px;">
                 <div style="font-weight:800;">${escapeHtml(featured.label)}</div>
                 <div style="font-family:monospace;opacity:.7;">featured</div>
               </div>`
            : ""
        }
      </div>
    `
    : `
      <div style="margin-top:18px;border:1px dashed #D1D5DB;border-radius:16px;background:#F9FAFB;padding:16px;color:#6B7280;font-size:14px;">
        No images selected.
      </div>
    `;

  const galleryHtml = gallery.length
    ? `
      <div style="margin-top:18px;">
        <div style="font-size:12px;font-weight:800;color:#4B5563;margin-bottom:10px;">Included images</div>
        ${gallery
          .map(
            (img, idx) => `
              <div style="margin-top:12px;overflow:hidden;border-radius:14px;border:1px solid #E5E7EB;">
                <img src="${escAttr(img.url)}" alt="${escAttr(img.label)}" style="width:100%;display:block;max-height:360px;object-fit:cover;" />
                <div style="padding:8px 10px;font-size:11px;color:#4B5563;display:flex;justify-content:space-between;gap:10px;">
                  <div style="font-weight:800;">${escapeHtml(img.label || "Image")}</div>
                  <div style="font-family:monospace;opacity:.7;">#${idx + 1}</div>
                </div>
              </div>
            `
          )
          .join("")}
      </div>
    `
    : "";

  const logoHtml = shopLogoUrl
    ? `
      <div style="width:40px;height:40px;border-radius:12px;overflow:hidden;background:#111827;">
        <img src="${escAttr(shopLogoUrl)}" alt="${escAttr(shopName)}" style="width:40px;height:40px;object-fit:cover;display:block;" />
      </div>
    `
    : `
      <div style="width:40px;height:40px;border-radius:12px;background:#111827;"></div>
    `;

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#F3F4F6;padding:28px;">
    <div style="max-width:720px;margin:0 auto;background:#FFFFFF;border-radius:18px;padding:24px;border:1px solid #E5E7EB;">
      <!-- Brand bar -->
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div style="display:flex;align-items:center;gap:12px;">
          ${logoHtml}
          <div>
            <div style="font-size:14px;font-weight:900;color:#111827;">${escapeHtml(shopName)}</div>
            <div style="font-size:12px;color:#6B7280;margin-top:2px;">${escapeHtml(brandSubtitle)}</div>
          </div>
        </div>
      </div>

      <!-- Headline -->
      <div style="margin-top:18px;">
        <div style="font-size:26px;line-height:1.2;font-weight:900;color:#111827;">
          ${escapeHtml(headline || args.subject)}
        </div>
      </div>

      <!-- Intro -->
      <div style="margin-top:12px;white-space:pre-wrap;font-size:14px;line-height:1.7;color:#1F2937;">
        ${escapeHtml(intro)}
      </div>

      <!-- Pills -->
      ${
        pillsHtml
          ? `<div style="margin-top:14px;">${pillsHtml}</div>`
          : ""
      }

      <!-- Pricing + blocks -->
      ${pricingBlock}
      ${summaryBlock}
      ${scopeBlock}
      ${questionsBlock}
      ${assumptionsBlock}

      <!-- Images -->
      ${featuredHtml}
      ${galleryHtml}

      <!-- Closing -->
      <div style="margin-top:18px;white-space:pre-wrap;font-size:14px;line-height:1.7;color:#1F2937;">
        ${escapeHtml(closing)}
      </div>

      <!-- Footer -->
      <div style="margin-top:22px;border-top:1px solid #E5E7EB;padding-top:12px;font-size:11px;color:#6B7280;">
        Sent via AIPhotoQuote · Reply to this email for scheduling or adjustments.
      </div>
    </div>
  </div>
  `;
}

export function buildQuoteCanvasText(args: {
  headline: string;
  intro: string;
  closing: string;

  shopName?: string | null;

  quoteBlocks?: {
    showPricing?: boolean;
    pricingMode?: PricingMode;
    priceFixed?: number | string | null;
    priceLow?: number | string | null;
    priceHigh?: number | string | null;

    estimateText?: string;
    confidence?: string;
    inspectionRequired?: boolean | null;

    showSummary?: boolean;
    summary?: string;

    showScope?: boolean;
    visibleScope?: string[];

    showQuestions?: boolean;
    questions?: string[];

    showAssumptions?: boolean;
    assumptions?: string[];
  } | null;
}) {
  const shopName = safeTrim(args.shopName) || "Your Shop";
  const qb = args.quoteBlocks || {};

  const showPricing = qb.showPricing !== false;
  const showSummary = qb.showSummary !== false;
  const showScope = qb.showScope === true;
  const showQuestions = qb.showQuestions !== false;
  const showAssumptions = qb.showAssumptions === true;

  const pricing = derivePricing({
    pricingMode: qb.pricingMode,
    priceFixed: qb.priceFixed,
    priceLow: qb.priceLow,
    priceHigh: qb.priceHigh,
    estimateText: safeTrim(qb.estimateText),
  });

  const lines: string[] = [];
  lines.push(shopName);
  lines.push("");
  lines.push(safeTrim(args.headline));
  lines.push("");
  lines.push(toLines(args.intro));
  lines.push("");

  if (showPricing) {
    lines.push(`Price: ${pricing.label || "—"}`);
    if (safeTrim(qb.confidence)) lines.push(`Confidence: ${safeTrim(qb.confidence)}`);
    if (qb.inspectionRequired === true) lines.push("Inspection required");
    lines.push("");
  }

  if (showSummary && safeTrim(qb.summary)) {
    lines.push("Summary:");
    lines.push(toLines(qb.summary));
    lines.push("");
  }

  if (showScope && Array.isArray(qb.visibleScope) && qb.visibleScope.length) {
    lines.push("Visible scope:");
    for (const x of qb.visibleScope) lines.push(`- ${safeTrim(x)}`);
    lines.push("");
  }

  if (showQuestions && Array.isArray(qb.questions) && qb.questions.length) {
    lines.push("Questions:");
    for (const x of qb.questions) lines.push(`- ${safeTrim(x)}`);
    lines.push("");
  }

  if (showAssumptions && Array.isArray(qb.assumptions) && qb.assumptions.length) {
    lines.push("Assumptions:");
    for (const x of qb.assumptions) lines.push(`- ${safeTrim(x)}`);
    lines.push("");
  }

  lines.push(toLines(args.closing));

  return lines.join("\n").trim();
}