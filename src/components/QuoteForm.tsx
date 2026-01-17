"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type UploadImage = { url: string; kind?: "wide" | "close" | "other" };

type QuoteResult = {
  ok: boolean;
  quoteLogId?: string;
  output?: any;
  error?: any;
  debugId?: string;
};

type RenderResult =
  | { ok: true; quoteLogId: string; imageUrl: string | null }
  | { ok: false; error: string; message?: string };

export default function QuoteForm(props: {
  tenantSlug: string;
  aiRenderingEnabled?: boolean;
}) {
  const tenantSlug = props.tenantSlug;
  const aiRenderingEnabled = props.aiRenderingEnabled === true;

  // ---- form state ----
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  // Keep the customer-friendly wide/close intent
  const [images, setImages] = useState<UploadImage[]>([]);
  const wideShot = images.find((x) => x.kind === "wide")?.url ?? null;
  const closeUp = images.find((x) => x.kind === "close")?.url ?? null;
  const otherImages = images.filter((x) => x.kind !== "wide" && x.kind !== "close").map((x) => x.url);

  const [renderOptIn, setRenderOptIn] = useState(false);

  // ---- submit / result ----
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteResult | null>(null);

  // ---- rendering step ----
  const [renderingStatus, setRenderingStatus] = useState<
    "idle" | "queued" | "running" | "rendered" | "failed"
  >("idle");
  const [renderingErr, setRenderingErr] = useState<string | null>(null);
  const [renderedImageUrl, setRenderedImageUrl] = useState<string | null>(null);

  // avoid double-trigger
  const renderAttemptedForQuoteRef = useRef<string | null>(null);

  // ---- derived progress ----
  const estimateProgressLabel = useMemo(() => {
    if (!submitting) return "Estimate ready";
    return "Working…";
  }, [submitting]);

  const showEstimateProgressBar = submitting;

  const showRenderingSection = aiRenderingEnabled && (renderOptIn || (result?.output?.render_opt_in === true));

  const renderingProgressLabel = useMemo(() => {
    switch (renderingStatus) {
      case "idle":
        return "Waiting";
      case "queued":
        return "Queued…";
      case "running":
        return "Rendering…";
      case "rendered":
        return "Complete";
      case "failed":
        return "Failed";
      default:
        return "Waiting";
    }
  }, [renderingStatus]);

  const showRenderingProgressBar =
    renderingStatus === "queued" || renderingStatus === "running";

  // ---- helpers ----
  function normalizePhone(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  async function uploadToBlob(files: File[]) {
    const fd = new FormData();
    for (const f of files) fd.append("files", f, f.name);

    const res = await fetch("/api/blob/upload", { method: "POST", body: fd });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw new Error(j?.error?.message ?? `Upload failed (HTTP ${res.status})`);

    const urls: string[] = (j.files ?? []).map((x: any) => String(x.url)).filter(Boolean);
    return urls;
  }

  function assignShotKinds(urls: string[]) {
    // Preserve the original customer-friendly intent:
    // first image = wide shot, second = close-up, rest = other
    const next: UploadImage[] = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      if (i === 0) next.push({ url, kind: "wide" });
      else if (i === 1) next.push({ url, kind: "close" });
      else next.push({ url, kind: "other" });
    }
    return next;
  }

  async function submitQuote() {
    setSubmitErr(null);
    setResult(null);

    // reset rendering state each new submit
    setRenderingStatus("idle");
    setRenderingErr(null);
    setRenderedImageUrl(null);
    renderAttemptedForQuoteRef.current = null;

    if (!tenantSlug) {
      setSubmitErr("Missing tenant slug. Please reload the page (invalid tenant link).");
      return;
    }
    if (!name.trim() || !email.trim() || !phone.trim()) {
      setSubmitErr("Please fill out Name, Email, and Phone.");
      return;
    }
    if (images.length < 1) {
      setSubmitErr("Please add at least 1 photo.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        tenantSlug,
        images: images.map((x) => ({ url: x.url })),
        customer_context: {
          notes: notes.trim() || undefined,
          category: "service",
          service_type: "photo_quote",
          // This is used by the render route fallbacks if columns don't exist
          render_opt_in: aiRenderingEnabled ? renderOptIn : false,
        },
        // ALSO store render opt-in on the root, in case your submit route stores input directly
        render_opt_in: aiRenderingEnabled ? renderOptIn : false,
      };

      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = (await res.json().catch(() => null)) as QuoteResult | null;
      if (!res.ok || !j?.ok) {
        const msg =
          (j as any)?.message ??
          (j as any)?.error?.message ??
          (j as any)?.error ??
          `Quote failed (HTTP ${res.status})`;
        setSubmitErr(String(msg));
        setResult(j ?? { ok: false });
        return;
      }

      setResult(j);
    } catch (e: any) {
      setSubmitErr(e?.message ?? "Quote request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function triggerRendering(args: { tenantSlug: string; quoteLogId: string }) {
    setRenderingErr(null);
    setRenderedImageUrl(null);
    setRenderingStatus("queued");

    try {
      // small delay makes the UI feel “intentional” vs flicker
      await new Promise((r) => setTimeout(r, 250));
      setRenderingStatus("running");

      const res = await fetch("/api/render/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });

      const j = (await res.json().catch(() => null)) as any;

      if (!res.ok || !j?.ok) {
        const msg = j?.message ?? j?.error ?? `Render failed (HTTP ${res.status})`;
        setRenderingStatus("failed");
        setRenderingErr(String(msg));
        return;
      }

      setRenderedImageUrl(j?.imageUrl ? String(j.imageUrl) : null);
      setRenderingStatus("rendered");
    } catch (e: any) {
      setRenderingStatus("failed");
      setRenderingErr(e?.message ?? "Render failed.");
    }
  }

  // Auto-trigger rendering after estimate, if opted-in + tenant enabled
  useEffect(() => {
    const quoteLogId = result?.quoteLogId ?? null;
    const outputOptIn = result?.output?.render_opt_in === true;

    const shouldRender =
      aiRenderingEnabled && (renderOptIn || outputOptIn) && typeof quoteLogId === "string";

    if (!shouldRender) return;

    if (renderAttemptedForQuoteRef.current === quoteLogId) return;
    renderAttemptedForQuoteRef.current = quoteLogId;

    triggerRendering({ tenantSlug, quoteLogId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.quoteLogId, result?.output, aiRenderingEnabled, tenantSlug, renderOptIn]);

  // ---- UI: image chooser ----
  async function onPickFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    setSubmitErr(null);

    const files = Array.from(fileList).slice(0, 12);
    try {
      const urls = await uploadToBlob(files);

      // merge: keep existing, add new, then re-assign kinds by order
      const mergedUrls = [...images.map((x) => x.url), ...urls].slice(0, 12);
      setImages(assignShotKinds(mergedUrls));
    } catch (e: any) {
      setSubmitErr(e?.message ?? "Upload failed.");
    }
  }

  function removeImage(url: string) {
    const next = images.filter((x) => x.url !== url).map((x) => x.url);
    setImages(assignShotKinds(next));
  }

  // ---- UI: big image modal ----
  const [modalUrl, setModalUrl] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* PROGRESS: Estimate */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Progress
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300">
            {estimateProgressLabel}
          </div>
        </div>

        <div className="mt-3">
          {showEstimateProgressBar ? (
            <IndeterminateBar />
          ) : (
            <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800">
              <div className="h-2 w-full rounded-full bg-gray-900 dark:bg-gray-100" />
            </div>
          )}
        </div>

        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          tenantSlug: {tenantSlug}
        </div>
      </div>

      {/* PHOTO INTAKE: Wide + Close up */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Take 2 quick photos
        </div>
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          Wide shot + close-up gets the best accuracy. Add more if you want (max 12).
        </div>

        <div className="mt-4 grid gap-4">
          <ShotRow
            label="Wide shot"
            url={wideShot}
            onPickFiles={onPickFiles}
            onRemove={() => wideShot && removeImage(wideShot)}
          />

          <ShotRow
            label="Close-up"
            url={closeUp}
            onPickFiles={onPickFiles}
            onRemove={() => closeUp && removeImage(closeUp)}
          />

          {otherImages.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                Additional photos
              </div>

              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {otherImages.map((u) => (
                  <div key={u} className="relative">
                    <button
                      type="button"
                      onClick={() => setModalUrl(u)}
                      className="block w-full overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={u}
                        alt="Additional photo"
                        className="h-24 w-full object-cover"
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => removeImage(u)}
                      className="absolute right-2 top-2 rounded-md bg-white/90 px-2 py-1 text-xs font-semibold text-gray-800 shadow-sm dark:bg-black/70 dark:text-gray-100"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2">
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onPickFiles(e.target.files)}
              />
              <span className="font-semibold">Upload Photos</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                (add up to 12)
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* USER INFO */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Your info
        </div>
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          Required so we can send your estimate and follow up if needed.
        </div>

        <div className="mt-4 grid gap-3">
          <Field label="Name *">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-gray-100"
              autoComplete="name"
            />
          </Field>

          <Field label="Email *">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-gray-100"
              autoComplete="email"
              inputMode="email"
            />
          </Field>

          <Field label="Phone *">
            <input
              value={phone}
              onChange={(e) => setPhone(normalizePhone(e.target.value))}
              placeholder="(555) 555-5555"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-gray-100"
              autoComplete="tel"
              inputMode="tel"
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What are you looking to do? Material preference, timeline, constraints?"
              rows={4}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-gray-100"
            />
          </Field>

          {aiRenderingEnabled && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={renderOptIn}
                  onChange={(e) => setRenderOptIn(e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <div className="font-semibold">Optional: AI rendering preview</div>
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    If selected, we may generate a visual “after” concept based on your photos.
                    This happens as a second step after your estimate.
                  </div>
                </div>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* ACTION */}
      <button
        type="button"
        onClick={submitQuote}
        disabled={submitting}
        className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
      >
        {submitting ? "Working…" : "Get Estimate"}
      </button>

      {/* ERROR */}
      {submitErr && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {submitErr}
        </div>
      )}

      {/* RESULT */}
      {result?.ok && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Result</div>

          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-900">
            <pre className="whitespace-pre-wrap break-words">
              {JSON.stringify(result.output ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* RENDERING SECTION */}
      {result?.ok && showRenderingSection && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            AI Rendering
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            This is a second step after your estimate. It can take a moment.
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-gray-600 dark:text-gray-300">
              Status: <span className="font-semibold">{renderingProgressLabel}</span>
            </div>
            {renderingStatus === "rendered" && renderedImageUrl && (
              <button
                type="button"
                onClick={() => setModalUrl(renderedImageUrl)}
                className="text-xs font-semibold text-gray-900 underline dark:text-gray-100"
              >
                Open full size
              </button>
            )}
          </div>

          <div className="mt-3">
            {showRenderingProgressBar ? (
              <IndeterminateBar />
            ) : (
              <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800">
                <div
                  className={`h-2 rounded-full ${
                    renderingStatus === "rendered"
                      ? "w-full bg-gray-900 dark:bg-gray-100"
                      : renderingStatus === "failed"
                      ? "w-full bg-red-600"
                      : "w-1/4 bg-gray-400"
                  }`}
                />
              </div>
            )}
          </div>

          {renderingStatus === "failed" && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              {renderingErr ?? "Render failed."}
            </div>
          )}

          {/* Rendered image (constrained, not huge) */}
          {renderingStatus === "rendered" && renderedImageUrl && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setModalUrl(renderedImageUrl)}
                className="block w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
                aria-label="Open rendered image full size"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={renderedImageUrl}
                  alt="AI rendering preview"
                  className="
                    w-full
                    max-h-[420px]
                    object-contain
                    bg-gray-50
                    dark:bg-gray-900
                  "
                />
              </button>

              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Tap image to view full size.
              </div>
            </div>
          )}

          {/* Retry */}
          {(renderingStatus === "failed" || renderingStatus === "idle") && (
            <button
              type="button"
              onClick={() => {
                const quoteLogId = result?.quoteLogId;
                if (typeof quoteLogId !== "string") return;
                triggerRendering({ tenantSlug, quoteLogId });
              }}
              className="mt-4 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            >
              Retry Render
            </button>
          )}
        </div>
      )}

      {/* Full-size modal */}
      {modalUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setModalUrl(null)}
        >
          <div
            className="w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-lg dark:bg-gray-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Preview
              </div>
              <button
                type="button"
                onClick={() => setModalUrl(null)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              >
                Close
              </button>
            </div>
            <div className="bg-gray-50 p-3 dark:bg-gray-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={modalUrl}
                alt="Full size preview"
                className="mx-auto max-h-[80vh] w-auto object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- small UI components ---------- */

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
        {props.label}
      </div>
      <div className="mt-1">{props.children}</div>
    </div>
  );
}

function ShotRow(props: {
  label: string;
  url: string | null;
  onPickFiles: (files: FileList | null) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-gray-800 dark:text-gray-100">
          {props.label}
        </div>

        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-lg bg-black px-3 py-2 text-xs font-semibold text-white">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => props.onPickFiles(e.target.files)}
            />
            {props.url ? "Replace" : "Take Photo (Camera)"}
          </label>

          {props.url && (
            <button
              type="button"
              onClick={props.onRemove}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="mt-3">
        {props.url ? (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={props.url}
              alt={props.label}
              className="h-36 w-full object-cover"
            />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-400">
            No photo yet.
          </div>
        )}
      </div>
    </div>
  );
}

function IndeterminateBar() {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
      <div className="indeterminate-bar h-2 rounded-full bg-gray-900 dark:bg-gray-100" />
      <style jsx>{`
        .indeterminate-bar {
          width: 35%;
          transform: translateX(-120%);
          animation: indeterminate 1.1s ease-in-out infinite;
        }
        @keyframes indeterminate {
          0% {
            transform: translateX(-120%);
          }
          50% {
            transform: translateX(60%);
          }
          100% {
            transform: translateX(220%);
          }
        }
      `}</style>
    </div>
  );
}
