"use client";

import { useState } from "react";

export default function QuoteForm({ tenantSlug }: { tenantSlug: string }) {
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    setResult(null);

    if (!files.length) {
      setError("Please upload at least 1 photo.");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));

      const up = await fetch("/api/blob/upload", { method: "POST", body: form });
      const upJson = await up.json();
      if (!upJson.ok) throw new Error(upJson.error?.message ?? "Upload failed");

      const urls = upJson.files.map((x: any) => ({ url: x.url }));

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
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <label className="block">
        <div className="text-sm font-medium">Photos</div>
        <div className="mt-2 rounded-xl border border-dashed p-4">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <p className="mt-2 text-xs text-gray-600">
            Tip: include one wide photo + a close-up of damage.
          </p>
        </div>
      </label>

      <label className="block">
        <div className="text-sm font-medium">Notes (optional)</div>
        <textarea
          className="mt-2 w-full rounded-xl border p-3"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Tell us what you want done, material preference, timeline, etc."
        />
      </label>

      <button
        className="w-full rounded-xl bg-black text-white py-3 disabled:opacity-50"
        onClick={onSubmit}
        disabled={uploading}
      >
        {uploading ? "Working..." : "Get Estimate"}
      </button>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result?.output && (
        <div className="rounded-2xl border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Estimate</h2>
            <span className="text-xs text-gray-600">
              Confidence: <b>{result.output.confidence}</b>
            </span>
          </div>

          <p className="text-sm">{result.output.summary}</p>

          <div className="rounded-xl bg-gray-50 p-4">
            <div className="text-sm font-medium">Estimated Price Range</div>
            <div className="mt-1 text-2xl font-semibold">
              ${result.output.estimate.low.toLocaleString()} – $
              {result.output.estimate.high.toLocaleString()}
            </div>
            {result.output.inspection_required && (
              <p className="mt-2 text-xs text-gray-600">
                Inspection required to confirm final pricing.
              </p>
            )}
          </div>

          {result.redirectUrl && (
            <button
              className="w-full rounded-xl border py-3"
              onClick={() => (window.location.href = result.redirectUrl)}
            >
              Continue
            </button>
          )}
        </div>
      )}
    </div>
  );
}
