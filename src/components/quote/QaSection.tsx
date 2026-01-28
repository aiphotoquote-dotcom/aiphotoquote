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
  onStartOver,
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
  onStartOver?: () => void;
}) {
  if (!needsQa) return null;

  const inputCls =
    "mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-[16px] text-gray-900 outline-none focus:ring-2 focus:ring-emerald-300 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100";

  return (
    <section
      ref={sectionRef as any}
      className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Quick questions</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            One more step — answer these and we’ll finalize your estimate.
          </p>
          {quoteLogId ? <div className="mt-2 text-xs text-gray-500">Ref: {String(quoteLogId).slice(0, 8)}</div> : null}
        </div>

        {onStartOver ? (
          <button
            type="button"
            className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
            onClick={onStartOver}
            disabled={working}
          >
            Start Over
          </button>
        ) : null}
      </div>

      <div className="space-y-4">
        {qaQuestions.map((q, idx) => {
          const id = `qa-input-${idx}`;
          const val = String(qaAnswers?.[idx] ?? "");

          return (
            <label key={`${quoteLogId || "noqid"}-${idx}-${q}`} className="block">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {idx + 1}. {q} <span className="text-red-600">*</span>
              </div>

              <input
                id={id}
                ref={idx === 0 ? firstInputRef : undefined}
                className={inputCls}
                value={val}
                onChange={(e) => onAnswer(idx, e.target.value)}
                placeholder="Type your answer…"
                disabled={working}
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="sentences"
                spellCheck={true}
              />
            </label>
          );
        })}
      </div>

      <button
        type="button"
        className="w-full rounded-xl bg-black text-white py-4 font-semibold disabled:opacity-50 dark:bg-white dark:text-black"
        onClick={() => onSubmit()}
        disabled={working}
        aria-busy={working}
      >
        Finalize Estimate
      </button>
    </section>
  );
}