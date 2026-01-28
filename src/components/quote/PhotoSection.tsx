// src/components/quote/PhotoSection.tsx
"use client";

import React from "react";
import { cn } from "./ui";

export type ShotType = "wide" | "closeup" | "extra";

export type PhotoItem = {
  id: string;
  shotType: ShotType;
  previewSrc: string;
  uploadedUrl?: string;
  file?: File;
};

function shotBadge(t: ShotType) {
  return t === "wide" ? "Wide shot" : t === "closeup" ? "Close-up" : "Extra";
}

export function PhotoSection({
  sectionRef,
  working,
  photos,
  minPhotos,
  recommendedPhotos,
  maxPhotos,
  onAddCameraFiles,
  onUploadPhotosNow,
  onRemovePhoto,
  onSetShotType,
}: {
  sectionRef: React.RefObject<HTMLElement | null>;
  working: boolean;
  photos: PhotoItem[];
  minPhotos: number;
  recommendedPhotos: number;
  maxPhotos: number;
  onAddCameraFiles: (files: File[]) => void;
  onUploadPhotosNow: (files: FileList) => Promise<void>;
  onRemovePhoto: (id: string) => void;
  onSetShotType: (id: string, shotType: ShotType) => void;
}) {
  const photoCount = photos.length;
  const recommendedOk = photoCount >= recommendedPhotos;

  return (
    <section
      ref={sectionRef as any}
      className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Add photos</h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          Minimum <b>{minPhotos}</b> photo to submit — but <b>{recommendedPhotos}–6</b> photos usually gives a better
          estimate. (max {maxPhotos})
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <input
            className="hidden"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={async (e) => {
              try {
                const f = Array.from(e.target.files ?? []);
                if (f.length) onAddCameraFiles(f);
              } finally {
                e.currentTarget.value = "";
              }
            }}
            disabled={working}
          />
          <div className="w-full rounded-xl bg-black text-white py-4 text-center font-semibold cursor-pointer select-none dark:bg-white dark:text-black">
            Take Photo
          </div>
        </label>

        <label className="block">
          <input
            className="hidden"
            type="file"
            accept="image/*"
            multiple
            onChange={async (e) => {
              try {
                if (e.target.files) await onUploadPhotosNow(e.target.files);
              } finally {
                e.currentTarget.value = "";
              }
            }}
            disabled={working}
          />
          <div className="w-full rounded-xl border border-gray-200 py-4 text-center font-semibold cursor-pointer select-none dark:border-gray-800">
            Upload Photos
          </div>
        </label>
      </div>

      {photos.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {photos.map((p, idx) => {
            const badge = shotBadge(p.shotType);
            return (
              <div key={p.id} className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewSrc} alt={`photo ${idx + 1}`} className="h-44 w-full object-cover" />
                  <div className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-xs font-semibold text-white">
                    {badge}
                  </div>
                  <button
                    type="button"
                    className="absolute top-2 right-2 rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-xs disabled:opacity-50 dark:bg-gray-900/90 dark:border-gray-800"
                    onClick={() => onRemovePhoto(p.id)}
                    disabled={working}
                  >
                    Remove
                  </button>
                </div>

                <div className="p-3 flex flex-wrap items-center gap-2">
                  <div className="text-xs text-gray-600 dark:text-gray-300 mr-1">Label:</div>

                  {(["wide", "closeup", "extra"] as ShotType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-semibold border",
                        p.shotType === t
                          ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                          : "bg-white text-gray-900 border-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
                      )}
                      onClick={() => onSetShotType(p.id, t)}
                      disabled={working}
                    >
                      {t === "wide" ? "Wide" : t === "closeup" ? "Close-up" : "Extra"}
                    </button>
                  ))}

                  {!p.uploadedUrl && p.file ? (
                    <span className="ml-auto text-[11px] text-gray-500 dark:text-gray-300">
                      Camera photo (uploads on submit)
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
          No photos yet. Add at least one photo to continue — two or more is better.
        </div>
      )}

      <div className="text-xs text-gray-600 dark:text-gray-300">
        {photoCount >= minPhotos ? (
          <>
            ✅ {photoCount} photo{photoCount === 1 ? "" : "s"} added{" "}
            {!recommendedOk ? (
              <span className="text-gray-500 dark:text-gray-400">· Add 1+ more for best results</span>
            ) : null}
          </>
        ) : (
          `Add ${minPhotos} photo (you have ${photoCount})`
        )}
      </div>
    </section>
  );
}