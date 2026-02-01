// src/components/quoteForm/helpers.ts

export type WorkingPhase = "idle" | "compressing" | "uploading" | "analyzing";

export function digitsOnlyRaw(s: string) {
  return (s || "").replace(/\D/g, "");
}

export function normalizeUSPhoneDigits(input: string) {
  const d = digitsOnlyRaw(input);
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.slice(0, 10);
}

export function formatUSPhone(input: string) {
  const d = normalizeUSPhoneDigits(input);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (d.length <= 3) return a ? `(${a}` : "";
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

export function isValidEmail(email: string) {
  const s = (email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function safeFocus(el: HTMLElement | null | undefined) {
  if (!el) return;
  try {
    el.focus({ preventScroll: true } as any);
  } catch {
    try {
      (el as any).focus();
    } catch {
      // ignore
    }
  }
}

export async function focusAndScroll(
  el: HTMLElement | null | undefined,
  opts?: { block?: ScrollLogicalPosition; behavior?: ScrollBehavior }
) {
  if (!el) return;
  const block = opts?.block ?? "start";
  const behavior = opts?.behavior ?? "smooth";
  try {
    el.scrollIntoView({ behavior, block });
  } catch {
    try {
      el.scrollIntoView();
    } catch {
      // ignore
    }
  }
  await sleep(25);
  safeFocus(el);
}

export function computeWorkingStep(phase: WorkingPhase) {
  if (phase === "compressing") return { idx: 1, total: 3, label: "Optimizing photos…" };
  if (phase === "uploading") return { idx: 2, total: 3, label: "Uploading…" };
  if (phase === "analyzing") return { idx: 3, total: 3, label: "Inspecting…" };
  return { idx: 0, total: 3, label: "Ready" };
}

export function prettyCount(n: number) {
  if (!Number.isFinite(n)) return "0";
  if (n <= 999) return String(n);
  if (n <= 9_999) return `${Math.round(n / 100) / 10}k`;
  return `${Math.round(n / 1000)}k`;
}

export function isAbortError(e: any) {
  const name = String(e?.name ?? "");
  const msg = String(e?.message ?? "");
  return name === "AbortError" || /aborted/i.test(msg);
}