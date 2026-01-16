"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type UploadedFile = { url: string };

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

/**
 * Compress an image file in-browser using canvas.
 * - Keeps aspect ratio
 * - Converts to JPEG
 * - Limits max dimension
 */
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

type QuoteFormProps = {
  tenantSlug?: string;
  aiRenderingEnabled?: boolean;
};

type NormalizedOutput = {
  confidence?: "high" | "medium" | "low" | string;
  inspection_required?: boolean;
  summary?: string;
  visible_scope?: string[];
  assumptions?: string[];
  questions?: string[];
  // until pricing is wired on the server, we won't assume estimate exists
};

function normalizeAssessmentToOutput(payload: any): NormalizedOutput | null {
  if (!payload) return null;

  // If server already returns output in the old shape:
  if (payload?.output && typeof payload.output === "object") return payload.output as any;

  // Current server route returns: { assessment: {...} }
  const a = payload?.assessment;

  if (!a) return null;

  // Sometimes assessment is nested or wrapped
  if (a?.assessment && typeof a.assessment === "object") return a.assessment as any;

  // If assessment is the object itself (expected today)
  if (typeof a === "object") return a as any;

  return null;
}

export default function QuoteForm({ tenantSlug, aiRenderingEnabled }: QuoteFormProps) {
  const MIN_PHOTOS = 2;
  const MAX_PHOTOS = 12;

  // Contact (required)
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<"idle" | "compressing" | "uploading" | "analyzing">("idle");

  // We store both the raw payload and a normalized output used for UI
  const [result, setResult] = useState<any>(null);

  const [error, setError] = useState<string | null>(null);

  const resultsRef = useRef<HTMLDivElement | null>(null);

  // ✅ Bulletproof slug resolution:
  // - Prefer prop
  // - Fallback to URL (/q/<slug>)
  const resolvedTenantSlug = useMemo(() => {
    const p = (tenantSlug || "").trim();
    if (p) return p;

    if (typeof window === "undefined") return "";

    const path = window.location.pathname || "";
    const parts = path.split("/").filter(Boolean);
    const qIdx = parts.indexOf("q");
    if (qIdx >= 0 && parts[qIdx + 1]) return parts[qIdx + 1];

    return "";
  }, [tenantSlug]);

  const contactOk = useMemo(() => {
    const nOk = customerName.trim().length > 0;
    const eOk = isValidEmail(email);
    const pOk = digitsOnly(phone).length === 10;
    return nOk && eOk && pOk;
  }, [customerName, email, phone]);

  const normalizedOutput: NormalizedOutput | null = useMemo(() => {
    return normalizeAssessmentToOutput(result);
  }, [result]);

  const step = useMemo(() => {
    if (normalizedOutput) return 3;
    if (files.length > 0) return 2;
    return 1;
  }, [files.length, normalizedOutput]);

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

    if (normalizedOutput) p = 1.0;

    return Math.max(0, Math.min(1, p));
  }, [step, working, phase, normalizedOutput]);

  const progressLabel = useMemo(() => {
    if (normalizedOutput) return "Assessment ready";
    if (working) {
      if (phase === "compressing") return "Optimizing photos…";
      if (phase === "uploading") return "Uploading…";
      if (phase === "analyzing") return "Analyzing…";
    }
    if (step === 1) return "Add photos";
    if (step === 2) return "Add details";
    return "Review";
  }, [normalizedOutput, working, phase, step]);

  const progressText = useMemo(() => {
    if (files.length >= MIN_PHOTOS) {
      const c = contactOk ? " • ✅ contact info" : " • add contact info";
      return `✅ ${files.length} photo${files.length === 1 ? "" : "s"} added${c}`;
    }
    return `Add ${MIN_PHOTOS} photos (you have ${files.length})`;
  }, [files.length, contactOk]);

  // Auto-scroll to results once it appears
  useEffect(() => {
    if (!normalizedOutput) return;
    (async () => {
      await sleep(50);
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    })();
  }, [normalizedOutput]);

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
    previews.forEach((p) => URL.revokeObjectURL(p));
    setPreviews([]);
    setFiles([]);
    setPhase("idle");
  }

  async function onSubmit() {
    setError(null);
    setResult(null);

    if (!resolvedTenantSlug) {
      setError(
        "Tenant link is missing a slug. Please reload from /admin (Public quote page) or open /q/<tenantSlug> directly."
      );
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

      setPhase("uploading");
      const form = new FormData();
      compressed.forEach((f) => form.append("files", f));

      const up = await fetch("/api/blob/upload", { method: "POST", body: form });
      const upJson = await up.json();
      if (!upJson.ok) throw new Error(upJson.error?.message ?? "Upload failed");

      const urls: UploadedFile[] = (upJson.files || [])
        .map((x: any) => ({ url: x?.url }))
        .filter((x: any) => typeof x.url === "string" && x.url.startsWith("http"));

      if (!urls.length) throw new Error("Upload succeeded but no public image URLs were returned.");

      setPhase("analyzing");
      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug: resolvedTenantSlug,
          images: urls,
          customer_context: {
            name: customerName.trim(),
            email: email.trim(),
            phone: digitsOnly(phone),
            notes,
          },
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        const parts = [
          "Quote failed",
          `HTTP ${res.status}`,
          json.debugId ? `debugId: ${json.debugId}` : null,
          json.error ? `code: ${json.error}` : null,
          json.message ? `message: ${json.message}` : null,
          json.issues ? `issues:\n${JSON.stringify(json.issues, null, 2)}` : null,
        ].filter(Boolean);

        throw new Error(parts.join("\n"));
      }

      // ✅ normalize so UI always has result.output-like data
      const out = normalizeAssessmentToOutput(json);
      if (!out) {
        // still show raw payload for debugging
        setResult(json);
        throw new Error("Server returned ok=true but no assessment/output was found in the response.");
      }

      setResult({ ...json, output: out });
    } catch (e: any) {
      setError(e.message ?? "Something went wrong.");
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
          <div className={`text-center ${step >= 2 ? "font-semibold text-gray-900" : ""}`}>Details</div>
          <div className={`text-right ${step >= 3 ? "font-semibold text-gray-900" : ""}`}>Result</div>
        </div>
      </div>

      {/* Guidance + capture */}
      <section className="rounded-2xl border p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Take 2 quick photos</h2>
          <p className="mt-1 text-xs text-gray-600">
            These two shots give the best accuracy. Add more if you want (max 12).
          </p>
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

        {/* Previews */}
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
                </div>
              ))}
            </div>
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

        <button
          className="w-full rounded-xl bg-black text-white py-4 font-semibold disabled:opacity-50"
          onClick={onSubmit}
          disabled={working || files.length < MIN_PHOTOS || !contactOk}
        >
          {working ? "Working…" : "Get Estimate"}
        </button>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap">
            {error}
          </div>
        )}

        {aiRenderingEnabled ? (
          <div className="text-xs text-gray-600">
            (Tenant has AI rendering enabled — customer opt-in will appear in the next step.)
          </div>
        ) : null}
      </section>

      {/* Results */}
      {normalizedOutput && (
        <section ref={resultsRef} className="rounded-2xl border p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Preliminary Assessment</h2>
            <div className="text-xs text-gray-600">
              Confidence: <b>{String(normalizedOutput.confidence || "—")}</b>
            </div>
          </div>

          {normalizedOutput.summary ? <p className="text-sm">{normalizedOutput.summary}</p> : null}

          {!!normalizedOutput.questions?.length && (
            <div className="rounded-xl border p-4">
              <div className="text-sm font-semibold">Quick questions</div>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
                {normalizedOutput.questions.slice(0, 8).map((x: string, i: number) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}

          {normalizedOutput.inspection_required ? (
            <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-700">
              Inspection recommended to confirm scope and pricing.
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="w-full rounded-xl border py-4 font-semibold"
              onClick={retake}
              disabled={working}
            >
              Retake / Start Over
            </button>

            <button
              type="button"
              className="w-full rounded-xl bg-black text-white py-4 font-semibold"
              onClick={onSubmit}
              disabled={working || !contactOk || files.length < MIN_PHOTOS}
            >
              Re-run with Updated Photos
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
