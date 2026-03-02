import React from "react";

type StageItem = {
  key: string;
  label: string;
};

function chip(text: string, tone: "gray" | "blue" | "green" | "red" = "gray") {
  const base =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold " +
    "dark:border-gray-800";

  const toneCls =
    tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-200"
      : tone === "green"
        ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/40 dark:bg-green-950/40 dark:text-green-200"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
          : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200";

  return <span className={base + " " + toneCls}>{text}</span>;
}

export default function QuoteHeader(props: {
  quoteId: string;
  submittedAtLabel: string;
  isRead: boolean;

  stageLabel: string;
  stageNorm: string;

  // ✅ for progress bar + chips
  stages: StageItem[];
  stageIndex: number;
  stagePct: number;

  renderStatus: any;
  confidence: any;
  inspectionRequired: boolean | null;
  activeVersion: number | null;

  // server actions (module exports)
  markUnreadAction: any;
  markReadAction: any;
}) {
  const {
    quoteId,
    submittedAtLabel,
    isRead,
    stageLabel,
    stageNorm,
    stages,
    stageIndex,
    stagePct,
    activeVersion,
    markUnreadAction,
    markReadAction,
  } = props;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <a href="/admin/quotes" className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300">
            ← Back to quotes
          </a>

          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Quote</h1>

            {chip(stageLabel, "blue")}
            {activeVersion != null ? chip(`active v${activeVersion}`, "green") : chip("no active version", "gray")}
            {isRead ? chip("READ", "gray") : chip("UNREAD", "red")}
          </div>

          <div className="text-xs text-gray-600 dark:text-gray-300">
            <span className="font-mono break-all">{quoteId}</span>
            <span className="mx-2 opacity-60">·</span>
            Submitted: <span className="font-mono">{submittedAtLabel}</span>
            <span className="mx-2 opacity-60">·</span>
            Stage key: <span className="font-mono">{String(stageNorm)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form action={markUnreadAction}>
            <input type="hidden" name="quote_id" value={quoteId} />
            <button
              type="submit"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Mark unread
            </button>
          </form>

          <form action={markReadAction}>
            <input type="hidden" name="quote_id" value={quoteId} />
            <button
              type="submit"
              className="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Mark read
            </button>
          </form>
        </div>
      </div>

      {/* ✅ Progress bar + stage chips */}
      <div className="mt-5">
        <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
          <div className="font-semibold">Progress</div>
          <div className="font-mono">{Number.isFinite(stagePct) ? `${stagePct}%` : "—"}</div>
        </div>

        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-900">
          <div className="h-full bg-black dark:bg-white" style={{ width: `${Math.max(0, Math.min(100, stagePct))}%` }} />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(stages ?? []).slice(0, 8).map((s, idx) => {
            const isDone = idx < stageIndex;
            const isActive = idx === stageIndex;
            const tone: any = isActive ? "blue" : isDone ? "green" : "gray";
            return (
              <span key={s.key}>
                {chip(s.label, tone)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}