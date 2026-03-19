// src/lib/platform/email/sendInviteEmail.ts

import { sendPlatformEmail } from "./sendPlatformEmail";

export type SendInviteEmailInput = {
  email: string;
  inviteCode: string;
  inviteLink: string;
};

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function buildInviteHtml(code: string, link: string) {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#f5f7fb; padding:40px 20px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e6e8ee;padding:40px;">
      
      <h1 style="margin:0 0 16px 0;font-size:26px;color:#111827;">
        🎉 Congratulations — You've Been Invited
      </h1>

      <p style="font-size:16px;line-height:1.6;color:#374151;">
        You’ve been invited to join <strong>AI Photo Quote</strong>, the AI-powered quoting platform designed for modern service businesses.
      </p>

      <p style="font-size:16px;line-height:1.6;color:#374151;">
        Use the link below to begin onboarding your business.
      </p>

      <div style="margin:32px 0;text-align:center;">
        <a href="${link}" style="
          display:inline-block;
          background:#2563eb;
          color:#ffffff;
          text-decoration:none;
          font-weight:600;
          padding:14px 26px;
          border-radius:8px;
          font-size:16px;
        ">
          Start Your Setup
        </a>
      </div>

      <p style="font-size:14px;color:#6b7280;">
        If the button doesn’t work, paste this link into your browser:
      </p>

      <p style="font-size:14px;color:#2563eb;word-break:break-all;">
        ${link}
      </p>

      <div style="
        margin-top:30px;
        padding:16px;
        background:#f9fafb;
        border-radius:8px;
        border:1px solid #e5e7eb;
        text-align:center;
      ">
        <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">
          Your Invite Code
        </div>
        <div style="font-family:monospace;font-size:20px;font-weight:600;color:#111827;">
          ${code}
        </div>
      </div>

      <p style="margin-top:30px;font-size:13px;color:#6b7280;">
        If you did not expect this invitation, you can safely ignore this email.
      </p>

    </div>
  </div>
  `;
}

function buildInviteText(code: string, link: string) {
  return `
Congratulations — You've Been Invited

You've been invited to join AI Photo Quote.

Start onboarding here:
${link}

Invite Code:
${code}

If you did not expect this invitation you can ignore this email.
`.trim();
}

export async function sendInviteEmail(input: SendInviteEmailInput) {
  const email = safeTrim(input.email);
  const code = safeTrim(input.inviteCode);
  const link = safeTrim(input.inviteLink);

  if (!email || !code || !link) {
    return {
      ok: false,
      error: "Missing email, inviteCode, or inviteLink",
    };
  }

  const subject = "You're Invited to Join AI Photo Quote";

  const html = buildInviteHtml(code, link);
  const text = buildInviteText(code, link);

  return sendPlatformEmail({
    to: email,
    subject,
    html,
    text,

    tags: [
      { name: "system", value: "pcc" },
      { name: "type", value: "invite" },
    ],
  });
}