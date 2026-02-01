// src/components/quoteForm/useRenderPreview.ts
"use client";

import { useEffect, useRef, useState } from "react";
import { isAbortError, sleep } from "./helpers";

export type RenderStatus = "idle" | "running" | "rendered" | "failed";

export function useRenderPreview(params: {
  tenantSlug: string;
  enabled: boolean; // aiRenderingEnabled
  optIn: boolean;   // renderOptIn
  quoteLogId: string | null;
  mode: "entry" | "qa" | "results";
}) {
  const { tenantSlug, enabled, optIn, quoteLogId, mode } = params;

  const [renderStatus, setRenderStatus] = useState<RenderStatus>("idle");
  const [renderImageUrl, setRenderImageUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderProgressPct, setRenderProgressPct] = useState(0);

  const attemptedForQuoteRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  function stopPolling() {
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;

    if (pollAbortRef.current) {
      try {
        pollAbortRef.current.abort();
      } catch {
        // ignore
      }
    }
    pollAbortRef.current = null;
  }

  async function pollOnce(qid: string) {
    if (!tenantSlug || !qid) return;

    if (pollAbortRef.current) {
      try {
        pollAbortRef.current.abort();
      } catch {
        // ignore
      }
    }

    const ac = new AbortController();
    pollAbortRef.current = ac;

    const url = `/api/quote/render-status?tenantSlug=${encodeURIComponent(tenantSlug)}&quoteLogId=${encodeURIComponent(qid)}`;

    let res: Response;
    let txt = "";
    try {
      res = await fetch(url, { method: "GET", cache: "no-store", signal: ac.signal as any });
      txt = await res.text();
    } catch (e: any) {
      if (isAbortError(e)) return;
      throw e;
    }

    let j: any = null;
    try {
      j = txt ? JSON.parse(txt) : null;
    } catch {
      throw new Error(`Render status returned non-JSON (HTTP ${res.status}).`);
    }

    if (!res.ok || !j?.ok) {
      throw new Error(j?.message || j?.error || `Render status failed (HTTP ${res.status})`);
    }

    const statusRaw = String(j?.renderStatus ?? "").toLowerCase().trim();
    const imageUrl = (j?.imageUrl ?? null) as string | null;
    const err = (j?.error ?? null) as string | null;

    // valid response -> clear transient error
    if (renderError) setRenderError(null);

    if (statusRaw === "rendered") {
      if (!imageUrl) throw new Error("Render status is 'rendered' but no image url was returned.");
      setRenderImageUrl(imageUrl);
      setRenderError(null);
      setRenderStatus("rendered");
      setRenderProgressPct(100);
      stopPolling();
      return;
    }

    if (statusRaw === "failed") {
      setRenderStatus("failed");
      setRenderError(err || "Render failed");
      setRenderImageUrl(null);
      setRenderProgressPct(100);
      stopPolling();
      return;
    }

    if (statusRaw === "running") {
      setRenderStatus("running");
      return;
    }

    // IMPORTANT: server normalizes queued->idle; if we requested render, keep UI running
    const weRequestedThis = attemptedForQuoteRef.current === qid;
    if (weRequestedThis) {
      setRenderStatus("running");
      return;
    }

    setRenderStatus("idle");
  }

  function startPolling(qid: string) {
    stopPolling();

    pollOnce(qid).catch((e: any) => {
      if (isAbortError(e)) return;
      setRenderError(e?.message ?? "Temporary render status error");
    });

    pollTimerRef.current = window.setInterval(() => {
      pollOnce(qid).catch((e: any) => {
        if (isAbortError(e)) return;
        setRenderError(e?.message ?? "Temporary render status error");
      });
    }, 3000);
  }

  async function enqueueOnce(qid: string) {
    if (attemptedForQuoteRef.current === qid) return;
    attemptedForQuoteRef.current = qid;

    setRenderStatus("running");
    setRenderError(null);
    setRenderImageUrl(null);

    const res = await fetch("/api/quote/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantSlug, quoteLogId: qid }),
    });

    const txt = await res.text();
    let j: any = null;
    try {
      j = txt ? JSON.parse(txt) : null;
    } catch {
      throw new Error(`Render enqueue returned non-JSON (HTTP ${res.status}).`);
    }

    if (!res.ok || !j?.ok) {
      throw new Error(j?.message || j?.error || `Render enqueue failed (HTTP ${res.status})`);
    }

    startPolling(qid);
  }

  // smooth progress while "running"
  useEffect(() => {
    if (renderStatus !== "running") {
      setRenderProgressPct(renderStatus === "rendered" || renderStatus === "failed" ? 100 : 0);
      return;
    }

    setRenderProgressPct(12);

    const t = window.setInterval(() => {
      setRenderProgressPct((prev) => {
        const cap = 92;
        if (prev >= cap) return cap;
        const bump = prev < 50 ? 6 : prev < 75 ? 3 : 1;
        return Math.min(cap, prev + bump);
      });
    }, 650);

    return () => window.clearInterval(t);
  }, [renderStatus]);

  // lifecycle / cleanup
  useEffect(() => {
    return () => {
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // auto-start when conditions are met
  useEffect(() => {
    if (!enabled) return;
    if (!optIn) return;
    if (!quoteLogId) return;
    if (mode !== "results") return;

    enqueueOnce(quoteLogId).catch((e: any) => {
      if (isAbortError(e)) return;
      setRenderStatus("failed");
      setRenderError(e?.message ?? "Render failed");
      setRenderProgressPct(100);
      stopPolling();
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, optIn, quoteLogId, tenantSlug, mode]);

  function resetRenderState() {
    stopPolling();
    attemptedForQuoteRef.current = null;
    setRenderStatus("idle");
    setRenderImageUrl(null);
    setRenderError(null);
    setRenderProgressPct(0);
  }

  return {
    renderStatus,
    renderImageUrl,
    renderError,
    renderProgressPct,
    resetRenderState,
  };
}