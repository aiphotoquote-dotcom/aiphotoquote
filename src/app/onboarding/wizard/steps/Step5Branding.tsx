// src/app/onboarding/wizard/steps/Step5Branding.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { guessLogoUrl } from "../utils";
import { Field } from "./Field";

function isEmail(v: string) {
  const s = String(v ?? "").trim();
  if (!s.includes("@")) return false;
  // simple “good enough” check for onboarding (don’t over-reject)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function pickBestEmailFromAnalysis(aiAnalysis: any | null | undefined): string {
  const emails: string[] = [];

  // common places we might have put it in analysis
  const direct = [
    aiAnalysis?.contactEmail,
    aiAnalysis?.ownerEmail,
    aiAnalysis?.email,
    aiAnalysis?.debug?.contactEmail,
    aiAnalysis?.debug?.email,
  ];
  for (const v of direct) {
    const s = String(v ?? "").trim();
    if (s && isEmail(s)) emails.push(s);
  }

  // scan “extractedTextPreview” if present
  const blob = String(aiAnalysis?.extractedTextPreview ?? aiAnalysis?.debug?.extractedTextPreview ?? "").trim();
  if (blob) {
    const matches = blob.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    for (const m of matches) {
      const s = String(m ?? "").trim();
      if (s && isEmail(s)) emails.push(s);
    }
  }

  // try structured fields if you stored them
  const maybeList: any[] = Array.isArray(aiAnalysis?.contactEmails) ? aiAnalysis.contactEmails : [];
  for (const v of maybeList) {
    const s = String(v ?? "").trim();
    if (s && isEmail(s)) emails.push(s);
  }

  // prefer “info@ / quotes@ / sales@ / support@ / contact@” over random
  const uniq = Array.from(new Set(emails));
  const preferredPrefixes = ["leads@", "quotes@", "info@", "sales@", "support@", "contact@"];

  for (const p of preferredPrefixes) {
    const hit = uniq.find((e) => e.toLowerCase().startsWith(p));
    if (hit) return hit;
  }

  return uniq[0] ?? "";
}

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
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const suggestedLogo = useMemo(() => guessLogoUrl(props.aiAnalysis), [props.aiAnalysis]);
  const suggestedLeadEmail = useMemo(() => pickBestEmailFromAnalysis(props.aiAnalysis), [props.aiAnalysis]);

  useEffect(() => {
    // one-time gentle autofill
    if (!brandLogoUrl.trim() && suggestedLogo) setBrandLogoUrl(String(suggestedLogo).trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedLogo]);

  useEffect(() => {
    if (!leadToEmail.trim() && suggestedLeadEmail) setLeadToEmail(String(suggestedLeadEmail).trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedLeadEmail]);

  async function uploadLogo(file: File) {
    const tid = String(props.tenantId ?? "").trim();
    if (!tid) throw new Error("NO_TENANT: missing tenantId for logo upload.");

    // Ensure correct tenant cookie before calling tenant-scoped upload endpoint
    await props.ensureActiveTenant(tid);

    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/admin/tenant-logo/upload", {
      method: "POST",
      body: fd,
      credentials: "include", // ✅ important on iOS/Safari + cookie-based tenant scope
      cache: "no-store",
    });

    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : { ok: false, error: await res.text() };

    if (!res.ok || !data?.ok) throw new Error(data?.message || data?.error || "Upload failed");
    return String(data.url || "").trim();
  }

  const canSave = isEmail(leadToEmail);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Branding & lead routing</div>

      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        We’ll send emails using{" "}
        <span className="font-mono">AI Photo Quote &lt;no-reply@aiphotoquote.com&gt;</span> on our Resend platform by
        default. You can personalize sender/branding later in tenant settings.
      </div>

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
                We try to auto-detect a logo from your website. You can upload a different one anytime.
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
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            We’ll email new quote requests to this address.
          </div>

          <div className="mt-4">
            <Field
              label="Lead to email"
              value={leadToEmail}
              onChange={setLeadToEmail}
              placeholder="leads@yourshop.com"
              type="email"
            />
          </div>

          {!leadToEmail.trim() ? (
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Tip: use the inbox you already watch (info@, quotes@, or your personal email).
            </div>
          ) : !canSave ? (
            <div className="mt-2 text-xs text-red-600 dark:text-red-300">Please enter a valid email address.</div>
          ) : null}
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