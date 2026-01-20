// src/app/q/[tenantSlug]/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Customer = {
  name: string;
  phone: string;
  email: string;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function normalizePhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  // Basic US-friendly formatting; we still store digits-only.
  // If you want E.164 later, we can do that too.
  return digits;
}

export default function PublicQuotePage() {
  const params = useParams<{ tenantSlug: string }>();
  const router = useRouter();
  const tenantSlug = params?.tenantSlug;

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // REQUIRED customer fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // Existing fields (keep what you already had)
  const [category, setCategory] = useState("service");
  const [serviceType, setServiceType] = useState("upholstery");
  const [notes, setNotes] = useState("");

  const [renderOptIn, setRenderOptIn] = useState(false);

  // Images (your existing uploader likely fills this)
  const [images, setImages] = useState<Array<{ url: string; shotType?: string }>>([]);

  const canSubmit = useMemo(() => {
    const n = name.trim().length >= 2;
    const p = normalizePhone(phone).length >= 10; // minimum 10 digits
    const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const hasImages = images.length >= 1;
    return Boolean(tenantSlug && n && p && e && hasImages && !submitting);
  }, [tenantSlug, name, phone, email, images.length, submitting]);

  async function submit() {
    setErr(null);
    if (!tenantSlug) {
      setErr("Missing tenant slug.");
      return;
    }

    const customer: Customer = {
      name: name.trim(),
      phone: normalizePhone(phone),
      email: email.trim().toLowerCase(),
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          images,
          render_opt_in: renderOptIn,
          customer, // ✅ NEW
          customer_context: {
            notes: notes.trim() || undefined,
            category,
            service_type: serviceType,
          },
        }),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Submit returned non-JSON (HTTP ${res.status}).`);
      }

      if (!res.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || `Submit failed (HTTP ${res.status}).`);
      }

      // If you already have a thank-you route, keep that
      // Otherwise, just push them somewhere sane:
      router.push("/thank-you");
    } catch (e: any) {
      setErr(e?.message ?? "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <h1 className="text-2xl font-semibold">Get an AI Estimate</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Upload photos and tell us a bit about what you need.
        </p>

        {err ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {err}
          </div>
        ) : null}

        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950 space-y-4">
          <div className="text-sm font-semibold">Your info</div>

          <div>
            <div className="text-xs text-gray-700 dark:text-gray-200">
              Name <span className="text-red-600">*</span>
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              autoComplete="name"
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-black"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <div className="text-xs text-gray-700 dark:text-gray-200">
              Phone <span className="text-red-600">*</span>
            </div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={submitting}
              autoComplete="tel"
              inputMode="tel"
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-black"
              placeholder="(555) 123-4567"
            />
            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              We’ll only use this to contact you about your quote.
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-700 dark:text-gray-200">
              Email <span className="text-red-600">*</span>
            </div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              autoComplete="email"
              inputMode="email"
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-black"
              placeholder="jane@email.com"
            />
          </div>
        </section>

        {/* Keep whatever image uploader you already have.
            If you don’t, tell me which component you’re using and I’ll wire it cleanly. */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950 space-y-4">
          <div className="text-sm font-semibold">Job details</div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs text-gray-700 dark:text-gray-200">Category</div>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={submitting}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-black"
              />
            </div>
            <div>
              <div className="text-xs text-gray-700 dark:text-gray-200">Service type</div>
              <input
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                disabled={submitting}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-black"
              />
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-700 dark:text-gray-200">Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting}
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-black"
              rows={4}
              placeholder="What should we know? (e.g., fix rips, new foam, color match, etc.)"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={renderOptIn}
              onChange={(e) => setRenderOptIn(e.target.checked)}
              disabled={submitting}
            />
            Include an AI rendering preview (if available)
          </label>
        </section>

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={cn(
            "w-full rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50",
            "dark:bg-white dark:text-black"
          )}
        >
          {submitting ? "Submitting…" : "Get AI Estimate"}
        </button>

        <div className="text-xs text-gray-500 dark:text-gray-400">
          By submitting, you agree we can contact you about this request.
        </div>
      </div>
    </main>
  );
}
