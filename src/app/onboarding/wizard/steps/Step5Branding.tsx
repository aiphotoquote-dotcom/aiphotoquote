// src/app/onboarding/wizard/steps/Step5Branding.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { guessLogoUrl } from "../utils";
import { Field } from "./Field";

type BrandGuessResponse = {
  ok: boolean;
  tenantId: string;
  website: string | null;
  current?: { brandLogoUrl: string | null; leadToEmail: string | null };
  suggested?: { brandLogoUrl: string | null; leadToEmail: string | null };
  error?: string;
  message?: string;
};

export function Step5Branding(props: {
  tenantId: string | null;
  aiAnalysis: any | null | undefined;
  ensureActiveTenant: (tid: string) => Promise<void>;
  onBack: () => void;
  onSubmit: (payload: { leadToEmail: string; brandLogoUrl?: string | null }) => Promise<void>;
}) {
  const [leadToEmail, setLeadToEmail] = useState("");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingGuess, setLoadingGuess] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const suggestedLogoFromAi = useMemo(() => guessLogoUrl(props.aiAnalysis), [props.aiAnalysis]);

  // ✅ If we already have AI analysis guess and logo field is empty, prime it immediately
  useEffect(() => {
    if (!brandLogoUrl.trim() && suggestedLogoFromAi) setBrandLogoUrl(String(suggestedLogoFromAi).trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedLogoFromAi]);

  // ✅ Server-side “brand guess” autofill (scrape + saved tenant_settings)
  useEffect(() => {
    const tid = String(props.tenantId ?? "").trim();
    if (!tid) return;

    // Only fetch guesses if fields are still empty (don’t clobber user edits)
    if (leadToEmail.trim() || brandLogoUrl.trim()) return;

    let alive = true;

    (async () => {
      setLoadingGuess(true);
      setErr(null);
      try {
        // Not strictly required for this route, but safe: keeps tenant context consistent across flows
        await props.ensureActiveTenant(tid).catch(() => null);

        const res = await fetch(`/api/onboarding/brand-guess?tenantId=${encodeURIComponent(tid)}`, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });

        const j = (await res.json().catch(() => null)) as BrandGuessResponse | null;
        if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `Failed to fetch brand guess (HTTP ${res.status})`);

        if (!alive) return;

        const currentLogo = String(j?.current?.brandLogoUrl ?? "").trim();
        const currentEmail = String(j?.current?.leadToEmail ?? "").trim();

        const suggLogo = String(j?.suggested?.brandLogoUrl ?? "").trim();
        const suggEmail = String(j?.suggested?.leadToEmail ?? "").trim();

        // prefer current (saved), else suggested
        if (!brandLogoUrl.trim() && (currentLogo || suggLogo)) setBrandLogoUrl((currentLogo || suggLogo).trim());
        if (!leadToEmail.trim() && (currentEmail || suggEmail)) setLeadToEmail((currentEmail || suggEmail).trim());
      } catch (ex: any) {
        if (!alive) return;
        setErr(ex?.message ?? String(ex));
      } finally {
        if (alive) setLoadingGuess(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tenantId]);

  async function uploadLogo(file: File) {
    const tid = String(props.tenantId ?? "").trim();
    if (!tid) throw new Error("NO_TENANT: missing tenantId for logo upload.");

    // Ensure correct tenant cookie before calling tenant-scoped upload endpoint
    await props.ensureActiveTenant(tid);

    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/admin/tenant-logo/upload", { method: "POST", body: fd });
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : { ok: false, error: await res.text() };

    if (!res.ok || !data?.ok) throw new Error(data?.message || data?.error || "Upload failed");
    return String(data.url || "").trim();
  }

  const canSave = leadToEmail.trim().includes("@");

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Branding & lead routing</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Default sender will be <span className="font-mono">AI Photo Quote &lt;no-reply@aiphotoquote.com&gt;</span>. You can
        personalize later in tenant settings.
      </div>

      {loadingGuess ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          Pulling your logo + lead email from your website…
        </div>
      ) : null}

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        <div className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Logo</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                We try to auto-detect a logo from your website. Upload a different one anytime.
              </div>
            </div>

            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;

                  setErr(null);
                  setUploading(true);
                  try {
                    const url = await uploadLogo(f);
                    setBrandLogoUrl(url);
                  } catch (ex: any) {
                    setErr(ex?.message ?? String(ex));
                  } finally {
                    setUploading(false);
                    if (fileRef.current) fileRef.current.value = "";
                  }
                }}
              />

              <button
                type="button"
                className="rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
                disabled={uploading || saving}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>

              {brandLogoUrl.trim() ? (
                <button
                  type="button"
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                  onClick={() => setBrandLogoUrl("")}
                  disabled={uploading || saving}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 dark:border-gray-700 dark:bg-black/30">
            {brandLogoUrl.trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brandLogoUrl.trim()} alt="Logo preview" className="max-h-24 max-w-[280px] object-contain" />
            ) : (
              <div className="text-sm text-gray-500 dark:text-gray-400">No logo selected.</div>
            )}
          </div>

          <div className="mt-3">
            <Field label="Logo URL (optional)" value={brandLogoUrl} onChange={setBrandLogoUrl} placeholder="https://..." />
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Where should leads be sent?</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">We’ll email new quote requests to this address.</div>

          <div className="mt-4">
            <Field
              label="Lead to email"
              value={leadToEmail}
              onChange={setLeadToEmail}
              placeholder="leads@yourshop.com"
              type="email"
            />
          </div>

          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Tip: use the inbox you already watch (info@, quotes@, or your personal email).
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          onClick={props.onBack}
          disabled={saving || uploading}
        >
          Back
        </button>

        <button
          type="button"
          className="rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
          disabled={!canSave || saving || uploading}
          onClick={async () => {
            setErr(null);
            setSaving(true);
            try {
              await props.onSubmit({
                leadToEmail: leadToEmail.trim(),
                brandLogoUrl: brandLogoUrl.trim() ? brandLogoUrl.trim() : null,
              });
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save & Continue"}
        </button>
      </div>
    </div>
  );
}