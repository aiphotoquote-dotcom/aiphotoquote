// src/components/admin/quoteEmail/QuoteEmailComposeClient.tsx
"use client";

import React, { useMemo, useState } from "react";
import QuoteEmailPreview, { type QuoteEmailPreviewModel } from "./QuoteEmailPreview";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

type TemplateKey = "standard" | "before_after" | "visual_first";

type RenderRow = {
  id: string;
  imageUrl?: string | null;
  createdAt?: any;
  attempt?: number | null;
  quoteVersionId?: string | null;
  status?: string | null;
};

type Photo = {
  url?: string;
  publicUrl?: string;
  blobUrl?: string;
  // anything else your pickPhotos returns
};

function photoUrl(p: any) {
  return safeTrim(p?.url || p?.publicUrl || p?.blobUrl);
}

/**
 * We need a stable selection key for customer photos.
 * In v1: use URL when present; fallback to index key.
 */
function photoKey(p: any, idx: number) {
  const u = photoUrl(p);
  return u ? `url:${u}` : `idx:${idx}`;
}

function templateLabel(k: TemplateKey) {
  if (k === "standard") return "Standard";
  if (k === "before_after") return "Before / After";
  return "Visual First";
}

function templateDesc(k: TemplateKey) {
  if (k === "standard") return "Balanced quote + visuals.";
  if (k === "before_after") return "Great for transformations.";
  return "Sales-first visuals, lighter text.";
}

function isTemplateKey(v: string): v is TemplateKey {
  return v === "standard" || v === "before_after" || v === "visual_first";
}

function chip(text: string) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
      {text}
    </span>
  );
}

function joinCsv(xs: string[]) {
  return xs.map((x) => safeTrim(x)).filter(Boolean).join(",");
}

function parseEmailList(v: string) {
  return safeTrim(v)
    .split(",")
    .map((x) => safeTrim(x))
    .filter(Boolean);
}

export default function QuoteEmailComposeClient(props: {
  quoteId: string;
  tenantId: string;
  lead: any;

  versionRows: any[];
  customerPhotos: Photo[];
  renderedRenders: RenderRow[];

  initialTemplateKey: string;
  initialSelectedVersionNumber?: string; // ✅ added to match compose page usage
  initialSelectedRenderIds: string[];
  initialSelectedPhotoKeys: string[];
}) {
  const {
    quoteId,
    tenantId,
    lead,
    versionRows,
    customerPhotos,
    renderedRenders,
    initialTemplateKey,
    initialSelectedVersionNumber,
    initialSelectedRenderIds,
    initialSelectedPhotoKeys,
  } = props;

  /* ------------------------------ initial state ------------------------------ */
  const initialTemplate = ((): TemplateKey => {
    const t = safeTrim(initialTemplateKey);
    return isTemplateKey(t) ? (t as TemplateKey) : "standard";
  })();

  const [templateKey, setTemplateKey] = useState<TemplateKey>(initialTemplate);

  // version selection
  const versionOptions = useMemo(() => {
    const rows = Array.isArray(versionRows) ? versionRows : [];
    // Expecting: { version: number, createdAt, id } but keep defensive
    const mapped = rows
      .map((v: any) => {
        const n = Number(v?.version);
        const labelTime =
          v?.createdAt ? new Date(v.createdAt).toLocaleString() : v?.created_at ? new Date(v.created_at).toLocaleString() : "";
        const label = Number.isFinite(n)
          ? `v${n}${labelTime ? ` — ${labelTime}` : ""}`
          : safeTrim(v?.id)
            ? `version ${String(v.id).slice(0, 8)}…`
            : "version";
        return { value: Number.isFinite(n) ? String(n) : "", label, raw: v };
      })
      .filter((x) => x.value || x.label);
    // sort by version asc if possible
    mapped.sort((a, b) => Number(a.value || 0) - Number(b.value || 0));
    return mapped;
  }, [versionRows]);

  const initialVersionNumber = ((): string => {
    const v = safeTrim(initialSelectedVersionNumber);
    if (v && versionOptions.some((x) => x.value === v)) return v;
    // fallback to active-like: highest version
    const vs = versionOptions.map((x) => Number(x.value)).filter((n) => Number.isFinite(n));
    if (vs.length) return String(Math.max(...vs));
    return "";
  })();

  const [selectedVersionNumber, setSelectedVersionNumber] = useState<string>(initialVersionNumber);

  const [selectedRenderIds, setSelectedRenderIds] = useState<string[]>(
    Array.isArray(initialSelectedRenderIds) ? initialSelectedRenderIds : []
  );

  const customerPhotoItems = useMemo(() => {
    return (customerPhotos ?? []).map((p: any, idx: number) => ({
      key: photoKey(p, idx),
      url: photoUrl(p),
      raw: p,
    }));
  }, [customerPhotos]);

  const [selectedPhotoKeys, setSelectedPhotoKeys] = useState<string[]>(
    Array.isArray(initialSelectedPhotoKeys) ? initialSelectedPhotoKeys : []
  );

  // Addressing fields (lightweight; real send will use API later)
  const defaultTo = safeTrim(lead?.email || lead?.customerEmail || lead?.contact?.email || "");
  const defaultName = safeTrim(lead?.name || lead?.customerName || lead?.contact?.name || "");

  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");

  // Copy overrides (inline edited in preview)
  const [subject, setSubject] = useState(
    defaultName ? `Your quote is ready — ${defaultName}` : "Your quote is ready"
  );

  const [headline, setHeadline] = useState("Your quote is ready ✅");
  const [intro, setIntro] = useState(
    `Hi ${defaultName || "there"},\n\nThanks for reaching out. We reviewed your photos and put together a quote package below.\n\nIf you'd like to move forward, reply to this email and we'll get you scheduled.`
  );
  const [closing, setClosing] = useState("Thanks,\n— " + (safeTrim(lead?.shopName) || "Your Shop"));

  /* ------------------------------ derived selections ------------------------------ */
  function toggleRender(id: string) {
    setSelectedRenderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function togglePhoto(k: string) {
    setSelectedPhotoKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  const selectedRenders = useMemo(() => {
    const set = new Set(selectedRenderIds);
    return (renderedRenders ?? []).filter((r) => set.has(String(r.id))).filter((r) => safeTrim(r.imageUrl));
  }, [renderedRenders, selectedRenderIds]);

  const selectedPhotos = useMemo(() => {
    const set = new Set(selectedPhotoKeys);
    return (customerPhotoItems ?? []).filter((p) => set.has(p.key)).filter((p) => safeTrim(p.url));
  }, [customerPhotoItems, selectedPhotoKeys]);

  const selectedImages = useMemo(() => {
    // Keep order: renders first, then photos (v1)
    const imgs: Array<{ kind: "render" | "photo"; id: string; url: string; label: string }> = [];
    for (const r of selectedRenders) {
      const url = safeTrim(r.imageUrl);
      if (!url) continue;
      imgs.push({
        kind: "render",
        id: String(r.id),
        url,
        label: `Render${r.attempt != null ? ` #${Number(r.attempt)}` : ""}`,
      });
    }
    for (const p of selectedPhotos) {
      const url = safeTrim(p.url);
      if (!url) continue;
      imgs.push({ kind: "photo", id: p.key, url, label: "Customer photo" });
    }
    return imgs;
  }, [selectedRenders, selectedPhotos]);

  const totalSelectedImages = selectedImages.length;

  /* ------------------------------ model builder ------------------------------ */
  const previewModel: QuoteEmailPreviewModel = useMemo(() => {
    // Choose a featured image based on template + selection
    const featured =
      templateKey === "before_after"
        ? selectedImages.find((x) => x.kind === "photo") || selectedImages[0] || null
        : selectedImages.find((x) => x.kind === "render") || selectedImages[0] || null;

    // Gallery excludes featured (if present)
    const gallery = featured ? selectedImages.filter((x) => x.url !== featured.url) : selectedImages;

    return {
      templateKey,
      quoteId,
      tenantId,
      selectedVersionNumber: safeTrim(selectedVersionNumber),
      to,
      cc,
      bcc,
      subject,
      headline,
      intro,
      closing,
      featuredImage: featured ? { url: featured.url, label: featured.label } : null,
      galleryImages: gallery.map((x) => ({ url: x.url, label: x.label })),
      badges: [
        safeTrim(selectedVersionNumber) ? `v${safeTrim(selectedVersionNumber)}` : "",
        templateLabel(templateKey),
        totalSelectedImages ? `${totalSelectedImages} image${totalSelectedImages === 1 ? "" : "s"}` : "No images selected",
      ].filter(Boolean),
    };
  }, [templateKey, quoteId, tenantId, selectedVersionNumber, to, cc, bcc, subject, headline, intro, closing, selectedImages, totalSelectedImages]);

  /* ------------------------------ media drawer ------------------------------ */
  const [mediaOpen, setMediaOpen] = useState(false);

  function openMedia() {
    setMediaOpen(true);
  }
  function closeMedia() {
    setMediaOpen(false);
  }
  function clearMedia() {
    setSelectedRenderIds([]);
    setSelectedPhotoKeys([]);
  }

  /* ------------------------------ shareable url params ------------------------------ */
  const shareUrl = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("template", templateKey);
    if (safeTrim(selectedVersionNumber)) sp.set("version", safeTrim(selectedVersionNumber));
    if (selectedRenderIds.length) sp.set("renders", joinCsv(selectedRenderIds));
    if (selectedPhotoKeys.length) sp.set("photos", joinCsv(selectedPhotoKeys));
    return `/admin/quotes/${encodeURIComponent(quoteId)}/email/compose?${sp.toString()}`;
  }, [templateKey, selectedVersionNumber, selectedRenderIds, selectedPhotoKeys, quoteId]);

  /* ------------------------------ render ------------------------------ */
  return (
    <div className="space-y-6">
      {/* Sticky builder bar */}
      <div className="sticky top-0 z-30 -mx-6 border-b border-gray-200 bg-white/80 px-6 py-3 backdrop-blur dark:border-gray-800 dark:bg-black/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {/* Version */}
            <div className="flex items-center gap-2">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Version</div>
              <select
                value={selectedVersionNumber}
                onChange={(e) => setSelectedVersionNumber(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              >
                {versionOptions.length ? (
                  versionOptions.map((v) => (
                    <option key={v.value || v.label} value={v.value}>
                      {v.label}
                    </option>
                  ))
                ) : (
                  <option value="">(no versions)</option>
                )}
              </select>
            </div>

            {/* Template */}
            <div className="ml-1 flex items-center gap-2">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Template</div>
              <div className="flex flex-wrap gap-2">
                {(["standard", "before_after", "visual_first"] as TemplateKey[]).map((k) => {
                  const active = k === templateKey;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTemplateKey(k)}
                      className={
                        "rounded-full px-3 py-2 text-xs font-semibold transition border " +
                        (active
                          ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-900")
                      }
                      title={templateDesc(k)}
                    >
                      {templateLabel(k)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Chips */}
            <div className="ml-1 flex flex-wrap gap-2">
              {chip(`${totalSelectedImages} selected`)}
              {safeTrim(selectedVersionNumber) ? chip(`v${safeTrim(selectedVersionNumber)}`) : chip("v—")}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openMedia}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
            >
              Select images
            </button>

            <button
              type="button"
              onClick={clearMedia}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-900"
              title="Clear all selected images"
            >
              Clear
            </button>

            <button
              type="button"
              disabled
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white opacity-50 dark:bg-white dark:text-black"
              title="Send will be wired after Preview + API route"
            >
              Send (next)
            </button>
          </div>
        </div>
      </div>

      {/* Address row (lightweight) */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">To</div>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="customer@email.com"
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
          </div>

          <div className="lg:col-span-3">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">CC</div>
            <input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="optional"
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
          </div>

          <div className="lg:col-span-4">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">BCC</div>
            <input
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              placeholder="optional"
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
          </div>
        </div>

        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Subject</div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
          />
        </div>

        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Shareable builder URL:{" "}
          <a className="font-mono underline" href={shareUrl}>
            {shareUrl}
          </a>
        </div>
      </section>

      {/* Preview canvas */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Email preview</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              This is the customer-facing email. Click into text to edit.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {previewModel.badges.map((b) => chip(b))}
          </div>
        </div>

        <div className="mt-4">
          <QuoteEmailPreview
            model={previewModel}
            onEdit={{
              setHeadline,
              setIntro,
              setClosing,
            }}
          />
        </div>
      </section>

      {/* Media drawer */}
      {mediaOpen ? (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={closeMedia} />
          <div className="absolute right-0 top-0 h-full w-full max-w-3xl bg-white shadow-2xl dark:bg-black">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Select images</div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  Pick renders and/or customer photos — the preview updates instantly.
                </div>
              </div>
              <div className="flex items-center gap-2">
                {chip(`Selected: ${totalSelectedImages}`)}
                <button
                  type="button"
                  onClick={closeMedia}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  Done
                </button>
              </div>
            </div>

            <div className="h-[calc(100%-64px)] overflow-auto px-6 py-5 space-y-8">
              {/* Renders */}
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Renders</div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">Rendered only</div>
                </div>

                {renderedRenders?.length ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {renderedRenders.map((r) => {
                      const url = safeTrim(r.imageUrl);
                      if (!url) return null;
                      const active = selectedRenderIds.includes(String(r.id));
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => toggleRender(String(r.id))}
                          className={
                            "group rounded-2xl border overflow-hidden text-left transition " +
                            (active
                              ? "border-black ring-2 ring-black dark:border-white dark:ring-white"
                              : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700")
                          }
                          title="Toggle render"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="Render" className="h-40 w-full object-cover bg-black/5" />
                          <div className="p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                                Render {r.attempt != null ? `#${Number(r.attempt)}` : ""}
                              </div>
                              {active ? (
                                <span className="rounded-full bg-black px-2 py-1 text-[11px] font-semibold text-white dark:bg-white dark:text-black">
                                  SELECTED
                                </span>
                              ) : (
                                <span className="text-[11px] text-gray-500 dark:text-gray-400 group-hover:underline">
                                  Click to select
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                    No rendered images found yet.
                  </div>
                )}
              </div>

              {/* Customer Photos */}
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Customer photos</div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">From the quote</div>
                </div>

                {customerPhotoItems?.length ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {customerPhotoItems.map((p) => {
                      const active = selectedPhotoKeys.includes(p.key);
                      const url = safeTrim(p.url);
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => togglePhoto(p.key)}
                          className={
                            "group rounded-2xl border overflow-hidden text-left transition " +
                            (active
                              ? "border-black ring-2 ring-black dark:border-white dark:ring-white"
                              : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700")
                          }
                          title="Toggle customer photo"
                        >
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt="Customer photo" className="h-32 w-full object-cover bg-black/5" />
                          ) : (
                            <div className="h-32 w-full flex items-center justify-center text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-black">
                              Missing URL
                            </div>
                          )}
                          <div className="p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">Customer photo</div>
                              {active ? (
                                <span className="rounded-full bg-black px-2 py-1 text-[11px] font-semibold text-white dark:bg-white dark:text-black">
                                  SELECTED
                                </span>
                              ) : (
                                <span className="text-[11px] text-gray-500 dark:text-gray-400 group-hover:underline">
                                  Click to select
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                    No customer photos found on this quote.
                  </div>
                )}
              </div>

              {/* Helpful footnote */}
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
                <div className="font-semibold">Tip</div>
                <div className="mt-1">
                  The preview chooses a “featured” image automatically based on template, then builds a clean gallery
                  below it. You can keep selecting — the email stays formatted.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Debug footer (optional) */}
      <details className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
        <summary className="cursor-pointer select-none text-sm font-semibold text-gray-700 dark:text-gray-200">
          Debug (selection state)
          <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">(collapsed)</span>
        </summary>
        <div className="mt-4 space-y-2 text-xs font-mono text-gray-700 dark:text-gray-200 break-all">
          <div>template={templateKey}</div>
          <div>version={selectedVersionNumber || "(none)"}</div>
          <div>renders={JSON.stringify(selectedRenderIds)}</div>
          <div>photos={JSON.stringify(selectedPhotoKeys)}</div>
          <div>to={to}</div>
          <div>cc={JSON.stringify(parseEmailList(cc))}</div>
          <div>bcc={JSON.stringify(parseEmailList(bcc))}</div>
        </div>
      </details>
    </div>
  );
}