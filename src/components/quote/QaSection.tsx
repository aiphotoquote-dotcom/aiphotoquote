// src/components/quote/QaSection.tsx
"use client";

import React, { useCallback } from "react";

export function QaSection({
  sectionRef,
  firstInputRef,
  working,
  needsQa,
  qaQuestions,
  qaAnswers,
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

  onAnswer: (idx: number, v: string) => void;
  onSubmit: () => Promise<void>;
  onStartOver?: () => void;
}) {
  if (!needsQa) return null;

  const inputCls =
    "mt-2 w-full min-w-0 rounded-xl border border-gray-200 bg-white p-3 text-[16px] text-gray-900 outline-none focus:ring-2 focus:ring-emerald-300 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100";

  const focusInput = useCallback((idx: number) => {
    const el = document.getElementById(`qa-input-${idx}`) as HTMLInputElement | null;
    if (el) el.focus();
  }, []);

  const onKeyDown = useCallback(
    async (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;

      e.preventDefault();

      const isLast = idx >= qaQuestions.length - 1;
      if (!isLast) {
        focusInput(idx + 1);
        return;
      }

      // last question: submit
      await onSubmit();
    },
    [qaQuestions.length, focusInput, onSubmit]
  );

  return (
    <section
      ref={sectionRef as any}
      className="w-full max-w-full min-w-0 overflow-x-hidden rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Quick questions</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            One more step — answer these and we’ll finalize your estimate.
          </p>
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
            <label key={`qa-${idx}`} className="block min-w-0">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 break-words">
                {idx + 1}. {q} <span className="text-red-600">*</span>
              </div>

              <input
                id={id}
                ref={idx === 0 ? firstInputRef : undefined}
                className={inputCls}
                value={val}
                onChange={(e) => onAnswer(idx, e.target.value)}
                onKeyDown={(e) => onKeyDown(idx, e)}
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