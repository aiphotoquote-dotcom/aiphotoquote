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

  quoteBlocks: {
    showPricing: boolean;
    showSummary: boolean;
    showScope: boolean;
    showQuestions: boolean;
    showAssumptions: boolean;

    estimateText: string;
    confidence: string;
    inspectionRequired: boolean | null;

    summary: string;
    visibleScope: string[];
    questions: string[];
    assumptions: string[];
  };
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

function pill(text: string) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
      {text}
    </span>
  );
}

function sectionCard(title: string, children: React.ReactNode) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
      <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">{children}</div>
    </div>
  );
}

function editableClass() {
  return [
    "outline-none rounded-lg px-2 -mx-2",
    "focus:ring-2 focus:ring-black/15 dark:focus:ring-white/20",
    "hover:bg-gray-50/70 dark:hover:bg-white/5",
    "transition",
  ].join(" ");
}

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
    if (model.templateKey === "before_after") return "Before / After";
    if (model.templateKey === "visual_first") return "Visual First";
    return "Standard";
  }, [model.templateKey]);

  const galleryCols = model.templateKey === "visual_first" ? 3 : 2;
  const qb = model.quoteBlocks;

  const versionLabel = safeTrim(model.selectedVersionNumber) ? `v${safeTrim(model.selectedVersionNumber)}` : "v—";
  const quoteShort = String(model.quoteId || "").slice(0, 8);

  const toLine = (() => {
    const parts: string[] = [];
    const to = safeTrim(model.to);
    const cc = safeTrim(model.cc);
    const bcc = safeTrim(model.bcc);
    if (to) parts.push(`To: ${to}`);
    if (cc) parts.push(`CC: ${cc}`);
    if (bcc) parts.push(`BCC: ${bcc}`);
    return parts.join(" · ");
  })();

  const showBadges = Array.isArray(model.badges) && model.badges.length > 0;

  return (
    <div className="space-y-4">
      {/* App chrome (like a mail preview panel) */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-black">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
              <div className="h-3 w-3 rounded-full bg-gray-400 dark:bg-gray-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Email Preview</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {frameTitle} · {versionLabel} · quote {quoteShort}…
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            live · canvas · {model.templateKey}
          </div>
        </div>
      </div>

      {/* Canvas background */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
        {/* Email “paper” */}
        <div className="mx-auto max-w-[720px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-black">
          {/* Header rows */}
          <div className="border-b border-gray-200 dark:border-gray-800 px-6 py-4">
            <div className="text-[11px] font-semibold tracking-wide text-gray-500 dark:text-gray-400 uppercase">
              Subject
            </div>
            <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{model.subject}</div>

            {toLine ? (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">{toLine}</div>
            ) : (
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Tip: set To/CC/BCC above to see delivery details here.
              </div>
            )}
          </div>

          {/* Body */}
          <div className="px-6 py-7">
            {/* “Brand bar” placeholder (looks like marketing email) */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-xl bg-gray-900 dark:bg-white" />
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Your Shop Name</div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">Quote ready to review</div>
                </div>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {versionLabel} · {quoteShort}…
              </div>
            </div>

            {/* Headline */}
            <div className="mt-6">
              <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                Click any text to edit
              </div>
              <div
                ref={headlineRef}
                contentEditable
                suppressContentEditableWarning
                onBlur={() => {
                  const v = safeTrim(headlineRef.current?.innerText);
                  if (v) onEdit.setHeadline(v);
                }}
                className={[
                  editableClass(),
                  "mt-2 text-[28px] leading-tight font-semibold text-gray-900 dark:text-gray-100 py-1",
                ].join(" ")}
              >
                {model.headline}
              </div>
            </div>

            {/* Intro */}
            <div
              ref={introRef}
              contentEditable
              suppressContentEditableWarning
              onBlur={() => {
                const v = toLines(introRef.current?.innerText || "");
                onEdit.setIntro(v);
              }}
              className={[
                editableClass(),
                "mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-200 py-2",
              ].join(" ")}
            >
              {toLines(model.intro)}
            </div>

            {/* Pills */}
            <div className="mt-5 flex flex-wrap gap-2">
              {qb.showPricing && qb.estimateText ? pill(`Estimate: ${qb.estimateText}`) : null}
              {qb.confidence ? pill(`Confidence: ${qb.confidence}`) : null}
              {qb.inspectionRequired === true ? pill("Inspection required") : null}
              {showBadges ? model.badges.map((b, i) => <React.Fragment key={`${b}-${i}`}>{pill(b)}</React.Fragment>) : null}
            </div>

            {/* Quote blocks */}
            <div className="mt-6 space-y-3">
              {qb.showPricing ? (
                <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Quote at a glance</div>
                  <div className="mt-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
                    {qb.estimateText ? qb.estimateText : "Estimate pending"}
                  </div>
                  <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                    Reply to approve and we’ll schedule the job. If anything looks off, tell us what to adjust.
                  </div>
                  <div className="mt-4 rounded-xl bg-gray-900 px-4 py-3 text-center text-sm font-semibold text-white dark:bg-white dark:text-black">
                    Reply “Approved” to schedule
                  </div>
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
                    (You can ask questions or request changes — we’ll update the quote.)
                  </div>
                </div>
              ) : null}

              {qb.showSummary && qb.summary ? sectionCard("Summary", <div className="whitespace-pre-wrap">{qb.summary}</div>) : null}

              {qb.showScope && qb.visibleScope?.length ? (
                sectionCard(
                  "Visible scope",
                  <ul className="list-disc pl-5 space-y-1">
                    {qb.visibleScope.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                )
              ) : null}

              {qb.showQuestions && qb.questions?.length ? (
                sectionCard(
                  "A few quick questions (optional)",
                  <ul className="list-disc pl-5 space-y-1">
                    {qb.questions.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                )
              ) : null}

              {qb.showAssumptions && qb.assumptions?.length ? (
                sectionCard(
                  "Assumptions",
                  <ul className="list-disc pl-5 space-y-1">
                    {qb.assumptions.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>

            {/* Featured image */}
            {model.featuredImage ? (
              <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={model.featuredImage.url}
                  alt={model.featuredImage.label}
                  className="w-full object-cover max-h-[460px] bg-black/5"
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
              <div className="mt-6">
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Included images</div>
                <div
                  className={
                    "mt-3 grid gap-3 " + (galleryCols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")
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

            {/* Closing */}
            <div
              ref={closingRef}
              contentEditable
              suppressContentEditableWarning
              onBlur={() => {
                const v = toLines(closingRef.current?.innerText || "");
                onEdit.setClosing(v);
              }}
              className={[
                editableClass(),
                "mt-7 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200 py-2",
              ].join(" ")}
            >
              {toLines(model.closing)}
            </div>

            {/* Footer */}
            <div className="mt-8 border-t border-gray-200 dark:border-gray-800 pt-4 text-[11px] text-gray-500 dark:text-gray-400">
              Live preview canvas. Next: wire “Send” + generate final HTML.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}