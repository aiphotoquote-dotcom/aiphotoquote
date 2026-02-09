// src/app/onboarding/wizard/utils.ts

import type { Mode } from "./types";

export function safeStep(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(7, Math.floor(n)));
}

export function safeMode(v: any): Mode {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "update") return "update";
  if (s === "existing") return "existing";
  return "new";
}

export function normalizeWebsiteInput(raw: string) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

export function getUrlParams() {
  if (typeof window === "undefined") return { step: 1, mode: "new" as Mode, tenantId: "" };
  const url = new URL(window.location.href);
  const step = safeStep(url.searchParams.get("step") ?? "1");
  const mode = safeMode(url.searchParams.get("mode"));
  const tenantId = String(url.searchParams.get("tenantId") ?? "").trim();
  return { step, mode, tenantId };
}

export function setUrlParams(next: { step?: number; mode?: Mode; tenantId?: string }) {
  const url = new URL(window.location.href);

  if (typeof next.step === "number") url.searchParams.set("step", String(safeStep(next.step)));
  if (next.mode) url.searchParams.set("mode", next.mode);

  if (typeof next.tenantId === "string") {
    const tid = next.tenantId.trim();
    if (tid) url.searchParams.set("tenantId", tid);
    else url.searchParams.delete("tenantId");
  }

  window.history.replaceState({}, "", url.toString());
}

export function buildStateUrl(mode: Mode, tenantId: string) {
  const qs = new URLSearchParams();
  qs.set("mode", mode);
  if (tenantId) qs.set("tenantId", tenantId);
  return `/api/onboarding/state?${qs.toString()}`;
}

export function buildIndustriesUrl(tenantId: string) {
  const qs = new URLSearchParams();
  qs.set("tenantId", tenantId);
  return `/api/onboarding/industries?${qs.toString()}`;
}

export function getConfidence(aiAnalysis: any | null | undefined) {
  const n = Number(aiAnalysis?.confidenceScore ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function needsConfirmation(aiAnalysis: any | null | undefined) {
  const v = aiAnalysis?.needsConfirmation;
  if (typeof v === "boolean") return v;
  return getConfidence(aiAnalysis) < 0.8;
}

export function formatHttpError(j: any, res: Response) {
  const msg = String(j?.message || j?.error || "").trim();
  return msg || `Request failed (HTTP ${res.status})`;
}

export function getMetaStatus(aiAnalysis: any | null | undefined) {
  const s = String(aiAnalysis?.meta?.status ?? "").trim();
  return s || "";
}

export function getMetaLastAction(aiAnalysis: any | null | undefined) {
  const s = String(aiAnalysis?.meta?.lastAction ?? "").trim();
  return s || "";
}

export function getPreviewText(aiAnalysis: any | null | undefined) {
  const p = String(aiAnalysis?.extractedTextPreview ?? "").trim();
  if (p) return p;
  const p2 = String(aiAnalysis?.debug?.extractedTextPreview ?? "").trim();
  if (p2) return p2;
  return "";
}

export function summarizeFetchDebug(aiAnalysis: any | null | undefined) {
  const fd = aiAnalysis?.fetchDebug ?? null;
  if (!fd) return null;

  const aggregateChars = Number(fd?.aggregateChars ?? 0) || 0;
  const pagesUsed: string[] = Array.isArray(fd?.pagesUsed) ? fd.pagesUsed : [];
  const attempted: any[] = Array.isArray(fd?.attempted) ? fd.attempted : [];
  const pagesAttempted: any[] = Array.isArray(fd?.pagesAttempted) ? fd.pagesAttempted : [];

  let hint: string | null = null;
  if (aggregateChars < 200) {
    const notes: string[] = [];
    for (const a of attempted) {
      const n = String(a?.note ?? "").trim();
      if (n) notes.push(n);
    }
    for (const a of pagesAttempted) {
      const n = String(a?.note ?? "").trim();
      if (n) notes.push(n);
    }
    const uniq = Array.from(new Set(notes)).slice(0, 2);
    hint = uniq.length
      ? uniq.join(" / ")
      : "Very little readable text was extracted. This usually means the site is JS-rendered, blocked, or mostly images.";
  }

  return { aggregateChars, pagesUsed, attemptedCount: attempted.length, pagesAttemptedCount: pagesAttempted.length, hint };
}

/** Best-effort logo guess from analysis payload (defensive) */
export function guessLogoUrl(aiAnalysis: any | null | undefined) {
  const candidates = [
    aiAnalysis?.brand?.recommendedLogoUrl,
    aiAnalysis?.brand?.logoUrl,
    aiAnalysis?.brand?.logo,
    aiAnalysis?.logoUrl,
    aiAnalysis?.logo,
    aiAnalysis?.assets?.logo,
    aiAnalysis?.assets?.logoUrl,
    aiAnalysis?.detectedLogoUrl,
  ];

  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s && /^https?:\/\//i.test(s)) return s;
  }
  return "";
}