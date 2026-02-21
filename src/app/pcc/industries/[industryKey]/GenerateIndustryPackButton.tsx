// src/app/pcc/industries/[industryKey]/GenerateIndustryPackButton.tsx
"use client";

import React, { useMemo, useState } from "react";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function safeLower(v: unknown) {
  return safeTrim(v).toLowerCase();
}

function clip(s: string, n = 900) {
  const t = safeTrim(s);
  if (!t) return "";
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

type Props = {
  industryKey: string;

  // Optional: pass these if the page already has them (nice UX, but not required)
  industryLabel?: string | null;
  industryDescription?: string | null;
};

type ApiOk = {
  ok: true;
  industryKey: string;
  version: number;
  id: string;
  meta?: any;
  preview?: {
    hasModels?: boolean;
    hasPrompts?: boolean;
    industryPackKeys?: string[];
    renderPromptAddendumLen?: number;
    renderNegativeGuidanceLen?: number;
  };
};

type ApiErr = {
  ok: false;
  error?: string;
  message?: string;
};

export default function GenerateIndustryPackButton(props: Props) {
  const industryKey = useMemo(() => safeLower(props.industryKey), [props.industryKey]);

  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ApiOk | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setErr(null);
    setBusy(true);

    try {
      const body: any = { mode: "backfill" };

      // If the page already knows these, we send them (helps generator quality).
      if (safeTrim(props.industryLabel)) body.industryLabel = props.industryLabel;
      if (safeTrim(props.industryDescription)) body.industryDescription = props.industryDescription;

      const url = `/api/pcc/industries/${encodeURIComponent(industryKey)}/llm-pack/generate`;

      // ✅ redirect: "manual" lets us SEE if auth/middleware is redirecting the POST
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "manual",
      });

      const ct = safeTrim(res.headers.get("content-type") || "");
      const location = safeTrim(res.headers.get("location") || "");

      // If we got a redirect, show it explicitly (most common cause of “mystery 405”)
      if (res.status >= 300 && res.status < 400) {
        setErr(
          [
            `HTTP_${res.status} redirect while calling: ${url}`,
            location ? `Location: ${location}` : `Location: (missing)`,
            `Content-Type: ${ct || "—"}`,
            `Likely auth/middleware redirect. If this turns POST -> GET, downstream can 405.`,
          ].join("\n")
        );
        return;
      }

      // Try JSON first if it looks like JSON
      let data: any = null;

      if (ct.includes("application/json")) {
        data = await res.json().catch(() => null);
      } else {
        // Not JSON (common when redirected to HTML login or error page)
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          setErr(
            [
              `Request failed (${res.status})`,
              `URL: ${url}`,
              `Content-Type: ${ct || "—"}`,
              location ? `Location: ${location}` : null,
              "",
              "Body (first 900 chars):",
              clip(text, 900) || "(empty body)",
            ]
              .filter(Boolean)
              .join("\n")
          );
          return;
        }

        // If res.ok but non-json, still treat as unexpected
        setErr(
          [
            `Unexpected non-JSON response (${res.status})`,
            `URL: ${url}`,
            `Content-Type: ${ct || "—"}`,
            "",
            "Body (first 900 chars):",
            clip(text, 900) || "(empty body)",
          ].join("\n")
        );
        return;
      }

      if (!res.ok) {
        const msg =
          safeTrim(data?.message) ||
          safeTrim(data?.error) ||
          `Request failed (${res.status})`;
        setErr(
          [
            msg,
            `HTTP_${res.status}`,
            `URL: ${url}`,
            location ? `Location: ${location}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        );
        return;
      }

      if (!data || data?.ok !== true) {
        const msg = safeTrim(data?.message) || safeTrim(data?.error) || "Unexpected response";
        setErr(
          [
            msg,
            `HTTP_${res.status}`,
            `URL: ${url}`,
          ].join("\n")
        );
        return;
      }

      setLast(data as ApiOk);
    } catch (e: any) {
      setErr(e?.message ?? String(e ?? "Unknown error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={busy || !industryKey}
        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-gray-900"
        title="Generate + store industry LLM pack in DB (industry_llm_packs)"
      >
        {busy ? "Generating LLM pack…" : "Generate LLM pack"}
      </button>

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          <div className="font-semibold">Generation failed</div>
          <pre className="mt-2 whitespace-pre-wrap font-mono break-words">{err}</pre>
        </div>
      ) : null}

      {last ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Saved</span>
            <span className="font-mono">v{last.version}</span>
            <span className="text-[11px] opacity-80">({String(last.id).slice(0, 8)}…)</span>
          </div>

          {last.preview ? (
            <div className="mt-2 grid gap-1">
              <div>
                models: <span className="font-mono">{last.preview.hasModels ? "yes" : "no"}</span> · prompts:{" "}
                <span className="font-mono">{last.preview.hasPrompts ? "yes" : "no"}</span>
              </div>

              <div>
                render addendum len:{" "}
                <span className="font-mono">{Number(last.preview.renderPromptAddendumLen ?? 0)}</span> · negative len:{" "}
                <span className="font-mono">{Number(last.preview.renderNegativeGuidanceLen ?? 0)}</span>
              </div>

              {Array.isArray(last.preview.industryPackKeys) && last.preview.industryPackKeys.length ? (
                <div className="truncate">
                  pack keys:{" "}
                  <span className="font-mono">{last.preview.industryPackKeys.slice(0, 6).join(", ")}</span>
                  {last.preview.industryPackKeys.length > 6 ? "…" : ""}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          Creates a new <span className="font-mono">industry_llm_packs</span> version row for{" "}
          <span className="font-mono">{industryKey || "—"}</span>.
        </div>
      )}
    </div>
  );
}