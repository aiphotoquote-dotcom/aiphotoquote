"use client";

import React from "react";

export function HandoffStep(props: {
  title: string;
  desc: string;
  primaryLabel: string;
  onPrimary: () => void;
  onBack: () => void;
  onContinue: () => void;
  note?: string;
  continueLabel?: string;
}) {
  return (
    <div>
      <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">{props.title}</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{props.desc}</div>

      {props.note ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
          {props.note}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3">
        <button
          type="button"
          className="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white"
          onClick={props.onPrimary}
        >
          {props.primaryLabel}
        </button>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className="rounded-2xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            onClick={props.onBack}
          >
            Back
          </button>
          <button
            type="button"
            className="rounded-2xl bg-black py-3 text-sm font-semibold text-white dark:bg-white dark:text-black"
            onClick={props.onContinue}
          >
            {props.continueLabel ?? "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}