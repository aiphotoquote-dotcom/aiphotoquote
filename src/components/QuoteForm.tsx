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
  tenantId?: string;
  output?: any;
  estimate?: any;
  assessment?: any;
  render_opt_in?: boolean;
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

type RenderStatus =
  | "idle"
  | "queued"
  | "running"
  | "rendered"
  | "failed";

type RenderStatusResp =
  | { ok: true; quoteLogId: string; status: RenderStatus; imageUrl?: string | null; error?: string | null }
  | { ok: false; error: string; message?: string; status?: number };

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

  // local files + previews
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [shotTypes, setShotTypes] = useState<ShotType[]>([]); // same length as files

  // rendering opt-in (only if tenant allows)
  const [renderOptIn, setRenderOptIn] = useState(false);

  // submission lifecycle
  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<"idle" | "compressing" | "uploading" | "analyzing">("idle");

  // results
  const [result, setResult] = useState<any>(null);
  const [quoteLogId, setQuoteLogId] = useState<string | null>(null);

  // errors
  const [error, setError] = useState<string | null>(null);

  // rendering lifecycle (step 2)
  const [renderStatus, setRenderStatus] = useState<RenderStatus>("idle");
  const [renderImageUrl, setRenderImageUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // guard against multiple auto-renders per quote
  const renderAttemptedForQuoteRef = useRef<string | null>(null);

  // scroll to results
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const contactOk = useMemo(() => {
    const nOk = customerName.trim().length > 0;
    const eOk = isValidEmail(email);
    const pOk = digitsOnly(phone).length === 10;
    return nOk && eOk && pOk;
  }, [customerName, email, phone]);

  const canSubmit = useMemo(() => {
    return !working && files.length >= MIN_PHOTOS && contactOk;
  }, [working, files.length, contactOk]);

  useEffect(() => {
    if (!result) return;
    (async () => {
      await sleep(50);
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    })();
  }, [result]);

  useEffect(() => {
    // tenant disables -> force off
    if (!aiRenderingEnabled) setRenderOptIn(false);
  }, [aiRenderingEnabled]);

  function rebuildPreviews(nextFiles: File[]) {
    previews.forEach((p) => URL.revokeObjectURL(p));
    setPreviews(nextFiles.map((f) => URL.createObjectURL(f)));
  }

  function defaultShotTypeForIndex(idx: number): ShotType {
    if (idx === 0) return "wide";
    if (idx === 1) return "closeup";
    return "extra";
  }

  function addFiles(newOnes: File[]) {
    if (!newOnes.length) return;

    const combined = [...files, ...newOnes].slice(0, MAX_PHOTOS);

    // shot types: preserve existing, append defaults for new
    const nextShotTypes = [...shotTypes];
    while (nextShotTypes.length < combined.length) {
      nextShotTypes.push(defaultShotTypeForIndex(nextShotTypes.length));
    }

    setFiles(combined);
    setShotTypes(nextShotTypes.slice(0, combined.length));
    rebuildPreviews(combined);
  }

  function removeFileAt(idx: number) {
    const next = files.filter((_, i) => i !== idx);
    const nextShots = shotTypes.filter((_, i) => i !== idx);
    setFiles(next);
    setShotTypes(nextShots);
    rebuildPreviews(next);
  }

  function setShotTypeAt(idx: number, t: ShotType) {
    setShotTypes((prev) => prev.map((x, i) => (i === idx ? t : x)));
  }

  function startOver() {
    setError(null);
    setResult(null);
    setQuoteLogId(null);
    setNotes("");
    setCustomerName("");
    setEmail("");
    setPhone("");

    previews.forEach((p) => URL.revokeObjectURL(p));
    setPreviews([]);
    setFiles([]);
    setShotTypes([]);

    setWorking(false);
    setPhase("idle");

    setRenderStatus("idle");
    setRenderImageUrl(null);
    setRenderError(null);
    renderAttemptedForQuoteRef.current = null;

    if (!aiRenderingEnabled) setRenderOptIn(false);
  }

  async function uploadFiles(filesList: FileList) {
    const arr = Array.from(filesList ?? []);
    if (!arr.length) return;

    // Compress browser uploads to avoid 413 / huge payloads
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

      // convert urls to "virtual files" by fetching as blobs? NO — we keep them separate.
      // For this flow, we still need the *File* objects for /api/quote/submit (which expects urls).
      // So we store only local files + previews for UI, and we submit URLs later after upload.
      // ----
      // We keep it simple: after upload, we do NOT re-add as file objects; we just add preview cards
      // that reference *uploaded urls* as images, but we also keep the urls list for submit.
      //
      // To avoid rewriting everything, we re-use "files" state as local Files and keep a parallel
      // "uploadedUrls" list.
      //
      // ✅ Instead: we attach urls onto a hidden state: uploadedUrls in the same index order.
      addUploadedUrls(urls);
    } finally {
      setWorking(false);
      setPhase("idle");
    }
  }

  // uploaded urls aligned to images shown (same order as previews)
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);

  function addUploadedUrls(urls: string[]) {
    // Add a "card" per uploaded URL. We don’t have local File objects here (they were uploaded already),
    // so we push a placeholder File? No — we track urls and show them directly.
    // We also keep a lightweight preview list using the URL itself.
    setUploadedUrls((prev) => [...prev, ...urls].slice(0, MAX_PHOTOS));

    // For display, we append to previews using the actual remote url (no object URL).
    // But previews[] currently contains object URLs for camera-taken files.
    // We’ll treat previews as generic image src list.
    setPreviews((prev) => [...prev, ...urls].slice(0, MAX_PHOTOS));

    // For shot types, append defaults
    setShotTypes((prev) => {
      const next = [...prev];
      while (next.length < Math.min(MAX_PHOTOS, (previews.length + urls.length))) {
        next.push(defaultShotTypeForIndex(next.length));
      }
      return next.slice(0, MAX_PHOTOS);
    });

    // Also bump "files" count so validation works (we use files OR uploadedUrls for count)
    // We’ll keep files[] ONLY for camera captures (local). Upload button uses urls only.
  }

  const totalPhotosCount = useMemo(() => {
    // photos can be from camera (local files) OR upload (already uploaded urls)
    return Math.max(previews.length, uploadedUrls.length, files.length);
  }, [previews.length, uploadedUrls.length, files.length]);

  const effectiveShotTypes = useMemo(() => {
    // ensure shotTypes length matches previews length
    const n = previews.length;
    const out = [...shotTypes];
    while (out.length < n) out.push(defaultShotTypeForIndex(out.length));
    return out.slice(0, n);
  }, [shotTypes, previews.length]);

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
    if (renderStatus === "idle") return "Queued";
    if (renderStatus === "queued") return "Queued";
    if (renderStatus === "running") return "Rendering…";
    if (renderStatus === "rendered") return "Ready";
    if (renderStatus === "failed") return "Failed";
    return "Waiting";
  }, [aiRenderingEnabled, renderOptIn, quoteLogId, renderStatus]);

  async function submitEstimate() {
    setError(null);
    setResult(null);
    setQuoteLogId(null);

    setRenderStatus("idle");
    setRenderImageUrl(null);
    setRenderError(null);
    renderAttemptedForQuoteRef.current = null;

    if (!tenantSlug || typeof tenantSlug !== "string") {
      setError("Missing tenant slug. Please reload the page (invalid tenant link).");
      return;
    }

    const nPhotos = previews.length; // what we show
    if (nPhotos < MIN_PHOTOS) {
      setError(`Please add at least ${MIN_PHOTOS} photos for an accurate estimate.`);
      return;
    }
    if (nPhotos > MAX_PHOTOS) {
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
      // If some photos are still local camera Files, compress+upload them first
      // and merge with already-uploaded urls.
      let urls: string[] = [...uploadedUrls];

      if (files.length) {
        setPhase("compressing");
        const compressed = await Promise.all(files.map((f) => compressImage(f)));

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

      // Align shot types to urls order:
      // previews currently has BOTH remote urls and object urls; we want shot types in displayed order,
      // but submission needs urls. We’ll use the displayed shot types for the first N urls.
      const shots = effectiveShotTypes.slice(0, urls.length);

      setPhase("analyzing");

      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          images: urls.map((u, idx) => ({ url: u, shotType: shots[idx] ?? defaultShotTypeForIndex(idx) })),
          customer_context: {
            name: customerName.trim(),
            email: email.trim(),
            phone: digitsOnly(phone),
            notes,
            render_opt_in: aiRenderingEnabled ? Boolean(renderOptIn) : false,
          },
          render_opt_in: aiRenderingEnabled ? Boolean(renderOptIn) : false,
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
          ? `\nissues:\n${json.issues
              .map((i: any) => `- ${i.path?.join(".")}: ${i.message}`)
              .join("\n")}`
          : "";
        throw new Error(`Quote failed\nHTTP ${res.status}${dbg}${code}${msg}${issues}`.trim());
      }

      const qid = (json?.quoteLogId ?? null) as string | null;
      setQuoteLogId(qid);
      setResult(json?.output ?? json);

      // Once estimate is done, clear local camera files so we don't double-upload later
      if (files.length) {
        setFiles([]);
      }

      // If we uploaded local files during submit, update uploadedUrls so the UI stays consistent
      // (best-effort: keep what we submitted)
      setUploadedUrls(urls);

      // And ensure previews are remote urls (no object urls) after submit for consistency
      // (We cannot map old object urls to their final remote urls perfectly without more plumbing,
      // but after submit we can just show the submitted urls list.)
      previews.forEach((p) => {
        if (p.startsWith("blob:")) URL.revokeObjectURL(p);
      });
      setPreviews(urls);

      // Reset attempted guard for this NEW quote id
      renderAttemptedForQuoteRef.current = null;
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
      setPhase("idle");
    } finally {
      setWorking(false);
    }
  }

  async function startRenderOnce(qid: string) {
    // Idempotency guard client-side
    if (renderAttemptedForQuoteRef.current === qid) return;
    renderAttemptedForQuoteRef.current = qid;

    setRenderStatus("running");
    setRenderError(null);
    setRenderImageUrl(null);

    try {
      // Kick off render (server is idempotent; may immediately return "already_in_progress/final")
      await fetch("/api/render/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantSlug, quoteLogId: qid }),
      });

      // Poll status until rendered/failed (or timeout)
      const deadline = Date.now() + 120_000; // 2 min
      while (Date.now() < deadline) {
        const st = await fetch("/api/render/status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tenantSlug, quoteLogId: qid }),
        });

        const stJson: RenderStatusResp | any = await st.json().catch(() => null);

        if (stJson?.ok) {
          const status = String(stJson.status || "idle") as RenderStatus;
          setRenderStatus(status);

          if (status === "rendered") {
            const url = stJson.imageUrl ? String(stJson.imageUrl) : null;
            if (url) setRenderImageUrl(url);
            return;
          }

          if (status === "failed") {
            const msg = stJson.error ? String(stJson.error) : "Render failed";
            setRenderError(msg);
            return;
          }
        } else {
          // If status route fails, don't spam; just keep the render bar running and try again
        }

        await sleep(2000);
      }

      setRenderStatus("failed");
      setRenderError("Render timed out. Try again.");
    } catch (e: any) {
      setRenderStatus("failed");
      setRenderError(e?.message ?? "Render failed");
    }
  }

  // Auto-trigger render after estimate ONLY if tenant allows + customer opted in
  useEffect(() => {
    if (!aiRenderingEnabled) return;
    if (!renderOptIn) return;
    if (!quoteLogId) return;

    // only once per quote id
    if (renderAttemptedForQuoteRef.current === quoteLogId) return;

    // start
    startRenderOnce(quoteLogId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRenderingEnabled, renderOptIn, quoteLogId, tenantSlug]);

  async function retryRender() {
    if (!quoteLogId) return;
    // allow retry (reset guard)
    renderAttemptedForQuoteRef.current = null;
    await startRenderOnce(quoteLogId);
  }

  const hasEstimate = Boolean(result);

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="grid gap-3">
        <ProgressBar title="Working" label={workingLabel} active={working} />
        {aiRenderingEnabled ? (
          <ProgressBar
            title="AI Rendering"
            label={renderingLabel}
            active={renderStatus === "running" || renderStatus === "queued"}
          />
        ) : null}
      </div>

      {/* Photos */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Take 2 quick photos</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Take a wide shot, then a close-up. You can label each photo after it uploads. (max {MAX_PHOTOS})
          </p>
        </div>

        {/* Single Take Photo button + Upload Photos button */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <input
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={async (e) => {
                try {
                  const f = Array.from(e.target.files ?? []);
                  if (f.length) {
                    // camera returns local File(s). add to UI immediately.
                    addFiles(f);
                  }
                } catch (err: any) {
                  setError(err?.message ?? "Failed to add photo");
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

          <label className="block">
            <input
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={async (e) => {
                try {
                  if (e.target.files) {
                    // Upload flow: direct upload now, adds preview cards from remote urls
                    await uploadFiles(e.target.files);
                  }
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

        {previews.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {previews.map((src, idx) => {
              const st = effectiveShotTypes[idx] ?? defaultShotTypeForIndex(idx);
              const badge =
                st === "wide" ? "Wide shot" : st === "closeup" ? "Close-up" : "Extra";
              return (
                <div key={`${src}-${idx}`} className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`photo ${idx + 1}`} className="h-44 w-full object-cover" />
                    <div className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-xs font-semibold text-white">
                      {badge}
                    </div>
                    <button
                      type="button"
                      className="absolute top-2 right-2 rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-xs disabled:opacity-50 dark:bg-gray-900/90 dark:border-gray-800"
                      onClick={() => removeFileAt(idx)}
                      disabled={working}
                    >
                      Remove
                    </button>
                  </div>

                  {/* Label controls (the customer-friendly wide/close selectors) */}
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
          {totalPhotosCount >= MIN_PHOTOS
            ? `✅ ${totalPhotosCount} photo${totalPhotosCount === 1 ? "" : "s"} added`
            : `Add ${MIN_PHOTOS} photos (you have ${totalPhotosCount})`}
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
      {hasEstimate ? (
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
                    Status: {renderStatus}
                  </div>
                </div>

                <button
                  type="button"
                  className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
                  onClick={retryRender}
                  disabled={!quoteLogId || working || renderStatus === "running" || renderStatus === "queued"}
                >
                  Retry Render
                </button>
              </div>

              {renderError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                  {renderError}
                </div>
              ) : null}

              {renderImageUrl ? (
                <div className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={renderImageUrl} alt="AI rendering" className="w-full object-cover" />
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
