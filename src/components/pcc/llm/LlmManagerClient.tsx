// src/components/pcc/llm/LlmManagerClient.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { PlatformLlmConfig } from "@/lib/pcc/llm/types";

function prettyJson(obj: any) {
  return JSON.stringify(obj, null, 2);
}

export function LlmManagerClient({ initialConfig }: { initialConfig: PlatformLlmConfig }) {
  const [draft, setDraft] = useState(() => prettyJson(initialConfig));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(draft) };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "Invalid JSON" };
    }
  }, [draft]);

  async function reloadFromServer() {
    setErr(null);
    setMsg(null);
    setNewUrl(null);

    try {
      const res = await fetch("/api/pcc/llm", { method: "GET" });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error(j?.message || "Failed to load config.");
      setDraft(prettyJson(j.config));
      setMsg(j.sourceUrl ? `Loaded from PLATFORM_LLM_CONFIG_URL` : "Loaded default config (no PLATFORM_LLM_CONFIG_URL set).");
    } catch (e: any) {
      setErr(e?.message ?? "Load failed.");
    }
  }

  async function save() {
    setErr(null);
    setMsg(null);
    setNewUrl(null);

    if (!parsed.ok) {
      setErr(`Fix JSON first: ${parsed.error}`);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/pcc/llm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: parsed.value }),
      });

      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error(j?.message || "Save failed.");

      setNewUrl(j.url || null);
      setMsg("Saved. Paste the URL into Vercel env var PLATFORM_LLM_CONFIG_URL to make it the active config.");
    } catch (e: any) {
      setErr(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Platform LLM Config (JSON)</div>
          <div className="text-xs text-gray-600 dark:text-gray-300">
            V1 persistence writes to Vercel Blob. Canonical URL comes from env var <span className="font-mono">PLATFORM_LLM_CONFIG_URL</span>.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={reloadFromServer}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
          >
            Reload
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-gray-100"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {msg ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900/40 dark:bg-green-950/40 dark:text-green-200">
          {msg}
        </div>
      ) : null}

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200 whitespace-pre-wrap">
          {err}
        </div>
      ) : null}

      {newUrl ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900/30 dark:text-gray-100">
          <div className="font-semibold">New config URL</div>
          <div className="mt-1 font-mono break-all text-xs">{newUrl}</div>
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
            Set <span className="font-mono">PLATFORM_LLM_CONFIG_URL</span> to this value in Vercel → Environment Variables.
          </div>
        </div>
      ) : null}

      <div className="grid gap-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="min-h-[520px] w-full rounded-2xl border border-gray-200 bg-white p-4 font-mono text-xs text-gray-900 outline-none focus:ring-2 focus:ring-black/20 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:focus:ring-white/20"
        />
        <div className="text-xs text-gray-600 dark:text-gray-300">
          JSON status:{" "}
          {parsed.ok ? (
            <span className="font-semibold text-green-700 dark:text-green-300">Valid</span>
          ) : (
            <span className="font-semibold text-red-700 dark:text-red-300">Invalid</span>
          )}
        </div>
      </div>
    </div>
  );
}