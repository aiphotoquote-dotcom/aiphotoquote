// src/app/pcc/tenants/[tenantId]/ExitImpersonationButton.tsx
"use client";

import React, { useState } from "react";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function ExitImpersonationButton() {
  const [working, setWorking] = useState(false);

  async function stopImpersonation() {
    if (working) return;

    setWorking(true);
    try {
      const res = await fetch("/api/pcc/impersonation", {
        method: "DELETE",
        credentials: "include",
      });

      const data = await res.json().catch(() => null);
      const redirectTo = data?.redirectTo || "/pcc/tenants";
      window.location.assign(redirectTo);
    } catch {
      window.location.assign("/pcc/tenants");
    } finally {
      setWorking(false);
    }
  }

  return (
    <button
      type="button"
      onClick={stopImpersonation}
      disabled={working}
      className={cn(
        "inline-flex items-center rounded-xl border px-3 py-2 text-xs font-semibold",
        "border-red-200 bg-red-50 text-red-800 hover:bg-red-100",
        "disabled:opacity-50 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/50"
      )}
    >
      {working ? "Exiting…" : "Exit impersonation"}
    </button>
  );
}