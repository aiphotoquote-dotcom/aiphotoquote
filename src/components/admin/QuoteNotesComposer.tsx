// src/components/admin/QuoteNotesComposer.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function QuoteNotesComposer({
  quoteLogId,
  className,
}: {
  quoteLogId: string;
  className?: string;
}) {
  const router = useRouter();

  const [body, setBody] = useState("");
  const [reassess, setReassess] = useState(false);
  const [engine, setEngine] = useState<"openai_assessment" | "deterministic_only">("openai_assessment");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const canSubmit = useMemo(() => body.trim().length > 0 && !busy, [body, busy]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setErr(null);
    setOkMsg(null);

    try {
      const res = await fetch(`/api/admin/quotes/${encodeURIComponent(quoteLogId)}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          reassess,
          engine,
          linkNoteToVersion: true,
          contextNotesLimit: 50,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        const msg = json?.error || json?.message || `HTTP ${res.status}`;
        throw new Error(String(msg));
      }

      setBody("");
      setOkMsg(
        json?.reassessed
          ? `Saved note + created version v${json?.version ?? "?"} (${json?.engine}).`
          : "Saved note."
      );

      // refresh server component data (note list + versions)
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950", className)}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Add internal note</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {busy ? "Saving…" : null}
          </div>
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type a shop note (materials, condition, special instructions, follow-ups, etc.)"
          rows={4}
          className="w-full rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:focus:ring-white/10"
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reassess}
              onChange={(e) => setReassess(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-gray-800 dark:text-gray-200">
              Re-run assessment using customer notes + internal notes
            </span>
          </label>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 dark:text-gray-300">Engine</span>
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value as any)}
              disabled={!reassess}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-gray-800 dark:bg-black"
            >
              <option value="openai_assessment">OpenAI assessment</option>
              <option value="deterministic_only">Deterministic only</option>
            </select>

            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-semibold",
                canSubmit
                  ? "bg-black text-white hover:opacity-90 dark:bg-white dark:text-black"
                  : "bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              )}
            >
              Save
            </button>
          </div>
        </div>

        {okMsg ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-2 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/40 dark:text-green-200">
            {okMsg}
          </div>
        ) : null}

        {err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
            {err}
          </div>
        ) : null}

        <div className="text-xs text-gray-500 dark:text-gray-400">
          Tip: keep notes specific (materials, measurements, “replace foam vs reuse,” stitching pattern, etc.).
        </div>
      </form>
    </div>
  );
}