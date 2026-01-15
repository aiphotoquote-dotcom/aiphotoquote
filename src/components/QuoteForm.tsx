"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type UploadedFile = { url: string };

function formatMoney(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

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

/**
 * Read a fetch Response safely:
 * - If JSON, return parsed JSON
 * - If not JSON, return text
 */
async function readResponse(res: Response): Promise<{
  ok: boolean;
  status: number;
  contentType: string;
  json: any | null;
  text: string | null;
}> {
  const status = res.status;
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (isJson) {
    const j = await res.json().catch(() => null);
    return { ok: res.ok, status, contentType, json: j, text: null };
  }

  const t = await res.text().catch(() => "");
  return { ok: res.ok, status, contentType, json: null, text: t || "" };
}

function buildUserError(args: {
  stage: "upload" | "quote";
  r: { ok: boolean; status: number; contentType: string; json: any | null; text: string | null };
}) {
  const { stage, r } = args;

  // JSON errors from our API
  if (r.json) {
    const debugId = r.json?.debugId || r.json?.xDebugId || null;
    const code = r.json?.error || "UNKNOWN_ERROR";
    const msg =
      r.json?.message ||
      r.json?.error?.message ||
      r.json?.error_message ||
      null;

    const details =
      r.json?.dbErr?.message ||
      r.json?.error?.detail ||
      null;

    return [
      stage === "upload" ? "Upload failed" : "Quote failed",
      `HTTP ${r.status}`,
      debugId ? `debugId: ${debugId}` : null,
      msg ? `message: ${msg}` : null,
      details ? `details: ${details}` : null,
      `code: ${code}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Non-JSON (HTML / plain text) -> show snippet
  const snippet = (r.text || "").slice(0, 240).trim();
  return [
    stage === "upload" ? "Upload failed" : "Quote failed",
    `HTTP ${r.status}`,
    `content-type: ${r.contentType || "(none)"}`,
    snippet ? `body: ${snippet}` : null,
  ]
    .filter(Boolean)
    .join("\n");
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

  // Contact (required)
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  // Customer opt-in for rendering (only shown if tenant enabled)
  const [renderOptIn, setRenderOptIn] = useState(false);

  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<"idle" | "compressing" | "uploading" | "analyzing">(
    "idle"
  );

  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const resultsRef = useRef<HTMLDivElement | null>(null);

  const contactOk = useMemo(() => {
    const nOk = customerName.trim().length > 0;
    const eOk = isValidEmail(email);
    const pOk = digitsOnly(phone).length === 10;
    return nOk && eOk && pOk;
  }, [customerName, email, phone]);

  const step = useMemo(() => {
    if (result?.output) return 3;
    if (files.length > 0) return 2;
    return 1;
  }, [files.length, result?.output]);

  const progress = useMemo(() => {
    let p = 0.15;
    if (step === 1) p = 0.25;
    if (step === 2) p = 0.55;
    if (step === 3) p = 0.85;

    if (working) {
      if (phase === "compressing") p = 0.62;
      if (phase === "uploading") p = 0.72;
      if (phase === "analyzing") p = 0.82;
    }

    if (result?.output) p = 1.0;

    return Math.max(0, Math.min(1, p));
  }, [step, working, phase, result?.output]);

  const progressLabel = useMemo(() => {
    if (result?.output) return "Estimate ready";
    if (working) {
      if (phase === "compressing") return "Optimizing photos…";
      if (phase === "uploading") return "Uploading…";
      if (phase === "analyzing") return "Analyzing…";
    }
    if (step === 1) return "Add photos";
    if (step === 2) return "Add details";
    return "Review estimate";
  }, [result?.output, working, phase, step]);

  const progressText = useMemo(() => {
    if (files.length >= MIN_PHOTOS) {
      const c = contactOk ? " • ✅ contact info" : " • add contact info";
      return `✅ ${files.length} photo${files.length === 1 ? "" : "s"} added${c}`;
    }
    return `Add ${MIN_PHOTOS} photos (you have ${files.length})`;
  }, [files.length, contactOk]);

  useEffect(() => {
    if (!result?.output) return;
    (async () => {
      await sleep(50);
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    })();
  }, [result?.output]);

  function rebuildPreviews(nextFiles: File[]) {
    previews.forEach((p) => URL.revokeObjectURL(p));
    setPreviews(nextFiles.map((f) => URL.createObjectURL(f)));
  }

  function addFiles(newOnes: File[]) {
    if (!newOnes.length) return;
    const combined = [...files, ...newOnes].slice(0, MAX_PHOTOS);
    setFiles(combined);
    rebuildPreviews(combined);
  }

  function removeFileAt(idx: number) {
    const next = files.filter((_, i) => i !== idx);
    setFiles(next);
    rebuildPreviews(next);
  }

  function retake() {
    setError(null);
    setResult(null);
    setNotes("");
    setRenderOptIn(false);
    previews.forEach((p) => URL.revokeObjectURL(p));
    setPreviews([]);
    setFiles([]);
    setPhase("idle");
  }

  async function onSubmit() {
    setError(null);
    setResult(null);

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

      setPhase("uploading");
      const form = new FormData();
      compressed.forEach((f) => form.append("files", f));

      const upRes = await fetch("/api/blob/upload", { method: "POST", body: form });
      const up = await readResponse(upRes);

      if (!up.ok || !up.json?.ok) {
        throw new Error(buildUserError({ stage: "upload", r: up }));
      }

      const urls: UploadedFile[] = up.json.files.map((x: any) => ({ url: x.url }));

      setPhase("analyzing");
      const qRes = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          images: urls,
          render_opt_in: aiRenderingEnabled ? Boolean(renderOptIn) : false,
          customer_context: {
            name: customerName.trim(),
            email: email.trim(),
            phone: digitsOnly(phone),
            notes,
          },
        }),
      });

      const q = await readResponse(qRes);

      if (!q.ok || !q.json?.ok) {
        throw new Error(buildUserError({ stage: "quote", r: q }));
      }

      setResult(q.json);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
      setPhase("idle");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="rounded-xl border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs text-gray-600">Progress</div>
            <div className="text-sm font-semibold">{progressLabel}</div>
          </div>
          <div className="text-xs text-gray-700">{progressText}</div>
        </div>

        <div className="mt-3 h-2 w-full rounded-full bg-gray-200 overflow-hidden">
          <div
            className="h-full rounded-full bg-black transition-all duration-500"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>

        <div className="mt-3 grid grid-cols-3 text-xs text-gray-600">
          <div className={step >= 1 ? "font-semibold text-gray-900" : ""}>Photos</div>
          <div className={`text-center ${step >= 2 ? "font-semibold text-gray-900" : ""}`}>
            Details
          </div>
          <div className={`text-right ${step >= 3 ? "font-semibold text-gray-900" : ""}`}>
            Estimate
          </div>
        </div>
      </div>

      {/* Pre-photos hint */}
      {files.length === 0 && (
        <div className="rounded-2xl border p-5">
          <div className="text-sm font-semibold">Fastest way (phone)</div>
          <p className="mt-1 text-sm text-gray-700">
            Tap <b>Take Photo</b> twice:
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
            <li>One wide shot (full seat/cushion/panel)</li>
            <li>One close-up (damage/stitching/material texture)</li>
          </ul>
          <p className="mt-3 text-xs text-gray-600">
            Add a third photo from an angle if you can — it improves accuracy.
          </p>
        </div>
      )}

      {/* Guidance + capture */}
      <section className="rounded-2xl border p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Take 2 quick photos</h2>
          <p className="mt-1 text-xs text-gray-600">
            These two shots give the best accuracy. Add more if you want (max {MAX_PHOTOS}).
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">1) Wide shot</div>
            <p className="mt-1 text-xs text-gray-600">
              Step back. Capture the full seat/cushion/panel.
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">2) Close-up</div>
            <p className="mt-1 text-xs text-gray-600">
              Get the damage/stitching/material texture clearly.
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <div className="text-sm font-semibold">Optional: Angle</div>
            <p className="mt-1 text-xs text-gray-600">
              Helps estimate seam complexity + foam condition.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="sr-only">Take photo</span>
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
            <div className="w-full rounded-xl bg-black text-white py-4 text-center font-semibold cursor-pointer select-none">
              Take Photo (Camera)
            </div>
          </label>

          <label className="block">
            <span className="sr-only">Upload photos</span>
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
            <div className="w-full rounded-xl border py-4 text-center font-semibold cursor-pointer select-none">
              Upload Photos
            </div>
          </label>
        </div>

        <div className="rounded-xl bg-gray-50 p-4 text-sm">
          <div className="font-semibold">Checklist</div>
          <ul className="mt-2 space-y-1 text-gray-700">
            <li>{files.length >= 1 ? "✅" : "⬜️"} Wide shot added</li>
            <li>{files.length >= 2 ? "✅" : "⬜️"} Close-up added</li>
            <li className="text-xs text-gray-600 pt-1">
              Tip: If you’re unsure, take one extra angle photo.
            </li>
          </ul>
        </div>

        {previews.length > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {previews.map((src, idx) => (
                <div key={`${src}-${idx}`} className="relative rounded-xl border overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`photo ${idx + 1}`} className="h-28 w-full object-cover" />
                  <button
                    type="button"
                    className="absolute top-2 right-2 rounded-md bg-white/90 border px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() => removeFileAt(idx)}
                    disabled={working}
                  >
                    Remove
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[11px] px-2 py-1">
                    Photo {idx + 1}
                  </div>
                </div>
              ))}
            </div>

            {files.length < MAX_PHOTOS && (
              <div className="text-center text-xs text-gray-600">
                Want better accuracy? Add one more photo from a different angle.
              </div>
            )}
          </div>
        )}
      </section>

      {/* Details */}
      <section className="rounded-2xl border p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Your info</h2>
          <p className="mt-1 text-xs text-gray-600">
            Required so we can send your estimate and follow up if needed.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="text-xs text-gray-700">
              Name <span className="text-red-600">*</span>
            </div>
            <input
              className="mt-2 w-full rounded-xl border p-3 text-sm"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Your name"
              disabled={working}
              autoComplete="name"
            />
          </label>

          <label className="block">
            <div className="text-xs text-gray-700">
              Email <span className="text-red-600">*</span>
            </div>
            <input
              className="mt-2 w-full rounded-xl border p-3 text-sm"
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
          <div className="text-xs text-gray-700">
            Phone <span className="text-red-600">*</span>
          </div>
          <input
            className="mt-2 w-full rounded-xl border p-3 text-sm"
            value={phone}
            onChange={(e) => setPhone(formatUSPhone(e.target.value))}
            placeholder="(555) 555-5555"
            disabled={working}
            inputMode="tel"
            autoComplete="tel"
          />
          <p className="mt-1 text-xs text-gray-600">We’ll only use this for your quote request.</p>
        </label>

        <div className="pt-2">
          <h3 className="text-sm font-semibold">Details (optional)</h3>
          <p className="mt-1 text-xs text-gray-600">One sentence helps us estimate faster.</p>
        </div>

        <label className="block">
          <div className="text-xs text-gray-700">Notes</div>
          <textarea
            className="mt-2 w-full rounded-xl border p-3 text-sm"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What are you looking to do? Material preference, timeline, constraints?"
            disabled={working}
          />
        </label>

        {aiRenderingEnabled ? (
          <label className="flex items-start gap-3 rounded-xl border p-4">
            <input
              type="checkbox"
              className="mt-1"
              checked={renderOptIn}
              onChange={(e) => setRenderOptIn(e.target.checked)}
              disabled={working}
            />
            <div>
              <div className="text-sm font-semibold">Optional: AI concept rendering</div>
              <div className="text-xs text-gray-600">
                If available, we can generate a concept image of the finished result after review.
              </div>
            </div>
          </label>
        ) : null}

        <div className="rounded-xl bg-gray-50 p-4 text-xs text-gray-700">
          <div className="font-semibold">Estimate disclaimer</div>
          <p className="mt-1">
            This is a photo-based estimate range. Final pricing can change after inspection,
            measurements, and material selection.
          </p>
        </div>

        <button
          className="w-full rounded-xl bg-black text-white py-4 font-semibold disabled:opacity-50"
          onClick={onSubmit}
          disabled={working || files.length < MIN_PHOTOS || !contactOk}
        >
          {working ? "Working…" : "Get Estimate"}
        </button>

        {files.length < MIN_PHOTOS && (
          <p className="text-center text-xs text-gray-600">
            Add at least <b>{MIN_PHOTOS}</b> photos to unlock estimate.
          </p>
        )}

        {files.length >= MIN_PHOTOS && !contactOk && (
          <p className="text-center text-xs text-gray-600">
            Please complete <b>Name</b>, <b>Email</b>, and <b>Phone</b> to submit.
          </p>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap">
            {error}
          </div>
        )}
      </section>

      {/* Results */}
      {result?.output && (
        <section ref={resultsRef} className="rounded-2xl border p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Your Estimate</h2>
            <div className="text-xs text-gray-600">
              Confidence: <b>{result.output.confidence}</b>
            </div>
          </div>

          <div className="rounded-xl bg-gray-50 p-4">
            <div className="text-sm font-medium">Estimated Price Range</div>
            <div className="mt-1 text-2xl font-semibold">
              {formatMoney(result.output.estimate.low)} – {formatMoney(result.output.estimate.high)}
            </div>
            {result.output.inspection_required && (
              <p className="mt-2 text-xs text-gray-600">
                Inspection recommended to confirm scope and pricing.
              </p>
            )}
          </div>

          <p className="text-sm">{result.output.summary}</p>

          {!!result.output.questions?.length && (
            <div className="rounded-xl border p-4">
              <div className="text-sm font-semibold">Quick questions</div>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
                {result.output.questions.slice(0, 6).map((x: string, i: number) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="sr-only">Add another photo</span>
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
                disabled={working || files.length >= MAX_PHOTOS}
              />
              <div className="w-full rounded-xl border py-4 text-center font-semibold cursor-pointer select-none">
                Add Another Photo
              </div>
            </label>

            <button
              type="button"
              className="w-full rounded-xl bg-black text-white py-4 font-semibold"
              onClick={retake}
              disabled={working}
            >
              Retake / Start Over
            </button>
          </div>

          {files.length >= MIN_PHOTOS && files.length <= MAX_PHOTOS && (
            <button
              type="button"
              className="w-full rounded-xl border py-4 font-semibold"
              onClick={onSubmit}
              disabled={working || !contactOk}
            >
              Re-run Estimate with Updated Photos
            </button>
          )}

          <p className="text-center text-xs text-gray-600">
            Tip: Add a new angle photo, then click <b>Re-run</b> for better accuracy.
          </p>
        </section>
      )}
    </div>
  );
}
