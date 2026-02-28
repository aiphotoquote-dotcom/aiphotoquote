// src/components/admin/quote/QuoteHeader.tsx
import Link from "next/link";
import React from "react";

import { chip, renderChip } from "@/components/admin/quote/ui";

export default function QuoteHeader(props: {
  quoteId: string;
  submittedAtLabel: string;
  isRead: boolean;
  stageLabel: string;
  stageNorm: string;
  renderStatus: any;
  confidence: any;
  inspectionRequired: boolean | null;
  activeVersion: number | null;
  markUnreadAction: any;
  markReadAction: any;
}) {
  const {
    quoteId,
    submittedAtLabel,
    isRead,
    stageLabel,
    stageNorm,
    renderStatus,
    confidence,
    inspectionRequired,
    activeVersion,
    markUnreadAction,
    markReadAction,
  } = props;

  const composeHref = `/admin/quotes/${encodeURIComponent(quoteId)}/email/compose`;

  return (
    <header className="space-y-4">
      <div>
        <Link href="/admin/quotes" className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300">
          ← Back to quotes
        </Link>

        <h1 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">Quote review</h1>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
          <span>Submitted {submittedAtLabel}</span>
          <span className="text-gray-300 dark:text-gray-700">•</span>
          <span className="font-mono text-xs break-all">Quote: {quoteId}</span>
        </div>
      </div>

      {/* Primary action + guidance */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {isRead ? chip("Read", "gray") : chip("Unread", "yellow")}
            {chip(`Stage: ${stageLabel}`, stageNorm === "new" ? "blue" : "gray")}
            {renderChip(renderStatus)}
            {confidence ? chip(`Confidence: ${String(confidence)}`, "gray") : null}
            {inspectionRequired === true ? chip("Inspection required", "yellow") : null}
            {activeVersion != null ? chip(`Active: v${activeVersion}`, "green") : chip("Active: —", "gray")}
          </div>

          <div className="text-sm text-gray-700 dark:text-gray-200">
            Next step: pick your <span className="font-semibold">version</span>, select{" "}
            <span className="font-semibold">customer photos</span> + <span className="font-semibold">renders</span>, choose a{" "}
            <span className="font-semibold">template</span>, then send a polished quote email.
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={composeHref}
                className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Compose quote email
              </Link>

              <a
                href="#renders"
                className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-900"
              >
                Jump to versions & renders
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isRead ? (
                <form action={markUnreadAction}>
                  <button
                    type="submit"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  >
                    Mark unread
                  </button>
                </form>
              ) : (
                <form action={markReadAction}>
                  <button
                    type="submit"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  >
                    Mark read
                  </button>
                </form>
              )}
            </div>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400">
            Tip: the composer supports multiple images + templates (standard / before-after / visual-first).
          </div>
        </div>
      </div>
    </header>
  );
}