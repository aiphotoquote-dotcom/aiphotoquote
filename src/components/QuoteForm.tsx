"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  tenantSlug: string;
  aiRenderingEnabled: boolean;
};

type QuoteOutput = {
  confidence: "high" | "medium" | "low";
  inspection_required: boolean;
  summary: string;
  questions: string[];
  estimate: { low: number; high: number } | null;
  render_opt_in?: boolean;
};

type QuoteSubmitResponse = {
  ok: boolean;
  debugId?: string;

  quoteLogId?: string;

  output?: QuoteOutput | null;

  error?: string;
  message?: string;
};

type RenderStartResponse = {
  ok: boolean;
  debugId?: string;

  quoteLogId?: string;
  imageUrl?: string | null;

  error?: string;
  message?: string;
};

function formatMoney(n: number) {
  try {
    return `$${Math.round(n).toLocaleString()}`;
  } catch {
    return `$${n}`;
  }
}

function toErrMessage(e: unknown) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  const anyE = e as any;
  return anyE?.message ?? String(e);
}

type ShotType = "wide" | "close";

type ImageItem = {
  id: string;
  url: string;
  shot: ShotType;
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function QuoteForm({ tenantSlug, aiRenderingEnabled }: Props) {
  // ---- customer fields ----
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  // ---- images ----
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [shotHint, setShotHint] = useState<ShotType>("wide"); // first prompt is wide

  // Tracks which files we've already uploaded (by fingerprint) -> URL
  const uploadedRef = useRef<Map<string, string>>(new Map());

  // ---- optional rendering opt-in ----
  const [renderOptIn, setRenderOptIn] = useState(false);

  // ---- submit + result ----
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteSubmitResponse | null>(null);

  // ---- rendering step ----
  const [renderStatus, setRenderStatus] = useState<
    "idle" | "queued" | "rendering" | "rendered" | "failed"
  >("idle");
  const [renderImageUrl, setRenderImageUrl] = useState<string | null>(null);
  const [renderErr, setRenderErr] = useState<string | null>(null);
  const renderAttemptedForQuoteRef = useRef<string | null>(null);

  const wideDone = useMemo(() => images.some((x) => x.shot === "wide"), [images]);
  const closeDone = useMemo(() => images.some((x) => x.shot === "close"), [images]);

  // Friendly progress: wide + close are the two “best accuracy” shots
  const progressPct = useMemo(() => {
    const done = (wideDone ? 1 : 0) + (closeDone ? 1 : 0);
    return Math.min(100, (done / 2) * 100);
  }, [wideDone, closeDone]);

  const canSubmit = useMemo(() => {
    return (
      tenantSlug &&
      name.trim().length > 0 &&
      email.trim().length > 0 &&
      phone.trim().length > 0 &&
      images.length >= 1 &&
      !submitting
    );
  }, [tenantSlug, name, email, phone, images.length, submitting]);

  async function uploadFilesToBlob(files: File[]) {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);

    const res = await fetch("/api/blob/upload", { method: "POST", body: fd });
    const j = await res.json().catch(() => null);

    if (!res.ok || !j?.ok) {
      const msg = j?.error?.message ?? `Upload failed (HTTP ${res.status})`;
      throw new Error(msg);
    }

    const urls: string[] = Array.isArray(j?.files)
      ? j.files.map((x: any) => x?.url).filter(Boolean)
      : [];

    if (!urls.length) throw new Error("Upload succeeded but returned no file URLs.");
    return urls;
  }

  function fingerprintFile(f: File) {
    // good-enough client-side fingerprint (not cryptographic)
    return `${f.name}|${f.size}|${f.lastModified}|${f.type}`;
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    // Limit total images to 12 like before
    const remaining = Math.max(0, 12 - images.length);
    const picked = Array.from(files).slice(0, remaining);
    if (!picked.length) return;

    setSubmitErr(null);
    setSubmitting(true);

    try {
      // Upload only files we haven't uploaded yet
      const newFilesToUpload: File[] = [];
      const newFilesFingerprints: string[] = [];

      for (const f of picked) {
        const fp = fingerprintFile(f);
        if (!uploadedRef.current.has(fp)) {
          newFilesToUpload.push(f);
          newFilesFingerprints.push(fp);
        }
      }

      let uploadedUrls: string[] = [];
      if (newFilesToUpload.length) {
        uploadedUrls = await uploadFilesToBlob(newFilesToUpload);
        // map returned URLs to fingerprints in the same order
        uploadedUrls.forEach((url, i) => {
          const fp = newFilesFingerprints[i];
          if (fp) uploadedRef.current.set(fp, url);
        });
      }

      // Build ImageItems for ALL picked files using mapped URLs (old + new)
      const newItems: ImageItem[] = picked
        .map((f) => {
          const fp = fingerprintFile(f);
          const url = uploadedRef.current.get(fp);
          if (!url) return null;

          // Use current hint for the first image, then bias to "close" after wide done
          const suggested: ShotType =
            shotHint === "wide"
              ? "wide"
              : "close";

          return { id: uid(), url, shot: suggested } as ImageItem;
        })
        .filter(Boolean) as ImageItem[];

      // Append, don't replace
      setImages((prev) => {
        const next = [...prev, ...newItems];
        return next.slice(0, 12);
      });

      // Update next hint: if wide is still missing, keep prompting wide, else prompt close
      // (use current derived flags + what we just added)
      const willHaveWide = wideDone || newItems.some((x) => x.shot === "wide");
      setShotHint(willHaveWide ? "close" : "wide");
    } catch (e) {
      setSubmitErr(toErrMessage(e));
    } finally {
      setSubmitting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((x) => x.id !== id));
  }

  function setShot(id: string, shot: ShotType) {
    setImages((prev) => prev.map((x) => (x.id === id ? { ...x, shot } : x)));
  }

  function resetAll() {
    setName("");
    setEmail("");
    setPhone("");
    setNotes("");

    setImages([]);
    uploadedRef.current = new Map();

    setSubmitErr(null);
    setResult(null);

    setRenderOptIn(false);
    setRenderStatus("idle");
    setRenderImageUrl(null);
    setRenderErr(null);
    renderAttemptedForQuoteRef.current = null;

    setShotHint("wide");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submitQuote() {
    setSubmitErr(null);
    setResult(null);

    setRenderStatus("idle");
    setRenderImageUrl(null);
    setRenderErr(null);
    renderAttemptedForQuoteRef.current = null;

    setSubmitting(true);
    try {
      const payload = {
        tenantSlug,
        images: images.map((x) => ({ url: x.url })),
        render_opt_in: Boolean(aiRenderingEnabled && renderOptIn),
        customer_context: {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          notes: notes.trim() || undefined,
          category: "upholstery",
          service_type: "quote",
        },
      };

      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j: QuoteSubmitResponse = await res.json().catch(() => ({
        ok: false,
        error: "BAD_RESPONSE",
        message: "Server did not return JSON.",
      }));

      if (!res.ok || !j?.ok) {
        setSubmitErr(j?.message ?? j?.error ?? `Quote failed (HTTP ${res.status})`);
        setResult(j ?? null);
        return;
      }

      setResult(j);

      // auto trigger render
      const qid = j?.quoteLogId ?? null;
      const opted = Boolean(j?.output?.render_opt_in);
      if (aiRenderingEnabled && opted && qid) {
        triggerRendering({ tenantSlug, quoteLogId: qid });
      }
    } catch (e) {
      setSubmitErr(toErrMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function triggerRendering(args: { tenantSlug: string; quoteLogId: string }) {
    const { quoteLogId } = args;

    if (renderAttemptedForQuoteRef.current === quoteLogId) return;
    renderAttemptedForQuoteRef.current = quoteLogId;

    setRenderStatus("rendering");
    setRenderErr(null);
    setRenderImageUrl(null);

    try {
      const res = await fetch("/api/render/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });

      const j: RenderStartResponse = await res.json().catch(() => ({
        ok: false,
        error: "BAD_RESPONSE",
        message: "Render endpoint did not return JSON.",
      }));

      if (!res.ok || !j?.ok) {
        setRenderStatus("failed");
        setRenderErr(j?.message ?? j?.error ?? `Render failed (HTTP ${res.status})`);
        return;
      }

      if (j?.imageUrl) {
        setRenderStatus("rendered");
        setRenderImageUrl(String(j.imageUrl));
        setRenderErr(null);
      } else {
        setRenderStatus("queued");
        setRenderErr("Render started, but no image URL returned yet.");
      }
    } catch (e) {
      setRenderStatus("failed");
      setRenderErr(toErrMessage(e));
    }
  }

  useEffect(() => {
    const qid = result?.quoteLogId ?? null;
    if (!qid) return;

    const opted = Boolean(result?.output?.render_opt_in);
    if (!aiRenderingEnabled || !opted) return;

    if (renderStatus === "rendered" && renderImageUrl) return;
    if (renderAttemptedForQuoteRef.current === qid) return;

    triggerRendering({ tenantSlug, quoteLogId: qid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.quoteLogId, result?.output?.render_opt_in, aiRenderingEnabled, tenantSlug]);

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => addFiles(e.target.files)}
      />

      {/* Progress / shot checklist */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs text-gray-600 dark:text-gray-300">Progress</div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {wideDone && closeDone ? "Estimate ready" : "Add photos"}
            </div>
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300">
            Add 2 photos (you have {images.length})
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
          <div
            className="h-full bg-black dark:bg-white"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="font-semibold">Wide shot</div>
            <div className={wideDone ? "text-green-600 font-semibold" : "text-gray-500"}>
              {wideDone ? "Captured" : "Needed"}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="font-semibold">Close-up</div>
            <div className={closeDone ? "text-green-600 font-semibold" : "text-gray-500"}>
              {closeDone ? "Captured" : "Needed"}
            </div>
          </div>
        </div>

        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          tenantSlug: <span className="font-mono">{tenantSlug}</span>
        </div>
      </div>

      {/* Photo picker */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Take 2 quick photos
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {shotHint === "wide"
                ? "Start with a wide shot that shows the whole item."
                : "Now take a close-up of the material / damage area."}
              {" "}Add more if you want (max 12).
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting || images.length >= 12}
            >
              Take Photo (Camera)
            </button>

            <button
              type="button"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting || images.length >= 12}
            >
              Upload Photos
            </button>
          </div>
        </div>

        {/* Previews */}
        {images.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {images.map((img) => (
              <div
                key={img.id}
                className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950"
              >
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="upload" className="h-44 w-full object-cover" />
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded-md bg-white/90 px-2 py-1 text-xs font-semibold text-gray-900 hover:bg-white dark:bg-black/70 dark:text-gray-100"
                    onClick={() => removeImage(img.id)}
                  >
                    Remove
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-gray-200 bg-white px-3 py-2 text-xs dark:border-gray-800 dark:bg-gray-900">
                  <div className="font-semibold text-gray-900 dark:text-gray-100">
                    Shot type
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={
                        img.shot === "wide"
                          ? "rounded-md bg-black px-2 py-1 text-white"
                          : "rounded-md border border-gray-300 px-2 py-1 text-gray-900 dark:border-gray-700 dark:text-gray-100"
                      }
                      onClick={() => setShot(img.id, "wide")}
                    >
                      Wide
                    </button>
                    <button
                      type="button"
                      className={
                        img.shot === "close"
                          ? "rounded-md bg-black px-2 py-1 text-white"
                          : "rounded-md border border-gray-300 px-2 py-1 text-gray-900 dark:border-gray-700 dark:text-gray-100"
                      }
                      onClick={() => setShot(img.id, "close")}
                    >
                      Close-up
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {submitErr && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {submitErr}
          </div>
        )}
      </div>

      {/* Customer info */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-base font-semibold text-gray-900 dark:text-gray-100">Your info</div>
        <div className="text-sm text-gray-600 dark:text-gray-300">
          Required so we can send your estimate and follow up if needed.
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Name <span className="text-red-600">*</span>
            </div>
            <input
              className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          </label>

          <label className="block">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Email <span className="text-red-600">*</span>
            </div>
            <input
              className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              autoComplete="email"
              inputMode="email"
            />
          </label>

          <label className="block">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Phone <span className="text-red-600">*</span>
            </div>
            <input
              className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              autoComplete="tel"
              inputMode="tel"
            />
          </label>

          <label className="block md:col-span-2">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notes</div>
            <textarea
              className="mt-2 min-h-[90px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-white"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What are you looking to do? Material preference, timeline, constraints?"
            />
          </label>
        </div>

        {aiRenderingEnabled && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={renderOptIn}
                onChange={(e) => setRenderOptIn(e.target.checked)}
              />
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Optional: AI rendering preview
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  If selected, we may generate a visual “after” concept based on your photos.
                  This happens as a second step after your estimate.
                </div>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          className="w-full rounded-xl bg-black px-4 py-3 text-base font-semibold text-white hover:opacity-90 disabled:opacity-50 sm:w-auto"
          disabled={!canSubmit}
          onClick={submitQuote}
        >
          {submitting ? "Working..." : "Get Estimate"}
        </button>

        <button
          type="button"
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 sm:w-auto dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          onClick={resetAll}
          disabled={submitting}
        >
          Reset
        </button>

        {submitErr && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {submitErr}
            {result?.debugId ? (
              <div className="mt-1 text-xs opacity-80">debugId: {result.debugId}</div>
            ) : null}
          </div>
        )}
      </div>

      {/* Result */}
      {result?.ok && result?.output && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100">Result</div>

          {result.output.estimate && (
            <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-950">
              <div className="font-semibold text-gray-900 dark:text-gray-100">Estimate</div>
              <div className="text-gray-700 dark:text-gray-200">
                {formatMoney(result.output.estimate.low)} – {formatMoney(result.output.estimate.high)}
              </div>
            </div>
          )}

          <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
            {JSON.stringify(result.output, null, 2)}
          </pre>
        </div>
      )}

      {/* AI Rendering */}
      {result?.ok && Boolean(result?.output?.render_opt_in) && aiRenderingEnabled && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100">AI Rendering</div>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            This is a second step after your estimate. It can take a moment.
          </div>

          <div className="mt-3 text-sm text-gray-900 dark:text-gray-100">
            Status:{" "}
            <span className="font-semibold">
              {renderStatus === "idle"
                ? "Idle"
                : renderStatus === "queued"
                  ? "Queued"
                  : renderStatus === "rendering"
                    ? "Rendering"
                    : renderStatus === "rendered"
                      ? "Rendered"
                      : "Failed"}
            </span>
          </div>

          {renderStatus === "rendered" && renderImageUrl && (
            <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={renderImageUrl} alt="AI render" className="w-full object-cover" />
              <div className="border-t border-gray-200 bg-gray-50 p-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
                Render image URL stored.
              </div>
            </div>
          )}

          {(renderStatus === "failed" || renderErr) && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
              {renderErr ?? "Render failed."}
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
              disabled={!result?.quoteLogId || renderStatus === "rendering"}
              onClick={() => {
                const qid = result?.quoteLogId ?? null;
                if (!qid) return;
                renderAttemptedForQuoteRef.current = null;
                triggerRendering({ tenantSlug, quoteLogId: qid });
              }}
            >
              Retry Render
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
