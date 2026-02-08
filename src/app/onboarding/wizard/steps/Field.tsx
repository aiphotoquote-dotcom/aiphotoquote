"use client";

import React from "react";

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;

  // ✅ passthrough controls for iOS / URL fields
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoCorrect?: "on" | "off";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  spellCheck?: boolean;
}) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{props.label}</div>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        autoCorrect={props.autoCorrect}
        autoCapitalize={props.autoCapitalize}
        spellCheck={props.spellCheck}
        // extra iOS “don’t be helpful” hints
        autoComplete={props.type === "url" ? "url" : undefined}
        className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none focus:border-gray-400 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
      />
    </label>
  );
}