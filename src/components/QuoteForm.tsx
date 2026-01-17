"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ShotType = "wide" | "closeup" | "extra";

type UploadedImage = {
  url: string;
  shotType: ShotType;
};

type QuoteApiOk = {
  ok: true;
  quoteLogId?: string;
  id?: string;
  output?: any;
  assessment?: any;
};

type QuoteApiErr = {
  ok?: false;
  error?: any;
  message?: string;
  debugId?: string;
};

type RenderStartResp =
  | { ok: true; quoteLogId: string; status: "queued" | "running" | "rendered" | "failed" | "idle"; imageUrl?: string | null; error?: string | null; skipped?: boolean }
  | { ok?: false; error?: string; message?: string; debugId?: string };

type RenderStatusResp =
  | { ok: true; quoteLogId: string; status: "queued" | "running" | "rendered" | "failed" | "idle"; imageUrl?: string | null; error?: string | null }
  | { ok?: false; error?: string; message?: string; debugId?: string };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function digitsOnly(s: string) {
  return (s || "").replace(/\D/g, "");
}

function formatUSPhone(input: string) {
  const d = digitsOnly(input).slice(0, 10);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (d.length <= 3) return a ? `(${a}` : "";
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function isValidEmail(email: string) {
  const s = (email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function compressImage(file: File, opts?: { maxDim?: number; quality?: number }): Promise<File> {
  const maxDim = opts?.maxDim ?? 1600;
  const quality = opts?.quality ?? 0.78;

  if (!file.type.startsWith("image/")) return file;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Failed to load image"));
    i.src = dataUrl;
  });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const scale = Math.min(1, maxDim / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(img, 0, 0, outW, outH);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Compression failed"))),
      "image/jpeg",
      quality
    );
  });

  const baseName = file.name.replace(/\.[^/.]+$/, "");
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

function ProgressBar({
  labelLeft,
  labelRight,
  value,
  active,
}: {
  labelLeft: string;
  labelRight?: string;
  value: number; // 0..1
  active: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="w-full rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs text-gray-600 dark:text-gray-300">{labelLeft}</div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{labelRight ?? ""}</div>
        </div>
        <div className="text-xs text-gray-700 dark:text-gray-200">{Math.round(pct * 100)}%</div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
        <div
          className={cn(
            "h-full rounded-full bg-black transition-all duration-500 dark:bg-white",
            active ? "animate-pulse" : ""
          )}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function QuoteForm({
  tenantSlug,
  aiRenderingEnabled,
}: {
  tenantSlug: string;
  aiRenderingEnabled?: boolean;
}) {
  const MIN_PHOTOS = 2;
  const MAX_PHOTOS = 12;

  const tenantRenderEnabled = Boolean(aiRenderingEnabled);

  // Contact + notes
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  // Uploaded photos (already in Blob)
  const [images, setImages] = useState<UploadedImage[]>([]);

  // Opt-in (only meaningful if tenantRenderEnabled)
  const [renderOptIn, setRenderOptIn] = useState(false);

  useEffect(() => {
    if (!tenantRenderEnabled) setRenderOptIn(false);
  }, [tenantRenderEnabled]);

  // Estimate lifecycle
  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<"idle" | "compressing" | "uploading" | "analyzing">("idle");

  const [result, setResult] = useState<{ quoteLogId: string | null; output: any | null }>({
    quoteLogId: null,
    output: null,
  });

  const [error, setError] = useState<string | null>(null);

  // Rendering lifecycle
  const [renderStatus, setRenderStatus] = useState<"idle" | "queued" | "running" | "rendered" | "failed">("idle");
  const [renderImageUrl, setRenderImageUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Prevent multi-start / multi-poll loops
  const renderAttemptedForQuoteRef = useRef<string | null>(null);
  const renderPollAbortRef = useRef<AbortController | null>(null);

  const contactOk = useMemo(() => {
    const nOk = customerName.trim().length > 0;
    const eOk = isValidEmail(email);
    const pOk = digitsOnly(phone).length === 10;
    return nOk && eOk && pOk;
  }, [customerName, email, phone]);

  const photoOk = images.length >= MIN_PHOTOS;

  const estimateReady = Boolean(result.output);

  const estimateProgress = useMemo(() => {
    // Smooth-ish progression:
    // - baseline depends on how far the user is
    let p = 0.1;
    if (images.length > 0) p = 0.25;
    if (photoOk) p = 0.35;
    if (contactOk) p = 0.45;
    if (working) {
      if (phase === "compressing") p = 0.60;
      if (phase === "uploading") p = 0.75;
      if (phase === "analyzing") p = 0.88;
    }
    if (estimateReady) p = 1.0;
    return Math.max(0, Math.min(1, p));
  }, [images.length, photoOk, contactOk, working, phase, estimateReady]);

  const estimateLabel = useMemo(() => {
    if (estimateReady) return "Estimate ready";
    if (working) {
      if (phase === "compressing") return "Optimizing photos…";
      if (phase === "uploading") return "Uploading…";
      if (phase === "analyzing") return "Analyzing…";
      return "Working…";
    }
    if (!photoOk) return `Add ${MIN_PHOTOS} photos`;
    if (!contactOk) return "Add contact info";
    return "Ready to submit";
  }, [estimateReady, working, phase, photoOk, contactOk]);

  const renderProgress = useMemo(() => {
    if (!tenantRenderEnabled) return 0;
    if (!renderOptIn) return estimateReady ? 0.35 : 0.1;
    if (!estimateReady) return 0.15;

    if (renderStatus === "queued") return 0.45;
    if (renderStatus === "running") return 0.75;
    if (renderStatus === "rendered") return 1.0;
    if (renderStatus === "failed") return 1.0;

    return 0.25;
  }, [tenantRenderEnabled, renderOptIn, estimateReady, renderStatus]);

  const renderLabel = useMemo(() => {
    if (!tenantRenderEnabled) return "Disabled";
    if (!renderOptIn) return "Off";
    if (!estimateReady) return "Waiting for estimate…";
    if (renderStatus === "queued") return "Queued…";
    if (renderStatus === "running") return "Rendering…";
    if (renderStatus === "rendered") return "Ready";
    if (renderStatus === "failed") return "Failed";
    return "Waiting…";
  }, [tenantRenderEnabled, renderOptIn, estimateReady, renderStatus]);

  const addImagesFromUrls = useCallback((urls: string[]) => {
    setImages((prev) => {
      const next = [...prev];

      for (const url of urls) {
        if (!url) continue;
        if (next.find((x) => x.url === url)) continue;

        const idx = next.length;
        const shotType: ShotType = idx === 0 ? "wide" : idx === 1 ? "closeup" : "extra";
        next.push({ url, shotType });
      }

      return next.slice(0, MAX_PHOTOS);
    });
  }, []);

  const setShotType = useCallback((url: string, shotType: ShotType) => {
    setImages((prev) => prev.map((x) => (x.url === url ? { ...x, shotType } : x)));
  }, []);

  const removeImage = useCallback((url: string) => {
    setImages((prev) => prev.filter((x) => x.url !== url));
  }, []);

  async function uploadFiles(files: FileList) {
    if (!files?.length) return;

    // Respect max photos
    const remaining = Math.max(0, MAX_PHOTOS - images.length);
    const picked = Array.from(files).slice(0, remaining);
    if (!picked.length) return;

    setError(null);

    setWorking(true);
    setPhase("compressing");

    try {
      const compressed = await Promise.all(picked.map((f) => compressImage(f)));

      setPhase("uploading");

      const form = new FormData();
      compressed.forEach((f) => form.append("files", f));

      const res = await fetch("/api/blob/upload", { method: "POST", body: form });
      const text = await res.text();

      let j: any = null;
      try {
        j = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Upload returned non-JSON (HTTP ${res.status}). ${text?.slice(0, 200) ?? ""}`.trim());
      }

      if (!res.ok || !j?.ok) {
        throw new Error(j?.error?.message || j?.message || `Blob upload failed (HTTP ${res.status})`);
      }

      // Support either shape: {urls:[...]} or {files:[{url}]}
      const urls: string[] = Array.isArray(j?.urls)
        ? j.urls.map((x: any) => String(x)).filter(Boolean)
        : Array.isArray(j?.files)
          ? j.files.map((x: any) => String(x?.url)).filter(Boolean)
          : [];

      if (!urls.length) throw new Error("Blob upload returned no file urls");

      addImagesFromUrls(urls);
    } finally {
      setWorking(false);
      setPhase("idle");
    }
  }

  async function submitEstimate() {
    setError(null);
    setResult({ quoteLogId: null, output: null });

    // Reset render UI
    setRenderStatus("idle");
    setRenderImageUrl(null);
    setRenderError(null);
    renderAttemptedForQuoteRef.current = null;
    renderPollAbortRef.current?.abort();
    renderPollAbortRef.current = null;

    if (!tenantSlug || typeof tenantSlug !== "string") {
      setError("Missing tenant slug. Please reload the page (invalid tenant link).");
      return;
    }
    if (!photoOk) {
      setError(`Please add at least ${MIN_PHOTOS} photos for an accurate estimate.`);
      return;
    }
    if (!contactOk) {
      setError("Please complete name, email, and phone.");
      return;
    }

    setWorking(true);
    setPhase("analyzing");

    try {
      // IMPORTANT: keep payload aligned with your server route schema:
      // - render_opt_in must be TOP-LEVEL (not inside customer_context)
      // - name/email/phone live under customer_context (your route expects that)
      const payload = {
        tenantSlug,
        images: images.map((x) => ({ url: x.url })),
        render_opt_in: tenantRenderEnabled ? Boolean(renderOptIn) : false,
        customer_context: {
          name: customerName.trim(),
          email: email.trim(),
          phone: digitsOnly(phone),
          notes: notes?.trim() || undefined,
          category: "service",
          service_type: "upholstery",
        },
      };

      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let j: QuoteApiOk | QuoteApiErr | any = null;

      try {
        j = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Server returned non-JSON (HTTP ${res.status}). ${text?.slice(0, 200) ?? ""}`.trim());
      }

      if (!res.ok || !j?.ok) {
        const dbg = j?.debugId ? `\ndebugId: ${j.debugId}` : "";
        const msg = j?.message ? `\nmessage: ${j.message}` : "";
        const code = j?.error ? `\ncode: ${j.error}` : "";
        throw new Error(`Quote failed\nHTTP ${res.status}${dbg}${code}${msg}`.trim());
      }

      const quoteLogId = (j.quoteLogId ?? j.id ?? null) as string | null;
      const output = (j.output ?? j.assessment ?? null) as any | null;

      setResult({ quoteLogId, output });
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
      setRenderStatus("idle");
    } finally {
      setWorking(false);
      setPhase("idle");
    }
  }

  async function startRenderAndPoll(args: { tenantSlug: string; quoteLogId: string }) {
    const { tenantSlug, quoteLogId } = args;

    // Idempotent start (doesn't do the expensive render itself)
    setRenderStatus("queued");
    setRenderImageUrl(null);
    setRenderError(null);

    // Stop any previous poll
    renderPollAbortRef.current?.abort();
    const ac = new AbortController();
    renderPollAbortRef.current = ac;

    try {
      const startRes = await fetch("/api/render/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantSlug, quoteLogId }),
        signal: ac.signal,
      });

      const startText = await startRes.text();
      let startJson: RenderStartResp | any = null;
      try {
        startJson = startText ? JSON.parse(startText) : null;
      } catch {
        throw new Error(`Render start returned non-JSON (HTTP ${startRes.status}).`);
      }

      // Even if already started, it's OK.
      if (!startRes.ok || !startJson?.ok) {
        const msg = startJson?.message || startJson?.error || `Render start failed (HTTP ${startRes.status})`;
        throw new Error(String(msg));
      }

      // If it already has an image, stop here
      if (startJson.status === "rendered" && startJson.imageUrl) {
        setRenderStatus("rendered");
        setRenderImageUrl(String(startJson.imageUrl));
        setRenderError(null);
        return;
      }

      // Poll status until done/fail
      for (;;) {
        if (ac.signal.aborted) return;

        await sleep(2000);

        const stRes = await fetch("/api/render/status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tenantSlug, quoteLogId }),
          signal: ac.signal,
        });

        const stText = await stRes.text();
        let stJson: RenderStatusResp | any = null;
        try {
          stJson = stText ? JSON.parse(stText) : null;
        } catch {
          throw new Error(`Render status returned non-JSON (HTTP ${stRes.status}).`);
        }

        if (!stRes.ok || !stJson?.ok) {
          const msg = stJson?.message || stJson?.error || `Render status failed (HTTP ${stRes.status})`;
          throw new Error(String(msg));
        }

        const status = String(stJson.status || "idle") as any;

        if (status === "queued") {
          setRenderStatus("queued");
          continue;
        }

        if (status === "running") {
          setRenderStatus("running");
          continue;
        }

        if (status === "rendered") {
          const imageUrl = stJson.imageUrl ? String(stJson.imageUrl) : null;
          if (!imageUrl) throw new Error("Render marked rendered, but no imageUrl returned.");
          setRenderStatus("rendered");
          setRenderImageUrl(imageUrl);
          setRenderError(null);
          return;
        }

        if (status === "failed") {
          setRenderStatus("failed");
          setRenderImageUrl(null);
          setRenderError(stJson.error ? String(stJson.error) : "Render failed");
          return;
        }

        // idle -> keep polling a short while
        setRenderStatus("queued");
      }
    } catch (e: any) {
      if (ac.signal.aborted) return;
      setRenderStatus("failed");
      setRenderImageUrl(null);
      setRenderError(e?.message ?? "Render failed");
    }
  }

  // Auto-start render exactly once per quoteLogId (no token waste)
  useEffect(() => {
    const quoteLogId = result.quoteLogId;

    if (!tenantRenderEnabled) return;
    if (!renderOptIn) return;
    if (!estimateReady) return;
    if (!quoteLogId) return;

    if (renderAttemptedForQuoteRef.current === quoteLogId) return;
    renderAttemptedForQuoteRef.current = quoteLogId;

    startRenderAndPoll({ tenantSlug, quoteLogId });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.quoteLogId, estimateReady, tenantRenderEnabled, renderOptIn, tenantSlug]);

  function startOver() {
    setError(null);
    setResult({ quoteLogId: null, output: null });

    renderPollAbortRef.current?.abort();
    renderPollAbortRef.current = null;
    renderAttemptedForQuoteRef.current = null;

    setRenderStatus("idle");
    setRenderImageUrl(null);
    setRenderError(null);

    setNotes("");
    setCustomerName("");
    setEmail("");
    setPhone("");
    setImages([]);

    setWorking(false);
    setPhase("idle");

    setRenderOptIn(false);
  }

  const renderActive = renderStatus === "queued" || renderStatus === "running";

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="space-y-3">
        <ProgressBar
          labelLeft="Progress"
          labelRight={estimateLabel}
          value={estimateProgress}
          active={working}
        />

        {tenantRenderEnabled ? (
          <ProgressBar
            labelLeft="AI Rendering"
            labelRight={renderLabel}
            value={renderProgress}
            active={renderActive}
          />
        ) : null}
      </div>

      {/* Photos */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Take 2 quick photos</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Wide shot + close-up gets the best accuracy. Add more if you want (max {MAX_PHOTOS}).
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {/* Your preferred primary flow: one Take Photo button, then choose wide/close after upload */}
          <label className="block">
            <input
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={async (e) => {
                try {
                  if (e.target.files) await uploadFiles(e.target.files);
                } catch (err: any) {
                  setError(err?.message ?? "Upload failed");
                } finally {
                  e.currentTarget.value = "";
                }
              }}
              disabled={working}
            />
            <div className="w-full rounded-xl bg-black text-white py-4 text-center font-semibold cursor-pointer select-none dark:bg-white dark:text-black">
              Take Photo
            </div>
          </label>

          {/* Keep Upload Photos as secondary (still needed for existing photos) */}
          <label className="block">
            <input
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={async (e) => {
                try {
                  if (e.target.files) await uploadFiles(e.target.files);
                } catch (err: any) {
                  setError(err?.message ?? "Upload failed");
                } finally {
                  e.currentTarget.value = "";
                }
              }}
              disabled={working}
            />
            <div className="w-full rounded-xl border border-gray-200 py-4 text-center font-semibold cursor-pointer select-none dark:border-gray-800">
              Upload Photos
            </div>
          </label>
        </div>

        {images.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {images.map((img) => (
              <div
                key={img.url}
                className="relative rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="uploaded" className="h-44 w-full object-cover" />

                <div className="absolute left-2 top-2 rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-xs font-semibold dark:bg-gray-900/90 dark:border-gray-800">
                  {img.shotType === "wide" ? "Wide shot" : img.shotType === "closeup" ? "Close-up" : "Extra"}
                </div>

                <button
                  type="button"
                  className="absolute right-2 top-2 rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-xs disabled:opacity-50 dark:bg-gray-900/90 dark:border-gray-800"
                  onClick={() => removeImage(img.url)}
                  disabled={working}
                >
                  Remove
                </button>

                <div className="p-3 bg-white dark:bg-gray-900">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-xs text-gray-600 dark:text-gray-300">Mark as</div>

                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-semibold border",
                        img.shotType === "wide"
                          ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                          : "bg-white text-gray-900 border-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
                      )}
                      onClick={() => setShotType(img.url, "wide")}
                      disabled={working}
                    >
                      Wide
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-semibold border",
                        img.shotType === "closeup"
                          ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                          : "bg-white text-gray-900 border-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
                      )}
                      onClick={() => setShotType(img.url, "closeup")}
                      disabled={working}
                    >
                      Close-up
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-semibold border",
                        img.shotType === "extra"
                          ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                          : "bg-white text-gray-900 border-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
                      )}
                      onClick={() => setShotType(img.url, "extra")}
                      disabled={working}
                    >
                      Extra
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-300">
            No photos yet.
          </div>
        )}
      </section>

      {/* Details */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Your info</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Required so we can send your estimate and follow up if needed.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="text-xs text-gray-700 dark:text-gray-200">
              Name <span className="text-red-600">*</span>
            </div>
            <input
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Your name"
              disabled={working}
              autoComplete="name"
            />
          </label>

          <label className="block">
            <div className="text-xs text-gray-700 dark:text-gray-200">
              Email <span className="text-red-600">*</span>
            </div>
            <input
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              disabled={working}
              inputMode="email"
              autoComplete="email"
            />
          </label>
        </div>

        <label className="block">
          <div className="text-xs text-gray-700 dark:text-gray-200">
            Phone <span className="text-red-600">*</span>
          </div>
          <input
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            value={phone}
            onChange={(e) => setPhone(formatUSPhone(e.target.value))}
            placeholder="(555) 555-5555"
            disabled={working}
            inputMode="tel"
            autoComplete="tel"
          />
        </label>

        <label className="block">
          <div className="text-xs text-gray-700 dark:text-gray-200">Notes</div>
          <textarea
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What are you looking to do? Material preference, timeline, constraints?"
            disabled={working}
          />
        </label>

        {tenantRenderEnabled ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-start gap-3">
              <input
                id="renderOptIn"
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={renderOptIn}
                onChange={(e) => setRenderOptIn(e.target.checked)}
                disabled={working}
              />
              <label htmlFor="renderOptIn" className="cursor-pointer">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Optional: AI rendering preview
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  If selected, we may generate a visual “after” concept based on your photos. This happens as a second step after your estimate.
                </div>
              </label>
            </div>
          </div>
        ) : null}

        <button
          className="w-full rounded-xl bg-black text-white py-4 font-semibold disabled:opacity-50 dark:bg-white dark:text-black"
          onClick={submitEstimate}
          disabled={working || !photoOk || !contactOk}
        >
          {working ? "Working…" : "Get Estimate"}
        </button>

        <button
          type="button"
          className="w-full rounded-xl border border-gray-200 py-3 text-sm font-semibold dark:border-gray-800"
          onClick={startOver}
          disabled={working}
        >
          Start Over
        </button>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}
      </section>

      {/* Result */}
      {estimateReady ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Result</h2>
            {result.quoteLogId ? (
              <div className="text-xs text-gray-600 dark:text-gray-300">Quote ID: {result.quoteLogId}</div>
            ) : null}
          </div>

          <pre className="overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
            {JSON.stringify(result.output, null, 2)}
          </pre>

          {tenantRenderEnabled && renderOptIn ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Rendering</div>
                <div className="text-xs text-gray-600 dark:text-gray-300">Status: {renderStatus}</div>
              </div>

              {renderStatus === "failed" && renderError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                  {renderError}
                </div>
              ) : null}

              {renderStatus === "rendered" && renderImageUrl ? (
                <div className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={renderImageUrl} alt="AI render" className="w-full object-cover" />
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
                  disabled={!result.quoteLogId || renderActive}
                  onClick={() => {
                    if (!result.quoteLogId) return;
                    // allow manual retry without duplicating starts
                    renderAttemptedForQuoteRef.current = null;
                    startRenderAndPoll({ tenantSlug, quoteLogId: result.quoteLogId });
                  }}
                >
                  Retry Render
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <p className="text-xs text-gray-600 dark:text-gray-300">
        By submitting, you agree we may contact you about this request. Photos are used only to prepare your estimate.
      </p>
    </div>
  );
}
