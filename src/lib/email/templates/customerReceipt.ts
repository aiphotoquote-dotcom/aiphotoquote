// src/lib/email/templates/customerReceipt.ts
function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderCustomerReceiptEmailHTML(args: {
  businessName: string;
  quoteLogId: string;
  customerName: string;
  summary: string;
  estimateLow: number;
  estimateHigh: number;
  questions: string[];
  // NEW (optional)
  logoUrl?: string | null;
}) {
  const {
    businessName,
    quoteLogId,
    customerName,
    summary,
    estimateLow,
    estimateHigh,
    questions,
    logoUrl,
  } = args;

  const q = (questions || [])
    .slice(0, 10)
    .map((x) => `<li>${esc(x)}</li>`)
    .join("");

  const header = logoUrl
    ? `
      <div style="display:flex;align-items:center;gap:12px;margin:0 0 12px;">
        <img src="${esc(logoUrl)}" alt="${esc(businessName)}" style="max-height:48px;width:auto;display:block;object-fit:contain;" />
        <div>
          <div style="font-size:18px;font-weight:800;color:#111;line-height:1.2;">Your AI Photo Quote</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">${esc(businessName)}</div>
        </div>
      </div>
    `
    : `<h2 style="margin:0 0 10px;">Your AI Photo Quote</h2>`;

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#111;">
    ${header}

    <div style="margin:0 0 10px;color:#374151;">
      Hi ${esc(customerName)}, we received your photos. Here’s your preliminary estimate range.
    </div>

    <div style="margin:12px 0;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
      <div><b>Quote ID</b>: ${esc(quoteLogId)}</div>
      <div style="margin-top:8px;"><b>Estimate range</b>: $${esc(estimateLow)} – $${esc(estimateHigh)}</div>
    </div>

    <div style="margin:12px 0;">
      <b>Summary</b>
      <div style="margin-top:6px;white-space:pre-wrap;">${esc(summary)}</div>
    </div>

    ${
      q
        ? `<div style="margin:12px 0;">
            <b>Quick questions</b>
            <ul style="margin:6px 0 0 18px;color:#111;">${q}</ul>
          </div>`
        : ""
    }

    <div style="margin-top:14px;color:#6b7280;">
      — ${esc(businessName)}
    </div>
  </div>`;
}