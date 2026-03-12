// src/components/admin/quote/RawPayloadPanel.tsx
import React from "react";

export default function RawPayloadPanel(props: { input: any }) {
  const { input } = props;

  return (
    <details className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <summary className="cursor-pointer text-sm font-semibold">Raw submission payload</summary>
      <pre className="mt-4 overflow-auto rounded-xl border border-gray-200 bg-black p-4 text-xs text-white dark:border-gray-800">
{JSON.stringify(input ?? {}, null, 2)}
      </pre>
    </details>
  );
}