// src/components/admin/quote/QuoteHeader.tsx
import React from "react";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export default function QuoteHeader(props: {
  quoteId: string;
  submittedAtLabel: string;

  isRead: boolean;
  stageLabel: string;
  stageNorm: string;

  // ✅ kept for back-compat (page still passes these), but intentionally unused
  stages?: Array<{ key: string; label: string }>;
  stageIndex?: number;
  stagePct?: number;

  renderStatus: any;
  confidence: any;
  inspectionRequired: boolean | null;
  activeVersion: number | null;

  markUnreadAction: any;
  markReadAction: any;
}) {
  const quoteId = safeTrim(props.quoteId);
  const submittedAtLabel = safeTrim(props.submittedAtLabel) || "—";

  const stageLabel = safeTrim(props.stageLabel) || "—";

  const renderStatus = safeTrim(props.renderStatus) || "—";
  const confidence = props.confidence == null || props.confidence === "" ? null : String(props.confidence);
  const inspectionRequired = typeof props.inspectionRequired === "boolean" ? props.inspectionRequired : null;

  const activeVersion =
    typeof props.activeVersion === "number" && Number.isFinite(props.activeVersion) ? props.activeVersion : null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[240px]">
          <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Quote</div>
          <div className="mt-1 font-mono text-xs text-gray-500 dark:text-gray-400">{quoteId}</div>
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Submitted: {submittedAtLabel}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-extrabold text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">
            Stage: {stageLabel}
          </span>

          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-extrabold text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">
            Render: {renderStatus}
          </span>

          {activeVersion != null ? (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-extrabold text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">
              Active v{activeVersion}
            </span>
          ) : null}

          {confidence != null && confidence !== "" ? (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-extrabold text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">
              Confidence: {confidence}
            </span>
          ) : null}

          {inspectionRequired != null ? (
            <span
              className={
                "inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold " +
                (inspectionRequired
                  ? "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200"
                  : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200")
              }
            >
              {inspectionRequired ? "Inspection required" : "No inspection"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {props.isRead ? (
          <form action={props.markUnreadAction}>
            <input type="hidden" name="quoteId" value={quoteId} />
            <button
              className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950/20 dark:text-gray-100 dark:hover:bg-gray-900/30"
              type="submit"
            >
              Mark unread
            </button>
          </form>
        ) : (
          <form action={props.markReadAction}>
            <input type="hidden" name="quoteId" value={quoteId} />
            <button
              className="inline-flex items-center rounded-lg bg-black px-3 py-2 text-xs font-extrabold text-white hover:opacity-90 dark:bg-white dark:text-black"
              type="submit"
            >
              Mark read
            </button>
          </form>
        )}
      </div>
    </div>
  );
}