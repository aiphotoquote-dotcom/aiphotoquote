"use client";

import { useMemo, useState } from "react";

type UploadedFile = { url: string };

function formatMoney(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

export default function QuoteForm({ tenantSlug }: { tenantSlug: string }) {
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "analyzing">("idle");

  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const step = useMemo(() => {
    if (result?.output) return 3;
    if (files.length > 0) return 2;
    return 1;
  }, [files.length, result?.output]);

  function rebuildPreviews(nextFiles: File[]) {
    previews.forEach((p) => URL.revokeObjectURL(p));
    setPreviews(nextFiles.map((f) => URL.createObjectURL(f)));
  }

  function addFiles(newOnes: File[]) {
    if (!newOnes.length) return;

    const combined = [...files, ...newOnes].slice(0, 12);
    setFiles(combined);
    rebuildPreviews(combined);
  }

  function removeFileAt(idx: number) {
    const next = files.filter((_, i) => i !== idx);
    setFiles(next);
    rebuildPreviews(next);
  }

  async function onSubmit() {
    setError(null);
    setResult(null);

    if (!files.length) {
      setError("Please add at least 1 photo.");
      return;
    }
    if (files.length > 12) {
      setError("Please limit to 12 photos or fewer.");
      return;
    }

    setWorking(true);

    try {
      setPhase("uploading");

      // 1) upload to blob
      const form = new FormData();
      files.forEach((f) => form.append("files", f));

      const up = await fetch("/api/blob/upload", { method: "POST", body: form });
      const upJson = await up.json();
      if (!upJson.ok) throw new Error(upJson.error?.message ?? "Upload failed");

      const urls: UploadedFile[] = upJson.files.map((x: any) => ({ url: x.url }));

      // 2) submit for quote
      setPhase("analyzing");

      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          images: urls,
          customer_context: { notes },
        }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? "Quote failed");

      setResult(json);
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
      <div className="rounded-xl border p-4">
        <div className="text-xs text-gray-600">Step</div>
        <div className="text-sm font-semibold">
          {step === 1 && "1 / 3 — Add photos"}
          {step === 2 && "2 / 3 — Add details"}
          {step === 3 && "3 / 3 — Your estimate"}
        </div>
        {working && (
          <div className="mt-1 text-xs text-gray-600">
            {phase === "uploading" && "Uploading photos…"}
            {phase === "analyzing" && "Analyzing photos…"}
          </div>
        )}
      </div>

      {/* Photos */}
      <section className="rounded-2xl border p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Photos</h2>
          <p className="mt-1 text-xs text-gray-600">
            Best results: 1 wide shot + 1–2 close-ups + one from an angle. Max 12.
          </p>
        </div>

        {/* Mobile-first capture buttons */}
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

        {previews.length > 0 && (
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
        )}

        {files.length > 0 && (
          <div className="text-xs text-gray-600">
            Added <b>{files.length}</b> photo{files.length === 1 ? "" : "s"}.
          </div>
        )}
      </section>

      {/* Details */}
      <section className="rounded-2xl border p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Details (optional)</h2>
          <p className="mt-1 text-xs text-gray-600">
            A sentence or two helps us estimate faster.
          </p>
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
          disabled={working || files.length === 0}
        >
          {working ? "Working…" : "Get Estimate"}
        </button>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap">
            {error}
          </div>
        )}
      </section>

      {/* Results */}
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
        </section>
      )}
    </div>
  );
}
