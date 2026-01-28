// src/components/quote/InfoSection.tsx
"use client";

import React from "react";

export function InfoSection({
  sectionRef,
  working,
  customerName,
  email,
  phone,
  notes,
  disabledReason,
  canSubmit,
  aiRenderingEnabled,
  renderOptIn,
  onCustomerName,
  onEmail,
  onPhone,
  onNotes,
  onRenderOptIn,
  onSubmitEstimate,
  onStartOver,
}: {
  sectionRef: React.RefObject<HTMLElement | null>;
  working: boolean;

  customerName: string;
  email: string;
  phone: string;
  notes: string;

  disabledReason: string | null;
  canSubmit: boolean;

  aiRenderingEnabled: boolean;
  renderOptIn: boolean;

  onCustomerName: (v: string) => void;
  onEmail: (v: string) => void;
  onPhone: (v: string) => void;
  onNotes: (v: string) => void;
  onRenderOptIn: (v: boolean) => void;

  onSubmitEstimate: () => Promise<void>;
  onStartOver: () => void;
}) {
  return (
    <section
      ref={sectionRef as any}
      className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Your info</h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Required so we can send your estimate and follow up if needed.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <div className="text-xs text-gray-700 dark:text-gray-200">
            Name <span className="text-red-600">*</span>
          </div>
          <input
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            value={customerName}
            onChange={(e) => onCustomerName(e.target.value)}
            placeholder="Your name"
            disabled={working}
            autoComplete="name"
          />
        </label>

        <label className="block">
          <div className="text-xs text-gray-700 dark:text-gray-200">
            Email <span className="text-red-600">*</span>
          </div>
          <input
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            placeholder="you@email.com"
            disabled={working}
            inputMode="email"
            autoComplete="email"
          />
        </label>
      </div>

      <label className="block">
        <div className="text-xs text-gray-700 dark:text-gray-200">
          Phone <span className="text-red-600">*</span>
        </div>
        <input
          className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          value={phone}
          onChange={(e) => onPhone(e.target.value)}
          placeholder="(555) 555-5555"
          disabled={working}
          inputMode="tel"
          autoComplete="tel"
        />
        <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Tip: if you type a leading “1”, we’ll normalize it automatically.</div>
      </label>

      <label className="block">
        <div className="text-xs text-gray-700 dark:text-gray-200">Notes</div>
        <textarea
          className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          rows={4}
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          placeholder="What are you looking to do? Material preference, timeline, constraints?"
          disabled={working}
        />
      </label>

      {aiRenderingEnabled ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex items-start gap-3">
            <input
              id="renderOptIn"
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={renderOptIn}
              onChange={(e) => onRenderOptIn(e.target.checked)}
              disabled={working}
            />
            <label htmlFor="renderOptIn" className="cursor-pointer">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Optional: AI rendering preview</div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                If selected, we’ll generate a visual “after” concept as a second step after your estimate.
              </div>
            </label>
          </div>
        </div>
      ) : null}

      <button
        className="w-full rounded-xl bg-black text-white py-4 font-semibold disabled:opacity-50 dark:bg-white dark:text-black"
        onClick={() => onSubmitEstimate()}
        disabled={!canSubmit}
      >
        {working ? "Working…" : "Get Estimate"}
      </button>

      {disabledReason ? <div className="text-xs text-gray-600 dark:text-gray-300">{disabledReason}</div> : null}

      <button
        type="button"
        className="w-full rounded-xl border border-gray-200 py-3 text-sm font-semibold dark:border-gray-800"
        onClick={onStartOver}
        disabled={working}
      >
        Start Over
      </button>
    </section>
  );
}