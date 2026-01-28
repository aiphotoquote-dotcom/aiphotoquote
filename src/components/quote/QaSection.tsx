// src/components/quote/QaSection.tsx
"use client";

import React from "react";

export function QaSection({
  sectionRef,
  firstInputRef,
  working,
  needsQa,
  qaQuestions,
  qaAnswers,
  quoteLogId,
  onAnswer,
  onSubmit,
}: {
  sectionRef: React.RefObject<HTMLElement | null>;
  firstInputRef: React.RefObject<HTMLInputElement | null>;
  working: boolean;

  needsQa: boolean;
  qaQuestions: string[];
  qaAnswers: string[];
  quoteLogId: string | null;

  onAnswer: (idx: number, v: string) => void;
  onSubmit: () => Promise<void>;
}) {
  if (!needsQa) return null;

  return (
    <section
      ref={sectionRef as any}
      className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Quick questions</h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          One more step — answer these and we’ll finalize your estimate.
        </p>
      </div>

      <div className="space-y-3">
        {qaQuestions.map((q, i) => (
          <label key={i} className="block">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">
              {i + 1}. {q} <span className="text-red-600">*</span>
            </div>
            <input
              id={`qa-input-${i}`}
              ref={i === 0 ? firstInputRef : undefined}
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              value={qaAnswers[i] ?? ""}
              onChange={(e) => onAnswer(i, e.target.value)}
              placeholder="Type your answer…"
              disabled={working}
            />
          </label>
        ))}
      </div>

      <button
        className="w-full rounded-xl bg-black text-white py-4 font-semibold disabled:opacity-50 dark:bg-white dark:text-black"
        onClick={() => onSubmit()}
        disabled={working || !quoteLogId}
      >
        {working ? "Working…" : "Finalize Estimate"}
      </button>

      <div className="text-xs text-gray-600 dark:text-gray-300">Ref: {quoteLogId ? quoteLogId.slice(0, 8) : "(missing)"}</div>
    </section>
  );
}