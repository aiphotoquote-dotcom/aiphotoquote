// src/lib/email/templates/abandoned.ts
export function renderAbandonedEmailHTML(args: {
  businessName: string;
  customerName: string;
  brandLogoUrl?: string | null;
  resumeUrl?: string | null; // optional: later you can build "resume" links
}) {
  const businessName = String(args.businessName || "AI Photo Quote").trim();
  const customerName = String(args.customerName || "there").trim();
  const logo = (args.brandLogoUrl || "").trim();
  const resumeUrl = (args.resumeUrl || "").trim();

  const button = resumeUrl
    ? `<p style="margin:16px 0;">
         <a href="${escapeHtmlAttr(resumeUrl)}"
            style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600;">
            Finish your request
         </a>
       </p>`
    : "";

  const logoHtml = logo
    ? `<div style="margin-bottom:12px;">
         <img src="${escapeHtmlAttr(logo)}" alt="${escapeHtmlAttr(businessName)}"
              style="max-height:48px;max-width:220px;object-fit:contain;" />
       </div>`
    : "";

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;color:#111;">
    ${logoHtml}
    <h2 style="margin:0 0 8px;">Still want an estimate?</h2>
    <p style="margin:0 0 10px;color:#374151;">
      Hey ${escapeHtml(customerName)} — we noticed you started a photo quote request with ${escapeHtml(businessName)} but didn’t finish.
    </p>
    <p style="margin:0 0 10px;color:#374151;">
      If you still want an estimate, just reply to this email and tell us what you’re looking for (or send any extra photos).
    </p>
    ${button}
    <p style="margin:14px 0 0;color:#6b7280;font-size:12px;">
      If you already completed your request, you can ignore this message.
    </p>
  </div>
  `;
}

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeHtmlAttr(s: string) {
  return escapeHtml(s).replace(/`/g, "&#096;");
}