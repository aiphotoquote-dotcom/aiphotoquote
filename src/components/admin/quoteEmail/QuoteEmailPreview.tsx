// src/components/admin/quoteEmail/QuoteEmailPreview.tsx
"use client";

import React, { useEffect, useMemo, useRef } from "react";

export type QuoteEmailPreviewModel = {
  templateKey: "standard" | "before_after" | "visual_first";
  quoteId: string;
  tenantId: string;
  selectedVersionNumber: string;

  to: string;
  cc: string;
  bcc: string;

  subject: string;

  headline: string;
  intro: string;
  closing: string;

  featuredImage: { url: string; label: string } | null;
  galleryImages: Array<{ url: string; label: string }>;

  badges: string[];
};

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function toLines(text: string) {
  return String(text ?? "")
    .split("\n")
    .map((x) => x.replace(/\r/g, ""))
    .join("\n");
}

function blockStyle() {
  return "rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-black";
}

/**
 * A "marketing-style" preview canvas:
 * - looks like a real email
 * - supports lightweight inline editing (headline / intro / closing)
 */
export default function QuoteEmailPreview(props: {
  model: QuoteEmailPreviewModel;
  onEdit: {
    setHeadline: (v: string) => void;
    setIntro: (v: string) => void;
    setClosing: (v: string) => void;
  };
}) {
  const { model, onEdit } = props;

  const headlineRef = useRef<HTMLDivElement | null>(null);
  const introRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef<HTMLDivElement | null>(null);

  // Keep contenteditable regions in sync when model changes from outside
  useEffect(() => {
    if (headlineRef.current && headlineRef.current.innerText !== model.headline) {
      headlineRef.current.innerText = model.headline;
    }
    if (introRef.current && introRef.current.innerText !== toLines(model.intro)) {
      introRef.current.innerText = toLines(model.intro);
    }
    if (closingRef.current && closingRef.current.innerText !== toLines(model.closing)) {
      closingRef.current.innerText = toLines(model.closing);
    }
  }, [model.headline, model.intro, model.closing]);

  const frameTitle = useMemo(() => {
    if (model.templateKey === "before_after") return "Before/After layout";
    if (model.templateKey === "visual_first") return "Visual-first layout";
    return "Standard layout";
  }, [model.templateKey]);

  const galleryCols = model.templateKey === "visual_first" ? 3 : 2;

  return (
    <div className="space-y-4">
      {/* Preview "client" header */}
      <div className={blockStyle()}>
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
              <div className="h-3 w-3 rounded-full bg-gray-400 dark:bg-gray-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Email Preview</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">{frameTitle}</div>
            </div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            {safeTrim(model.selectedVersionNumber) ? `v${safeTrim(model.selectedVersionNumber)}` : "v—"} · quote{" "}
            {String(model.quoteId).slice(0, 8)}…
          </div>
        </div>
      </div>

      {/* Email body canvas */}
      <div className={blockStyle()}>
        <div className="border-b border-gray-200 dark:border-gray-800 px-5 py-4">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Subject</div>
          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{model.subject}</div>
        </div>

        <div className="px-5 py-6">
          {/* Headline */}
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Click to edit</div>
          <div
            ref={headlineRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={() => {
              const v = safeTrim(headlineRef.current?.innerText);
              if (v) onEdit.setHeadline(v);
            }}
            className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20 rounded-lg px-2 -mx-2 py-1"
          >
            {model.headline}
          </div>

          {/* Intro copy */}
          <div
            ref={introRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={() => {
              const v = toLines(introRef.current?.innerText || "");
              onEdit.setIntro(v);
            }}
            className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-200 outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20 rounded-lg px-2 -mx-2 py-2"
          >
            {toLines(model.intro)}
          </div>

          {/* Featured image */}
          {model.featuredImage ? (
            <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={model.featuredImage.url}
                alt={model.featuredImage.label}
                className="w-full object-cover max-h-[420px] bg-black/5"
              />
              <div className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300 flex items-center justify-between">
                <div className="font-semibold">{model.featuredImage.label}</div>
                <div className="font-mono opacity-70">featured</div>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
              Select at least one image to see the layout come alive.
            </div>
          )}

          {/* Gallery */}
          {model.galleryImages?.length ? (
            <div className="mt-5">
              <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Included images</div>
              <div
                className={
                  "mt-3 grid gap-3 " +
                  (galleryCols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")
                }
              >
                {model.galleryImages.map((img, idx) => (
                  <div
                    key={`${img.url}-${idx}`}
                    className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.label} className="h-40 w-full object-cover bg-black/5" />
                    <div className="px-3 py-2 text-[11px] text-gray-600 dark:text-gray-300 flex items-center justify-between">
                      <div className="font-semibold">{img.label}</div>
                      <div className="font-mono opacity-70">#{idx + 1}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Template-specific section (light v1; later: real assessment/price blocks) */}
          <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
            {model.templateKey === "before_after" ? (
              <>
                <div className="font-semibold">Before / After summary</div>
                <div className="mt-1 text-sm opacity-90">
                  This layout is optimized for showing customer photos prominently, with clean supporting visuals.
                </div>
              </>
            ) : model.templateKey === "visual_first" ? (
              <>
                <div className="font-semibold">Visual-first note</div>
                <div className="mt-1 text-sm opacity-90">
                  This layout leads with images and keeps copy minimal for fast conversion.
                </div>
              </>
            ) : (
              <>
                <div className="font-semibold">Standard quote summary</div>
                <div className="mt-1 text-sm opacity-90">
                  Balanced layout: concise copy + a featured visual + a clean image gallery.
                </div>
              </>
            )}
          </div>

          {/* Closing */}
          <div
            ref={closingRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={() => {
              const v = toLines(closingRef.current?.innerText || "");
              onEdit.setClosing(v);
            }}
            className="mt-6 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200 outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20 rounded-lg px-2 -mx-2 py-2"
          >
            {toLines(model.closing)}
          </div>

          {/* Footer */}
          <div className="mt-6 border-t border-gray-200 dark:border-gray-800 pt-4 text-[11px] text-gray-500 dark:text-gray-400">
            You’re viewing a live preview. Sending + final HTML export will be wired next.
          </div>
        </div>
      </div>
    </div>
  );
}