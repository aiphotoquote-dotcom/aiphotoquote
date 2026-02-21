// src/app/pcc/industries/[industryKey]/pccIndustryUtils.ts

export type EditorPack = {
  quoteEstimatorSystem?: string;
  qaQuestionGeneratorSystem?: string;
  extraSystemPreamble?: string;
  renderSystemAddendum?: string;
  renderNegativeGuidance?: string;
};

export function rows(r: any): any[] {
  return (r as any)?.rows ?? (Array.isArray(r) ? r : []);
}

export function firstRow(r: any): any | null {
  const rr = rows(r);
  return rr[0] ?? null;
}

export function fmtDate(d: any) {
  try {
    if (!d) return "";
    const dt = d instanceof Date ? d : new Date(d);
    if (!Number.isFinite(dt.getTime())) return "";
    return dt.toLocaleString();
  } catch {
    return "";
  }
}

export function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export function toBool(v: any) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? "").toLowerCase().trim();
  return s === "true" || s === "t" || s === "1" || s === "yes";
}

export function toNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export function titleFromKey(key: string) {
  const s = String(key ?? "").trim();
  if (!s) return "";
  return s
    .split(/[_\-]+/g)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

export function safeJsonParse(v: any): any | null {
  try {
    if (!v) return null;
    if (typeof v === "object") return v;
    const s = String(v);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function pick(obj: any, paths: string[]): any {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const k of parts) {
      if (!cur || typeof cur !== "object" || !(k in cur)) {
        ok = false;
        break;
      }
      cur = cur[k];
    }
    if (ok) return cur;
  }
  return null;
}

export function normalizeUrl(u: string | null) {
  const s = safeTrim(u);
  if (!s) return null;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://${s}`;
}

export function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

export function isPlainObject(v: any) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function packObjToEditorPack(industryKeyLower: string, obj: any): EditorPack | null {
  if (!isPlainObject(obj)) return null;

  const p = obj?.prompts?.industryPromptPacks?.[industryKeyLower];
  const pack = isPlainObject(p) ? p : null;
  if (!pack) return null;

  const quoteEstimatorSystem = safeTrim(pack.quoteEstimatorSystem);
  const qaQuestionGeneratorSystem = safeTrim(pack.qaQuestionGeneratorSystem);
  const extraSystemPreamble = safeTrim(pack.extraSystemPreamble);

  const renderSystemAddendum = safeTrim(pack.renderSystemAddendum) || safeTrim(pack.renderPromptAddendum);
  const renderNegativeGuidance = safeTrim(pack.renderNegativeGuidance);

  const out: EditorPack = {};
  if (quoteEstimatorSystem) out.quoteEstimatorSystem = quoteEstimatorSystem;
  if (qaQuestionGeneratorSystem) out.qaQuestionGeneratorSystem = qaQuestionGeneratorSystem;
  if (extraSystemPreamble) out.extraSystemPreamble = extraSystemPreamble;
  if (renderSystemAddendum) out.renderSystemAddendum = renderSystemAddendum;
  if (renderNegativeGuidance) out.renderNegativeGuidance = renderNegativeGuidance;

  return Object.keys(out).length ? out : null;
}

export function mergeEditorPacks(base: EditorPack | null, overlay: EditorPack | null): EditorPack | null {
  const b = base ?? {};
  const o = overlay ?? {};
  const out: EditorPack = { ...b };

  (Object.keys(o) as Array<keyof EditorPack>).forEach((k) => {
    const v = safeTrim(o[k]);
    if (v) (out as any)[k] = v;
  });

  return Object.keys(out).length ? out : null;
}