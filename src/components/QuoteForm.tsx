"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ShotType = "wide" | "closeup" | "extra";

type UploadedImage = {
  url: string;
  shotType: ShotType;
};

type RenderState =
  | { status: "idle" }
  | { status: "queued" }
  | { status: "rendering" }
  | { status: "rendered"; imageUrl: string }
  | { status: "failed"; message: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

async function postJson<T>(url: string, body: any): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let j: any = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    const snippet = text?.slice(0, 200) ?? "";
    throw new Error(`Server returned non-JSON (HTTP ${res.status}). ${snippet}`.trim());
  }

  return { ok: res.ok, status: res.status, json: j };
}

function ProgressBar({
  labelLeft,
  labelRight,
  active,
}: {
  labelLeft: string;
  labelRight?: string;
  active: boolean;
}) {
  return (
    <div className="w-full rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{labelLeft}</div>
        {labelRight ? <div className="text-xs text-gray-700 dark:text-gray-200">{labelRight}</div> : null}
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
        <div
          className={cn(
            "h-full rounded-full bg-black transition-all duration-500 dark:bg-white",
            active ? "w-1/2 animate-pulse" : "w-full"
          )}
        />
      </div>
    </div>
  );
}

function ShotBadge({ t }: { t: ShotType }) {
  const label = t === "wide" ? "Wide shot" : t === "closeup" ? "Close-up" : "Extra";
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
      {label}
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

  const tenantAllowsRendering = Boolean(aiRenderingEnabled);

  // ----- form state -----
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [images, setImages] = useState<UploadedImage[]>([]);
  const [renderOptIn, setRenderOptIn] = useState(false);

  // ----- submit + progress -----
  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<"idle" | "compressing" | "uploading" | "analyzing">("idle");

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null); // holds /api/quote/submit response
  const quoteLogId: string | null = (result?.quoteLogId ?? null) as string | null;

  // ----- rendering -----
  const [renderState, setRenderState] = useState<RenderState>({ status: "idle" });
  const renderAttemptedForQuoteRef = useRef<string | null>(null);

  // If tenant disables rendering, force opt-in off
  useEffect(() => {
    if (!tenantAllowsRendering) setRenderOptIn(false);
  }, [tenantAllowsRendering]);

  const contactOk = useMemo(() => {
    const nOk = customerName.trim().length > 0;
    const eOk = isValidEmail(email);
    const pOk = digitsOnly(phone).length === 10;
    return nOk && eOk && pOk;
  }, [customerName, email, phone]);

  const canSubmit = useMemo(() => {
    return !working && images.length >= MIN_PHOTOS && contactOk;
  }, [working, images.length, contactOk]);

  // ----- helpers: image list -----
  function addUploadedUrl(url: string) {
    setImages((prev) => {
      const next = [...prev];
      if (next.find((x) => x.url === url)) return next;

      const idx = next.length;
      const shotType: ShotType = idx === 0 ? "wide" : idx === 1 ? "closeup" : "extra";
      next.push({ url, shotType });
      return next.slice(0, MAX_PHOTOS);
    });
  }

  function removeImage(url: string) {
    setImages((prev) => prev.filter((x) => x.url !== url));
  }

  function setShotType(url: string, shotType: ShotType) {
    setImages((prev) => prev.map((x) => (x.url === url ? { ...x, shotType } : x)));
  }

  // ----- upload (single photo at a time, compressed) -----
  async function uploadOne(file: File): Promise<string> {
    // compress client-side to avoid 413
    const compressed = await compressImage(file);

    const form = new FormData();
    form.append("files", compressed);

    const res = await fetch("/api/blob/upload", { method: "POST", body: form });
    const text = await res.text();

    let j: any = null;
    try {
      j = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Blob upload returned non-JSON (HTTP ${res.status}). ${text?.slice(0, 200) ?? ""}`.trim());
    }

    if (!res.ok || !j?.ok) {
      throw new Error(j?.error?.message || j?.message || "Blob upload failed");
    }

    const url: string | null =
      Array.isArray(j?.urls) && j.urls[0] ? String(j.urls[0]) :
      Array.isArray(j?.files) && j.files[0]?.url ? String(j.files[0].url) :
      null;

    if (!url) throw new Error("Blob upload returned no file url");
    return url;
  }

  async function onAddPhoto(file: File) {
    setError(null);

    if (images.length >= MAX_PHOTOS) {
      setError(`Please limit to ${MAX_PHOTOS} photos or fewer.`);
      return;
    }

    setWorking(true);
    try {
      setPhase("compressing");
      await sleep(50);

      setPhase("uploading");
      const url = await uploadOne(file);

      addUploadedUrl(url);
      setPhase("idle");
    } catch (e: any) {
      setPhase("idle");
      setError(e?.message ?? "Upload failed.");
    } finally {
      setWorking(false);
    }
  }

  // ----- submit estimate -----
  async function onSubmit() {
    setError(null);
    setResult(null);

    if (!tenantSlug || typeof tenantSlug !== "string") {
      setError("Missing tenant slug. Please reload the page (invalid tenant link).");
      return;
    }

    if (images.length < MIN_PHOTOS) {
      setError(`Please add at least ${MIN_PHOTOS} photos for an accurate estimate.`);
      return;
    }

    if (!contactOk) {
      setError("Please complete name, email, and a valid 10-digit phone number.");
      return;
    }

    setWorking(true);
    setPhase("analyzing");

    try {
      const payload = {
        tenantSlug,
        images: images.map((x) => ({ url: x.url })), // server expects {url}
        render_opt_in: tenantAllowsRendering ? Boolean(renderOptIn) : false, // ✅ top-level
        customer_context: {
          name: customerName.trim(),
          email: email.trim(),
          phone: digitsOnly(phone),
          notes: notes?.trim() || undefined,
          category: "service",
          service_type: "upholstery",
        },
      };

      const { ok, status, json } = await postJson<any>("/api/quote/submit", payload);

      if (!ok || !json?.ok) {
        const dbg = json?.debugId ? `\ndebugId: ${json.debugId}` : "";
        const code = json?.error ? `\ncode: ${json.error}` : "";
        const msg = json?.message ? `\nmessage: ${json.message}` : "";
        throw new Error(`Quote failed\nHTTP ${status}${dbg}${code}${msg}`.trim());
      }

      setResult(json);

      // reset render guard for this new quote
      renderAttemptedForQuoteRef.current = null;

      setPhase("idle");
    } catch (e: any) {
      setPhase("idle");
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setWorking(false);
    }
  }

  // ----- rendering: queue + poll -----
  async function pollRenderStatus(args: { tenantSlug: string; quoteLogId: string }) {
    const { tenantSlug: ts, quoteLogId: qid } = args;
    const started = Date.now();
    const timeoutMs = 3 * 60 * 1000; // 3 minutes
    const intervalMs = 3000;

    // We’ll show "rendering" while polling
    setRenderState({ status: "rendering" });

    while (Date.now() - started < timeoutMs) {
      await sleep(intervalMs);

      const { ok, status, json } = await postJson<any>("/api/render/status", { tenantSlug: ts, quoteLogId: qid });

      if (!ok) {
        // non-fatal: keep polling unless it’s clearly terminal
        const msg = json?.message || `Render status failed (HTTP ${status})`;
        // keep polling quietly; don’t flip to failed on transient errors
        continue;
      }

      // Expect status route to return something like:
      // { ok:true, status:"queued"|"running"|"rendered"|"failed", imageUrl?:string, error?:string }
      const st = String(json?.status ?? "");
      const imageUrl = (json?.imageUrl ?? json?.render_image_url ?? null) as string | null;

      if (st === "rendered" && imageUrl) {
        setRenderState({ status: "rendered", imageUrl });
        return;
      }

      if (st === "failed") {
        const msg = json?.error || json?.message || "Render failed";
        setRenderState({ status: "failed", message: String(msg) });
        return;
      }

      // else keep looping (queued/running/etc)
    }

    setRenderState({ status: "failed", message: "Render timed out. Please retry." });
  }

  async function triggerRendering(args: { tenantSlug: string; quoteLogId: string }) {
    setRenderState({ status: "queued" });

    // enqueue
    const { ok, status, json } = await postJson<any>("/api/render/start", {
      tenantSlug: args.tenantSlug,
      quoteLogId: args.quoteLogId,
    });

    if (!ok || !json?.ok) {
      const msg = json?.message || json?.error || `Render start failed (HTTP ${status})`;
      setRenderState({ status: "failed", message: String(msg) });
      return;
    }

    // If start returns an imageUrl immediately (rare), use it; otherwise poll.
    const immediateUrl = (json?.imageUrl ?? json?.url ?? null) as string | null;
    if (immediateUrl) {
      setRenderState({ status: "rendered", imageUrl: immediateUrl });
      return;
    }

    await pollRenderStatus(args);
  }

  useEffect(() => {
    const qid = quoteLogId;
    if (!qid) return;

    if (!tenantAllowsRendering || !renderOptIn) return;

    if (renderAttemptedForQuoteRef.current === qid) return;
    renderAttemptedForQuoteRef.current = qid;

    triggerRendering({ tenantSlug, quoteLogId: qid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteLogId, tenantAllowsRendering, renderOptIn, tenantSlug]);

  async function retryRender() {
    if (!quoteLogId) return;
    renderAttemptedForQuoteRef.current = quoteLogId;
    await triggerRendering({ tenantSlug, quoteLogId });
  }

  function startOver() {
    setError(null);
    setResult(null);
    setNotes("");
    setImages([]);
    setPhase("idle");
    setWorking(false);
    setRenderState({ status: "idle" });
    renderAttemptedForQuoteRef.current = null;
    if (!tenantAllowsRendering) setRenderOptIn(false);
  }

  // ----- labels -----
  const estimateReady = Boolean(result?.ok && result?.output);

  const progressRight = useMemo(() => {
    if (estimateReady) return "Estimate ready";
    if (working) {
      if (phase === "compressing") return "Optimizing photo…";
      if (phase === "uploading") return "Uploading…";
      if (phase === "analyzing") return "Working…";
      return "Working…";
    }
    return images.length >= MIN_PHOTOS ? "Ready to submit" : `Add ${MIN_PHOTOS} photos`;
  }, [estimateReady, working, phase, images.length]);

  const renderRight = useMemo(() => {
    if (!tenantAllowsRendering) return "Disabled";
    if (!renderOptIn) return "Off";
    if (!estimateReady) return "Waiting";

    if (renderState.status === "queued") return "Queued";
    if (renderState.status === "rendering") return "Rendering…";
    if (renderState.status === "rendered") return "Ready";
    if (renderState.status === "failed") return "Failed";
    return "Idle";
  }, [tenantAllowsRendering, renderOptIn, estimateReady, renderState.status]);

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="space-y-3">
        <ProgressBar labelLeft="Progress" labelRight={progressRight} active={working} />

        {tenantAllowsRendering ? (
          <ProgressBar
            labelLeft="AI Rendering"
            labelRight={renderRight}
            active={renderState.status === "rendering" || renderState.status === "queued"}
          />
        ) : null}
      </div>

      {/* Photos (single add-photo button + wide/close selector) */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Take 2 quick photos</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Start with a wide shot and a close-up. After each upload, select whether it’s wide or close-up.
          </p>
        </div>

        <label className="block">
          <input
            className="hidden"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={async (e) => {
              try {
                const f = e.target.files?.[0];
                if (f) await onAddPhoto(f);
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

        {images.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {images.map((img) => (
              <div key={img.url} className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="h-40 w-full object-cover" />

                  <div className="absolute left-2 top-2">
                    <ShotBadge t={img.shotType} />
                  </div>

                  <button
                    type="button"
                    className="absolute top-2 right-2 rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-xs disabled:opacity-50 dark:bg-gray-900/90 dark:border-gray-800"
                    onClick={() => removeImage(img.url)}
                    disabled={working}
                  >
                    Remove
                  </button>
                </div>

                <div className="p-3">
                  <div className="text-xs text-gray-700 dark:text-gray-200 mb-2 font-semibold">
                    What kind of shot is this?
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={cn(
                        "rounded-lg px-3 py-2 text-xs font-semibold border",
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
                        "rounded-lg px-3 py-2 text-xs font-semibold border",
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
                        "rounded-lg px-3 py-2 text-xs font-semibold border",
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

                  <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                    {images.length === 1
                      ? "Next: take a close-up."
                      : images.length === 2
                        ? "Great — you can submit now, or add more photos."
                        : "Optional: add more photos for accuracy."}
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

        {tenantAllowsRendering ? (
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
                  If selected, we may generate a visual “after” concept based on your photos. This happens after your estimate.
                </div>
              </label>
            </div>
          </div>
        ) : null}

        <button
          className="w-full rounded-xl bg-black text-white py-4 font-semibold disabled:opacity-50 dark:bg-white dark:text-black"
          onClick={onSubmit}
          disabled={!canSubmit}
        >
          {working && phase === "analyzing" ? "Working…" : "Get Estimate"}
        </button>

        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-xs font-semibold text-gray-700 underline underline-offset-4 dark:text-gray-200 disabled:opacity-50"
            onClick={startOver}
            disabled={working}
          >
            Start Over
          </button>

          <div className="text-xs text-gray-600 dark:text-gray-300">
            {images.length}/{MAX_PHOTOS} photos
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}
      </section>

      {/* Result + Render */}
      {estimateReady ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Result</h2>
          </div>

          <pre className="overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
            {JSON.stringify(result?.output ?? result, null, 2)}
          </pre>

          {tenantAllowsRendering && renderOptIn ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Rendering</div>
                <div className="text-xs text-gray-600 dark:text-gray-300">Status: {renderState.status}</div>
              </div>

              {renderState.status === "rendered" ? (
                <div className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={renderState.imageUrl} alt="AI render" className="w-full object-cover" />
                </div>
              ) : null}

              {renderState.status === "failed" ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                  {renderState.message}
                </div>
              ) : null}

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800 disabled:opacity-50"
                  onClick={retryRender}
                  disabled={!quoteLogId || working || renderState.status === "rendering" || renderState.status === "queued"}
                >
                  Retry Render
                </button>

                <div className="text-[11px] text-gray-600 dark:text-gray-300">
                  Rendering is a second step after estimate (no duplicate token burns).
                </div>
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
