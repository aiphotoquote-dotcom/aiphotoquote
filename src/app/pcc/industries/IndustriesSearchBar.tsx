// src/app/pcc/industries/IndustriesSearchBar.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function IndustriesSearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const currentQ = sp.get("q") ?? "";
  const [value, setValue] = useState(currentQ);

  // Keep input in sync if user clicks pills / back button, etc.
  useEffect(() => {
    setValue(currentQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQ]);

  const baseParams = useMemo(() => {
    // Clone current search params so we preserve sort/filter, etc.
    const p = new URLSearchParams(sp.toString());
    return p;
  }, [sp]);

  useEffect(() => {
    // debounce URL updates while typing
    const t = setTimeout(() => {
      const p = new URLSearchParams(baseParams.toString());
      const q = value.trim();

      if (!q) p.delete("q");
      else p.set("q", q);

      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, 300);

    return () => clearTimeout(t);
  }, [value, baseParams, pathname, router]);

  return (
    <div>
      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Search</div>
      <div className="mt-2 flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search industries (label or key)…"
          className={cn(
            "w-full rounded-xl border px-3 py-2 text-sm",
            "border-gray-200 bg-white text-gray-900 placeholder:text-gray-400",
            "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:placeholder:text-gray-600"
          )}
        />

        <button
          type="button"
          onClick={() => setValue("")}
          className={cn(
            "shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold",
            "border-gray-200 bg-white text-gray-900 hover:bg-gray-50",
            "dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-950"
          )}
          title="Clear search"
        >
          Clear
        </button>
      </div>

      <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
        Updates the URL automatically (debounced) so this stays server-rendered + shareable.
      </div>
    </div>
  );
}