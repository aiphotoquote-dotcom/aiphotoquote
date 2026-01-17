"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type QuoteOutput = {
  confidence?: "high" | "medium" | "low";
  inspection_required?: boolean;
  summary?: string;
  questions?: string[];
  estimate?: { low: number; high: number } | null;
  render_opt_in?: boolean;
};

type SubmitResponse = {
  ok: boolean;
  debugId?: string;
  quoteLogId?: string;
  output?: QuoteOutput | null;
  estimate?: { low: number; high: number } | null;
  assessment?: any;
  email?: any;
  error?: string;
  message?: string;
  server_debug?: any;
};

type RenderResponse = {
  ok: boolean;
  debugId?: string;
  quoteLogId?: string;
  imageUrl?: string | null;
  error?: string;
  message?: string;
  stored?: any;
  queuedMark?: any;
};

type UploadResponse = {
  ok: boolean;
  files?: Array<{ url?: string }>;
  error?: any;
};

export default function QuoteForm(props: {
  tenantSlug: string;
  aiRenderingEnabled: boolean;
}) {
  const { tenantSlug, aiRenderingEnabled } = props;

  // ---- form state ----
  const [files, setFiles] = useState<File[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [renderOptIn, setRenderOptIn] = useState(false);

  // ---- submit state ----
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResponse | null>(null);

  // ---- rendering state ----
  const [renderStatus, setRenderStatus] = useState<
    "idle" | "queued" | "rendered" | "failed"
  >("idle");
  const [renderMsg, setRenderMsg] = useState<string | null>(null);
  const [renderImageUrl, setRenderImageUrl] = useState<string | null>(null);
  const [renderMeta, setRenderMeta] = useState<any>(null);

  // Prevent double-trigger for same quoteLogId
  const renderAttemptedForQuoteRef = useRef<string | null>(null);

  const canSubmit = useMemo(() => {
    return (
      tenantSlug?.length >= 3 &&
      imageUrls.length >= 1 &&
      name.trim().length >= 1 &&
      email.trim().length >= 3 &&
      phone.trim().length >= 7 &&
      !uploading &&
      !submitting
    );
  }, [tenantSlug, imageUrls.length, name, email, phone, uploading, submitting]);

  // ---- helpers ----
  const formatPhone = useCallback((raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    const a = digits.slice(0, 3);
    const b = digits.slice(3, 6);
    const c = digits.slice(6, 10);
    if (digits.length <= 3) return a ? `(${a}` : "";
    if (digits.length <= 6) return `(${a}) ${b}`;
    return `(${a}) ${b}-${c}`;
  }, []);

  const pretty = useCallback((v: any) => {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }, []);

  async function uploadToBlob(selected: File[]) {
    setUploadErr(null);
    setUploading(true);

    try {
      const fd = new FormData();
      for (const f of selected) fd.append("files", f, f.name);

      const res = await fetch("/api/blob/upload", {
        method: "POST",
        body: fd,
      });

      const j: UploadResponse | null = await res.json().catch(() => null);

      if (!res.ok || !j?.ok) {
        throw new Error(
          j?.error?.message ||
            j?.error?.toString?.() ||
            `Upload failed (HTTP ${res.status})`
        );
      }

      const urls =
        j.files?.map((x) => (x?.url ? String(x.url) : "")).filter(Boolean) ?? [];

      if (!urls.length) {
        throw new Error("Upload succeeded but returned no file URLs.");
      }

      setImageUrls(urls);
      return urls;
    } finally {
      setUploading(false);
    }
  }

  async function submitQuote(payload: any) {
    const res = await fetch("/api/quote/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j: SubmitResponse | null = await res.json().catch(() => null);

    if (!res.ok || !j?.ok) {
      const msg =
        j?.message ||
        j?.error ||
        (j as any)?.server_debug?.[0]?.message ||
        `Quote failed (HTTP ${res.status})`;
      throw new Error(msg);
    }

    return j;
  }

  async function triggerRendering(args: { tenantSlug: string; quoteLogId: string }) {
    // UI rule: rendering is SUCCESS if ANY imageUrl comes back.
    // Blob upload is nice-to-have; not required to mark success.
    setRenderStatus("queued");
    setRenderMsg("Rendering queued…");
    setRenderImageUrl(null);
    setRenderMeta(null);

    const res = await fetch("/api/render/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });

    const j: RenderResponse | null = await res.json().catch(() => null);

    if (!res.ok || !j?.ok) {
      const msg = j?.message || j?.error || `Render failed (HTTP ${res.status})`;
      setRenderStatus("failed");
      setRenderMsg(msg);
      setRenderMeta(j);
      return;
    }

    const imgUrl = j?.imageUrl ? String(j.imageUrl) : null;

    if (imgUrl) {
      setRenderStatus("rendered");
      setRenderMsg(null);
      setRenderImageUrl(imgUrl);
      setRenderMeta(j);
      return;
    }

    // If backend says ok but no image URL, treat as failed (true failure)
    setRenderStatus("failed");
    setRenderMsg("Render returned ok but no image URL was provided.");
    setRenderMeta(j);
  }

  // ---- auto-trigger rendering after estimate (ONLY if opted-in + tenant enabled) ----
  useEffect(() => {
    const quoteLogId = result?.quoteLogId ?? null;

    const optedIn = result?.output?.render_opt_in === true;
    const shouldAutoRender = Boolean(aiRenderingEnabled && optedIn);

    if (!quoteLogId) return;
    if (!shouldAutoRender) return;

    // avoid duplicate triggers for same quote id
    if (renderAttemptedForQuoteRef.current === quoteLogId) return;
    renderAttemptedForQuoteRef.current = quoteLogId;

    triggerRendering({ tenantSlug, quoteLogId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.quoteLogId, result?.output?.render_opt_in, aiRenderingEnabled, tenantSlug]);

  // ---- events ----
  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setSubmitErr(null);
    setResult(null);
    setRenderStatus("idle");
    setRenderMsg(null);
    setRenderImageUrl(null);
    setRenderMeta(null);
    renderAttemptedForQuoteRef.current = null;

    const picked = Array.from(e.target.files ?? []).slice(0, 12);
    setFiles(picked);

    if (!picked.length) {
      setImageUrls([]);
      return;
    }

    try {
      await uploadToBlob(picked);
    } catch (err: any) {
      setUploadErr(err?.message ?? String(err));
      setImageUrls([]);
    }
  };

  const onSubmit = async () => {
    setSubmitErr(null);
    setResult(null);

    // clear rendering state for new submission
    setRenderStatus("idle");
    setRenderMsg(null);
    setRenderImageUrl(null);
    setRenderMeta(null);
    renderAttemptedForQuoteRef.current = null;

    setSubmitting(true);
    try {
      const payload = {
        tenantSlug,
        images: imageUrls.map((url) => ({ url })),
        render_opt_in: Boolean(aiRenderingEnabled && renderOptIn),
        customer_context: {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          notes: notes.trim() || undefined,
          category: "upholstery",
          service_type: "estimate",
        },
      };

      const j = await submitQuote(payload);
      setResult(j);
    } catch (err: any) {
      setSubmitErr(err?.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const quoteLogId = result?.quoteLogId ?? null;

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-600 dark:text-gray-300">Progress</div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {result?.ok ? "Estimate ready" : "Add photos"}
            </div>
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300">
            {imageUrls.length >= 2
              ? `Photos: ${imageUrls.length}`
              : `Add 2 photos (you have ${imageUrls.length})`}
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-900">
          <div
            className="h-full bg-black dark:bg-white"
            style={{
              width: result?.ok ? "100%" : imageUrls.length ? "50%" : "10%",
            }}
          />
        </div>

        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          tenantSlug: <span className="font-mono">{tenantSlug}</span>
        </div>
      </div>

      {/* Photos */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Take 2 quick photos
        </div>
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          These two shots give the best accuracy. Add more if you want (max 12).
        </div>

        <div className="mt-4">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={onPickFiles}
            className="block w-full text-sm"
          />
        </div>

        {uploading ? (
          <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
            Uploading photos…
          </div>
        ) : null}

        {uploadErr ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {uploadErr}
          </div>
        ) : null}

        {imageUrls.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {imageUrls.slice(0, 6).map((u) => (
              <div
                key={u}
                className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="uploaded" className="h-28 w-full object-cover" />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Customer */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Your info</div>
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          Required so we can send your estimate and follow up if needed.
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:focus:ring-white/10"
              placeholder="Your name"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:focus:ring-white/10"
              placeholder="you@email.com"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              Phone <span className="text-red-500">*</span>
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              autoComplete="tel"
              inputMode="tel"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:focus:ring-white/10"
              placeholder="(555) 555-5555"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950 dark:focus:ring-white/10"
              placeholder="What are you looking to do? Material preference, timeline, constraints?"
            />
          </div>

          {aiRenderingEnabled ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={renderOptIn}
                  onChange={(e) => setRenderOptIn(e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                    Optional: AI rendering preview
                  </div>
                  <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                    If selected, we may generate a visual “after” concept based on your photos.
                    This happens as a second step after your estimate.
                  </div>
                </div>
              </label>
            </div>
          ) : null}
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        className="w-full rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {submitting ? "Working…" : "Get Estimate"}
      </button>

      {submitErr ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          <div className="font-semibold">Quote failed</div>
          <div className="mt-1">{submitErr}</div>
          {result?.debugId ? (
            <div className="mt-2 text-xs opacity-80">debugId: {result.debugId}</div>
          ) : null}
        </div>
      ) : null}

      {/* Result */}
      {result?.ok ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Result</div>
          <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            <pre className="max-h-[320px] overflow-auto bg-gray-50 p-3 text-[11px] leading-4 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
              {pretty(result.output ?? result)}
            </pre>
          </div>

          {/* Rendering */}
          {aiRenderingEnabled && result?.output?.render_opt_in ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                AI Rendering
              </div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                This is a second step after your estimate. It can take a moment.
              </div>

              <div className="mt-3 text-xs text-gray-700 dark:text-gray-200">
                Status:{" "}
                <span className="font-semibold">
                  {renderStatus === "idle"
                    ? "Not started"
                    : renderStatus === "queued"
                      ? "Queued / Working"
                      : renderStatus === "rendered"
                        ? "Rendered"
                        : "Failed"}
                </span>
              </div>

              {renderStatus === "failed" ? (
                <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                  {renderMsg || "Render failed"}
                </div>
              ) : null}

              {renderStatus === "queued" && renderMsg ? (
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                  {renderMsg}
                </div>
              ) : null}

              {renderImageUrl ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={renderImageUrl}
                    alt="AI rendering"
                    className="w-full object-cover"
                  />
                </div>
              ) : null}

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => {
                    if (!quoteLogId) return;
                    triggerRendering({ tenantSlug, quoteLogId });
                  }}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                >
                  Retry Render
                </button>

                {renderMeta ? (
                  <button
                    onClick={() => {
                      const text = pretty(renderMeta);
                      // best-effort copy
                      navigator.clipboard?.writeText?.(text).catch(() => {});
                    }}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                  >
                    Copy debug
                  </button>
                ) : null}
              </div>

              {renderMeta ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                  <pre className="max-h-[220px] overflow-auto bg-gray-50 p-3 text-[11px] leading-4 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
                    {pretty(renderMeta)}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : aiRenderingEnabled ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
              AI Rendering: disabled (customer did not opt in).
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
              AI Rendering: not enabled for this tenant.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
