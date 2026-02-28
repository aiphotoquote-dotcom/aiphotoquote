// src/components/admin/quoteEmail/QuoteEmailPackager.tsx
"use client";

import React, { useMemo, useState } from "react";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

type TemplateKey = "standard" | "before_after" | "visual_first";

type VersionRow = {
  id: string;
  version?: number | null;
  createdAt?: any;
};

type RenderRow = {
  id: string;
  imageUrl?: string | null;
  status?: string | null;
  attempt?: number | null;
  createdAt?: any;
  quoteVersionId?: string | null;
};

type Photo = {
  url?: string;
  publicUrl?: string;
  blobUrl?: string;
};

function photoUrl(p: any) {
  return safeTrim(p?.url || p?.publicUrl || p?.blobUrl);
}

function photoKey(p: any, idx: number) {
  const u = photoUrl(p);
  return u ? `url:${u}` : `idx:${idx}`;
}

function templateLabel(k: TemplateKey) {
  if (k === "standard") return "Standard Quote";
  if (k === "before_after") return "Before / After";
  return "Visual First";
}

function templateDesc(k: TemplateKey) {
  if (k === "standard") return "Balanced: pricing/assessment + selected images.";
  if (k === "before_after") return "Emphasizes customer photos (before/after) with a clean price section.";
  return "Sales-first: big visuals, minimal text, strong impact.";
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
      {children}
    </span>
  );
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={
        "inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black " +
        className
      }
    />
  );
}

function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={
        "inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900 " +
        className
      }
    />
  );
}

function buildComposeUrl(args: { quoteId: string; template: TemplateKey; renderIds: string[]; photoKeys: string[] }) {
  const base = `/admin/quotes/${encodeURIComponent(args.quoteId)}/email/compose`;
  const q = new URLSearchParams();
  q.set("template", args.template);
  if (args.renderIds.length) q.set("renders", args.renderIds.join(","));
  if (args.photoKeys.length) q.set("photos", args.photoKeys.join(","));
  return `${base}?${q.toString()}`;
}

export default function QuoteEmailPackager(props: {
  quoteId: string;
  activeVersion: number | null;
  versionRows: VersionRow[];
  renderRows: RenderRow[];
  customerPhotos: Photo[];
  initialTemplateKey?: string;
}) {
  const { quoteId, activeVersion, versionRows, renderRows, customerPhotos, initialTemplateKey } = props;

  const initialTemplate = ((): TemplateKey => {
    const t = safeTrim(initialTemplateKey) as TemplateKey;
    if (t === "standard" || t === "before_after" || t === "visual_first") return t;
    return "visual_first";
  })();

  const renderedRenders = useMemo(() => {
    return (renderRows ?? []).filter((r) => safeTrim(r?.status) === "rendered" && safeTrim(r?.imageUrl));
  }, [renderRows]);

  const sortedVersions = useMemo(() => {
    const xs = [...(versionRows ?? [])];
    xs.sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0));
    return xs;
  }, [versionRows]);

  const defaultVersionNumber = useMemo(() => {
    if (activeVersion != null) return String(Number(activeVersion));
    const top = sortedVersions[0];
    return top?.version != null ? String(Number(top.version)) : "";
  }, [activeVersion, sortedVersions]);

  const customerPhotoItems = useMemo(() => {
    return (customerPhotos ?? []).map((p: any, idx: number) => ({
      key: photoKey(p, idx),
      url: photoUrl(p),
      raw: p,
    }));
  }, [customerPhotos]);

  const [templateKey, setTemplateKey] = useState<TemplateKey>(initialTemplate);
  const [selectedVersionNumber, setSelectedVersionNumber] = useState<string>(defaultVersionNumber);

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

  const totalSelected = selectedRenders.length + selectedPhotos.length;
  const canCompose = totalSelected > 0;

  function clearAll() {
    setSelectedRenderIds([]);
    setSelectedPhotoKeys([]);
  }

  function openComposer() {
    const url = buildComposeUrl({
      quoteId,
      template: templateKey,
      renderIds: selectedRenderIds,
      photoKeys: selectedPhotoKeys,
    });
    window.location.href = url;
  }

  const selectedTray = useMemo(() => {
    const thumbs: Array<{ key: string; url: string; onRemove: () => void }> = [];

    selectedRenders.forEach((r) => {
      const u = safeTrim(r.imageUrl);
      if (!u) return;
      thumbs.push({
        key: `r:${r.id}`,
        url: u,
        onRemove: () => setSelectedRenderIds((prev) => prev.filter((x) => x !== String(r.id))),
      });
    });

    selectedPhotos.forEach((p) => {
      const u = safeTrim(p.url);
      if (!u) return;
      thumbs.push({
        key: `p:${p.key}`,
        url: u,
        onRemove: () => setSelectedPhotoKeys((prev) => prev.filter((x) => x !== p.key)),
      });
    });

    return thumbs.slice(0, 12);
  }, [selectedRenders, selectedPhotos]);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Build customer email</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Select a version + images + a template — we’ll assemble it in the composer for final edits.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Chip>Template: {templateLabel(templateKey)}</Chip>
          <Chip>Selected: {totalSelected}</Chip>
        </div>
      </div>

      {/* 1) Version */}
      <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">1) Version</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              Choose which output/version you’re sending.
            </div>
          </div>

          <div className="mt-2 sm:mt-0">
            <select
              value={selectedVersionNumber}
              onChange={(e) => setSelectedVersionNumber(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-950"
              disabled={!sortedVersions.length}
            >
              {sortedVersions.length ? (
                sortedVersions.map((v) => {
                  const vnum = v.version != null ? String(Number(v.version)) : "";
                  const isActive = activeVersion != null && Number(v.version) === Number(activeVersion);
                  return (
                    <option key={v.id} value={vnum}>
                      {`v${vnum}`} {isActive ? "(active)" : ""}
                    </option>
                  );
                })
              ) : (
                <option value="">No versions</option>
              )}
            </select>
          </div>
        </div>

        {!sortedVersions.length ? (
          <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
            No versions yet — create v1 in “Quote lifecycle” first.
          </div>
        ) : null}
      </div>

      {/* 2) Template */}
      <div className="mt-6">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">2) Template</div>
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
                    ? "border-black ring-1 ring-black bg-gray-50 dark:border-white dark:ring-white dark:bg-black"
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

      {/* 3) Images */}
      <div className="mt-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">3) Pick images</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">Multi-select renders and/or customer photos.</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Chip>Renders: {selectedRenders.length}</Chip>
            <Chip>Photos: {selectedPhotos.length}</Chip>
          </div>
        </div>

        {/* Renders */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Concept images</div>
            <div className="text-xs text-gray-600 dark:text-gray-300">
              Showing <span className="font-mono">rendered</span> only.
            </div>
          </div>

          {renderedRenders.length ? (
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
                  >
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="Render" className="h-48 w-full object-cover bg-black/5" />
                      <div className="absolute left-3 top-3">
                        <div
                          className={
                            "h-5 w-5 rounded-md border flex items-center justify-center text-[11px] font-bold " +
                            (active
                              ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                              : "bg-white/90 text-gray-700 border-gray-200 dark:bg-black/70 dark:text-gray-200 dark:border-gray-800")
                          }
                        >
                          ✓
                        </div>
                      </div>
                    </div>

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

        {/* Photos */}
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Customer photos</div>
            <div className="text-xs text-gray-600 dark:text-gray-300">Photos submitted with this quote.</div>
          </div>

          {customerPhotoItems.length ? (
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
                  >
                    <div className="relative">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt="Customer photo" className="h-40 w-full object-cover bg-black/5" />
                      ) : (
                        <div className="h-40 w-full flex items-center justify-center text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-black">
                          Missing URL
                        </div>
                      )}

                      <div className="absolute left-3 top-3">
                        <div
                          className={
                            "h-5 w-5 rounded-md border flex items-center justify-center text-[11px] font-bold " +
                            (active
                              ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                              : "bg-white/90 text-gray-700 border-gray-200 dark:bg-black/70 dark:text-gray-200 dark:border-gray-800")
                          }
                        >
                          ✓
                        </div>
                      </div>
                    </div>

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
      </div>

      {/* Selected tray */}
      {selectedTray.length ? (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Selected</div>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-semibold text-gray-600 hover:underline dark:text-gray-300"
            >
              Clear all
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {selectedTray.map((t) => (
              <div key={t.key} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={t.url}
                  alt="Selected"
                  className="h-16 w-20 rounded-lg object-cover border border-gray-200 dark:border-gray-800"
                />
                <button
                  type="button"
                  onClick={t.onRemove}
                  className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-black text-white text-xs font-bold shadow hover:opacity-90 dark:bg-white dark:text-black"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Sticky action bar */}
      <div className="mt-6">
        <div className="sticky bottom-4 z-20">
          <div className="rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-gray-800 dark:bg-gray-950/90">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Chip>v{selectedVersionNumber || "—"}</Chip>
                <Chip>{templateLabel(templateKey)}</Chip>
                <Chip>{selectedPhotos.length} photos</Chip>
                <Chip>{selectedRenders.length} renders</Chip>
              </div>

              <div className="flex items-center gap-2">
                <SecondaryButton type="button" onClick={clearAll} disabled={!canCompose}>
                  Clear
                </SecondaryButton>
                <PrimaryButton type="button" onClick={openComposer} disabled={!canCompose}>
                  Open Composer
                </PrimaryButton>
              </div>
            </div>

            {!canCompose ? (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">Select at least one image to compose.</div>
            ) : (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                Opens composer pre-filled with template + your selected images.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}