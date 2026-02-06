// src/app/admin/setup/widget/ActiveTenantSync.tsx
"use client";

import React, { useEffect, useRef } from "react";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Sync active-tenant cookie to tenantId passed in URL.
 * - Prevents "wrong tenant" admin pages when a stale cookie exists.
 * - Safe: only runs once per mount (and is a no-op if tenantId is missing/invalid).
 */
export default function ActiveTenantSync({ tenantId }: { tenantId: string | null }) {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const tid = String(tenantId ?? "").trim();
    if (!tid || !isUuid(tid)) return;

    (async () => {
      try {
        await fetch("/api/tenant/context", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tenantId: tid }),
          credentials: "include",
          cache: "no-store",
        });
        // no hard dependency on response; if it fails, page still renders using tenantId param
      } catch {
        // ignore — rendering is already correct because server used tenantId param
      }
    })();
  }, [tenantId]);

  return null;
}