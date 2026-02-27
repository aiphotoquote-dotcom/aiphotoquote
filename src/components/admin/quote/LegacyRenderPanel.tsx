// src/components/admin/quote/LegacyRenderPanel.tsx
import React from "react";
import { chip, renderChip } from "@/components/admin/quote/ui";

export default function LegacyRenderPanel(props: {
  renderStatus: any;
  renderedAt: any;
  renderImageUrl: string | null;
  renderError: string | null;
  renderPrompt: string | null;
}) {
  const { renderStatus, renderedAt, renderImageUrl, renderError, renderPrompt } = props;

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-semibold">Rendering (legacy)</div>
        <div className="flex flex-wrap items-center gap-2">
          {renderChip(renderStatus)}
          {renderedAt ? chip(new Date(renderedAt).toLocaleString(), "gray") : null}
        </div>
      </div>

      <div className="mt-4">
        {renderImageUrl ? (
          <a href={renderImageUrl} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={renderImageUrl}
              alt="AI render"
              className="w-full rounded-2xl border border-gray-200 bg-white object-contain dark:border-gray-800"
            />
            <div className="mt-2 text-xs font-semibold text-gray-600 dark:text-gray-300">Click to open original</div>
          </a>
        ) : (
          <div className="text-sm text-gray-600 dark:text-gray-300 italic">No render available for this quote.</div>
        )}

        {renderError ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {renderError}
          </div>
        ) : null}

        {renderPrompt ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
              Render prompt (debug)
            </summary>
            <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-black p-4 text-xs text-white dark:border-gray-800">
{String(renderPrompt)}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}