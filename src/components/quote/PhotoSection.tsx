// src/components/quote/PhotoSection.tsx
"use client";

import React, { useRef, useState } from "react";
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

  // Prevent overlapping "Upload Photos" calls (double taps / slow networks)
  const [uploadingNow, setUploadingNow] = useState(false);
  const isBusy = working || uploadingNow;

  // Keep last FileList alive across awaits by copying to an array of Files
  // (FileList can be ephemeral in some browsers).
  const lastUploadFilesRef = useRef<File[] | null>(null);

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
            onChange={(e) => {
              // Always snapshot files synchronously; never touch e.target after an await.
              const files = Array.from(e.currentTarget.files ?? []);
              // Clear immediately to allow re-selecting same file.
              e.currentTarget.value = "";
              if (files.length) onAddCameraFiles(files);
            }}
            disabled={isBusy}
          />
          <div
            className={cn(
              "w-full rounded-xl bg-black text-white py-4 text-center font-semibold cursor-pointer select-none dark:bg-white dark:text-black",
              isBusy ? "opacity-50 cursor-not-allowed" : ""
            )}
          >
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
              if (isBusy) {
                // still clear to avoid stale selection
                e.currentTarget.value = "";
                return;
              }

              // Snapshot files immediately.
              const filesArr = Array.from(e.currentTarget.files ?? []);
              // Clear immediately (don’t rely on ref existing later).
              e.currentTarget.value = "";

              if (!filesArr.length) return;

              // Keep a copy so we can recreate a FileList-like structure if needed
              lastUploadFilesRef.current = filesArr;

              setUploadingNow(true);
              try {
                /**
                 * Your existing onUploadPhotosNow expects a FileList.
                 * We can't reliably construct a real FileList cross-browser, so we pass the
                 * original FileList when possible by re-reading from the event before clearing.
                 *
                 * Since we already cleared the input, we instead create a minimal "FileList-like"
                 * object that behaves for Array.from(...) usage.
                 */
                const pseudoFileList: FileList = {
                  length: filesArr.length,
                  item: (idx: number) => filesArr[idx] ?? null,
                  ...filesArr,
                } as any;

                await onUploadPhotosNow(pseudoFileList);
              } finally {
                setUploadingNow(false);
              }
            }}
            disabled={isBusy}
          />
          <div
            className={cn(
              "w-full rounded-xl border border-gray-200 py-4 text-center font-semibold cursor-pointer select-none dark:border-gray-800",
              isBusy ? "opacity-50 cursor-not-allowed" : ""
            )}
          >
            {uploadingNow ? "Uploading…" : "Upload Photos"}
          </div>
        </label>
      </div>

      {/* Reserve space so switching between empty/grid is less jarring (helps mobile focus stability). */}
      <div className="min-h-[10rem]">
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
                      disabled={isBusy}
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
                        disabled={isBusy}
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
      </div>

      {/* Reserve a consistent line height so this doesn't reflow while interacting. */}
      <div className="text-xs text-gray-600 dark:text-gray-300 min-h-[1.25rem]">
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