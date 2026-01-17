"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type QuoteFormProps = {
  tenantSlug: string;
  aiRenderingEnabled: boolean;
};

type UploadRespOk = { ok: true; files: Array<{ url: string }> };
type UploadRespErr = { ok: false; error?: { message?: string } };
type UploadResp = UploadRespOk | UploadRespErr;

type QuoteResp =
  | {
      ok: true;
      quoteLogId: string;
      output: any;
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

type ShotType = "unassigned" | "wide" | "close";

type LocalPhoto = {
  id: string;
  file: File;
  shotType: ShotType;
};

function escErr(e: any) {
  return (e?.message ?? e?.error?.message ?? e?.error ?? String(e ?? "")).toString();
}

function fmtMoney(n: any) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n ?? "");
  return num.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

export default function QuoteForm({ tenantSlug, aiRenderingEnabled }: QuoteFormProps) {
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [renderOptIn, setRenderOptIn] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteResp | null>(null);

  const [renderStatus, setRenderStatus] = useState<"idle" | "queued" | "rendered" | "failed">(
    "idle"
  );
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderImageUrl, setRenderImageUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  const [debugOn, setDebugOn] = useState(false);
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      setDebugOn(sp.get("debug") === "1");
    } catch {
      setDebugOn(false);
    }
  }, []);

  const wide = useMemo(() => photos.find((p) => p.shotType === "wide") ?? null, [photos]);
  const close = useMemo(() => photos.find((p) => p.shotType === "close") ?? null, [photos]);

  const totalPhotosCount = photos.length;

  const stage = useMemo(() => {
    if (result && (result as any)?.ok) return "Estimate ready";
    if (wide && close) return "Ready to submit";
    if (totalPhotosCount > 0) return "Choose Wide + Close-up";
    return "Add photos";
  }, [result, wide, close, totalPhotosCount]);

  const progressPct = useMemo(() => {
    if (result && (result as any)?.ok) return 100;
    if (wide && close) return 70;
    if (totalPhotosCount > 0) return 45;
    return 20;
  }, [result, wide, close, totalPhotosCount]);

  function enforceMax12(next: LocalPhoto[]) {
    if (next.length <= 12) return next;
    return next.slice(0, 12);
  }

  function addFiles(newFiles: File[]) {
    setErrMsg(null);
    setPhotos((prev) => {
      const room = Math.max(0, 12 - prev.length);
      const take = newFiles.slice(0, room);
      const mapped = take.map((file) => ({ id: uid(), file, shotType: "unassigned" as ShotType }));
      return enforceMax12([...prev, ...mapped]);
    });
  }

  function onTakePhoto(files: FileList | null) {
    if (!files || files.length === 0) return;
    addFiles(Array.from(files));
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  function setShotType(id: string, nextType: ShotType) {
    setPhotos((prev) => {
      // if setting to wide or close, ensure uniqueness by demoting existing one to unassigned
      let out = prev.map((p) => ({ ...p }));
      if (nextType === "wide") {
        out = out.map((p) => (p.shotType === "wide" ? { ...p, shotType: "unassigned" } : p));
      }
      if (nextType === "close") {
        out = out.map((p) => (p.shotType === "close" ? { ...p, shotType: "unassigned" } : p));
      }
      out = out.map((p) => (p.id === id ? { ...p, shotType: nextType } : p));
      return out;
    });
  }

  function orderedFilesForUpload(): File[] {
    const wideFile = photos.find((p) => p.shotType === "wide")?.file ?? null;
    const closeFile = photos.find((p) => p.shotType === "close")?.file ?? null;
    const rest = photos
      .filter((p) => p.shotType !== "wide" && p.shotType !== "close")
      .map((p) => p.file);

    return [ ...(wideFile ? [wideFile] : []), ...(closeFile ? [closeFile] : []), ...rest ];
  }

  async function uploadFiles(files: File[]): Promise<string[]> {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);

    const res = await fetch("/api/blob/upload", { method: "POST", body: fd });
    const j = (await res.json().catch(() => null)) as UploadResp | null;

    if (!res.ok || !j) throw new Error(`Blob upload failed (HTTP ${res.status})`);

    if (!j.ok) throw new Error(j.error?.message ?? `Blob upload failed (HTTP ${res.status})`);

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
    if (photos.length === 0) return setErrMsg("Please add at least one photo.");
    if (!wide || !close) return setErrMsg("Please mark one photo as Wide and one as Close-up.");

    setSubmitting(true);
    setResult(null);

    try {
      const filesToUpload = orderedFilesForUpload();
      const urls = await uploadFiles(filesToUpload);
      const images = urls.map((url) => ({ url }));

      const payload: any = {
        tenantSlug,
        images,
        customer_context: { notes: notes?.trim() || undefined },
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
        setRenderStatus("queued");
      }
    } catch (e: any) {
      setRenderStatus("failed");
      setRenderError(escErr(e));
    } finally {
      setRendering(false);
    }
  }

  const parsedOutput = useMemo(() => {
    const out = (result as any)?.output ?? null;
    return out || null;
  }, [result]);

  const estimateLow = useMemo(() => parsedOutput?.estimate?.low, [parsedOutput]);
  const estimateHigh = useMemo(() => parsedOutput?.estimate?.high, [parsedOutput]);

  const showAiOptIn = aiRenderingEnabled === true;

  // Preview URLs (avoid leaking memory)
  const previews = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of photos) {
      map.set(p.id, URL.createObjectURL(p.file));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.map((p) => p.id).join("|")]);

  useEffect(() => {
    return () => {
      previews.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [previews]);

  return (
    <div className="space-y-6">
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

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Take photos
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Best results: take one <span className="font-semibold">Wide shot</span> and one{" "}
              <span className="font-semibold">Close-up</span>. After you take a photo, pick which
              one it is.
            </p>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{totalPhotosCount}/12</div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-gray-100 dark:text-gray-900">
            Take Photo (Camera)
            <input
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => onTakePhoto(e.target.files)}
            />
          </label>

          <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800">
            Upload Photos
            <input
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onTakePhoto(e.target.files)}
            />
          </label>

          <div className="text-xs text-gray-600 dark:text-gray-300">
            Wide selected: <span className="font-semibold">{wide ? "yes" : "no"}</span> • Close-up
            selected: <span className="font-semibold">{close ? "yes" : "no"}</span>
          </div>
        </div>

        {photos.length ? (
          <div className="mt-4 space-y-3">
            {photos.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {p.file.name}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => removePhoto(p.id)}
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-[140px_1fr]">
                  <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previews.get(p.id)}
                      alt="uploaded"
                      className="h-[96px] w-full object-cover"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                      Shot type
                    </label>
                    <select
                      className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                      value={p.shotType}
                      onChange={(e) => setShotType(p.id, e.target.value as ShotType)}
                    >
                      <option value="unassigned">Unassigned</option>
                      <option value="wide">Wide shot</option>
                      <option value="close">Close-up</option>
                    </select>

                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Tip: only one Wide and one Close-up can be selected at a time.
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400">
            No photos yet.
          </div>
        )}
      </div>

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
                  If selected, we may generate a visual “after” concept based on your photos. This
                  happens as a second step after your estimate.
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

      {result && (result as any)?.ok ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Result</h3>

          {estimateLow != null || estimateHigh != null ? (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-950">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Estimate</div>
              <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
                {estimateLow != null ? fmtMoney(estimateLow) : "—"} –{" "}
                {estimateHigh != null ? fmtMoney(estimateHigh) : "—"}
              </div>
            </div>
          ) : null}

          <pre className="mt-4 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
{JSON.stringify((result as any).output ?? {}, null, 2)}
          </pre>

          {aiRenderingEnabled && renderOptIn ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                AI Rendering
              </div>
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
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
