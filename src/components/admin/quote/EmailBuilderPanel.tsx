// src/components/admin/quote/EmailBuilderPanel.tsx
"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

type TemplateKey = "standard" | "before_after" | "visual_first";

type VersionRow = {
  id: string;
  version?: number | string | null;
  createdAt?: any;
};

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
  // plus any other fields your pickPhotos emits
};

function templateLabel(k: TemplateKey) {
  if (k === "standard") return "Standard Quote";
  if (k === "before_after") return "Before / After";
  return "Visual First";
}
function templateDesc(k: TemplateKey) {
  if (k === "standard") return "Balanced: estimate summary + key notes with a featured render and supporting photos.";
  if (k === "before_after") return "Transformation layout: highlights before/after photos with a clean pricing section.";
  return "Sales-first: big visuals, minimal assessment text, strong render emphasis.";
}

function chip(text: string) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
      {text}
    </span>
  );
}

function photoUrl(p: any) {
  return safeTrim(p?.url || p?.publicUrl || p?.blobUrl);
}
function photoKey(p: any, idx: number) {
  const u = photoUrl(p);
  return u ? `url:${u}` : `idx:${idx}`;
}

export default function EmailBuilderPanel(props: {
  quoteId: string;
  activeVersion: number | null;
  versionRows: VersionRow[];
  renderedRenders: RenderRow[];
  customerPhotos: Photo[];
}) {
  const { quoteId, activeVersion, versionRows, renderedRenders, customerPhotos } = props;

  const sortedVersions = useMemo(() => {
    const xs = [...(versionRows ?? [])];
    xs.sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0));
    return xs;
  }, [versionRows]);

  const defaultVersionNumber = useMemo(() => {
    if (activeVersion != null) return String(activeVersion);
    const top = sortedVersions[0];
    return top?.version != null ? String(Number(top.version)) : "";
  }, [activeVersion, sortedVersions]);

  const [versionNumber, setVersionNumber] = useState<string>(defaultVersionNumber);
  const [templateKey, setTemplateKey] = useState<TemplateKey>("standard");

  const customerPhotoItems = useMemo(() => {
    return (customerPhotos ?? []).map((p: any, idx: number) => ({
      key: photoKey(p, idx),
      url: photoUrl(p),
      raw: p,
    }));
  }, [customerPhotos]);

  const [selectedRenderIds, setSelectedRenderIds] = useState<string[]>([]);
  const [selectedPhotoKeys, setSelectedPhotoKeys] = useState<string[]>([]);

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

  const composeHref = useMemo(() => {
    const q = new URLSearchParams();
    q.set("template", templateKey);

    if (selectedRenderIds.length) q.set("renders", selectedRenderIds.join(","));
    if (selectedPhotoKeys.length) q.set("photos", selectedPhotoKeys.join(","));

    // v1: composer page doesn’t require version, but we capture it now for future use.
    if (safeTrim(versionNumber)) q.set("version", safeTrim(versionNumber));

    return `/admin/quotes/${encodeURIComponent(quoteId)}/email/compose?${q.toString()}`;
  }, [quoteId, templateKey, selectedRenderIds, selectedPhotoKeys, versionNumber]);

  const canCompose = totalSelectedImages > 0;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Send a quote email</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Pick a version + images, choose a template, and we’ll open the composer pre-filled.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {chip(`Version: ${safeTrim(versionNumber) ? `v${versionNumber}` : "—"}`)}
          {chip(`Images selected: ${totalSelectedImages}`)}
          {chip(`Template: ${templateLabel(templateKey)}`)}
        </div>
      </div>

      {/* Step 1: version */}
      <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">1) Choose a version</div>
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          This lets you anchor the email to the version you’re quoting from.
        </div>

        <select
          value={versionNumber}
          onChange={(e) => setVersionNumber(e.target.value)}
          className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
          disabled={!sortedVersions.length}
        >
          {sortedVersions.length ? (
            sortedVersions.map((v) => {
              const n = String(Number(v.version ?? 0));
              const isActive = activeVersion != null && Number(activeVersion) === Number(n);
              return (
                <option key={v.id} value={n}>
                  {`v${n}`} {isActive ? "(active)" : ""}
                </option>
              );
            })
          ) : (
            <option value="">No versions yet</option>
          )}
        </select>

        {!sortedVersions.length ? (
          <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
            Create v1 in the lifecycle panel first so emails can be anchored to a version.
          </div>
        ) : null}
      </div>

      {/* Step 2: images */}
      <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">2) Select images</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Choose multiple renders and/or customer photos to include.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {chip(`Renders: ${selectedRenders.length}`)}
            {chip(`Customer photos: ${selectedPhotos.length}`)}
          </div>
        </div>

        {/* renders */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Renders</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Showing rendered attempts only
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
                    <img src={url} alt="Render" className="h-44 w-full object-cover bg-black/5" />
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
            <div className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
              No rendered images found yet.
            </div>
          )}
        </div>

        {/* customer photos */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Customer photos</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">From the intake form</div>
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
                      <img src={url} alt="Customer photo" className="h-36 w-full object-cover bg-black/5" />
                    ) : (
                      <div className="h-36 w-full flex items-center justify-center text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-black">
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
            <div className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
              No customer photos found on this quote.
            </div>
          )}
        </div>
      </div>

      {/* Step 3: template */}
      <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">3) Choose a template</div>
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          Templates control layout and emphasis (you’ll edit wording in the composer).
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
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
                    ? "border-black ring-1 ring-black bg-white dark:border-white dark:ring-white dark:bg-gray-950"
                    : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:hover:bg-gray-900")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{templateLabel(k)}</div>
                  {active ? (
                    <span className="rounded-full bg-black px-2 py-1 text-[11px] font-semibold text-white dark:bg-white dark:text-black">
                      ACTIVE
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{templateDesc(k)}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-gray-600 dark:text-gray-300 font-mono break-all">
          template={templateKey} · v={safeTrim(versionNumber) || "—"} · renders={selectedRenders.length} · photos=
          {selectedPhotos.length}
        </div>

        {canCompose ? (
          <Link
            href={composeHref}
            className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
          >
            Open composer with these selections →
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex items-center justify-center rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400"
            title="Select at least one image to continue"
          >
            Select images to continue
          </button>
        )}
      </div>
    </section>
  );
}