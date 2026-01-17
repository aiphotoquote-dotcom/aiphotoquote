"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ShotType = "wide" | "closeup" | "extra";

type UploadedImage = {
  url: string;
  shotType: ShotType;
};

type QuoteResult = {
  quoteLogId: string | null;
  output: any | null;
};

type RenderState =
  | { status: "idle" }
  | { status: "rendering" }
  | { status: "rendered"; imageUrl: string }
  | { status: "failed"; message: string };

function esc(s: unknown) {
  return String(s ?? "");
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function postJson<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    const snippet = text?.slice(0, 200) ?? "";
    throw new Error(
      `Server returned non-JSON (${res.status}). ${snippet ? `Snippet: ${snippet}` : ""}`.trim()
    );
  }

  if (!res.ok) {
    const msg =
      json?.message ||
      json?.error?.message ||
      json?.error ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return json as T;
}

function ProgressBar({
  labelLeft,
  labelRight,
  active,
}: {
  labelLeft: string;
  labelRight?: string;
  active: boolean;
}) {
  return (
    <div className="w-full rounded-md border border-neutral-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between text-sm">
        <div className="font-medium">{labelLeft}</div>
        {labelRight ? <div className="text-neutral-500">{labelRight}</div> : null}
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
        <div
          className={cn(
            "h-full w-1/2 rounded-full bg-neutral-900 transition-all",
            active ? "animate-pulse" : "w-full"
          )}
        />
      </div>
    </div>
  );
}

export default function QuoteForm({
  tenantSlug,
  aiRenderingEnabled,
}: {
  tenantSlug: string;
  aiRenderingEnabled: boolean;
}) {
  // ---------- form state ----------
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [images, setImages] = useState<UploadedImage[]>([]);

  // This is the *customer opt-in*. Default it to whatever tenant allows.
  const [aiRenderOptIn, setAiRenderOptIn] = useState<boolean>(!!aiRenderingEnabled);

  // If tenant disables rendering, force opt-in off.
  useEffect(() => {
    if (!aiRenderingEnabled) setAiRenderOptIn(false);
    else setAiRenderOptIn(true);
  }, [aiRenderingEnabled]);

  // ---------- lifecycle state ----------
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<QuoteResult>({ quoteLogId: null, output: null });

  const [renderState, setRenderState] = useState<RenderState>({ status: "idle" });

  // Avoid auto-render loops / multiple attempts
  const renderAttemptedForQuoteRef = useRef<string | null>(null);

  const debug = useMemo(() => {
    return {
      tenantSlug,
      tenantAiRenderingEnabled: aiRenderingEnabled,
      customerOptIn: aiRenderOptIn,
      imageCount: images.length,
      quoteLogId: result.quoteLogId,
      renderStatus: renderState.status,
    };
  }, [tenantSlug, aiRenderingEnabled, aiRenderOptIn, images.length, result.quoteLogId, renderState.status]);

  // ---------- helpers ----------
  const addImagesFromUrls = useCallback((urls: string[]) => {
    setImages((prev) => {
      const next = [...prev];
      for (const url of urls) {
        if (!url) continue;
        if (next.find((x) => x.url === url)) continue;

        const idx = next.length;
        const shotType: ShotType = idx === 0 ? "wide" : idx === 1 ? "closeup" : "extra";
        next.push({ url, shotType });
      }
      return next.slice(0, 12);
    });
  }, []);

  const setShotType = useCallback((url: string, shotType: ShotType) => {
    setImages((prev) => prev.map((x) => (x.url === url ? { ...x, shotType } : x)));
  }, []);

  const removeImage = useCallback((url: string) => {
    setImages((prev) => prev.filter((x) => x.url !== url));
  }, []);

  // ---------- upload ----------
  async function uploadFiles(files: FileList) {
    if (!files?.length) return;

    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));

    const res = await fetch("/api/blob/upload", { method: "POST", body: form });
    const text = await res.text();

    let j: any = null;
    try {
      j = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Upload returned non-JSON (${res.status}). ${text?.slice(0, 200) ?? ""}`.trim());
    }

    if (!res.ok || !j?.ok) {
      throw new Error(j?.error?.message || j?.message || "Blob upload failed");
    }

    const urls: string[] = Array.isArray(j?.urls)
      ? j.urls.map((x: any) => String(x)).filter(Boolean)
      : Array.isArray(j?.files)
        ? j.files.map((x: any) => String(x?.url)).filter(Boolean)
        : [];

    if (!urls.length) throw new Error("Blob upload returned no file urls");
    addImagesFromUrls(urls);
  }

  // ---------- submit estimate ----------
  async function submitEstimate() {
    if (!tenantSlug) throw new Error("Missing tenant slug");
    if (!images.length) throw new Error("Please add at least 1 photo.");
    if (!name.trim()) throw new Error("Name is required.");
    if (!email.trim()) throw new Error("Email is required.");
    if (!phone.trim()) throw new Error("Phone is required.");

    setIsSubmitting(true);
    setRenderState({ status: "idle" });

    try {
      const payload = {
        tenantSlug,
        images: images.map((x) => ({ url: x.url, shotType: x.shotType })),
        customer_context: {
          notes: notes?.trim() || undefined,
          category: "service",
          service_type: "upholstery",
          render_opt_in: aiRenderOptIn && aiRenderingEnabled,
        },
        contact: {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
        },
      };

      const j = await postJson<any>("/api/quote/submit", payload);

      const quoteLogId = (j?.quoteLogId ?? j?.id ?? null) as string | null;
      const output = j?.output ?? j?.assessment ?? j ?? null;

      setResult({ quoteLogId, output });

      // Every NEW quote: reset attempted guard
      renderAttemptedForQuoteRef.current = null;
    } finally {
      setIsSubmitting(false);
    }
  }

  // ---------- rendering ----------
  const triggerRendering = useCallback(
    async ({ tenantSlug, quoteLogId }: { tenantSlug: string; quoteLogId: string }) => {
      setRenderState({ status: "rendering" });

      try {
        const j = await postJson<any>("/api/render/start", { tenantSlug, quoteLogId });
        const imageUrl = (j?.imageUrl ?? j?.url ?? null) as string | null;
        if (!imageUrl) throw new Error("Render completed but no imageUrl returned.");
        setRenderState({ status: "rendered", imageUrl });
      } catch (e: any) {
        setRenderState({
          status: "failed",
          message: e?.message ? String(e.message) : "Render failed",
        });
      }
    },
    []
  );

  useEffect(() => {
    const quoteLogId = result.quoteLogId;
    if (!quoteLogId) return;

    // tenant must allow + customer opted in
    if (!aiRenderingEnabled || !aiRenderOptIn) return;

    if (renderAttemptedForQuoteRef.current === quoteLogId) return;

    renderAttemptedForQuoteRef.current = quoteLogId;
    triggerRendering({ tenantSlug, quoteLogId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.quoteLogId, aiRenderingEnabled, aiRenderOptIn, tenantSlug]);

  async function retryRender() {
    const quoteLogId = result.quoteLogId;
    if (!quoteLogId) return;
    await triggerRendering({ tenantSlug, quoteLogId });
  }

  function startOver() {
    setImages([]);
    setNotes("");
    setResult({ quoteLogId: null, output: null });
    setRenderState({ status: "idle" });
    setIsSubmitting(false);
    renderAttemptedForQuoteRef.current = null;

    // reset opt-in back to tenant default
    setAiRenderOptIn(!!aiRenderingEnabled);
  }

  const estimateReady = !!result.output;
  const isRendering = renderState.status === "rendering";

  return (
    <div className="w-full">
      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
        <div className="mb-1 font-bold">DEBUG /q/[tenantSlug]</div>
        <pre className="overflow-auto">{JSON.stringify(debug, null, 2)}</pre>
      </div>

      <div className="mb-4">
        <h2 className="text-2xl font-bold">Get a Photo Quote</h2>
        <p className="mt-1 text-neutral-600">
          Upload photos and add a quick note. We’ll return an estimate range.
        </p>
      </div>

      <div className="space-y-3">
        <ProgressBar
          labelLeft="Progress"
          labelRight={isSubmitting ? "Working…" : estimateReady ? "Estimate ready" : "Add photos"}
          active={isSubmitting}
        />

        {aiRenderingEnabled ? (
          <ProgressBar
            labelLeft="AI Rendering"
            labelRight={
              !aiRenderOptIn
                ? "Off"
                : isRendering
                  ? "Rendering…"
                  : renderState.status === "rendered"
                    ? "Ready"
                    : estimateReady
                      ? "Queued"
                      : "Waiting"
            }
            active={isRendering}
          />
        ) : null}
      </div>

      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-2 font-semibold">Take 2 quick photos</div>
        <div className="text-sm text-neutral-600">
          Wide shot + close-up gets the best accuracy. Add more if you want (max 12).
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <label className="inline-flex w-fit cursor-pointer items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
            Take Photo (Camera)
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={async (e) => {
                try {
                  if (e.target.files) await uploadFiles(e.target.files);
                } catch (err: any) {
                  alert(err?.message ?? "Upload failed");
                } finally {
                  e.currentTarget.value = "";
                }
              }}
            />
          </label>

          <label className="inline-flex w-fit cursor-pointer items-center justify-center rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900">
            Upload Photos
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={async (e) => {
                try {
                  if (e.target.files) await uploadFiles(e.target.files);
                } catch (err: any) {
                  alert(err?.message ?? "Upload failed");
                } finally {
                  e.currentTarget.value = "";
                }
              }}
            />
          </label>
        </div>

        {images.length ? (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {images.map((img) => (
              <div key={img.url} className="rounded-lg border border-neutral-200 p-2">
                <div className="relative overflow-hidden rounded-md">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="h-40 w-full object-cover" />
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded bg-white/90 px-2 py-1 text-xs font-medium"
                    onClick={() => removeImage(img.url)}
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="text-xs text-neutral-600">Shot type</div>
                  <button
                    type="button"
                    className={cn(
                      "rounded px-2 py-1 text-xs font-medium",
                      img.shotType === "wide" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-900"
                    )}
                    onClick={() => setShotType(img.url, "wide")}
                  >
                    Wide
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded px-2 py-1 text-xs font-medium",
                      img.shotType === "closeup" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-900"
                    )}
                    onClick={() => setShotType(img.url, "closeup")}
                  >
                    Close-up
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded px-2 py-1 text-xs font-medium",
                      img.shotType === "extra" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-900"
                    )}
                    onClick={() => setShotType(img.url, "extra")}
                  >
                    Extra
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-md border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">
            No photos yet.
          </div>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-2 font-semibold">Your info</div>
        <div className="text-sm text-neutral-600">
          Required so we can send your estimate and follow up if needed.
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Name *</label>
            <input
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Email *</label>
            <input
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@email.com"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Phone *</label>
            <input
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              placeholder="(555) 555-5555"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm font-medium">Notes</label>
            <textarea
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What are you looking to do? Material preference, timeline, constraints?"
              rows={3}
            />
          </div>
        </div>

        {/* Only show checkbox if tenant supports rendering */}
        {aiRenderingEnabled ? (
          <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={aiRenderOptIn}
                onChange={(e) => setAiRenderOptIn(e.target.checked)}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Optional: AI rendering preview</div>
                <div className="text-neutral-600">
                  If selected, we may generate a visual “after” concept based on your photos. This happens as a second step after your estimate.
                </div>
              </div>
            </label>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className={cn("rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white", isSubmitting ? "opacity-60" : "")}
            disabled={isSubmitting}
            onClick={async () => {
              try {
                await submitEstimate();
              } catch (e: any) {
                alert(e?.message ?? "Submit failed");
              }
            }}
          >
            Get Estimate
          </button>

          <button
            type="button"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium"
            onClick={startOver}
          >
            Start Over
          </button>
        </div>
      </div>

      {estimateReady ? (
        <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 font-semibold">Result</div>

          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(result.output, null, 2)}</pre>
          </div>

          {aiRenderingEnabled && aiRenderOptIn ? (
            <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
              <div className="text-lg font-semibold">AI Rendering</div>
              <div className="text-sm text-neutral-600">This is a second step after your estimate. It can take a moment.</div>

              <div className="mt-3 text-sm">
                <div className="font-medium">Status: {renderState.status}</div>

                {renderState.status === "rendered" ? (
                  <div className="mt-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={renderState.imageUrl} alt="AI Rendering" className="w-full rounded-lg border border-neutral-200" />
                  </div>
                ) : null}

                {renderState.status === "failed" ? (
                  <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-red-900">{esc(renderState.message)}</div>
                ) : null}

                <div className="mt-3">
                  <button
                    type="button"
                    className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium"
                    onClick={retryRender}
                    disabled={!result.quoteLogId || renderState.status === "rendering"}
                  >
                    Retry Render
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 text-xs text-neutral-500">
        By submitting, you agree we may contact you about this request. Photos are used only to prepare your estimate.
      </div>
    </div>
  );
}
