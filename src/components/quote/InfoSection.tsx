// src/components/quote/InfoSection.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

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

  // NEW
  collapsed = false,
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

  // ✅ when true, show a compact “info received” card with an Edit toggle
  collapsed?: boolean;
}) {
  // Local expand/collapse so QA can keep it compact, but user can still edit.
  const [expanded, setExpanded] = useState(!collapsed);

  useEffect(() => {
    // If parent says "not collapsed", ensure expanded.
    if (!collapsed) setExpanded(true);
    // If parent says "collapsed", default to compact view (but user can expand).
    if (collapsed) setExpanded(false);
  }, [collapsed]);

  // iOS Safari zoom guard:
  // Inline fontSize >= 16 prevents zoom even if classes get overridden.
  const inputCls =
    "mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100";
  const labelCls = "text-xs text-gray-700 dark:text-gray-200";

  const infoSummary = useMemo(() => {
    const parts = [
      customerName?.trim() ? customerName.trim() : null,
      email?.trim() ? email.trim() : null,
      phone?.trim() ? phone.trim() : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" • ") : "Info not completed yet.";
  }, [customerName, email, phone]);

  // Compact card (used during QA / after estimate) — keeps page from feeling “too tall”.
  if (collapsed && !expanded) {
    return (
      <section
        ref={sectionRef as any}
        className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">Your info</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 truncate">{infoSummary}</div>
          </div>

          <button
            type="button"
            className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
            onClick={() => setExpanded(true)}
            disabled={working}
          >
            Edit
          </button>
        </div>

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

  return (
    <section
      ref={sectionRef as any}
      className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Your info</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Required so we can send your estimate and follow up if needed.
          </p>
        </div>

        {collapsed ? (
          <button
            type="button"
            className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
            onClick={() => setExpanded(false)}
            disabled={working}
          >
            Collapse
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <div className={labelCls}>
            Name <span className="text-red-600">*</span>
          </div>
          <input
            className={inputCls}
            style={{ fontSize: 16 }}
            value={customerName}
            onChange={(e) => onCustomerName(e.target.value)}
            placeholder="Your name"
            disabled={working}
            autoComplete="name"
            inputMode="text"
            autoCapitalize="words"
          />
        </label>

        <label className="block">
          <div className={labelCls}>
            Email <span className="text-red-600">*</span>
          </div>
          <input
            className={inputCls}
            style={{ fontSize: 16 }}
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            placeholder="you@email.com"
            disabled={working}
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
      </div>

      <label className="block">
        <div className={labelCls}>
          Phone <span className="text-red-600">*</span>
        </div>
        <input
          className={inputCls}
          style={{ fontSize: 16 }}
          value={phone}
          onChange={(e) => onPhone(e.target.value)}
          placeholder="(555) 555-5555"
          disabled={working}
          inputMode="tel"
          autoComplete="tel"
        />
        <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          Tip: if you type a leading “1”, we’ll normalize it automatically.
        </div>
      </label>

      <label className="block">
        <div className={labelCls}>Notes</div>
        <textarea
          className={`${inputCls} resize-none`}
          style={{ fontSize: 16 }}
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
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Optional: AI rendering preview
              </div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                If selected, we’ll generate a visual “after” concept as a second step after your estimate.
              </div>
            </label>
          </div>
        </div>
      ) : null}

      {/* Hide “Get Estimate” CTA when parent wants compact mode (QA/estimate view). */}
      {!collapsed ? (
        <>
          <button
            type="button"
            className="w-full rounded-xl bg-black text-white py-3.5 font-semibold disabled:opacity-50 dark:bg-white dark:text-black"
            onClick={() => onSubmitEstimate()}
            disabled={!canSubmit}
            aria-busy={working}
          >
            Get Estimate
          </button>

          <div
            aria-live="polite"
            className={[
              "text-xs text-gray-600 dark:text-gray-300",
              "min-h-[2.5rem]",
            ].join(" ")}
          >
            {disabledReason ? (
              <span className="block leading-relaxed text-gray-500 dark:text-gray-400">{disabledReason}</span>
            ) : (
              <span className="block">&nbsp;</span>
            )}
          </div>
        </>
      ) : (
        <div className="text-xs text-gray-600 dark:text-gray-300">
          Info received. Continue below.
        </div>
      )}

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