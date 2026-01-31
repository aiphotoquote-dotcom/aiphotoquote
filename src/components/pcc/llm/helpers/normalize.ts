// src/components/pcc/llm/helpers/normalize.ts

export function safeStr(v: unknown, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

export function numClamp(v: unknown, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function normalizeBlockedTopics(raw: string): string[] {
  const parts = raw
    .split(/\n|,/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}