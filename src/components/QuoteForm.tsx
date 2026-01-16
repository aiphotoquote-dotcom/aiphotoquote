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

function titleCase(s: string) {
  const v = String(s || "").trim();
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function asArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  return [];
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

function Pill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "green" | "yellow" | "red" | "blue";
}) {
  const cls =
    tone === "green"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
      : tone === "yellow"
        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200"
        : tone === "red"
          ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
          : tone === "blue"
            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
            : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
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

  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  // ✅ customer opt-in (tenant-enabled)
  const [renderOptIn, setRenderOptIn] = useState(false);

  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<"idle" | "compressing" | "uploading" | "analyzing">("idle");

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

      setPhase("uploading");
      const form = new FormData();
      compressed.forEach((f) => form.append("files", f));

      const up = await fetch("/api/blob/upload", { method: "POST", body: form });
      const upJson = await up.json();
      if (!upJson.ok) throw new Error(upJson.error?.message ?? "Upload failed");

      const urls: UploadedFile[] = upJson.files.map((x: any) => ({ url: x.url }));

      setPhase("analyzing");
      const res = await fetch("/api/quote/submit", {
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

      const json = await res.json();

      if (!json.ok) {
        const dbg = json?.debugId ? `\ndebugId: ${json.debugId}` : "";
        const code = json?.error ? `\ncode: ${json.error}` : "";
        const issues = json?.issues
          ? `\nissues:\n${json.issues
              .map((i: any) => `- ${i.path?.join(".")}: ${i.message}`)
              .join("\n")}`
          : "";
        const msg = json?.message ? `\nmessage: ${json.message}` : "";
        throw new Error(`Quote failed\nHTTP ${res.status}${dbg}${code}${msg}${issues}`.trim());
      }

      setResult(json);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong.");
      setPhase("idle");
    } finally {
      setWorking(false);
    }
  }

  const out = result?.output ?? null;

  const confidence = out?.confidence ? String(out.confidence) : "";
  const inspectionRequired = out?.inspection_required === true;
  const summary = out?.summary ? String(out.summary) : "";
  const questions = asArray(out?.questions);
  const estimate = out?.estimate ?? null;
  const renderRequested = out?.render_opt_in === true;

  const confidenceTone =
    confidence === "high" ? "green" : confidence === "medium" ? "yellow" : confidence === "low" ? "red" : "neutral";

  const card = "rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900";
  const inner = "rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950";
  const muted = "text-xs text-gray-600 dark:text-gray-300";
  const mono = "font-mono text-gray-900 dark:text-gray-100";

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs text-gray-600 dark:text-gray-300">Progress</div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{progressLabel}</div>
          </div>
          <div className="text-xs text-gray-700 dark:text-gray-200">{progressText}</div>
        </div>

        <div className="mt-3 h-2 w-full rounded-full bg-gray-200 overflow-hidden dark:bg-gray-800">
          <div
            className="h-full rounded-full bg-black transition-all duration-500 dark:bg-white"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>

      {/* Photos */}
      <section className={card}>
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Take 2 quick photos</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            These two shots give the best accuracy. Add more if you want (max {MAX_PHOTOS}).
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
          <div className="grid grid-cols-3 gap-3">
            {previews.map((src, idx) => (
              <div
                key={`${src}-${idx}`}
                className="relative rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`photo ${idx + 1}`} className="h-28 w-full object-cover" />
                <button
                  type="button"
                  className="absolute top-2 right-2 rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-xs disabled:opacity-50 dark:bg-gray-900/90 dark:border-gray-800"
                  onClick={() => removeFileAt(idx)}
                  disabled={working}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Details */}
      <section className={card}>
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
                  If selected, we may generate a visual “after” concept based on your photos. This happens as a second
                  step after your estimate.
                </div>
              </label>
            </div>
          </div>
        ) : null}

        <button
          className="w-full rounded-xl bg-black text-white py-4 font-semibold disabled:opacity-50 dark:bg-white dark:text-black"
          onClick={onSubmit}
          disabled={working || files.length < MIN_PHOTOS || !contactOk}
        >
          {working ? "Working…" : "Get Estimate"}
        </button>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}
      </section>

      {out ? (
        <section ref={resultsRef} className={card}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Your estimate</h2>
              <p className={muted}>This is a preliminary range based on photos. Final scope may require inspection.</p>
            </div>
            <button
              type="button"
              className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
              onClick={retake}
              disabled={working}
            >
              Start Over
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Pill
              label={confidence ? `Confidence: ${titleCase(confidence)}` : "Confidence: —"}
              tone={confidenceTone}
            />
            <Pill
              label={inspectionRequired ? "Inspection required" : "Inspection not required"}
              tone={inspectionRequired ? "yellow" : "green"}
            />
            {renderRequested ? <Pill label="Rendering requested" tone="blue" /> : null}
          </div>

          <div className={inner}>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Estimated range</div>
            {estimate && typeof estimate.low === "number" && typeof estimate.high === "number" ? (
              <div className="mt-2 flex items-baseline gap-2">
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {formatMoney(estimate.low)} – {formatMoney(estimate.high)}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300">(preliminary)</div>
              </div>
            ) : (
              <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                Pricing range not configured for this shop yet.
              </div>
            )}

            {renderRequested ? (
              <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
                Optional rendering will run as a second step after the estimate (if enabled by the shop).
              </div>
            ) : null}
          </div>

          <div className={inner}>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Summary</div>
            <div className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
              {summary || <span className="text-gray-500 dark:text-gray-400">(no summary)</span>}
            </div>
          </div>

          <div className={inner}>
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Questions to confirm</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">{questions.length ? `${questions.length}` : "0"}</div>
            </div>
            {questions.length ? (
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200 space-y-1">
                {questions.slice(0, 12).map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">No questions — looks straightforward.</div>
            )}
          </div>

          <details className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <summary className="cursor-pointer text-sm font-semibold text-gray-900 dark:text-gray-100">
              Debug JSON (for you)
            </summary>
            <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-white p-4 text-xs dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
              {JSON.stringify(out, null, 2)}
            </pre>
            <div className={`mt-2 ${muted}`}>
              quoteLogId: <span className={mono}>{String(result?.quoteLogId ?? "")}</span>
            </div>
          </details>
        </section>
      ) : null}
    </div>
  );
}
