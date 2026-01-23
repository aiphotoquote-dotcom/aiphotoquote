// src/lib/email/templates/leadNew.ts
function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderLeadNewEmailHTML(args: {
  businessName: string;
  tenantSlug: string;
  quoteLogId: string;
  customer: { name: string; email: string; phone: string };
  notes?: string;
  imageUrls: string[];
}) {
  const { businessName, tenantSlug, quoteLogId, customer, notes, imageUrls } = args;

  const imgs = (imageUrls || [])
    .slice(0, 12)
    .map(
      (u) => `
      <div style="margin:10px 0;">
        <img src="${esc(u)}" alt="Customer photo" style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb" />
      </div>
    `
    )
    .join("");

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#111;">
    <h2 style="margin:0 0 10px;">New Photo Quote</h2>

    <div style="margin:0 0 10px;color:#374151;">
      <div><b>Tenant</b>: ${esc(tenantSlug)}</div>
      <div><b>Quote ID</b>: ${esc(quoteLogId)}</div>
    </div>

    <div style="margin:12px 0;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#fafafa;">
      <div><b>Name</b>: ${esc(customer.name)}</div>
      <div><b>Email</b>: ${esc(customer.email)}</div>
      <div><b>Phone</b>: ${esc(customer.phone)}</div>
    </div>

    ${
      notes
        ? `<div style="margin:12px 0;"><b>Notes</b><div style="white-space:pre-wrap;margin-top:6px;color:#111;">${esc(
            notes
          )}</div></div>`
        : ""
    }

    ${imgs}

    <div style="margin-top:14px;color:#6b7280;">
      — ${esc(businessName)}
    </div>
  </div>`;
}