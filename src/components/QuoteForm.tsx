"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type UploadedFile = { url: string };
type ShotType = "wide" | "closeup";

type QuoteSubmitOk = {
  ok: true;
  quoteLogId: string | null;
  output: any;
  debugId?: string;
};

type QuoteSubmitFail = {
  ok: false;
  error?: string;
  message?: string;
  debugId?: string;
  issues?: any[];
};

type QuoteSubmitResp = QuoteSubmitOk | QuoteSubmitFail;

type RenderStartOk = {
  ok: true;
  quoteLogId?: string;
  imageUrl?: string | null;
  durationMs?: number;
  debugId?: string;
};

type RenderStartFail = {
  ok: false;
  error?: string;
  message?: string;
  debugId?: string;
};

type RenderStartResp = RenderStartOk | RenderStartFail;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function digitsOnly(s: string) {
  return (s || "").replace(/\D/g, "");
}

function isValidEmail(email: string) {
  const s = (email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
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

async function compressImage(
  file: File,
  opts?: { maxDim?: number; quality?: number }
): Promise<File> {
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
  const outName = `${baseName}.jpg`;
  return new File([blob], outName, { type: "image/jpeg" });
}

type UploadOk = { ok: true; files: Array<{ url: string }> };
type UploadFail = { ok: false; error?: { message?: string } };
type UploadResp = UploadOk | UploadFail;

async function uploadBatchToBlob(files: File[]): Promise<string[]> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));

  const res = await fetch("/api/blob/upload", { method: "POST", body: form });

  let j: UploadResp | null = null;
  try {
    j = (await res.json()) as UploadResp;
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg = (j as any)?.error?.message || `Blob upload failed (HTTP ${res.status})`;
    throw new Error(msg);
  }

  if (!j || j.ok !== true) {
    const msg = (j as any)?.error?.message || "Blob upload failed";
    throw new Error(msg);
  }

  const urls = (j.files ?? []).map((x) => String(x.url)).filter(Boolean);
  if (!urls.length) throw new Error("Blob upload returned no file urls");
  return urls;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function ShotPill({ type }: { type: ShotType }) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
      {type === "wide" ? "Wide shot" : "Close-up"}
    </span>
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

  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [shotTypes, setShotTypes] = useState<Record<number, ShotType>>({}); // index -> type

  // customer opt-in (tenant-enabled)
  const [renderOptIn, setRenderOptIn] = useState(false);

  // Estimate state
  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<"idle" | "compressing" | "uploading" | "analyzing">("idle");

  const [result, setResult] = useState<QuoteSubmitOk | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rendering state
  const [renderStatus, setRenderStatus] = useState<
    "idle" | "queued" | "starting" | "rendering" | "uploaded" | "done" | "failed"
  >("idle");
  const [renderMessage, setRenderMessage] = useState<string | null>(null);
  const [renderImageUrl, setRenderImageUrl] = useState<string | null>(null);
  const [renderDebugId, setRenderDebugId] = useState<string | null>(null);

  const renderAttemptedForQuoteRef = useRef<string | null>(null);

  const resultsRef = useRef<HTMLDivElement | null>(null);

  const contactOk = useMemo(() => {
    const nOk = customerName.trim().length > 0;
    const eOk = isValidEmail(email);
    const pOk = digitsOnly(phone).length === 10;
    return nOk && eOk && pOk;
  }, [customerName, email, phone]);

  const estimateReady = Boolean(result?.output);

  // Progress (Estimate)
  const estimateProgress = useMemo(() => {
    if (estimateReady) return 1;
    if (working) {
      if (phase === "compressing") return 0.55;
      if (phase === "uploading") return 0.7;
      if (phase === "analyzing") return 0.85;
    }
    if (files.length === 0) return 0.2;
    if (files.length < MIN_PHOTOS) return 0.35;
    if (!contactOk) return 0.5;
    return 0.6;
  }, [estimateReady, working, phase, files.length, contactOk]);

  const estimateLabel = useMemo(() => {
    if (estimateReady) return "Estimate ready";
    if (working) {
      if (phase === "compressing") return "Working: optimizing photos…";
      if (phase === "uploading") return "Working: uploading…";
      if (phase === "analyzing") return "Working: analyzing…";
    }
    return "Progress";
  }, [estimateReady, working, phase]);

  // Progress (Rendering)
  const renderingEnabledForThis = Boolean(aiRenderingEnabled) && Boolean(renderOptIn);
  const quoteLogId = result?.quoteLogId ?? null;

  const renderProgress = useMemo(() => {
    if (!renderingEnabledForThis) return 0;
    if (renderStatus === "idle") return 0.1;
    if (renderStatus === "starting") return 0.25;
    if (renderStatus === "queued") return 0.35;
    if (renderStatus === "rendering") return 0.6;
    if (renderStatus === "uploaded") return 0.85;
    if (renderStatus === "done") return 1;
    if (renderStatus === "failed") return 1;
    return 0.1;
  }, [renderingEnabledForThis, renderStatus]);

  function rebuildPreviews(nextFiles: File[]) {
    previews.forEach((p) => URL.revokeObjectURL(p));
    setPreviews(nextFiles.map((f) => URL.createObjectURL(f)));
  }

  function addFiles(newOnes: File[]) {
    if (!newOnes.length) return;

    const startIdx = files.length;
    const combined = [...files, ...newOnes].slice(0, MAX_PHOTOS);

    setFiles(combined);
    rebuildPreviews(combined);

    // default shot typing: first photo wide, second close-up, rest wide (editable)
    setShotTypes((prev) => {
      const next = { ...prev };
      for (let i = startIdx; i < combined.length; i++) {
        if (next[i]) continue;
        if (i === 0) next[i] = "wide";
        else if (i === 1) next[i] = "closeup";
        else next[i] = "wide";
      }
      return next;
    });
  }

  function removeFileAt(idx: number) {
    const nextFiles = files.filter((_, i) => i !== idx);
    setFiles(nextFiles);
    rebuildPreviews(nextFiles);

    // re-index shotTypes
    setShotTypes((prev) => {
      const next: Record<number, ShotType> = {};
      let j = 0;
      for (let i = 0; i < files.length; i++) {
        if (i === idx) continue;
        next[j] = prev[i] ?? (j === 0 ? "wide" : j === 1 ? "closeup" : "wide");
        j++;
      }
      return next;
    });
  }

  function resetAll() {
    setError(null);
    setResult(null);
    setNotes("");
    setRenderOptIn(false);

    // rendering reset
    setRenderStatus("idle");
    setRenderMessage(null);
    setRenderImageUrl(null);
    setRenderDebugId(null);
    renderAttemptedForQuoteRef.current = null;

    previews.forEach((p) => URL.revokeObjectURL(p));
    setPreviews([]);
    setFiles([]);
    setShotTypes({});
    setPhase("idle");
  }

  async function submitEstimate() {
    setError(null);
    setResult(null);

    // reset rendering for new run
    setRenderStatus("idle");
    setRenderMessage(null);
    setRenderImageUrl(null);
    setRenderDebugId(null);
    renderAttemptedForQuoteRef.current = null;

    if (!tenantSlug || typeof tenantSlug !== "string") {
      setError("Missing tenant slug. Please reload the page (invalid tenant link).");
      return;
    }

    if (files.length < MIN_PHOTOS) {
      setError(`Please add at least ${MIN_PHOTOS} photos for an accurate estimate.`);
      return;
    }
    if (files.length > MAX_PHOTOS) {
      setError(`Please limit to ${MAX_PHOTOS} photos or fewer.`);
      return;
    }

    if (!customerName.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (digitsOnly(phone).length !== 10) {
      setError("Please enter a valid 10-digit phone number.");
      return;
    }

    setWorking(true);

    try {
      setPhase("compressing");
      const compressed = await Promise.all(files.map((f) => compressImage(f)));

      // ✅ key fix: upload in batches to avoid 413
      setPhase("uploading");
      const BATCH_SIZE = 2;
      const batches = chunk(compressed, BATCH_SIZE);

      const uploadedUrls: string[] = [];
      for (const batch of batches) {
        // one retry; doesn't waste tokens
        try {
          const urls = await uploadBatchToBlob(batch);
          uploadedUrls.push(...urls);
        } catch {
          const urls = await uploadBatchToBlob(batch);
          uploadedUrls.push(...urls);
        }
      }

      const images: UploadedFile[] = uploadedUrls.map((u) => ({ url: u }));

      setPhase("analyzing");

      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          images,
          render_opt_in: Boolean(aiRenderingEnabled) && Boolean(renderOptIn),
          customer_context: {
            name: customerName.trim(),
            email: email.trim(),
            phone: digitsOnly(phone),
            notes,
            // Optional metadata: wide/close selection per image (server can ignore)
            shot_types: images.map((_, i) => shotTypes[i] ?? (i === 0 ? "wide" : i === 1 ? "closeup" : "wide")),
          },
        }),
      });

      const j = (await res.json().catch(() => null)) as QuoteSubmitResp | null;

      if (!j || j.ok !== true) {
        const dbg = (j as any)?.debugId ? `\ndebugId: ${(j as any).debugId}` : "";
        const code = (j as any)?.error ? `\ncode: ${(j as any).error}` : "";
        const msg = (j as any)?.message ? `\nmessage: ${(j as any).message}` : "";
        throw new Error(`Quote failed\nHTTP ${res.status}${dbg}${code}${msg}`.trim());
      }

      setResult(j);
      await sleep(50);
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
      setPhase("idle");
    } finally {
      setWorking(false);
    }
  }

  async function startRender(args: { tenantSlug: string; quoteLogId: string }) {
    setRenderStatus("starting");
    setRenderMessage(null);
    setRenderImageUrl(null);
    setRenderDebugId(null);

    try {
      const res = await fetch("/api/render/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug: args.tenantSlug,
          quoteLogId: args.quoteLogId,
        }),
      });

      const j = (await res.json().catch(() => null)) as RenderStartResp | null;

      if (!res.ok || !j || (j as any).ok !== true) {
        const dbg = (j as any)?.debugId ? `debugId: ${(j as any).debugId}` : "";
        const msg = (j as any)?.message || (j as any)?.error || `Render failed (HTTP ${res.status})`;
        setRenderStatus("failed");
        setRenderMessage([msg, dbg].filter(Boolean).join("\n"));
        return;
      }

      // If your API returns the final URL immediately, show it.
      // If it queues async, still show success state and keep message minimal.
      const imageUrl = (j as any)?.imageUrl ? String((j as any).imageUrl) : null;

      if (imageUrl) {
        setRenderStatus("done");
        setRenderImageUrl(imageUrl);
        setRenderMessage(null);
      } else {
        // best-effort: treat as queued/started
        setRenderStatus("queued");
        setRenderMessage("Render started. It can take a moment…");
      }
      setRenderDebugId((j as any)?.debugId ?? null);
    } catch (e: any) {
      setRenderStatus("failed");
      setRenderMessage(e?.message ?? "Render failed.");
    }
  }

  // ✅ AUTO-TRIGGER render after estimate (only once per quoteLogId)
  useEffect(() => {
    if (!renderingEnabledForThis) return;
    if (!estimateReady) return;

    const qid = quoteLogId;
    if (!qid || typeof qid !== "string") return;

    if (renderAttemptedForQuoteRef.current === qid) return;
    renderAttemptedForQuoteRef.current = qid;

    startRender({ tenantSlug, quoteLogId: qid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateReady, quoteLogId, renderingEnabledForThis, tenantSlug]);

  const showRenderingBlock = estimateReady && Boolean(aiRenderingEnabled);

  return (
    <div className="space-y-6">
      {/* Estimate progress (WORKING bar) */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs text-gray-600 dark:text-gray-300">{estimateLabel}</div>
            <div className="mt-0.5 text-xs text-gray-700 dark:text-gray-200">
              tenantSlug: <span className="font-semibold">{tenantSlug}</span>
            </div>
          </div>
          <div className="text-xs text-gray-700 dark:text-gray-200">
            {estimateReady ? "Estimate ready" : working ? "Working…" : files.length < MIN_PHOTOS ? `Add ${MIN_PHOTOS} photos` : "Ready"}
          </div>
        </div>

        <div className="mt-3 h-2 w-full rounded-full bg-gray-200 overflow-hidden dark:bg-gray-800">
          <div
            className="h-full rounded-full bg-black transition-all duration-500 dark:bg-white"
            style={{ width: `${Math.round(estimateProgress * 100)}%` }}
          />
        </div>
      </div>

      {/* Photos */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Take 2 quick photos</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Wide shot + close-up gets the best accuracy. Add more if you want (max {MAX_PHOTOS}).
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Single Take Photo */}
          <label className="block">
            <input
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const next = Array.from(e.target.files ?? []);
                addFiles(next);
                e.currentTarget.value = "";
              }}
              disabled={working}
            />
            <div className="w-full rounded-xl bg-black text-white py-4 text-center font-semibold cursor-pointer select-none dark:bg-white dark:text-black">
              Take Photo (Camera)
            </div>
          </label>

          {/* Upload */}
          <label className="block">
            <input
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                const next = Array.from(e.target.files ?? []);
                addFiles(next);
                e.currentTarget.value = "";
              }}
              disabled={working}
            />
            <div className="w-full rounded-xl border border-gray-200 py-4 text-center font-semibold cursor-pointer select-none dark:border-gray-800">
              Upload Photos
            </div>
          </label>
        </div>

        {previews.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {previews.map((src, idx) => (
              <div
                key={`${src}-${idx}`}
                className="relative rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`photo ${idx + 1}`} className="h-32 w-full object-cover" />

                <div className="absolute left-2 top-2 flex items-center gap-2">
                  <ShotPill type={shotTypes[idx] ?? (idx === 0 ? "wide" : idx === 1 ? "closeup" : "wide")} />
                </div>

                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-xs font-semibold dark:bg-gray-900/90 dark:border-gray-800"
                      onClick={() =>
                        setShotTypes((p) => ({ ...p, [idx]: "wide" }))
                      }
                      disabled={working}
                    >
                      Wide
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-xs font-semibold dark:bg-gray-900/90 dark:border-gray-800"
                      onClick={() =>
                        setShotTypes((p) => ({ ...p, [idx]: "closeup" }))
                      }
                      disabled={working}
                    >
                      Close-up
                    </button>
                  </div>

                  <button
                    type="button"
                    className="rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-xs disabled:opacity-50 dark:bg-gray-900/90 dark:border-gray-800"
                    onClick={() => removeFileAt(idx)}
                    disabled={working}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
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

        {aiRenderingEnabled ? (
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
                  If selected, we’ll generate a visual “after” concept as a second step after your estimate.
                </div>
              </label>
            </div>
          </div>
        ) : null}

        <button
          className="w-full rounded-xl bg-black text-white py-4 font-semibold disabled:opacity-50 dark:bg-white dark:text-black"
          onClick={submitEstimate}
          disabled={working || files.length < MIN_PHOTOS || !contactOk}
        >
          {working ? "Working…" : "Get Estimate"}
        </button>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}

        <button
          type="button"
          className="w-full rounded-xl border border-gray-200 py-3 text-sm font-semibold dark:border-gray-800"
          onClick={resetAll}
          disabled={working}
        >
          Start Over
        </button>
      </section>

      {/* Result + Rendering */}
      {estimateReady ? (
        <section
          ref={resultsRef}
          className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Result</h2>

          <pre className="overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
            {JSON.stringify(result?.output ?? {}, null, 2)}
          </pre>

          {showRenderingBlock ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-base font-semibold text-gray-900 dark:text-gray-100">AI Rendering</div>
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    This is a second step after your estimate. It can take a moment.
                  </div>
                </div>

                <div className="text-xs text-gray-700 dark:text-gray-200">
                  {renderingEnabledForThis ? (
                    <>
                      Status:{" "}
                      <span className="font-semibold">
                        {renderStatus === "idle"
                          ? "Ready"
                          : renderStatus === "starting"
                          ? "Starting"
                          : renderStatus === "queued"
                          ? "Queued"
                          : renderStatus === "rendering"
                          ? "Rendering"
                          : renderStatus === "uploaded"
                          ? "Uploading"
                          : renderStatus === "done"
                          ? "Done"
                          : "Failed"}
                      </span>
                    </>
                  ) : (
                    <>Not requested</>
                  )}
                </div>
              </div>

              <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden dark:bg-gray-800">
                <div
                  className="h-full rounded-full bg-black transition-all duration-500 dark:bg-white"
                  style={{ width: `${Math.round(renderProgress * 100)}%` }}
                />
              </div>

              {renderingEnabledForThis ? (
                <div className="space-y-2">
                  {renderImageUrl ? (
                    <div className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={renderImageUrl} alt="AI render" className="w-full h-auto" />
                    </div>
                  ) : (
                    <div className="text-xs text-gray-700 dark:text-gray-200">
                      {renderStatus === "idle"
                        ? "Will start automatically after estimate."
                        : renderStatus === "queued"
                        ? "Queued — working on it…"
                        : renderStatus === "starting"
                        ? "Starting…"
                        : renderStatus === "failed"
                        ? "Failed."
                        : "Working…"}
                    </div>
                  )}

                  {renderStatus === "failed" && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                      {renderMessage ?? "Render failed."}
                      {renderDebugId ? `\ndebugId: ${renderDebugId}` : ""}
                    </div>
                  )}

                  {renderingEnabledForThis && estimateReady && quoteLogId && typeof quoteLogId === "string" ? (
                    <button
                      type="button"
                      className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
                      onClick={() => startRender({ tenantSlug, quoteLogId })}
                      disabled={renderStatus === "starting" || working}
                    >
                      Retry Render
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
