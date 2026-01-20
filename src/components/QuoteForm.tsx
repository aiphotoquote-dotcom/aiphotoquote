// src/components/QuoteForm.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ShotType = "wide" | "closeup" | "extra";

type PhotoItem = {
  id: string;
  shotType: ShotType;

  // Always used for UI preview (<img src=...>)
  previewSrc: string;

  // If photo already lives in Blob (Upload Photos OR previously uploaded camera photo)
  uploadedUrl?: string;

  // If photo is from camera capture and not yet uploaded
  file?: File;
};

type RenderStatus = "idle" | "running" | "rendered" | "failed";

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
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </div>
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

function defaultShotTypeForIndex(idx: number): ShotType {
  if (idx === 0) return "wide";
  if (idx === 1) return "closeup";
  return "extra";
}

function shotBadge(t: ShotType) {
  return t === "wide" ? "Wide shot" : t === "closeup" ? "Close-up" : "Extra";
}

async function uploadToBlob(files: File[]): Promise<string[]> {
  if (!files.length) return [];
  const form = new FormData();
  files.forEach((f) => form.append("files", f));

  const res = await fetch("/api/blob/upload", { method: "POST", body: form });
  const text = await res.text();

  let j: any = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Upload returned non-JSON (HTTP ${res.status}).`);
  }

  if (!res.ok || !j?.ok) {
    throw new Error(
      j?.error?.message ||
        j?.message ||
        `Blob upload failed (HTTP ${res.status})`
    );
  }

  const urls: string[] = Array.isArray(j?.urls)
    ? j.urls.map((x: any) => String(x)).filter(Boolean)
    : Array.isArray(j?.files)
      ? j.files.map((x: any) => String(x?.url)).filter(Boolean)
      : [];

  if (!urls.length) throw new Error("Blob upload returned no file urls.");
  return urls;
}

export default function QuoteForm({
  tenantSlug,
  aiRenderingEnabled = false,
}: {
  tenantSlug: string;
  aiRenderingEnabled?: boolean;
}) {
  // ✅ Allow submit with 1 photo, encourage 2–6
  const MIN_PHOTOS = 1;
  const MAX_PHOTOS = 12;

  // contact + notes
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  // photos unified (camera + uploaded)
  const [photos, setPhotos] = useState<PhotoItem[]>([]);

  // rendering opt-in (only if tenant allows)
  const [renderOptIn, setRenderOptIn] = useState(false);

  // submission lifecycle
  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "compressing" | "uploading" | "analyzing"
  >("idle");

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

  // cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      photos.forEach((p) => {
        if (p.previewSrc.startsWith("blob:")) URL.revokeObjectURL(p.previewSrc);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const photoCount = photos.length;

  const contactOk = useMemo(() => {
    const nOk = customerName.trim().length > 0;
    const eOk = isValidEmail(email);
    const pOk = digitsOnly(phone).length === 10;
    return nOk && eOk && pOk;
  }, [customerName, email, phone]);

  const canSubmit = useMemo(() => {
    return !working && photoCount >= MIN_PHOTOS && contactOk;
  }, [working, photoCount, contactOk]);

  const disabledReason = useMemo(() => {
    if (working) return "Working…";
    if (photoCount < MIN_PHOTOS) return `Add at least ${MIN_PHOTOS} photo.`;
    if (!customerName.trim()) return "Enter your name.";
    if (!isValidEmail(email)) return "Enter a valid email.";
    if (digitsOnly(phone).length !== 10) return "Enter a valid 10-digit phone.";
    return null;
  }, [working, photoCount, customerName, email, phone]);

  const workingLabel = useMemo(() => {
    if (!working) return "Ready";
    if (phase === "compressing") return "Optimizing photos…";
    if (phase === "uploading") return "Uploading photos…";
    if (phase === "analyzing") return "Inspecting + estimating…";
    return "Working…";
  }, [working, phase]);

  const renderingLabel = useMemo(() => {
    if (!aiRenderingEnabled) return "Disabled";
    if (!renderOptIn) return "Off";
    if (!quoteLogId) return "Waiting";
    if (renderStatus === "idle") return "Queued";
    if (renderStatus === "running") return "Rendering…";
    if (renderStatus === "rendered") return "Ready";
    if (renderStatus === "failed") return "Failed";
    return "Waiting";
  }, [aiRenderingEnabled, renderOptIn, quoteLogId, renderStatus]);

  const addCameraFiles = useCallback((files: File[]) => {
    if (!files.length) return;

    setPhotos((prev) => {
      const next = [...prev];
      for (const f of files) {
        if (next.length >= MAX_PHOTOS) break;

        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const previewSrc = URL.createObjectURL(f);
        const shotType = defaultShotTypeForIndex(next.length);

        next.push({ id, shotType, previewSrc, file: f });
      }
      return next;
    });
  }, []);

  const addUploadedUrls = useCallback((urls: string[]) => {
    if (!urls.length) return;

    setPhotos((prev) => {
      const next = [...prev];
      for (const u of urls) {
        if (!u) continue;
        if (next.length >= MAX_PHOTOS) break;

        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const shotType = defaultShotTypeForIndex(next.length);

        next.push({ id, shotType, previewSrc: u, uploadedUrl: u });
      }
      return next;
    });
  }, []);

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p?.previewSrc?.startsWith("blob:")) URL.revokeObjectURL(p.previewSrc);
      const next = prev.filter((x) => x.id !== id);

      // Re-normalize shot types for first 2 positions
      return next.map((x, idx) => ({
        ...x,
        shotType: idx === 0 ? "wide" : idx === 1 ? "closeup" : x.shotType,
      }));
    });
  }, []);

  const setShotType = useCallback((id: string, shotType: ShotType) => {
    setPhotos((prev) => prev.map((x) => (x.id === id ? { ...x, shotType } : x)));
  }, []);

  function startOver() {
    setError(null);
    setResult(null);
    setQuoteLogId(null);
    setNotes("");
    setCustomerName("");
    setEmail("");
    setPhone("");

    setPhotos((prev) => {
      prev.forEach((p) => {
        if (p.previewSrc.startsWith("blob:")) URL.revokeObjectURL(p.previewSrc);
      });
      return [];
    });

    setWorking(false);
    setPhase("idle");

    setRenderStatus("idle");
    setRenderImageUrl(null);
    setRenderError(null);
    renderAttemptedForQuoteRef.current = null;

    if (!aiRenderingEnabled) setRenderOptIn(false);
  }

  async function uploadPhotosNow(filesList: FileList) {
    const arr = Array.from(filesList ?? []);
    if (!arr.length) return;

    setWorking(true);
    setPhase("compressing");

    try {
      const compressed = await Promise.all(arr.map((f) => compressImage(f)));
      setPhase("uploading");
      const urls = await uploadToBlob(compressed);
      addUploadedUrls(urls);
    } finally {
      setWorking(false);
      setPhase("idle");
    }
  }

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

    if (photos.length < MIN_PHOTOS) {
      setError(`Please add at least ${MIN_PHOTOS} photo for an accurate estimate.`);
      return;
    }
    if (photos.length > MAX_PHOTOS) {
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
      // IMPORTANT: work with a local copy so we don't depend on React async state timing
      let workingPhotos: PhotoItem[] = [...photos];

      // 1) Ensure every photo has an uploadedUrl (upload camera files if needed)
      const needUpload = workingPhotos.filter((p) => !p.uploadedUrl && p.file);
      if (needUpload.length) {
        setPhase("compressing");
        const compressed = await Promise.all(
          needUpload.map((p) => compressImage(p.file!))
        );

        setPhase("uploading");
        const urls = await uploadToBlob(compressed);

        const byId = new Map<string, string>();
        needUpload.forEach((p, idx) => {
          const u = urls[idx];
          if (u) byId.set(p.id, u);
        });

        workingPhotos = workingPhotos.map((p) => {
          const u = byId.get(p.id);
          if (!u) return p;

          if (p.previewSrc.startsWith("blob:")) URL.revokeObjectURL(p.previewSrc);

          return {
            ...p,
            uploadedUrl: u,
            previewSrc: u,
            file: undefined,
          };
        });

        // sync UI state too
        setPhotos(workingPhotos);
      }

      // 2) Verify uploads complete
      const urls = workingPhotos.map((p) => p.uploadedUrl).filter(Boolean) as string[];
      if (urls.length !== workingPhotos.length) {
        throw new Error("Some photos are not uploaded yet. Please try again.");
      }

      setPhase("analyzing");

      // 3) Submit (API expects `customer`)
      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          images: workingPhotos.map((p) => ({
            url: p.uploadedUrl!,
            shotType: p.shotType,
          })),
          customer: {
            name: customerName.trim(),
            email: email.trim(),
            phone: digitsOnly(phone),
          },
          customer_context: {
            notes: notes?.trim() || undefined,
            category: "service",
            service_type: "upholstery",
          },
          render_opt_in: aiRenderingEnabled ? Boolean(renderOptIn) : false,
        }),
      });

      const text = await res.text();
      let json: any = null;
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

      const qid = (json?.quoteLogId ?? json?.quoteId ?? json?.id ?? null) as string | null;
      setQuoteLogId(qid);
      setResult(json?.output ?? json);

      renderAttemptedForQuoteRef.current = null;
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
      setPhase("idle");
    } finally {
      setWorking(false);
      setPhase("idle");
    }
  }

  async function startRenderOnce(qid: string) {
    if (renderAttemptedForQuoteRef.current === qid) return;
    renderAttemptedForQuoteRef.current = qid;

    setRenderStatus("running");
    setRenderError(null);
    setRenderImageUrl(null);

    try {
      const res = await fetch("/api/quote/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantSlug, quoteLogId: qid }),
      });

      const txt = await res.text();
      let j: any = null;
      try {
        j = txt ? JSON.parse(txt) : null;
      } catch {
        throw new Error(`Render returned non-JSON (HTTP ${res.status}).`);
      }

      if (!res.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || `Render failed (HTTP ${res.status})`);
      }

      const url = (j?.imageUrl ?? j?.render_image_url ?? j?.url ?? null) as string | null;
      if (!url) throw new Error("Render completed but no imageUrl returned.");

      setRenderImageUrl(url);
      setRenderStatus("rendered");
    } catch (e: any) {
      setRenderStatus("failed");
      setRenderError(e?.message ?? "Render failed");
    }
  }

  useEffect(() => {
    if (!aiRenderingEnabled) return;
    if (!renderOptIn) return;
    if (!quoteLogId) return;
    if (renderAttemptedForQuoteRef.current === quoteLogId) return;

    startRenderOnce(quoteLogId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRenderingEnabled, renderOptIn, quoteLogId, tenantSlug]);

  async function retryRender() {
    if (!quoteLogId) return;
    renderAttemptedForQuoteRef.current = null;
    await startRenderOnce(quoteLogId);
  }

  const hasEstimate = Boolean(result);

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="grid gap-3">
        <ProgressBar title="Progress" label={workingLabel} active={working} />
        {aiRenderingEnabled ? (
          <ProgressBar
            title="AI Rendering"
            label={renderingLabel}
            active={renderStatus === "running"}
          />
        ) : null}

        <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
          <div className="font-semibold text-gray-900 dark:text-gray-100">
            What happens next
          </div>
          <div className="mt-2 grid gap-1">
            <div>• Uploading photos</div>
            <div>• Inspecting details</div>
            <div>• Building estimate</div>
            <div>• Sending results</div>
            {aiRenderingEnabled ? <div>• Optional: rendering preview</div> : null}
          </div>
        </div>
      </div>

      {/* Photos */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Photos</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            You can submit with <span className="font-semibold">1 photo</span>, but{" "}
            <span className="font-semibold">2–6 photos is best</span> (wide + close-up). (max {MAX_PHOTOS})
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Take Photo */}
          <label className="block">
            <input
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={async (e) => {
                try {
                  const f = Array.from(e.target.files ?? []);
                  if (f.length) addCameraFiles(f);
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

          {/* Upload Photos */}
          <label className="block">
            <input
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={async (e) => {
                try {
                  if (e.target.files) await uploadPhotosNow(e.target.files);
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

        {photos.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {photos.map((p, idx) => {
              const badge = shotBadge(p.shotType);
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800"
                >
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.previewSrc}
                      alt={`photo ${idx + 1}`}
                      className="h-44 w-full object-cover"
                    />
                    <div className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-xs font-semibold text-white">
                      {badge}
                    </div>
                    <button
                      type="button"
                      className="absolute top-2 right-2 rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-xs disabled:opacity-50 dark:bg-gray-900/90 dark:border-gray-800"
                      onClick={() => removePhoto(p.id)}
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
                        p.shotType === "wide"
                          ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                          : "bg-white text-gray-900 border-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
                      )}
                      onClick={() => setShotType(p.id, "wide")}
                      disabled={working}
                    >
                      Wide
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-semibold border",
                        p.shotType === "closeup"
                          ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                          : "bg-white text-gray-900 border-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
                      )}
                      onClick={() => setShotType(p.id, "closeup")}
                      disabled={working}
                    >
                      Close-up
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-semibold border",
                        p.shotType === "extra"
                          ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                          : "bg-white text-gray-900 border-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
                      )}
                      onClick={() => setShotType(p.id, "extra")}
                      disabled={working}
                    >
                      Extra
                    </button>

                    {!p.uploadedUrl && p.file ? (
                      <span className="ml-auto text-[11px] text-gray-500 dark:text-gray-300">
                        Camera photo (uploads on submit)
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
            No photos yet. Add one to enable submit (2–6 is best).
          </div>
        )}

        <div className="text-xs text-gray-600 dark:text-gray-300">
          {photoCount >= MIN_PHOTOS ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>{`✅ ${photoCount} photo${photoCount === 1 ? "" : "s"} added`}</span>
              {photoCount < 2 ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
                  Add 1 more for best accuracy
                </span>
              ) : null}
            </div>
          ) : (
            `Add at least ${MIN_PHOTOS} photo (you have ${photoCount})`
          )}
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
          {working ? "Working…" : "Get AI Estimate"}
        </button>

        {disabledReason ? (
          <div className="text-xs text-gray-600 dark:text-gray-300">{disabledReason}</div>
        ) : null}

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
              <div className="text-xs text-gray-600 dark:text-gray-300">
                Quote ID: {quoteLogId}
              </div>
            ) : null}
          </div>

          <pre className="overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100">
            {JSON.stringify(result, null, 2)}
          </pre>

          {aiRenderingEnabled && renderOptIn ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    AI Rendering
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    Status: {renderStatus}
                  </div>
                </div>

                <button
                  type="button"
                  className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
                  onClick={retryRender}
                  disabled={!quoteLogId || working || renderStatus === "running"}
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
                  <img
                    src={renderImageUrl}
                    alt="AI rendering"
                    className="w-full object-cover"
                  />
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
