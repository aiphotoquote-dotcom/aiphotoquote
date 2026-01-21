// src/lib/auth/useSession.ts
"use client";

import { useEffect, useState } from "react";

type SessionResp =
  | {
      ok: true;
      identity: { provider: string; subject: string; email: string | null; name: string | null };
      appUserId: string;
      user: { id: string; email: string | null; name: string | null; authProvider: string } | null;
      activeTenantId: string | null;
    }
  | { ok: false; error: string; message?: string };

async function safeJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`Expected JSON, got "${ct}" (status ${res.status}). ${text.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

export function useSession() {
  const [data, setData] = useState<SessionResp | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      const json = await safeJson<SessionResp>(res);
      setData(json);
    } catch (e: any) {
      setData({ ok: false, error: "FETCH_FAILED", message: e?.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return { data, loading, refresh };
}