// src/app/onboarding/wizard/steps/Step1.tsx
"use client";

import React, { useMemo, useState } from "react";
import { Field } from "./Field";

function toTitleCase(raw: string) {
  const s = String(raw ?? "");

  // Preserve multiple spaces while typing, but normalize weird whitespace.
  const parts = s.split(/(\s+)/); // keep separators
  const keepUpper = new Set([
    "llc",
    "inc",
    "ltd",
    "co",
    "usa",
    "us",
    "ai",
    "hvac",
    "rv",
    "atv",
    "utv",
    "bbb",
  ]);

  return parts
    .map((p) => {
      if (/^\s+$/.test(p)) return p; // keep whitespace chunks
      const w = p.trim();
      if (!w) return p;

      // If word is already all-caps and short-ish, keep it (acronyms)
      if (w.length <= 5 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;

      const low = w.toLowerCase();
      if (keepUpper.has(low)) return low.toUpperCase();

      // Handle words like "joe's" -> "Joe's"
      const first = w.slice(0, 1).toUpperCase();
      const rest = w.slice(1).toLowerCase();
      return first + rest;
    })
    .join("");
}

function normalizeWebsiteInputLive(raw: string) {
  // Remove spaces as user types (iOS can insert them)
  // Keep everything else as-is; final normalization happens server-side.
  return String(raw ?? "").replace(/\s+/g, "");
}

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export function Step1(props: {
  existingUser: boolean;
  onSubmit: (payload: { businessName: string; website?: string; ownerName?: string; ownerEmail?: string }) => Promise<void>;
}) {
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const can = useMemo(() => {
    const bnOk = businessName.trim().length >= 2;
    if (!bnOk) return false;
    if (props.existingUser) return true;
    return ownerName.trim().length >= 2 && ownerEmail.trim().includes("@");
  }, [businessName, ownerName, ownerEmail, props.existingUser]);

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Business identity</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        This helps us personalize your estimates, emails, and branding.
      </div>

      {err ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {err}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        <Field
          label="Business name"
          value={businessName}
          onChange={(v) => {
            setErr(null);
            setBusinessName(toTitleCase(v));
          }}
          placeholder="Maggio Upholstery"
          autoCapitalize="words"
        />

        {props.existingUser ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
            We already know who you are from your login — no need to re-enter your name and email.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Your name"
              value={ownerName}
              onChange={(v) => {
                setErr(null);
                setOwnerName(toTitleCase(v));
              }}
              placeholder="Joe Maggio"
              autoCapitalize="words"
            />
            <Field
              label="Your email"
              value={ownerEmail}
              onChange={(v) => {
                setErr(null);
                setOwnerEmail(v);
              }}
              placeholder="you@shop.com"
              type="email"
            />
          </div>
        )}

        <Field
          label="Website (optional)"
          value={website}
          onChange={(v) => {
            setErr(null);
            setWebsite(normalizeWebsiteInputLive(v));
          }}
          placeholder="https://yourshop.com"
          type="url"
          inputMode="url"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <button
        type="button"
        className="mt-6 w-full rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
        disabled={!can || saving}
        onClick={async () => {
          if (saving) return;

          setErr(null);
          setSaving(true);

          const payload = {
            businessName: toTitleCase(businessName).trim(),
            website: normalizeWebsiteInputLive(website).trim() || undefined,
            ownerName: props.existingUser ? undefined : toTitleCase(ownerName).trim(),
            ownerEmail: props.existingUser ? undefined : ownerEmail.trim(),
          };

          try {
            // Basic client-side guardrails (keeps server errors cleaner)
            if (payload.businessName.length < 2) throw new Error("Business name is required.");
            if (!props.existingUser) {
              if (!safeTrim(payload.ownerName).length || safeTrim(payload.ownerName).length < 2) throw new Error("Your name is required.");
              if (!safeTrim(payload.ownerEmail).includes("@")) throw new Error("Enter a valid email.");
            }

            await props.onSubmit(payload);
          } catch (e: any) {
            const msg = e?.message ?? String(e);
            console.error("Step1 submit failed:", e);
            setErr(msg);
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}