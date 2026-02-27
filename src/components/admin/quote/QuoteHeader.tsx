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

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <Link href="/admin/quotes" className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300">
          ← Back to quotes
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Quote review</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Submitted {submittedAtLabel}</p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-wrap items-center gap-2">
          {isRead ? chip("Read", "gray") : chip("Unread", "yellow")}
          {chip(`Stage: ${stageLabel}`, stageNorm === "new" ? "blue" : "gray")}
          {renderChip(renderStatus)}
          {confidence ? chip(`Confidence: ${String(confidence)}`, "gray") : null}
          {inspectionRequired === true ? chip("Inspection required", "yellow") : null}
          {activeVersion != null ? chip(`Active: v${activeVersion}`, "green") : chip("Active: —", "gray")}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
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
    </div>
  );
}