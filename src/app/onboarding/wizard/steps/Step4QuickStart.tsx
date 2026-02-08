// src/app/onboarding/wizard/steps/Step4QuickStart.tsx
"use client";

import React, { useEffect, useState } from "react";

type Defaults = {
  industryKey: string;
  subIndustries: Array<{ key: string; label: string; blurb?: string | null }>;
  commonServices: string[];
  commonPhotoRequests: string[];
  defaultCustomerQuestions: string[];
};

type ApiResp =
  | { ok: true; tenantId: string; industryKey: string; defaults: Defaults }
  | { ok: false; error: string; message?: string };

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export function Step4QuickStart(props: {
  tenantId: string | null;
  onBack: () => void;
  onPrimary: () => Promise<void>; // open ai-policy setup
  onContinue: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [industryKey, setIndustryKey] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const tid = String(props.tenantId ?? "").trim();
      if (!tid) throw new Error("NO_TENANT: missing tenantId.");

      const res = await fetch(`/api/onboarding/industry-defaults-by-tenant?tenantId=${encodeURIComponent(tid)}`, {
        method: "GET",
        cache: "no-store",
      });

      const j = (await res.json().catch(() => null)) as ApiResp | null;
      if (!res.ok || !j || (j as any).ok !== true) {
        throw new Error((j as any)?.message || (j as any)?.error || `HTTP ${res.status}`);
      }

      setIndustryKey(String((j as any).industryKey ?? ""));
      setDefaults((j as any).defaults ?? null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setDefaults(null);
      setIndustryKey("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tenantId]);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Quick start (industry defaults)</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Even without a website, we can preload a solid starting experience based on your selected industry.
      </div>

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Loaded starter pack</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Source: platform defaults (v1). Later we’ll make these editable + industry-managed in PCC.
            </div>
          </div>

          {industryKey ? (
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
              industry: <span className="ml-1 font-mono">{industryKey}</span>
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">Loading defaults…</div>
        ) : defaults ? (
          <div className="mt-4 grid gap-4">
            {/* Services */}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Common services</div>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200">
                {defaults.commonServices.slice(0, 6).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>

            {/* Photo checklist */}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Recommended photo checklist</div>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200">
                {defaults.commonPhotoRequests.slice(0, 6).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>

            {/* Customer questions */}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Default customer questions</div>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200">
                {defaults.defaultCustomerQuestions.slice(0, 6).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>

            {/* Sub-industries */}
            {defaults.subIndustries?.length ? (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Suggested sub-industries</div>
                <div className="mt-2 grid gap-2">
                  {defaults.subIndustries.slice(0, 6).map((s) => (
                    <div
                      key={s.key}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-950"
                    >
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{s.label}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-gray-600 dark:text-gray-300">{s.key}</div>
                      {s.blurb ? <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{s.blurb}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="text-xs text-gray-500 dark:text-gray-400">
              Next: we’ll apply these defaults inside <span className="font-semibold">AI Policy</span> so your estimator language,
              Q&amp;A, and rendering behavior matches the industry.
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
            No defaults available yet.
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          onClick={props.onBack}
          disabled={loading}
        >
          Back
        </button>

        <div className="grid gap-2">
          <button
            type="button"
            className={cn(
              "rounded-2xl py-3 text-sm font-semibold",
              "bg-black text-white dark:bg-white dark:text-black"
            )}
            onClick={() => props.onPrimary()}
            disabled={loading}
          >
            Open AI Policy setup
          </button>

          <button
            type="button"
            className="rounded-2xl border border-gray-200 bg-white py-2 text-xs font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            onClick={props.onContinue}
            disabled={loading}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}