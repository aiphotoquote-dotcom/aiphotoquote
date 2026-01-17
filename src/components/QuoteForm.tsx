"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type QuoteFormProps = {
  tenantSlug: string;
  aiRenderingEnabled: boolean;
};

type UploadResp =
  | { ok: true; files: Array<{ url: string }> }
  | { ok: false; error?: { message?: string } };

type QuoteResp =
  | {
      ok: true;
      quoteLogId: string;
      output: any;
      // optional: some deployments may return more fields; we ignore safely
      [k: string]: any;
    }
  | {
      ok: false;
      error?: any;
      message?: string;
      debugId?: string;
      code?: string;
      [k: string]: any;
    };

type RenderStartResp =
  | { ok: true; imageUrl?: string | null; quoteLogId: string; [k: string]: any }
  | { ok: false; message?: string; error?: string; [k: string]: any };

function escErr(e: any) {
  return (e?.message ?? e?.error?.message ?? e?.error ?? String(e ?? "")).toString();
}

function fmtMoney(n: any) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n ?? "");
  return num.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function QuoteForm({ tenantSlug, aiRenderingEnabled }: QuoteFormProps) {
  // required photo pair
  const [wideFile, setWideFile] = useState<File | null>(null);
  const [closeFile, setCloseFile] = useState<File | null>(null);

  // optional extra photos (up to 10 more; total 12)
  const [extraFiles, setExtraFiles] = useState<File[]>([]);

  // customer info
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  // ai rendering opt-in
  const [renderOptIn, setRenderOptIn] = useState(false);

  // request state
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [result, setResult] = useState<QuoteResp | null>(null);

  // rendering state
  const [renderStatus, setRenderStatus] = useState<"idle" | "queued" | "rendered" | "failed">("idle");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderImageUrl, setRenderImageUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  // debug toggle via ?debug=1
  const [debugOn, setDebugOn] = useState(false);
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      setDebugOn(sp.get("debug") === "1");
    } catch {
      setDebugOn(false);
    }
  }, []);

  const totalPhotosCount = useMemo(() => {
    return (wideFile ? 1 : 0) + (closeFile ? 1 : 0) + extraFiles.length;
  }, [wideFile, closeFile, extraFiles.length]);

  const stage = useMemo(() => {
    if (result && (result as any)?.ok) return "Estimate ready";
    if (wideFile && closeFile) return "Ready to submit";
    if (wideFile || closeFile) return "Add 1 more photo";
    return "Add photos";
  }, [result, wideFile, closeFile]);

  const progressPct = useMemo(() => {
    // 0 photos -> 20%, 1 photo -> 45%, 2 photos -> 70%, submitted -> 100%
    if (result && (result as any)?.ok) return 100;
    if (wideFile && closeFile) return 70;
    if (wideFile || closeFile) return 45;
    return 20;
  }, [result, wideFile, closeFile]);

  function onPickWide(f: File | null) {
    setWideFile(f);
    setErrMsg(null);
  }

  function onPickClose(f: File | null) {
    setCloseFile(f);
    setErrMsg(null);
  }

  function onPickExtras(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    const already = (wideFile ? 1 : 0) + (closeFile ? 1 : 0) + extraFiles.length;
    const remaining = Math.max(0, 12 - already);
    const next = incoming.slice(0, remaining);
    if (next.length) setExtraFiles((p) => [...p, ...next]);
  }

  function removeExtra(idx: number) {
    setExtraFiles((p) => p.filter((_, i) => i !== idx));
  }

  async function uploadFiles(files: File[]): Promise<string[]> {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);

    const res = await fetch("/api/blob/upload", { method: "POST", body: fd });
    const j = (await res.json().catch(() => null)) as UploadResp | null;

    if (!res.ok || !j || (j as any).ok !== true) {
      const msg =
        (j as any)?.error?.message ??
        `Blob upload failed (HTTP ${res.status})`;
      throw new Error(msg);
    }

    const urls = (j.files ?? []).map((x) => String(x.url)).filter(Boolean);
    if (!urls.length) throw new Error("Blob upload returned no file urls");
    return urls;
  }

  async function submitQuote() {
    setErrMsg(null);

    if (!tenantSlug?.trim()) {
      setErrMsg("Invalid tenant link. Please reload the page.");
      return;
    }
    if (!name.trim()) return setErrMsg("Name is required.");
    if (!email.trim()) return setErrMsg("Email is required.");
    if (!phone.trim()) return setErrMsg("Phone is required.");
    if (!wideFile && !closeFile && extraFiles.length === 0) {
      return setErrMsg("Please add at least one photo.");
    }

    setSubmitting(true);
    setResult(null);

    try {
      // upload photos first
      const filesToUpload: File[] = [
        ...(wideFile ? [wideFile] : []),
        ...(closeFile ? [closeFile] : []),
        ...extraFiles,
      ];

      const urls = await uploadFiles(filesToUpload);
      const images = urls.map((url) => ({ url }));

      const payload: any = {
        tenantSlug,
        images,
        customer_context: {
          notes: notes?.trim() || undefined,
        },
        // IMPORTANT: this is what the render-start route looks for as a fallback
        render_opt_in: aiRenderingEnabled ? renderOptIn === true : false,
      };

      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = (await res.json().catch(() => null)) as QuoteResp | null;
      if (!res.ok || !j || (j as any).ok !== true) {
        const msg =
          (j as any)?.message ??
          (j as any)?.error?.message ??
          `Quote failed (HTTP ${res.status})`;
        setResult((j ?? { ok: false, message: msg }) as any);
        throw new Error(msg);
      }

      setResult(j);

      // kick off rendering automatically if enabled + opted in
      if (aiRenderingEnabled && renderOptIn && (j as any).quoteLogId) {
        triggerRendering({ tenantSlug, quoteLogId: String((j as any).quoteLogId) });
      } else {
        setRenderStatus("idle");
        setRenderError(null);
        setRenderImageUrl(null);
      }
    } catch (e: any) {
      setErrMsg(escErr(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function triggerRendering(args: { tenantSlug: string; quoteLogId: string }) {
    setRendering(true);
    setRenderError(null);
    setRenderImageUrl(null);
    setRenderStatus("queued");

    try {
      const res = await fetch("/api/render/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });

      const j = (await res.json().catch(() => null)) as RenderStartResp | null;

      if (!res.ok || !j || (j as any).ok !== true) {
        const msg =
          (j as any)?.message ??
          (j as any)?.error ??
          `Render failed (HTTP ${res.status})`;
        setRenderStatus("failed");
        setRenderError(msg);
        return;
      }

      const url = (j as any)?.imageUrl ? String((j as any).imageUrl) : null;
      if (url) {
        setRenderStatus("rendered");
        setRenderImageUrl(url);
      } else {
        // If your backend stores later, we still mark queued; user can retry.
        setRenderStatus("queued");
      }
    } catch (e: any) {
      setRenderStatus("failed");
      setRenderError(escErr(e));
    } finally {
      setRendering(false);
    }
  }

  // Pull a nicer summary/estimate if present
  const parsedOutput = useMemo(() => {
    const out = (result as any)?.output ?? null;
    if (!out) return null;
    return out;
  }, [result]);

  const estimateLow = useMemo(() => {
    const n = parsedOutput?.estimate?.low;
    return n;
  }, [parsedOutput]);

  const estimateHigh = useMemo(() => {
    const n = parsedOutput?.estimate?.high;
    return n;
  }, [parsedOutput]);

  const showAiOptIn = aiRenderingEnabled === true;

  return (
    <div className="space-y-6">
      {/* Progress (restored simple + customer-friendly) */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-gray-900 dark:text-gray-100">Progress</span>
          <span className="text-gray-600 dark:text-gray-300">{stage}</span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div
            className="h-full rounded-full bg-gray-900 dark:bg-gray-100"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {debugOn ? (
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            tenantSlug: <span className="font-mono">{tenantSlug}</span>
          </div>
        ) : null}
      </div>

      {/* Photo capture (restored Wide/Close indicators you liked) */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Take 2 quick photos
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Wide shot + close-up gets the best accuracy. Add more if you want (max 12).
            </p>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{totalPhotosCount}/12</div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {/* Wide */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Wide shot</div>
              <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-gray-100 dark:text-gray-900">
                Take Wide Shot (Camera)
                <input
                  className="hidden"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => onPickWide(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div className="mt-3">
              {wideFile ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-gray-600 dark:text-gray-300 truncate">
                    {wideFile.name}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => onPickWide(null)}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                  No photo yet.
                </div>
              )}
            </div>
          </div>

          {/* Close */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Close-up</div>
              <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-gray-100 dark:text-gray-900">
                Take Close-up (Camera)
                <input
                  className="hidden"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => onPickClose(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div className="mt-3">
              {closeFile ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-gray-600 dark:text-gray-300 truncate">
                    {closeFile.name}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => onPickClose(null)}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                  No photo yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Extra uploads */}
        <div className="mt-4 flex flex-col gap-3">
          <label className="inline-flex w-fit cursor-pointer items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800">
            Upload Photos <span className="ml-2 text-xs font-normal text-gray-500">(add up to 12)</span>
            <input
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onPickExtras(e.target.files)}
            />
          </label>

          {extraFiles.length ? (
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                Additional photos
              </div>
              <div className="space-y-2">
                {extraFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="truncate text-xs text-gray-700 dark:text-gray-200">{f.name}</div>
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => removeExtra(i)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Your info */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Your info</h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Required so we can send your estimate and follow up if needed.
        </p>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Name *</span>
            <input
              className="h-11 rounded-lg border border-gray-200 bg-white px-3 text-gray-900 shadow-sm outline-none ring-0 focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Your name"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Email *</span>
            <input
              className="h-11 rounded-lg border border-gray-200 bg-white px-3 text-gray-900 shadow-sm outline-none ring-0 focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="you@email.com"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Phone *</span>
            <input
              className="h-11 rounded-lg border border-gray-200 bg-white px-3 text-gray-900 shadow-sm outline-none ring-0 focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              inputMode="tel"
              placeholder="(555) 555-5555"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notes</span>
            <textarea
              className="min-h-[96px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900 shadow-sm outline-none ring-0 focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What are you looking to do? Material preference, timeline, constraints?"
            />
          </label>

          {showAiOptIn ? (
            <label className="mt-2 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-950">
              <input
                type="checkbox"
                className="mt-1"
                checked={renderOptIn}
                onChange={(e) => setRenderOptIn(e.target.checked)}
              />
              <div>
                <div className="font-semibold text-gray-900 dark:text-gray-100">
                  Optional: AI rendering preview
                </div>
                <div className="text-gray-600 dark:text-gray-300">
                  If selected, we may generate a visual “after” concept based on your photos. This happens as a second step after your estimate.
                </div>
              </div>
            </label>
          ) : null}
        </div>

        {errMsg ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {errMsg}
          </div>
        ) : null}

        <button
          type="button"
          onClick={submitQuote}
          disabled={submitting}
          className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-gray-900 text-base font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900"
        >
          {submitting ? "Working..." : "Get Estimate"}
        </button>
      </div>

      {/* Result */}
      {result && (result as any)?.ok ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Result</h3>

          {(estimateLow != null || estimateHigh != null) ? (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-950">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Estimate</div>
              <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
                {estimateLow != null ? fmtMoney(estimateLow) : "—"}{" "}
                –{" "}
                {estimateHigh != null ? fmtMoney(estimateHigh) : "—"}
              </div>
            </div>
          ) : null}

          <pre className="mt-4 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
{JSON.stringify((result as any).output ?? {}, null, 2)}
          </pre>

          {/* AI Rendering */}
          {aiRenderingEnabled && renderOptIn ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-base font-semibold text-gray-900 dark:text-gray-100">AI Rendering</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                This is a second step after your estimate. It can take a moment.
              </div>

              <div className="mt-3 text-sm text-gray-800 dark:text-gray-200">
                Status:{" "}
                <span className="font-semibold">
                  {renderStatus === "idle" ? "Not started" : renderStatus}
                </span>
              </div>

              {renderError ? (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                  {renderError}
                </div>
              ) : null}

              {renderImageUrl ? (
                <div className="mt-4">
                  <img
                    src={renderImageUrl}
                    alt="AI rendering preview"
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-800"
                  />
                </div>
              ) : null}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={rendering || !(result as any)?.quoteLogId}
                  onClick={() =>
                    triggerRendering({
                      tenantSlug,
                      quoteLogId: String((result as any).quoteLogId),
                    })
                  }
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                >
                  {rendering ? "Rendering..." : "Retry Render"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
