// src/lib/email/templates/renderReady.ts

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildRenderReadyEmail(args: {
  businessName: string;
  tenantSlug: string;
  quoteLogId: string;
  renderImageUrl: string;
}) {
  const { businessName, tenantSlug, quoteLogId, renderImageUrl } = args;

  const subjectLead = `AI Rendering Ready — Quote ${quoteLogId}`;
  const subjectCustomer = `Your AI Rendering Preview — Quote ${quoteLogId}`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.4;color:#111;">
    <h2 style="margin:0 0 8px;">AI Rendering Ready</h2>

    <div style="margin:0 0 10px;color:#374151;">
      <div><b>Tenant</b>: ${esc(tenantSlug)}</div>
      <div><b>Quote ID</b>: ${esc(quoteLogId)}</div>
    </div>

    <div style="margin:14px 0;">
      <img src="${esc(renderImageUrl)}" alt="AI concept rendering"
        style="max-width:560px;width:100%;border-radius:10px;border:1px solid #e5e7eb" />
    </div>

    <div style="margin-top:10px;color:#6b7280;">
      — ${esc(businessName)}
    </div>
  </div>`;

  return { html, subjectLead, subjectCustomer };
}