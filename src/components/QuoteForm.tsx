"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type ShotType = "wide" | "closeup" | "extra";

type QuoteApiOk = {
  ok: true;
  quoteLogId?: string;
  tenantId?: string;
  output?: any;
  estimate?: any;
  assessment?: any;
  render_opt_in?: boolean;
  debugId?: string;
};

type QuoteApiErr = {
  ok: false;
  error?: any;
  message?: string;
  issues?: any[];
  debugId?: string;
};

type QuoteApiResp = QuoteApiOk | QuoteApiErr;

type UploadOk = {
  ok: true;
  urls?: string[];
  files?: Array<{ url: string }>;
};

type UploadErr = {
  ok: false;
  error?: { message?: string };
  message?: string;
};

type UploadResp = UploadOk | UploadErr;

type RenderState =
  | { status: "idle" }
  | { status: "rendering" }
  | { status: "rendered"; imageUrl: string }
  | { status: "failed"; message: string };

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

function ProgressBar({
  title,
  label,
  active,
}: {
  title: string;
  label: string;
  active: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        <div className="text-xs text-gray-700 dark:text-gray-200">{label}</div>
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

export default function QuoteForm({
  tenantSlug,
  aiRenderingEnabled = false,
}: {
  tenantSlug: string;
  aiRenderingEnabled?: boolean;
}) {
  const MIN_PHOTOS = 2;
  const MAX_PHOTOS = 12;

  // contact + notes
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  // local camera files (not yet uploaded)
  const [cameraFiles, setCameraFiles] = useState<File[]>([]);

  // displayed previews (can be blob: object URLs or remote URLs)
  const [previews, setPreviews] = useState<string[]>([]);

  // uploaded URLs (remote), in display order
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);

  // shot types aligned to displayed photos (previews[])
  const [shotTypes, setShotTypes] = useState<ShotType[]>([]);

  // rendering opt-in
  const [renderOptIn, setRenderOptIn] = useState<boolean>(false);

  // submission lifecycle
  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<"idle" | "compressing" | "uploading" | "analyzing">("idle");

  // results
  const [result, setResult] = useState<any>(null);
  const [quoteLogId, setQuoteLogId] = useState<string | null>(null);

  // errors
  const [error, setError] = useState<string | null>(null);

  // render state (step 2)
  const [renderState, setRenderState] = useState<RenderState>({ status: "idle" });

  // guard against multiple auto-renders per quote
  const renderAttemptedForQuoteRef = useRef<string | null>(null);

  // scroll to results
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!result) return;
    (async () => {
      await sleep(50);
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    })();
  }, [result]);

  useEffect(() => {
    if (!aiRenderingEnabled) setRenderOptIn(false);
  }, [aiRenderingEnabled]);

  function defaultShotTypeForIndex(idx: number): ShotType {
    if (idx === 0) return "wide";
    if (idx === 1) return "closeup";
    return "extra";
  }

  function ensureShotTypesLen(n: number) {
    setShotTypes((prev) => {
      const out = [...prev];
      while (out.length < n) out.push(defaultShotTypeForIndex(out.length));
      return out.slice(0, n);
    });
  }

  function addCameraFiles(files: File[]) {
    if (!files.length) return;

    const nextPreviews = [...previews];
    for (const f of files) {
      if (nextPreviews.length >= MAX_PHOTOS) break;
      nextPreviews.push(URL.createObjectURL(f));
    }

    // keep camera file list (best-effort cap)
    const remainingSlots = Math.max(0, MAX_PHOTOS - uploadedUrls.length);
    const nextCamera = [...cameraFiles, ...files].slice(0, remainingSlots);

    setCameraFiles(nextCamera);
    setPreviews(nextPreviews.slice(0, MAX_PHOTOS));
    ensureShotTypesLen(Math.min(MAX_PHOTOS, nextPreviews.length));
  }

  function addUploadedUrls(urls: string[]) {
    if (!urls.length) return;

    const nextUploaded = [...uploadedUrls, ...urls].slice(0, MAX_PHOTOS);
    const nextPreviews = [...previews, ...urls].slice(0, MAX_PHOTOS);

    setUploadedUrls(nextUploaded);
    setPreviews(nextPreviews);
    ensureShotTypesLen(nextPreviews.length);
  }

  function removeAt(idx: number) {
    const src = previews[idx];

    if (src && src.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(src);
      } catch {}
    }

    const nextPreviews = previews.filter((_, i) => i !== idx);
    const nextShots = shotTypes.filter((_, i) => i !== idx);
    const nextUploaded = uploadedUrls.filter((u) => u !== src);

    // remove a camera file if we removed a blob preview
    if (src && src.startsWith("blob:")) {
      const blobIndex =
        previews.slice(0, idx + 1).filter((p) => p.startsWith("blob:")).length - 1;
      if (blobIndex >= 0) {
        setCameraFiles((prev) => prev.filter((_, i) => i !== blobIndex));
      }
    }

    setPreviews(nextPreviews);
    setShotTypes(nextShots);
    setUploadedUrls(nextUploaded);
    ensureShotTypesLen(nextPreviews.length);
  }

  function setShotTypeAt(idx: number, t: ShotType) {
    setShotTypes((prev) => prev.map((x, i) => (i === idx ? t : x)));
  }

  function startOver() {
    setError(null);
    setResult(null);
    setQuoteLogId(null);

    previews.forEach((p) => {
      if (p.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(p);
        } catch {}
      }
    });

    setPreviews([]);
    setUploadedUrls([]);
    setCameraFiles([]);
    setShotTypes([]);

    setWorking(false);
    setPhase("idle");

    setRenderState({ status: "idle" });
    renderAttemptedForQuoteRef.current = null;

    if (!aiRenderingEnabled) setRenderOptIn(false);
  }

  async function uploadFilesNow(filesList: FileList) {
    const arr = Array.from(filesList ?? []);
    if (!arr.length) return;

    setWorking(true);
    setPhase("compressing");

    try {
      const compressed = await Promise.all(arr.map((f) => compressImage(f)));
      setPhase("uploading");

      const form = new FormData();
      compressed.forEach((f) => form.append("files", f));

      const res = await fetch("/api/blob/upload", { method: "POST", body: form });
      const text = await res.text();

      let j: UploadResp | null = null;
      try {
        j = text ? (JSON.parse(text) as UploadResp) : null;
      } catch {
        throw new Error(`Upload returned non-JSON (HTTP ${res.status}).`);
      }

      if (!res.ok || !j || (j as any).ok !== true) {
        const msg =
          (j as any)?.error?.message ||
          (j as any)?.message ||
          `Blob upload failed (HTTP ${res.status})`;
        throw new Error(msg);
      }

      const urls: string[] = Array.isArray((j as UploadOk).urls)
        ? ((j as UploadOk).urls as any[]).map((x) => String(x)).filter(Boolean)
        : Array.isArray((j as UploadOk).files)
          ? ((j as UploadOk).files as any[]).map((x) => String(x?.url)).filter(Boolean)
          : [];

      if (!urls.length) throw new Error("Blob upload returned no file urls.");

      addUploadedUrls(urls);
    } finally {
      setWorking(false);
      setPhase("idle");
    }
  }

  const effectiveShotTypes = useMemo(() => {
    const n = previews.length;
    const out = [...shotTypes];
    while (out.length < n) out.push(defaultShotTypeForIndex(out.length));
    return out.slice(0, n);
  }, [shotTypes, previews.length]);

  const contactOk = useMemo(() => {
    const nOk = customerName.trim().length > 0;
    const eOk = isValidEmail(email);
    const pOk = digitsOnly(phone).length === 10;
    return nOk && eOk && pOk;
  }, [customerName, email, phone]);

  const canSubmit = useMemo(() => {
    return !working && previews.length >= MIN_PHOTOS && contactOk;
  }, [working, previews.length, contactOk]);

  const workingLabel = useMemo(() => {
    if (!working) return "Ready";
    if (phase === "compressing") return "Optimizing photos…";
    if (phase === "uploading") return "Uploading…";
    if (phase === "analyzing") return "Analyzing…";
    return "Working…";
  }, [working, phase]);

  const renderingLabel = useMemo(() => {
    if (!aiRenderingEnabled) return "Disabled";
    if (!renderOptIn) return "Off";
    if (!quoteLogId) return "Waiting";
    if (renderState.status === "idle") return "Queued";
    if (renderState.status === "rendering") return "Rendering…";
    if (renderState.status === "rendered") return "Ready";
    if (renderState.status === "failed") return "Failed";
    return "Waiting";
  }, [aiRenderingEnabled, renderOptIn, quoteLogId, renderState.status]);

  async function submitEstimate() {
    setError(null);
    setResult(null);
    setQuoteLogId(null);
    setRenderState({ status: "idle" });
    renderAttemptedForQuoteRef.current = null;

    if (!tenantSlug || typeof tenantSlug !== "string") {
      setError("Missing tenant slug. Please reload the page (invalid tenant link).");
      return;
    }

    if (previews.length < MIN_PHOTOS) {
      setError(`Please add at least ${MIN_PHOTOS} photos for an accurate estimate.`);
      return;
    }

    if (!customerName.trim()) return setError("Please enter your name.");
    if (!isValidEmail(email)) return setError("Please enter a valid email address.");
    if (digitsOnly(phone).length !== 10) return setError("Please enter a valid 10-digit phone number.");

    setWorking(true);

    try {
      // Upload any camera photos first, then merge with already-uploaded urls
      let urls: string[] = [...uploadedUrls];

      if (cameraFiles.length) {
        setPhase("compressing");
        const compressed = await Promise.all(cameraFiles.map((f) => compressImage(f)));

        setPhase("uploading");
        const form = new FormData();
        compressed.forEach((f) => form.append("files", f));

        const up = await fetch("/api/blob/upload", { method: "POST", body: form });
        const upText = await up.text();

        let upJson: UploadResp | null = null;
        try {
          upJson = upText ? (JSON.parse(upText) as UploadResp) : null;
        } catch {
          throw new Error(`Upload returned non-JSON (HTTP ${up.status}).`);
        }

        if (!up.ok || !upJson || (upJson as any).ok !== true) {
          const msg =
            (upJson as any)?.error?.message ||
            (upJson as any)?.message ||
            `Blob upload failed (HTTP ${up.status})`;
          throw new Error(msg);
        }

        const newUrls: string[] = Array.isArray((upJson as UploadOk).urls)
          ? ((upJson as UploadOk).urls as any[]).map((x) => String(x)).filter(Boolean)
          : Array.isArray((upJson as UploadOk).files)
            ? ((upJson as UploadOk).files as any[]).map((x) => String(x?.url)).filter(Boolean)
            : [];

        if (!newUrls.length) throw new Error("Blob upload returned no file urls.");

        urls = [...urls, ...newUrls].slice(0, MAX_PHOTOS);
      }

      if (!urls.length) throw new Error("No uploaded image URLs available. Please try again.");

      setPhase("analyzing");

      const renderOpt = aiRenderingEnabled ? Boolean(renderOptIn) : false;

      // IMPORTANT: match submit schema and ALSO store opt-in in a place render route reads later.
      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          images: urls.map((u) => ({ url: u })), // server expects only {url}
          render_opt_in: renderOpt, // top-level (we will add this to submit route schema)
          customer_context: {
            name: customerName.trim(),
            email: email.trim(),
            phone: digitsOnly(phone),
            notes: notes?.trim() || undefined,
            category: "service",
            service_type: "upholstery",
          },
        }),
      });

      const text = await res.text();
      let json: QuoteApiResp | any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Server returned non-JSON (HTTP ${res.status}).`);
      }

      if (!json?.ok) {
        const dbg = json?.debugId ? `\ndebugId: ${json.debugId}` : "";
        const code = json?.error ? `\ncode: ${json.error}` : "";
        const msg = json?.message ? `\nmessage: ${json.message}` : "";
        const issues = json?.issues
          ? `\nissues:\n${json.issues.map((i: any) => `- ${i.path?.join(".")}: ${i.message}`).join("\n")}`
          : "";
        throw new Error(`Quote failed\nHTTP ${res.status}${dbg}${code}${msg}${issues}`.trim());
      }

      const qid = (json?.quoteLogId ?? null) as string | null;
      setQuoteLogId(qid);
      setResult(json?.output ?? json?.assessment ?? json);

      // normalize UI to remote URLs
      previews.forEach((p) => {
        if (p.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(p);
          } catch {}
        }
      });

      setUploadedUrls(urls);
      setPreviews(urls);
      setCameraFiles([]);
      ensureShotTypesLen(urls.length);

      renderAttemptedForQuoteRef.current = null;
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setWorking(false);
      setPhase("idle");
    }
  }

  async function triggerRenderOnce(qid: string) {
    if (renderAttemptedForQuoteRef.current === qid) return;
    renderAttemptedForQuoteRef.current = qid;

    setRenderState({ status: "rendering" });

    try {
      // IMPORTANT: your actual route is /api/quote/render
      const res = await fetch("/api/quote/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantSlug, quoteLogId: qid }),
      });

      const text = await res.text();
      let j: any = null;
      try {
        j = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Render returned non-JSON (HTTP ${res.status}).`);
      }

      if (!res.ok || !j?.ok) {
        const msg = j?.message || j?.error || "Render failed";
        throw new Error(msg);
      }

      const imageUrl = (j?.imageUrl ?? j?.url ?? null) as string | null;
      if (!imageUrl) throw new Error("Render completed but no imageUrl returned.");

      setRenderState({ status: "rendered", imageUrl });
    } catch (e: any) {
      setRenderState({
        status: "failed",
        message: e?.message ? String(e.message) : "Render failed",
      });
    }
  }

  // Auto-trigger render after estimate ONLY if tenant allows + customer opted in
  useEffect(() => {
    if (!aiRenderingEnabled) return;
    if (!renderOptIn) return;
    if (!quoteLogId) return;

    if (renderAttemptedForQuoteRef.current === quoteLogId) return;
    triggerRenderOnce(quoteLogId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRenderingEnabled, renderOptIn, quoteLogId, tenantSlug]);

  async function retryRender() {
    if (!quoteLogId) return;
    renderAttemptedForQuoteRef.current = null;
    await triggerRenderOnce(quoteLogId);
  }

  const hasEstimate = Boolean(result);

  return (
    <div className="space-y-6">
      <div className="grid gap-3">
        <ProgressBar title="Working" label={workingLabel} active={working} />
        {aiRenderingEnabled ? (
          <ProgressBar
            title="AI Rendering"
            label={renderingLabel}
            active={renderState.status === "rendering"}
          />
        ) : null}
      </div>

      {/* Photos */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Take 2 quick photos</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Take a wide shot, then a close-up. Label each photo after you add it. (max {MAX_PHOTOS})
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <input
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                try {
                  const f = Array.from(e.target.files ?? []);
                  if (f.length) addCameraFiles(f);
                } finally {
                  e.currentTarget.value = "";
                }
              }}
              disabled={working || previews.length >= MAX_PHOTOS}
            />
            <div className="w-full rounded-xl bg-black text-white py-4 text-center font-semibold cursor-pointer select-none dark:bg-white dark:text-black">
              Take Photo
            </div>
          </label>

          <label className="block">
            <input
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={async (e) => {
                try {
                  if (e.target.files) await uploadFilesNow(e.target.files);
                } catch (err: any) {
                  setError(err?.message ?? "Upload failed");
                } finally {
                  e.currentTarget.value = "";
                }
              }}
              disabled={working || previews.length >= MAX_PHOTOS}
            />
            <div className="w-full rounded-xl border border-gray-200 py-4 text-center font-semibold cursor-pointer select-none dark:border-gray-800">
              Upload Photos
            </div>
          </label>
        </div>

        {previews.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {previews.map((src, idx) => {
              const st = effectiveShotTypes[idx] ?? defaultShotTypeForIndex(idx);
              const badge = st === "wide" ? "Wide shot" : st === "closeup" ? "Close-up" : "Extra";
              return (
                <div
                  key={`${src}-${idx}`}
                  className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800"
                >
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`photo ${idx + 1}`} className="h-44 w-full object-cover" />
                    <div className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-xs font-semibold text-white">
                      {badge}
                    </div>
                    <button
                      type="button"
                      className="absolute top-2 right-2 rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-xs disabled:opacity-50 dark:bg-gray-900/90 dark:border-gray-800"
                      onClick={() => removeAt(idx)}
                      disabled={working}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="p-3 flex flex-wrap items-center gap-2">
                    <div className="text-xs text-gray-600 dark:text-gray-300 mr-1">Label:</div>
                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-semibold border",
                        st === "wide"
                          ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                          : "bg-white text-gray-900 border-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
                      )}
                      onClick={() => setShotTypeAt(idx, "wide")}
                      disabled={working}
                    >
                      Wide
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-semibold border",
                        st === "closeup"
                          ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                          : "bg-white text-gray-900 border-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
                      )}
                      onClick={() => setShotTypeAt(idx, "closeup")}
                      disabled={working}
                    >
                      Close-up
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-semibold border",
                        st === "extra"
                          ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                          : "bg-white text-gray-900 border-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
                      )}
                      onClick={() => setShotTypeAt(idx, "extra")}
                      disabled={working}
                    >
                      Extra
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
            No photos yet. Take a wide shot first, then a close-up.
          </div>
        )}

        <div className="text-xs text-gray-600 dark:text-gray-300">
          {previews.length >= MIN_PHOTOS
            ? `✅ ${previews.length} photo${previews.length === 1 ? "" : "s"} added`
            : `Add ${MIN_PHOTOS} photos (you have ${previews.length})`}
        </div>
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
          disabled={!canSubmit}
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

      {/* Results */}
      {result ? (
        <section
          ref={resultsRef}
          className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Result</h2>
            {quoteLogId ? (
              <div className="text-xs text-gray-600 dark:text-gray-300">Quote ID: {quoteLogId}</div>
            ) : null}
          </div>

          <pre className="overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
            {JSON.stringify(result, null, 2)}
          </pre>

          {aiRenderingEnabled && renderOptIn ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Rendering</div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    Status: {renderState.status}
                  </div>
                </div>

                <button
                  type="button"
                  className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
                  onClick={retryRender}
                  disabled={!quoteLogId || working || renderState.status === "rendering"}
                >
                  Retry Render
                </button>
              </div>

              {renderState.status === "failed" ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                  {renderState.message}
                </div>
              ) : null}

              {renderState.status === "rendered" ? (
                <div className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={renderState.imageUrl} alt="AI rendering" className="w-full object-cover" />
                </div>
              ) : null}
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
