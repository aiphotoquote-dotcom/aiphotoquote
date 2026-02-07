// src/app/onboarding/wizard/steps/Step5Branding.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { guessLogoUrl } from "../utils";
import { Field } from "./Field";

type BrandGuessResponse = {
  ok: boolean;
  tenantId: string;
  website: string | null;
  current?: { brandLogoUrl: string | null; leadToEmail: string | null };
  suggested?: { brandLogoUrl: string | null; leadToEmail: string | null };
  // NEW (preferred)
  suggestedLogos?: string[];
  error?: string;
  message?: string;
};

type PreviewBgMode = "auto" | "light" | "dark" | "checker";

type ContrastProbe = {
  ok: boolean;
  brightness: number; // 0..1 (higher = brighter)
  transparentRatio: number; // 0..1 (higher = more transparent pixels)
  recommended: Exclude<PreviewBgMode, "auto">;
  samplePixels: number;
};

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function uniqUrlsKeepOrder(urls: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const s = String(u ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Best-effort: infer good preview background for the logo:
 * - Transparent / mostly transparent => checker
 * - Very bright logo => dark
 * - Otherwise => light
 *
 * NOTE: This is ONLY for preview UX; nothing is persisted.
 */
async function probeLogoContrast(url: string, maxSide = 220): Promise<ContrastProbe> {
  const src = String(url || "").trim();
  if (!src) {
    return {
      ok: false,
      brightness: 0,
      transparentRatio: 0,
      recommended: "light",
      samplePixels: 0,
    };
  }

  const isSvg = /\.svg(\?|#|$)/i.test(src) || src.startsWith("data:image/svg+xml");

  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";

    const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
      const u = new URL(src, typeof window !== "undefined" ? window.location.href : "https://example.com");
      if (!u.searchParams.has("_ts")) u.searchParams.set("_ts", String(Date.now()));
      img.src = u.toString();
    });

    const w0 = loaded.naturalWidth || loaded.width || 1;
    const h0 = loaded.naturalHeight || loaded.height || 1;

    const scale = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("NO_CTX");

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(loaded, 0, 0, w, h);

    const data = ctx.getImageData(0, 0, w, h).data;

    let brightSum = 0;
    let opaqueCount = 0;
    let transparentCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      const alpha = a / 255;

      if (alpha < 0.08) {
        transparentCount++;
        continue;
      }

      opaqueCount++;

      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      brightSum += lum;
    }

    const totalPixels = w * h;
    const transparentRatio = totalPixels > 0 ? transparentCount / totalPixels : 0;
    const brightness = opaqueCount > 0 ? brightSum / opaqueCount : 0;

    const recommended: Exclude<PreviewBgMode, "auto"> =
      transparentRatio > 0.35 || (opaqueCount < totalPixels * 0.25 && transparentRatio > 0.15)
        ? "checker"
        : brightness > 0.72 || (isSvg && brightness > 0.6)
          ? "dark"
          : "light";

    return {
      ok: true,
      brightness: clamp01(brightness),
      transparentRatio: clamp01(transparentRatio),
      recommended,
      samplePixels: totalPixels,
    };
  } catch {
    const fallback: Exclude<PreviewBgMode, "auto"> = isSvg ? "dark" : "light";
    return {
      ok: false,
      brightness: 0,
      transparentRatio: isSvg ? 0.5 : 0,
      recommended: fallback,
      samplePixels: 0,
    };
  }
}

function previewBoxClass(mode: Exclude<PreviewBgMode, "auto">) {
  if (mode === "dark") return "bg-black";
  if (mode === "light") return "bg-white";
  return "bg-[linear-gradient(45deg,rgba(0,0,0,0.06)_25%,transparent_25%,transparent_75%,rgba(0,0,0,0.06)_75%,rgba(0,0,0,0.06)),linear-gradient(45deg,rgba(0,0,0,0.06)_25%,transparent_25%,transparent_75%,rgba(0,0,0,0.06)_75%,rgba(0,0,0,0.06))] bg-[length:20px_20px] bg-[position:0_0,10px_10px]";
}

export function Step5Branding(props: {
  tenantId: string | null;
  aiAnalysis: any | null | undefined;
  ensureActiveTenant: (tid: string) => Promise<void>;
  onBack: () => void;
  onSubmit: (payload: { leadToEmail: string; brandLogoUrl?: string | null }) => Promise<void>;
}) {
  const [leadToEmail, setLeadToEmail] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [logoChoices, setLogoChoices] = useState<string[]>([]);
  const [userTouchedLogo, setUserTouchedLogo] = useState(false);
  const [userTouchedEmail, setUserTouchedEmail] = useState(false);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingGuess, setLoadingGuess] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // --- contrast-safe preview state ---
  const [previewMode, setPreviewMode] = useState<PreviewBgMode>("auto");
  const [probe, setProbe] = useState<ContrastProbe | null>(null);
  const [probing, setProbing] = useState(false);

  const suggestedLogoFromAi = useMemo(() => guessLogoUrl(props.aiAnalysis), [props.aiAnalysis]);

  // Prime from AI guess (ONLY if user hasn't touched logo and it's empty)
  useEffect(() => {
    if (userTouchedLogo) return;
    if (!brandLogoUrl.trim() && suggestedLogoFromAi) {
      const v = String(suggestedLogoFromAi).trim();
      setBrandLogoUrl(v);
      setLogoChoices((prev) => uniqUrlsKeepOrder([v, ...prev]).slice(0, 3));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedLogoFromAi]);

  // Server-side “brand guess” autofill (scrape + saved tenant_settings)
  useEffect(() => {
    const tid = String(props.tenantId ?? "").trim();
    if (!tid) return;

    // Only fetch guesses if fields are still empty AND user hasn't touched (don’t clobber)
    if (userTouchedEmail || userTouchedLogo) return;
    if (leadToEmail.trim() || brandLogoUrl.trim()) return;

    let alive = true;

    (async () => {
      setLoadingGuess(true);
      setErr(null);
      try {
        await props.ensureActiveTenant(tid).catch(() => null);

        const res = await fetch(`/api/onboarding/brand-guess?tenantId=${encodeURIComponent(tid)}`, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });

        const j = (await res.json().catch(() => null)) as BrandGuessResponse | null;
        if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `Failed to fetch brand guess (HTTP ${res.status})`);
        if (!alive) return;

        const currentLogo = String(j?.current?.brandLogoUrl ?? "").trim();
        const currentEmail = String(j?.current?.leadToEmail ?? "").trim();

        const suggLogo = String(j?.suggested?.brandLogoUrl ?? "").trim();
        const suggEmail = String(j?.suggested?.leadToEmail ?? "").trim();

        const suggestedLogos = Array.isArray(j?.suggestedLogos) ? j!.suggestedLogos!.map((x) => String(x ?? "").trim()) : [];
        const mergedChoices = uniqUrlsKeepOrder([
          currentLogo,
          ...suggestedLogos,
          suggLogo,
          suggestedLogoFromAi ? String(suggestedLogoFromAi).trim() : "",
        ]).slice(0, 3);

        if (mergedChoices.length) setLogoChoices(mergedChoices);

        // Prefer current saved, else first choice, else suggested
        const bestLogo = currentLogo || mergedChoices[0] || suggLogo;

        if (!brandLogoUrl.trim() && bestLogo) setBrandLogoUrl(bestLogo);
        if (!leadToEmail.trim() && (currentEmail || suggEmail)) setLeadToEmail((currentEmail || suggEmail).trim());
      } catch (ex: any) {
        if (!alive) return;
        setErr(ex?.message ?? String(ex));
      } finally {
        if (alive) setLoadingGuess(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tenantId]);

  // Probe the currently selected logo whenever URL changes to improve preview contrast
  useEffect(() => {
    const url = brandLogoUrl.trim();
    if (!url) {
      setProbe(null);
      setProbing(false);
      return;
    }

    let alive = true;

    (async () => {
      setProbing(true);
      try {
        const p = await probeLogoContrast(url);
        if (!alive) return;
        setProbe(p);
      } catch {
        if (!alive) return;
        setProbe(null);
      } finally {
        if (!alive) return;
        setProbing(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [brandLogoUrl]);

  const effectivePreview: Exclude<PreviewBgMode, "auto"> = useMemo(() => {
    if (previewMode !== "auto") return previewMode;
    return probe?.recommended ?? "light";
  }, [previewMode, probe]);

  async function uploadLogo(file: File) {
    const tid = String(props.tenantId ?? "").trim();
    if (!tid) throw new Error("NO_TENANT: missing tenantId for logo upload.");

    await props.ensureActiveTenant(tid);

    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/admin/tenant-logo/upload", { method: "POST", body: fd });
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : { ok: false, error: await res.text() };

    if (!res.ok || !data?.ok) throw new Error(data?.message || data?.error || "Upload failed");
    return String(data.url || "").trim();
  }

  const canSave = leadToEmail.trim().includes("@");

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Branding & lead routing</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Default sender will be <span className="font-mono">AI Photo Quote &lt;no-reply@aiphotoquote.com&gt;</span>. You can
        personalize later in tenant settings.
      </div>

      {loadingGuess ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          Pulling your logo + lead email from your website…
        </div>
      ) : null}

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        <div className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Logo</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                We try to auto-detect a few logo options from your website. Pick the right one or upload your own.
              </div>
            </div>

            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;

                  setErr(null);
                  setUploading(true);
                  try {
                    const url = await uploadLogo(f);
                    setUserTouchedLogo(true);
                    setBrandLogoUrl(url);
                    setLogoChoices((prev) => uniqUrlsKeepOrder([url, ...prev]).slice(0, 3));
                    setPreviewMode("auto");
                  } catch (ex: any) {
                    setErr(ex?.message ?? String(ex));
                  } finally {
                    setUploading(false);
                    if (fileRef.current) fileRef.current.value = "";
                  }
                }}
              />

              <button
                type="button"
                className="rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                disabled={uploading || saving}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>

              {brandLogoUrl.trim() ? (
                <button
                  type="button"
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                  onClick={() => {
                    setUserTouchedLogo(true);
                    setBrandLogoUrl("");
                    setPreviewMode("auto");
                    setProbe(null);
                  }}
                  disabled={uploading || saving}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {/* Website-derived choices */}
          {logoChoices.length ? (
            <div className="mt-4">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Logo options from your website</div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {logoChoices.map((u) => {
                  const selected = brandLogoUrl.trim() && brandLogoUrl.trim() === u.trim();
                  return (
                    <button
                      key={u}
                      type="button"
                      className={[
                        "rounded-2xl border p-3 text-left",
                        selected
                          ? "border-gray-900 bg-gray-50 dark:border-white dark:bg-gray-900/40"
                          : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900/30",
                      ].join(" ")}
                      onClick={() => {
                        setUserTouchedLogo(true);
                        setBrandLogoUrl(u);
                        setPreviewMode("auto");
                      }}
                      disabled={uploading || saving}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                          {selected ? "Selected" : "Select"}
                        </div>
                        <div className="text-[11px] font-mono text-gray-500 dark:text-gray-400">#{logoChoices.indexOf(u) + 1}</div>
                      </div>

                      <div className="mt-2 flex items-center justify-center rounded-xl border border-dashed border-gray-300 p-4 dark:border-gray-700 bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt="Logo option" className="max-h-16 max-w-[220px] object-contain" />
                      </div>

                      <div className="mt-2 break-all text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2">
                        {u}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Selected preview controls */}
          {brandLogoUrl.trim() ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Preview background:{" "}
                <span className="font-mono">
                  {previewMode === "auto" ? `auto → ${effectivePreview}` : previewMode}
                </span>
                {probing ? <span className="ml-2 italic">checking…</span> : null}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                    previewMode === "auto"
                      ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-gray-200 bg-white text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  }`}
                  onClick={() => setPreviewMode("auto")}
                  disabled={uploading || saving}
                >
                  Auto
                </button>
                <button
                  type="button"
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                    previewMode === "light"
                      ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-gray-200 bg-white text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  }`}
                  onClick={() => setPreviewMode("light")}
                  disabled={uploading || saving}
                >
                  Light
                </button>
                <button
                  type="button"
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                    previewMode === "dark"
                      ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-gray-200 bg-white text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  }`}
                  onClick={() => setPreviewMode("dark")}
                  disabled={uploading || saving}
                >
                  Dark
                </button>
                <button
                  type="button"
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                    previewMode === "checker"
                      ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-gray-200 bg-white text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  }`}
                  onClick={() => setPreviewMode("checker")}
                  disabled={uploading || saving}
                >
                  Checker
                </button>
              </div>
            </div>
          ) : null}

          <div
            className={[
              "mt-4 flex items-center justify-center rounded-2xl border border-dashed border-gray-300 p-6 dark:border-gray-700",
              brandLogoUrl.trim() ? previewBoxClass(effectivePreview) : "bg-gray-50 dark:bg-black/30",
            ].join(" ")}
          >
            {brandLogoUrl.trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brandLogoUrl.trim()} alt="Logo preview" className="max-h-24 max-w-[280px] object-contain" />
            ) : (
              <div className="text-sm text-gray-500 dark:text-gray-400">No logo selected.</div>
            )}
          </div>

          {brandLogoUrl.trim() && probe ? (
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {probe.ok ? (
                <>
                  Detected{" "}
                  <span className="font-mono">
                    brightness={probe.brightness.toFixed(2)} transparent={probe.transparentRatio.toFixed(2)}
                  </span>
                  . Auto picked <span className="font-mono">{probe.recommended}</span>.
                </>
              ) : (
                <>Auto preview used a safe fallback for this image.</>
              )}
            </div>
          ) : null}

          <div className="mt-3">
            <Field
              label="Logo URL (optional)"
              value={brandLogoUrl}
              onChange={(v) => {
                setUserTouchedLogo(true);
                setBrandLogoUrl(v);
                setLogoChoices((prev) => uniqUrlsKeepOrder([String(v ?? "").trim(), ...prev]).slice(0, 3));
                setPreviewMode("auto");
              }}
              placeholder="https://..."
            />
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Where should leads be sent?</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">We’ll email new quote requests to this address.</div>

          <div className="mt-4">
            <Field
              label="Lead to email"
              value={leadToEmail}
              onChange={(v) => {
                setUserTouchedEmail(true);
                setLeadToEmail(v);
              }}
              placeholder="leads@yourshop.com"
              type="email"
            />
          </div>

          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Tip: use the inbox you already watch (info@, quotes@, or your personal email).
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          onClick={props.onBack}
          disabled={saving || uploading}
        >
          Back
        </button>

        <button
          type="button"
          className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
          disabled={!canSave || saving || uploading}
          onClick={async () => {
            setErr(null);
            setSaving(true);
            try {
              await props.onSubmit({
                leadToEmail: leadToEmail.trim(),
                brandLogoUrl: brandLogoUrl.trim() ? brandLogoUrl.trim() : null,
              });
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save & Continue"}
        </button>
      </div>
    </div>
  );
}