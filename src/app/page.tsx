"use client";

import React, { useMemo, useState } from "react";
import { upload } from "@vercel/blob/client";
import type { PutBlobResult } from "@vercel/blob";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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

export default function QuotePage() {
  const [category, setCategory] = useState<QuoteCategory>("auto");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Prefer env, but give a safe default so you don't get "Invalid request" from missing slug.
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
      // 1) Upload all selected files to Blob
      const uploads: PutBlobResult[] = [];
      for (const f of files) {
        // NOTE: upload() needs a token endpoint in your app (/api/blob/token).
        const blob = await upload(
          `quotes/${Date.now()}-${f.name}`,
          f,
          {
            access: "public",
            handleUploadUrl: "/api/blob/token",
          }
        );
        uploads.push(blob);
      }

      const imageUrls = uploads.map((u) => u.url);

      // 2) Build payload EXACTLY as your Zod schema expects
      const payload = {
        tenantSlug,
        images: imageUrls.map((url) => ({ url })),
        customer_context: {
          notes: notes.trim() || undefined,
          service_type: "quote",
          category,
          // (optional) you can also pass name/email/phone here if you want,
          // but keep it stable with your backend schema for now.
        },
      };

      // 3) Call your quote submit endpoint
      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // 4) ALWAYS read raw text first so we never lose the real error
      const rawText = await res.text();

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { ok: false, error: "NON_JSON_RESPONSE", rawText };
      }

      if (!res.ok || !data?.ok) {
        console.error("QUOTE_SUBMIT_FAILED", {
          httpStatus: res.status,
          data,
          rawText,
          payload,
        });

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
      console.error("QUOTE_CLIENT_EXCEPTION", e);
      setError(`Client exception: ${e?.message ?? String(e)}`);
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">AI Photo Quote</h1>
        <p className="text-sm opacity-80">
          Upload photos and get an estimate. (Tenant: <span className="font-mono">{tenantSlug}</span>)
        </p>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Category</label>
            <div className="flex gap-2">
              {(["auto", "marine", "motorcycle"] as QuoteCategory[]).map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant={category === c ? "default" : "outline"}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </Button>
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
                placeholder="Your name"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Email *</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Phone * (required)</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                autoComplete="tel"
                placeholder="(555) 555-5555"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Photos * (1–12)</label>
              <input
                className="w-full text-sm"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const list = Array.from(e.target.files || []);
                  setFiles(list.slice(0, 12));
                }}
              />
              <div className="text-xs opacity-70">
                Selected: {files.length}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Notes</label>
            <textarea
              className="w-full rounded-md border px-3 py-2 text-sm"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Tell us what you want done..."
            />
          </div>

          <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
            {loading ? "Working..." : "Get AI Estimate"}
          </Button>

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
        </CardContent>
      </Card>
    </main>
  );
}
