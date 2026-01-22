"use client";

import React, { useEffect, useMemo, useState } from "react";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export type QuotePhoto = {
  url: string;
  label?: string | null;
};

export default function QuotePhotoGallery({ photos }: { photos: QuotePhoto[] }) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  const safePhotos = useMemo(
    () => (Array.isArray(photos) ? photos.filter((p) => p?.url) : []),
    [photos]
  );

  const total = safePhotos.length;

  function close() {
    setOpen(false);
  }

  function openAt(i: number) {
    if (!total) return;
    setIdx(Math.max(0, Math.min(total - 1, i)));
    setOpen(true);
  }

  function prev() {
    if (!total) return;
    setIdx((x) => (x - 1 + total) % total);
  }

  function next() {
    if (!total) return;
    setIdx((x) => (x + 1) % total);
  }

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, total]);

  if (!total) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
        <div className="font-semibold">Photos</div>
        <div className="mt-1 text-gray-600 dark:text-gray-300 italic">No photos attached.</div>
      </div>
    );
  }

  const active = safePhotos[idx];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Photos</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Click any photo to zoom. Use ← → keys to browse.
          </p>
        </div>
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">{total} total</div>
      </div>

      {/* Thumbnails */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {safePhotos.map((p, i) => (
          <button
            key={`${p.url}-${i}`}
            type="button"
            onClick={() => openAt(i)}
            className="group relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50 text-left shadow-sm hover:bg-white dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
            aria-label={`Open photo ${i + 1}`}
          >
            <div className="aspect-[4/3] w-full overflow-hidden">
              {/* plain img keeps it dead-simple and reliable for blob urls */}
              <img
                src={p.url}
                alt={p.label ?? `Photo ${i + 1}`}
                className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                loading="lazy"
              />
            </div>

            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="truncate text-xs font-semibold text-gray-700 dark:text-gray-200">
                {p.label ? p.label : `Photo ${i + 1}`}
              </div>
              <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                {i + 1}/{total}
              </div>
            </div>

            <div className="pointer-events-none absolute inset-0 opacity-0 transition group-hover:opacity-100">
              <div className="absolute inset-0 bg-black/5 dark:bg-white/5" />
              <div className="absolute bottom-2 right-2 rounded-full border border-gray-200 bg-white/90 px-2 py-1 text-[11px] font-semibold text-gray-800 dark:border-gray-800 dark:bg-black/80 dark:text-gray-200">
                Zoom
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            // click outside image closes
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="relative w-full max-w-5xl">
            {/* Top bar */}
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-white/20 bg-black/50 px-3 py-1 text-xs font-semibold text-white">
                  {idx + 1} / {total}
                </span>
                <span className="truncate text-sm font-semibold text-white/90">
                  {active?.label ? active.label : `Photo ${idx + 1}`}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={active?.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-xs font-semibold text-white hover:bg-black/60"
                >
                  Open original
                </a>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-xs font-semibold text-white hover:bg-black/60"
                >
                  Close (Esc)
                </button>
              </div>
            </div>

            {/* Image */}
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
              <img
                src={active?.url}
                alt={active?.label ?? `Photo ${idx + 1}`}
                className="max-h-[75vh] w-full object-contain"
              />

              {/* Nav buttons */}
              {total > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={prev}
                    className={cn(
                      "absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-black/40 px-3 py-2 text-sm font-semibold text-white hover:bg-black/60"
                    )}
                    aria-label="Previous photo"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    className={cn(
                      "absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-black/40 px-3 py-2 text-sm font-semibold text-white hover:bg-black/60"
                    )}
                    aria-label="Next photo"
                  >
                    →
                  </button>
                </>
              ) : null}
            </div>

            <div className="mt-3 text-center text-xs text-white/70">
              Tip: click outside the image to close.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}