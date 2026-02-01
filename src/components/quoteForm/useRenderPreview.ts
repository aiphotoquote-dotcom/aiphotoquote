"use client";

import { useEffect, useRef, useState } from "react";
import { isAbortError } from "./helpers";

export type RenderStatus = "idle" | "running" | "rendered" | "failed";

// ---- Fake progress tuning ----
// Goal: look believable for real-world render times (~50s observed).
// - Ramp to 92% over ~50 seconds
// - Hold at 92% until the server returns an image URL (rendered)
// - Jump to 100% on rendered/failed
const FAKE_PROGRESS = {
  cap: 92,
  // segment boundaries (ms)
  t1: 5_000, // early ramp
  t2: 30_000, // mid ramp
  t3: 50_000, // final ramp to cap
  // segment targets
  p0: 8,
  p1: 25,
  p2: 70,
  p3: 92,
  tickMs: 250,
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeOutCubic(t: number) {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

function fakeProgressAt(elapsedMs: number) {
  const { t1, t2, t3, p0, p1, p2, p3, cap } = FAKE_PROGRESS;
  const t = Math.max(0, elapsedMs);

  if (t <= t1) {
    const u = easeOutCubic(t / t1);
    return clamp(lerp(p0, p1, u), 0, cap);
  }

  if (t <= t2) {
    const u = easeOutCubic((t - t1) / (t2 - t1));
    return clamp(lerp(p1, p2, u), 0, cap);
  }

  if (t <= t3) {
    const u = easeOutCubic((t - t2) / (t3 - t2));
    return clamp(lerp(p2, p3, u), 0, cap);
  }

  return cap;
}

export function useRenderPreview(params: {
  tenantSlug: string;
  enabled: boolean; // aiRenderingEnabled
  optIn: boolean; // renderOptIn
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

  // ✅ prevents “abort loop” where we never receive a successful response
  const pollInFlightRef = useRef(false);

  // Fake progress timers/anchors
  const progressStartMsRef = useRef<number | null>(null);
  const progressTimerRef = useRef<number | null>(null);

  function stopProgress() {
    if (progressTimerRef.current) window.clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;
    progressStartMsRef.current = null;
  }

  function stopPolling() {
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;

    // Only abort when we intentionally stop (unmount / rendered / failed / reset)
    if (pollAbortRef.current) {
      try {
        pollAbortRef.current.abort();
      } catch {
        // ignore
      }
    }
    pollAbortRef.current = null;

    pollInFlightRef.current = false;
  }

  function setRenderedNow(imageUrl: string) {
    setRenderImageUrl(imageUrl);
    setRenderError(null);
    setRenderStatus("rendered");
    setRenderProgressPct(100);
    stopPolling();
    stopProgress();
  }

  function setFailedNow(message: string) {
    setRenderStatus("failed");
    setRenderError(message || "Render failed");
    setRenderImageUrl(null);
    setRenderProgressPct(100);
    stopPolling();
    stopProgress();
  }

  async function pollOnce(qid: string) {
    if (!tenantSlug || !qid) return;

    // ✅ If a poll is already in-flight, do not start another one.
    // This avoids aborting the very response that would transition us to "rendered".
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;

    const ac = new AbortController();
    pollAbortRef.current = ac;

    const url = `/api/quote/render-status?tenantSlug=${encodeURIComponent(
      tenantSlug
    )}&quoteLogId=${encodeURIComponent(qid)}&ts=${Date.now()}`;

    let res: Response;
    let txt = "";

    try {
      res = await fetch(url, { method: "GET", cache: "no-store", signal: ac.signal as any });
      txt = await res.text();
    } catch (e: any) {
      if (isAbortError(e)) return;
      throw e;
    } finally {
      pollInFlightRef.current = false;
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

    // ✅ Hard-converge if an image URL exists (even if status is stale)
    if (imageUrl && statusRaw !== "failed") {
      setRenderedNow(imageUrl);
      return;
    }

    if (statusRaw === "failed") {
      setFailedNow(err || "Render failed");
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

    const enqueueStatus = String(j?.status ?? "").toLowerCase().trim();
    const enqueueImageUrl = (j?.imageUrl ?? null) as string | null;

    if (enqueueStatus === "rendered" && enqueueImageUrl) {
      setRenderedNow(enqueueImageUrl);
      return;
    }

    if (enqueueStatus === "failed") {
      setFailedNow(String(j?.error ?? j?.message ?? "Render failed"));
      return;
    }

    startPolling(qid);
  }

  // Fake progress while "running" (time-based, tuned to ~50s to reach 92%)
  useEffect(() => {
    // stop any existing progress timer when status changes
    stopProgress();

    if (renderStatus !== "running") {
      setRenderProgressPct(renderStatus === "rendered" || renderStatus === "failed" ? 100 : 0);
      return;
    }

    // anchor start time for this run
    progressStartMsRef.current = Date.now();

    // set an immediate starting value (prevents "0%" flash)
    setRenderProgressPct((prev) => Math.max(prev, FAKE_PROGRESS.p0));

    progressTimerRef.current = window.setInterval(() => {
      const start = progressStartMsRef.current ?? Date.now();
      const elapsed = Date.now() - start;

      const next = fakeProgressAt(elapsed);

      setRenderProgressPct((prev) => {
        // never go backwards; never exceed cap while running
        const cap = FAKE_PROGRESS.cap;
        return clamp(Math.max(prev, next), 0, cap);
      });
    }, FAKE_PROGRESS.tickMs);

    return () => stopProgress();
  }, [renderStatus]);

  // lifecycle / cleanup
  useEffect(() => {
    return () => {
      stopPolling();
      stopProgress();
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
      setFailedNow(e?.message ?? "Render failed");
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, optIn, quoteLogId, tenantSlug, mode]);

  function resetRenderState() {
    stopPolling();
    stopProgress();
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