// src/components/admin/quoteEmail/QuoteEmailComposeClient.tsx
"use client";

import React, { useMemo, useState } from "react";

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

function templateCardLabel(k: TemplateKey) {
  if (k === "standard") return "Standard Quote";
  if (k === "before_after") return "Before / After";
  return "Visual First";
}

function templateCardDesc(k: TemplateKey) {
  if (k === "standard")
    return "Balanced: estimate summary + key notes, with an optional featured render and a small photo strip.";
  if (k === "before_after")
    return "Great for transformations: emphasizes customer photos (before/after) with a clean pricing section.";
  return "Sales-first: big render gallery, minimal assessment text, strong visual impact.";
}

function chip(text: string) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
      {text}
    </span>
  );
}

function parsePositiveInt(v: any) {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i > 0 ? i : null;
}

export default function QuoteEmailComposeClient(props: {
  quoteId: string;
  tenantId: string;
  lead: any;

  versionRows: any[];
  customerPhotos: Photo[];
  renderedRenders: RenderRow[];

  initialTemplateKey: string;
  initialSelectedVersionNumber?: string; // ✅ NEW (fixes build)
  initialSelectedRenderIds: string[];
  initialSelectedPhotoKeys: string[];
}) {
  const {
    quoteId,
    lead,
    versionRows,
    customerPhotos,
    renderedRenders,
    initialTemplateKey,
    initialSelectedVersionNumber,
    initialSelectedRenderIds,
    initialSelectedPhotoKeys,
  } = props;

  const initialTemplate = ((): TemplateKey => {
    const t = safeTrim(initialTemplateKey) as TemplateKey;
    if (t === "standard" || t === "before_after" || t === "visual_first") return t;
    return "standard";
  })();

  // -------------------------
  // ✅ Step 0: Version picker
  // -------------------------
  const versionOptions = useMemo(() => {
    // We expect rows shaped something like: { id, version, createdAt, output, ... }
    // We'll be defensive and only use fields when present.
    const rows = Array.isArray(versionRows) ? versionRows : [];
    const mapped = rows
      .map((v: any) => {
        const versionNum = parsePositiveInt(v?.version);
        if (!versionNum) return null;
        const id = safeTrim(v?.id);
        const createdAt = v?.createdAt ?? v?.created_at ?? null;
        const createdLabel =
          createdAt ? new Date(createdAt).toLocaleString() : safeTrim(v?.createdAtLabel) || "";
        return {
          version: versionNum,
          id,
          createdLabel,
        };
      })
      .filter(Boolean) as Array<{ version: number; id: string; createdLabel: string }>;

    // Sort newest version first (higher number first)
    mapped.sort((a, b) => b.version - a.version);
    return mapped;
  }, [versionRows]);

  const initialVersionNumber = parsePositiveInt(initialSelectedVersionNumber) ?? null;

  const [selectedVersionNumber, setSelectedVersionNumber] = useState<number | null>(() => {
    if (initialVersionNumber) return initialVersionNumber;
    // default to newest available
    return versionOptions?.[0]?.version ?? null;
  });

  // -------------------------
  // Template selection
  // -------------------------
  const [templateKey, setTemplateKey] = useState<TemplateKey>(initialTemplate);

  // -------------------------
  // Media selection
  // -------------------------
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

  // -------------------------
  // Draft fields (v1)
  // -------------------------
  const defaultTo = safeTrim(lead?.email || lead?.customerEmail || lead?.contact?.email || "");
  const defaultName = safeTrim(lead?.name || lead?.customerName || lead?.contact?.name || "");

  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState(""); // later: checkbox to auto BCC lead_to_email
  const [subject, setSubject] = useState(
    defaultName ? `Your quote is ready — ${defaultName}` : "Your quote is ready"
  );

  const [body, setBody] = useState(
    `Hi ${defaultName || "there"},\n\nAttached is your quote. Reply to this email with any questions, or to approve and schedule the job.\n\nThanks,\n`
  );

  function toggleRender(id: string) {
    setSelectedRenderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function togglePhoto(k: string) {
    setSelectedPhotoKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  const selectedRenders = useMemo(() => {
    const set = new Set(selectedRenderIds);
    return (renderedRenders ?? []).filter((r) => set.has(String(r.id)));
  }, [renderedRenders, selectedRenderIds]);

  const selectedPhotos = useMemo(() => {
    const set = new Set(selectedPhotoKeys);
    return (customerPhotoItems ?? []).filter((p) => set.has(p.key));
  }, [customerPhotoItems, selectedPhotoKeys]);

  const totalSelectedImages = selectedRenders.length + selectedPhotos.length;

  return (
    <div className="space-y-6">
      {/* Step 0: Version picker */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">0) Choose a version</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Pick which quote version to package into this email.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {chip(`Selected: ${selectedVersionNumber != null ? `v${selectedVersionNumber}` : "—"}`)}
          </div>
        </div>

        <div className="mt-4">
          {versionOptions.length ? (
            <div className="max-w-md">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Version</div>
              <select
                value={selectedVersionNumber != null ? String(selectedVersionNumber) : ""}
                onChange={(e) => {
                  const n = parsePositiveInt(e.target.value);
                  setSelectedVersionNumber(n);
                }}
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              >
                {versionOptions.map((v) => (
                  <option key={`${v.version}:${v.id || "noid"}`} value={String(v.version)}>
                    {`v${v.version}`}{v.createdLabel ? ` — ${v.createdLabel}` : ""}
                  </option>
                ))}
              </select>
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                Next: pick images + template, and we’ll generate the email layout from this version.
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300">
              No versions found yet. Create a version first (reassess), then compose.
            </div>
          )}
        </div>
      </section>

      {/* Step 1: template picker */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">1) Choose a template</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Templates control layout and emphasis. You’ll still edit wording and pick images.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {chip(`Selected: ${templateCardLabel(templateKey)}`)}
            {chip(`Images selected: ${totalSelectedImages}`)}
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {(["standard", "before_after", "visual_first"] as TemplateKey[]).map((k) => {
            const active = k === templateKey;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setTemplateKey(k)}
                className={
                  "text-left rounded-2xl border p-4 transition " +
                  (active
                    ? "border-black ring-1 ring-black bg-gray-50 dark:border-white dark:ring-white dark:bg-black"
                    : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{templateCardLabel(k)}</div>
                  {active ? (
                    <span className="rounded-full bg-black px-2 py-1 text-[11px] font-semibold text-white dark:bg-white dark:text-black">
                      ACTIVE
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{templateCardDesc(k)}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Step 2: media picker */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">2) Pick images</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Select multiple renders and/or customer photos to include in the email.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {chip(`Renders: ${selectedRenders.length}`)}
            {chip(`Customer photos: ${selectedPhotos.length}`)}
          </div>
        </div>

        {/* Renders gallery */}
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Renders</div>
            <div className="text-xs text-gray-600 dark:text-gray-300">
              Only <span className="font-mono">rendered</span> attempts are shown.
            </div>
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
                    title="Select render"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="Render" className="h-48 w-full object-cover bg-black/5" />
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
                      {r.quoteVersionId ? (
                        <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-300 font-mono break-all">
                          vId: {String(r.quoteVersionId).slice(0, 8)}…
                        </div>
                      ) : null}
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

        {/* Customer photos gallery */}
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Customer photos</div>
            <div className="text-xs text-gray-600 dark:text-gray-300">Uses the photos stored on the quote.</div>
          </div>

          {customerPhotoItems?.length ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {customerPhotoItems.map((p) => {
                const active = selectedPhotoKeys.includes(p.key);
                const url = p.url;
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
                    title="Select customer photo"
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt="Customer photo" className="h-40 w-full object-cover bg-black/5" />
                    ) : (
                      <div className="h-40 w-full flex items-center justify-center text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-black">
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
                      <div className="mt-1 text-[11px] text-gray-600 dark:text-gray-300 font-mono break-all">
                        {p.key.startsWith("url:") ? "url" : "idx"}
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
      </section>

      {/* Step 3: Draft fields */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">3) Draft email</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Final wording will be editable. Preview + send comes next.
          </p>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">To</div>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="customer@email.com"
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">CC (optional)</div>
                <input
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="cc@email.com"
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">BCC (optional)</div>
                <input
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  placeholder="shop@email.com"
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
                />
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Subject</div>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              />
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Body</div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
            <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
              Next step: we’ll convert this into template blocks + HTML preview.
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-gray-600 dark:text-gray-300 font-mono break-all">
            template={templateKey} · version={selectedVersionNumber != null ? `v${selectedVersionNumber}` : "—"} ·
            quote={quoteId} · renders={selectedRenders.length} · photos={selectedPhotos.length}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-400 dark:border-gray-800 dark:text-gray-500"
              title="Preview comes next"
            >
              Preview (next)
            </button>
            <button
              type="button"
              disabled
              className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              title="Send comes after preview"
            >
              Send (after preview)
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}