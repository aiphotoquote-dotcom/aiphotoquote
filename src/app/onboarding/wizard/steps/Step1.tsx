"use client";

import React, { useState } from "react";
import { Field } from "./Field";

export function Step1(props: {
  existingUser: boolean;
  onSubmit: (payload: { businessName: string; website?: string; ownerName?: string; ownerEmail?: string }) => Promise<void>;
}) {
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);

  const can =
    businessName.trim().length >= 2 &&
    (props.existingUser ? true : ownerName.trim().length >= 2 && ownerEmail.trim().includes("@"));

  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">Business identity</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        This helps us personalize your estimates, emails, and branding.
      </div>

      <div className="mt-6 grid gap-4">
        <Field label="Business name" value={businessName} onChange={setBusinessName} placeholder="Maggio Upholstery" />

        {props.existingUser ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
            We already know who you are from your login — no need to re-enter your name and email.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Your name" value={ownerName} onChange={setOwnerName} placeholder="Joe Maggio" />
            <Field label="Your email" value={ownerEmail} onChange={setOwnerEmail} placeholder="you@shop.com" type="email" />
          </div>
        )}

        <Field label="Website (optional)" value={website} onChange={setWebsite} placeholder="https://yourshop.com" />
      </div>

      <button
        type="button"
        className="mt-6 w-full rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
        disabled={!can || saving}
        onClick={async () => {
          setSaving(true);
          try {
            await props.onSubmit({
              businessName: businessName.trim(),
              website: website.trim() || undefined,
              ownerName: props.existingUser ? undefined : ownerName.trim(),
              ownerEmail: props.existingUser ? undefined : ownerEmail.trim(),
            });
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