// src/lib/platform/email/sendPlatformEmail.ts

import { Resend } from "resend";

export type PlatformEmailSendInput = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;

  fromEmail?: string | null;
  fromName?: string | null;
  replyTo?: string | string[] | null;

  cc?: string | string[] | null;
  bcc?: string | string[] | null;

  tags?: Array<{ name: string; value: string }> | null;
};

export type PlatformEmailSendResult = {
  ok: boolean;
  provider: "resend";
  providerMessageId: string | null;
  error: string | null;
  meta: {
    fromRequested: string | null;
    fromUsed: string | null;
    replyToUsed: string[];
    to: string[];
    cc: string[];
    bcc: string[];
    tags: Array<{ name: string; value: string }>;
  };
};

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function toArray(v: string | string[] | null | undefined): string[] {
  if (Array.isArray(v)) return v.map((x) => safeTrim(x)).filter(Boolean);
  const one = safeTrim(v);
  return one ? [one] : [];
}

function dedupe(xs: string[]) {
  return Array.from(new Set(xs.map((x) => safeTrim(x)).filter(Boolean)));
}

function normalizeTags(tags: PlatformEmailSendInput["tags"]) {
  if (!Array.isArray(tags)) return [] as Array<{ name: string; value: string }>;
  return tags
    .map((t) => ({
      name: safeTrim(t?.name),
      value: safeTrim(t?.value),
    }))
    .filter((t) => t.name && t.value);
}

function formatFromAddress(fromEmail?: string | null, fromName?: string | null) {
  const email = safeTrim(fromEmail);
  const name = safeTrim(fromName);

  if (!email) return "";
  if (!name) return email;

  const escapedName = name.replace(/"/g, '\\"');
  return `"${escapedName}" <${email}>`;
}

function getDefaultFromEmail() {
  return (
    safeTrim(process.env.PLATFORM_FROM_EMAIL) ||
    safeTrim(process.env.RESEND_FALLBACK_FROM) ||
    safeTrim(process.env.RESEND_FROM_EMAIL) ||
    ""
  );
}

function getDefaultFromName() {
  return (
    safeTrim(process.env.PLATFORM_FROM_EMAIL_NAME) ||
    "AI Photo Quote"
  );
}

function getDefaultReplyTo() {
  return (
    safeTrim(process.env.PLATFORM_REPLY_TO) ||
    safeTrim(process.env.PLATFORM_FROM_EMAIL) ||
    ""
  );
}

function getStatusCode(e: any): number | null {
  const s = e?.statusCode ?? e?.status ?? e?.response?.status ?? e?.response?.statusCode ?? null;
  return typeof s === "number" ? s : null;
}

function getRetryAfterMs(e: any): number | null {
  const ra = e?.response?.headers?.["retry-after"] ?? e?.headers?.["retry-after"] ?? e?.retryAfter ?? null;
  if (ra == null) return null;

  const n = Number(ra);
  if (Number.isFinite(n) && n > 0) return Math.min(30_000, Math.round(n * 1000));
  return null;
}

function isRateLimitError(e: any): boolean {
  const status = getStatusCode(e);
  if (status === 429) return true;

  const msg = String(e?.message ?? "").toLowerCase();
  return msg.includes("too many requests") || msg.includes("rate limit") || msg.includes("429");
}

function isSenderDomainBlockedError(e: any): boolean {
  const msg = String(e?.message ?? "").toLowerCase();

  if (msg.includes("domain is not verified") || msg.includes("not verified")) return true;
  if (msg.includes("verify your domain")) return true;
  if (msg.includes("add and verify your domain")) return true;
  if (msg.includes("sender") && msg.includes("not verified")) return true;
  if (msg.includes("from") && msg.includes("not verified")) return true;

  return false;
}

function extractMessageId(out: any): string | null {
  const a = out?.data?.id;
  if (typeof a === "string" && a.trim()) return a.trim();

  const b = out?.id;
  if (typeof b === "string" && b.trim()) return b.trim();

  const c = out?.data?.messageId ?? out?.messageId ?? out?.data?.message_id ?? out?.message_id;
  if (typeof c === "string" && c.trim()) return c.trim();

  return null;
}

function extractProviderError(out: any): string | null {
  const e = out?.error;
  if (!e) return null;
  if (typeof e === "string") return e;
  if (typeof e?.message === "string" && e.message.trim()) return e.message.trim();
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendPlatformEmail(input: PlatformEmailSendInput): Promise<PlatformEmailSendResult> {
  const apiKey = safeTrim(process.env.RESEND_API_KEY);
  if (!apiKey) {
    return {
      ok: false,
      provider: "resend",
      providerMessageId: null,
      error: "Missing RESEND_API_KEY",
      meta: {
        fromRequested: null,
        fromUsed: null,
        replyToUsed: [],
        to: [],
        cc: [],
        bcc: [],
        tags: [],
      },
    };
  }

  const resend = new Resend(apiKey);

  const to = dedupe(toArray(input.to));
  const cc = dedupe(toArray(input.cc ?? null));
  const bcc = dedupe(toArray(input.bcc ?? null));
  const replyTo = dedupe(toArray(input.replyTo ?? getDefaultReplyTo()));
  const tags = normalizeTags(input.tags);

  const requestedFromEmail = safeTrim(input.fromEmail) || getDefaultFromEmail();
  const requestedFromName = safeTrim(input.fromName) || getDefaultFromName();
  const requestedFrom = formatFromAddress(requestedFromEmail, requestedFromName);

  if (!to.length) {
    return {
      ok: false,
      provider: "resend",
      providerMessageId: null,
      error: "Missing recipient",
      meta: {
        fromRequested: requestedFrom || null,
        fromUsed: null,
        replyToUsed: replyTo,
        to,
        cc,
        bcc,
        tags,
      },
    };
  }

  if (!safeTrim(input.subject)) {
    return {
      ok: false,
      provider: "resend",
      providerMessageId: null,
      error: "Missing subject",
      meta: {
        fromRequested: requestedFrom || null,
        fromUsed: null,
        replyToUsed: replyTo,
        to,
        cc,
        bcc,
        tags,
      },
    };
  }

  if (!safeTrim(input.html) || !safeTrim(input.text)) {
    return {
      ok: false,
      provider: "resend",
      providerMessageId: null,
      error: "Both html and text are required",
      meta: {
        fromRequested: requestedFrom || null,
        fromUsed: null,
        replyToUsed: replyTo,
        to,
        cc,
        bcc,
        tags,
      },
    };
  }

  if (!requestedFrom) {
    return {
      ok: false,
      provider: "resend",
      providerMessageId: null,
      error: "Missing platform sender configuration",
      meta: {
        fromRequested: null,
        fromUsed: null,
        replyToUsed: replyTo,
        to,
        cc,
        bcc,
        tags,
      },
    };
  }

  const fallbackFromEmail =
    safeTrim(process.env.RESEND_FALLBACK_FROM) ||
    safeTrim(process.env.PLATFORM_FROM_EMAIL) ||
    safeTrim(process.env.RESEND_FROM_EMAIL) ||
    "";
  const fallbackFromName = getDefaultFromName();
  const fallbackFrom = formatFromAddress(fallbackFromEmail, fallbackFromName);

  await sleep(40 + Math.floor(Math.random() * 70));

  const backoffs = [350, 900, 1800];

  async function rawSend(fromOverride?: string) {
    const fromUsed = safeTrim(fromOverride) || requestedFrom;

    const payload: any = {
      from: fromUsed,
      to,
      subject: input.subject.trim(),
      html: input.html,
      text: input.text,
    };

    if (cc.length) payload.cc = cc;
    if (bcc.length) payload.bcc = bcc;
    if (replyTo.length) payload.replyTo = replyTo[0];
    if (tags.length) payload.tags = tags;

    const out = await resend.emails.send(payload);

    const providerErr = extractProviderError(out);
    if (providerErr) {
      const err = new Error(providerErr);
      (err as any).provider_out = out;
      throw err;
    }

    const id = extractMessageId(out);
    if (!id) {
      throw new Error("RESEND_NO_MESSAGE_ID");
    }

    return { id, fromUsed };
  }

  async function sendWith429Retries(fn: () => Promise<{ id: string; fromUsed: string }>) {
    for (let attempt = 0; attempt <= backoffs.length; attempt += 1) {
      try {
        const res = await fn();
        return { ...res, attempt };
      } catch (e: any) {
        if (!isRateLimitError(e)) throw e;

        if (attempt < backoffs.length) {
          const retryAfter = getRetryAfterMs(e);
          const waitMs = retryAfter ?? backoffs[attempt];
          const jitter = Math.floor(Math.random() * 150);
          await sleep(waitMs + jitter);
          continue;
        }

        throw e;
      }
    }

    throw new Error("RESEND_UNKNOWN_RETRY_STATE");
  }

  try {
    const { id, fromUsed } = await sendWith429Retries(() => rawSend());

    return {
      ok: true,
      provider: "resend",
      providerMessageId: id,
      error: null,
      meta: {
        fromRequested: requestedFrom,
        fromUsed,
        replyToUsed: replyTo,
        to,
        cc,
        bcc,
        tags,
      },
    };
  } catch (e1: any) {
    if (isSenderDomainBlockedError(e1) && fallbackFrom && fallbackFrom !== requestedFrom) {
      try {
        const { id, fromUsed } = await sendWith429Retries(() => rawSend(fallbackFrom));

        return {
          ok: true,
          provider: "resend",
          providerMessageId: id,
          error: null,
          meta: {
            fromRequested: requestedFrom,
            fromUsed,
            replyToUsed: replyTo,
            to,
            cc,
            bcc,
            tags,
          },
        };
      } catch (e2: any) {
        return {
          ok: false,
          provider: "resend",
          providerMessageId: null,
          error: e2?.message ?? String(e2),
          meta: {
            fromRequested: requestedFrom,
            fromUsed: fallbackFrom,
            replyToUsed: replyTo,
            to,
            cc,
            bcc,
            tags,
          },
        };
      }
    }

    return {
      ok: false,
      provider: "resend",
      providerMessageId: null,
      error: e1?.message ?? String(e1),
      meta: {
        fromRequested: requestedFrom,
        fromUsed: requestedFrom,
        replyToUsed: replyTo,
        to,
        cc,
        bcc,
        tags,
      },
    };
  }
}