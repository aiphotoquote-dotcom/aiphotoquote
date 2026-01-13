"use client";

import React, { useMemo, useState } from "react";
import { upload } from "@vercel/blob/client";
import type { PutBlobResult } from "@vercel/blob";

type QuoteCategory = "auto" | "marine" | "motorcycle";

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6, 10);
  if (digits.length <= 3) return a;
  if (digits.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function QuoteDebugPage() {
  const [category, setCategory] = useState<QuoteCategory>("auto");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const tenantSlug =
    process.env.NEXT_PUBLIC_TENANT_SLUG?.trim() || "maggio-upholstery";

  const canSubmit = useMemo(() => {
    return (
      name.trim().length > 0 &&
      email.trim().length > 0 &&
      phone.replace(/\D/g, "").length === 10 &&
      files.length > 0 &&
      !loading
    );
  }, [name, email, phone, files, loading]);

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // 1) Upload photos to Vercel Blob
      const uploads: PutBlobResult[] = [];
      for (const f of files) {
        const blob = await upload(`quotes/${Date.now()}-${f.name}`, f, {
          access: "public",
          handleUploadUrl: "/api/blob/token",
        });
        uploads.push(blob);
      }

      const imageUrls = uploads.map((u) => u.url);

      // 2) Payload shape MUST match your /api/quote/submit schema
      const payload = {
        tenantSlug,
        images: imageUrls.map((url) => ({ url })),
        customer_context: {
          notes: notes.trim() || undefined,
          service_type: "quote",
          category,
        },
      };

      // 3) Call API and ALWAYS show raw response
      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const rawText = await res.text();

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { ok: false, error: "NON_JSON_RESPONSE", rawText };
      }

      if (!res.ok || !data?.ok) {
        const msg = [
          `HTTP ${res.status}`,
          data?.debugId ? `debugId: ${data.debugId}` : null,
          data?.error ? `error: ${data.error}` : null,
          data?.message ? `message: ${data.message}` : null,
          data?.type ? `type: ${data.type}` : null,
          data?.code ? `code: ${data.code}` : null,
          "",
          "Raw response:",
          rawText,
        ]
          .filter(Boolean)
          .join("\n");

        setError(msg);
        setLoading(false);
        return;
      }

      setResult(data);
      setLoading(false);
    } catch (e: any) {
      setError(`Client exception: ${e?.message ?? String(e)}`);
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-3">
        <h1 className="text-2xl font-semibold">AI Photo Quote (Debug)</h1>
        <p className="text-sm opacity-80">
          This page shows the exact API error. Tenant:{" "}
          <span className="font-mono">{tenantSlug}</span>
        </p>
      </div>

      <div className="rounded-lg border p-4 shadow-sm">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">Category</div>
            <div className="flex gap-2">
              {(["auto", "marine", "motorcycle"] as QuoteCategory[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cx(
                    "rounded-md border px-3 py-2 text-sm",
                    category === c
                      ? "bg-black text-white"
                      : "bg-white hover:bg-gray-50"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name *</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Email *</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Phone *</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                autoComplete="tel"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Photos *</label>
              <input
                className="w-full text-sm"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 12))}
              />
              <div className="text-xs opacity-70">Selected: {files.length}</div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Notes</label>
            <textarea
              className="w-full rounded-md border px-3 py-2 text-sm"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className={cx(
              "w-full rounded-md px-4 py-2 text-sm font-medium",
              canSubmit
                ? "bg-black text-white hover:opacity-90"
                : "cursor-not-allowed bg-gray-200 text-gray-500"
            )}
          >
            {loading ? "Working..." : "Get AI Estimate"}
          </button>

          {error ? (
            <pre className="whitespace-pre-wrap rounded-md border p-3 text-xs">
              {error}
            </pre>
          ) : null}

          {result ? (
            <pre className="whitespace-pre-wrap rounded-md border p-3 text-xs">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : null}
        </div>
      </div>
    </main>
  );
}
