"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type UploadedFile = { url: string };

function formatMoney(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

function normalizeUrl(u: string | null | undefined) {
  const s = String(u ?? "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s;
}

export default function QuoteForm({ tenantSlug }: { tenantSlug: string }) {
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "uploading" | "analyzing" | "finalizing"
  >("idle");

  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [autoRedirect, setAutoRedirect] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);

  const [preloadStarted, setPreloadStarted] = useState(false);
  const [preloadReady, setPreloadReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const redirectUrl = useMemo(
    () => normalizeUrl(result?.redirectUrl),
    [result?.redirectUrl]
  );

  const step = useMemo(() => {
    if (result?.output) return 3;
    if (files.length > 0) return 2;
    return 1;
  }, [files.length, result?.output]);

  function setSelectedFiles(next: File[]) {
    previews.forEach((p) => URL.revokeObjectURL(p));
    const nextPreviews = next.map((f) => URL.createObjectURL(f));
    setFiles(next);
    setPreviews(nextPreviews);
  }

  function removeFileAt(idx: number) {
    const next = files.filter((_, i) => i !== idx);
    setSelectedFiles(next);
  }

  // Start preloading redirect destination once we have a redirect URL + estimate
  useEffect(() => {
    if (!redirectUrl || !result?.output) return;
    if (!autoRedirect) return;

    setPreloadStarted(true);
    setPreloadReady(false);
  }, [redirectUrl, result?.output, autoRedirect]);

  // Countdown + redirect once estimate is ready
  useEffect(() => {
    if (!redirectUrl || !result?.output) return;
    if (!autoRedirect) return;

    setCountdown(8);

    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const remaining = 8 - elapsed;
      setCountdown(remaining);

      if (remaining <= 0) {
        clearInterval(timer);
        window.location.href = redirectUrl;
      }
    }, 250);

    return () => clearInterval(timer);
  }, [redirectUrl, result?.output, autoRedirect]);

  async function onSubmit() {
    setError(null);
    setResult(null);
    setCountdown(null);
    setPreloadStarted(false);
    setPreloadReady(false);

    if (!files.length) {
      setError("Please upload at least 1 photo.");
      return;
    }
    if (files.length > 12) {
      setError("Please limit to 12 photos or fewer.");
      return;
    }

    setWorking(true);

    try {
      setPhase("uploading");

      // 1) Upload images to Vercel Blob
      const form = new FormData();
      files.forEach((f) => form.append("files", f));

      const up = await fetch("/api/blob/upload", { method: "POST", body: form });
      const upJson = await up.json();
      if (!upJson.ok) throw new Error(upJson.error?.message ?? "Upload failed");

      const urls: UploadedFile[] = upJson.files.map((x: any) => ({ url: x.url }));

      // 2) Submit to quote engine
      setPhase("analyzing");

      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          images: urls,
          customer_context: {
            notes,
            customer: {
              name: name || undefined,
              email: email || undefined,
              phone: phone || undefined,
            },
          },
        }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? "Quote failed");

      // 3) Show estimate immediately (THIS is the “Maggio” behavior)
      setResult(json);

      // 4) While countdown runs, we “finalize” the UX and allow preload
      setPhase("finalizing");
    } catch (e: any) {
      setError(e.message ?? "Something went wrong.");
      setPhase("idle");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Step header */}
      <div className="flex items-center justify-between rounded-xl border p-4">
        <div className="space-y-1">
          <div className="text-xs text-gray-600">Step</div>
          <div className="text-sm font-semibold">
            {step === 1 && "1 / 3 — Upload photos"}
            {step === 2 && "2 / 3 — Add details"}
            {step === 3 && "3 / 3 — Your estimate"}
          </div>
          {working && (
            <div className="text-xs text-gray-600">
              {phase === "uploading" && "Uploading photos…"}
              {phase === "analyzing" && "Analyzing photos…"}
              {phase === "finalizing" && "Finalizing…"}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={autoRedirect}
            onChange={(e) => setAutoRedirect(e.target.checked)}
          />
          Auto-redirect after estimate
        </label>
      </div>

      {/* Upload */}
      <section className="rounded-2xl border p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Photos</h2>
            <p className="text-xs text-gray-600 mt-1">
              Best results: 1 wide shot + 1–2 close-ups + one from an angle.
            </p>
          </div>
          <div className="text-xs text-gray-600">Max 12</div>
        </div>

        <div className="rounded-xl border border-dashed p-4">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setSelectedFiles(Array.from(e.target.files ?? []))}
            disabled={working}
          />
          <p className="mt-2 text-xs text-gray-600">
            Your photos are used only to generate this estimate.
          </p>
        </div>

        {previews.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {previews.map((src, idx) => (
              <div key={src} className="relative rounded-xl border overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`preview ${idx + 1}`} className="h-28 w-full object-cover" />
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
        )}
      </section>

      {/* Details */}
      <section className="rounded-2xl border p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Details</h2>
          <p className="text-xs text-gray-600 mt-1">
            Helps estimate faster and reduces follow-up questions.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <label className="grid gap-1">
            <span className="text-xs text-gray-700">Name (optional)</span>
            <input
              className="border rounded-xl p-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Joe"
              disabled={working}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-gray-700">Email (optional)</span>
            <input
              className="border rounded-xl p-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              disabled={working}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-gray-700">Phone (optional)</span>
            <input
              className="border rounded-xl p-2 text-sm"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              disabled={working}
            />
          </label>
        </div>

        <label className="block">
          <div className="text-xs text-gray-700">Notes (optional)</div>
          <textarea
            className="mt-2 w-full rounded-xl border p-3 text-sm"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What are you looking to do? Material preference, timeline, constraints?"
            disabled={working}
          />
        </label>

        <div className="rounded-xl bg-gray-50 p-4 text-xs text-gray-700">
          <div className="font-semibold">Estimate disclaimer</div>
          <p className="mt-1">
            This is a photo-based estimate range. Final pricing can change after inspection,
            measurements, and material selection.
          </p>
        </div>

        <button
          className="w-full rounded-xl bg-black text-white py-3 disabled:opacity-50"
          onClick={onSubmit}
          disabled={working}
        >
          {working ? "Working..." : "Get Estimate"}
        </button>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap">
            {error}
          </div>
        )}
      </section>

      {/* Results appear immediately when ready */}
      {result?.output && (
        <section className="rounded-2xl border p-5 space-y-4">
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

          {/* Redirect + background preload like Maggio */}
          {redirectUrl ? (
            <div className="space-y-2">
              <div className="rounded-xl border p-4">
                <div className="text-sm font-semibold">Returning you to the website…</div>
                <p className="mt-1 text-xs text-gray-600">
                  We’re preparing the next page so it loads fast.
                </p>

                <div className="mt-3 flex items-center justify-between text-xs text-gray-700">
                  <span>
                    {preloadStarted
                      ? preloadReady
                        ? "✅ Page preloaded"
                        : "⏳ Preloading…"
                      : "⏳ Preparing…"}
                  </span>
                  {autoRedirect && countdown !== null && countdown > 0 && (
                    <span>
                      Redirecting in <b>{countdown}</b>…
                    </span>
                  )}
                </div>
              </div>

              <button
                className="w-full rounded-xl border py-3"
                onClick={() => (window.location.href = redirectUrl)}
              >
                Continue now
              </button>

              <p className="text-center text-xs text-gray-500">
                If you don’t want the auto redirect, uncheck it at the top.
              </p>

              {/* Hidden preload iframe (best-effort; may be blocked by target site headers) */}
              {autoRedirect && preloadStarted && (
                <iframe
                  ref={iframeRef}
                  src={redirectUrl}
                  onLoad={() => setPreloadReady(true)}
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    opacity: 0,
                    pointerEvents: "none",
                    left: -9999,
                    top: -9999,
                  }}
                  aria-hidden="true"
                />
              )}
            </div>
          ) : (
            <div className="rounded-xl bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
              Redirect isn’t configured for this tenant yet. (Set it in Onboarding → Redirect after quote.)
            </div>
          )}
        </section>
      )}
    </div>
  );
}
