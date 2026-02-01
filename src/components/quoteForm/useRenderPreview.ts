"use client";

import { useEffect, useRef, useState } from "react";
import { isAbortError } from "./helpers";

export type RenderStatus = "idle" | "running" | "rendered" | "failed";

// ---- Fake progress tuning ----
// Goal: look believable for real-world render times (~50s observed).
// - Ramp to 92% over ~50 seconds
// - Hold at 92% until the image is actually loaded
// - Jump to 100% on rendered/failed
const FAKE_PROGRESS = {
  cap: 92,
  // segment boundaries (ms)
  t1: 5_000,
  t2: 30_000,
  t3: 50_000,
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

// Prefetch image so we don't show "Ready" before the user can actually see it.
function prefetchImage(url: string, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!url) return resolve();

    const img = new Image();
    let done = false;

    const t = window.setTimeout(() => {
      if (done) return;
      done = true;
      // timeout: resolve (don't block UI forever)
      resolve();
    }, timeoutMs);

    img.onload = () => {
      if (done) return;
      done = true;
      window.clearTimeout(t);
      resolve();
    };

    img.onerror = () => {
      if (done) return;
      done = true;
      window.clearTimeout(t);
      // error: resolve (we'll still try to show it; browser may load later)
      resolve();
    };

    img.src = url;
  });
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

  // Prevent double-finalize (poll + enqueue can both learn about imageUrl)
  const finalizeInFlightRef = useRef(false);
  const finalizedUrlRef = useRef<string | null>(null);

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

  async function setRenderedWhenLoaded(imageUrl: string) {
    if (!imageUrl) return;

    // If we already finalized to this URL, do nothing
    if (finalizedUrlRef.current === imageUrl) return;

    // If another finalize is in-flight for some URL, ignore duplicates
    if (finalizeInFlightRef.current) return;

    finalizeInFlightRef.current = true;

    try {
      // Keep UI in "running" while the image is actually downloading
      setRenderStatus("running");
      setRenderError(null);
      setRenderImageUrl(null);

      // Prefetch (best-effort, resolves on timeout too)
      await prefetchImage(imageUrl, 6000);

      finalizedUrlRef.current = imageUrl;

      setRenderImageUrl(imageUrl);
      setRenderError(null);
      setRenderStatus("rendered");
      setRenderProgressPct(100);

      stopPolling();
      stopProgress();
    } finally {
      finalizeInFlightRef.current = false;
    }
  }

  function setFailedNow(message: string) {
    finalizedUrlRef.current = null;
    finalizeInFlightRef.current = false;

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
      await setRenderedWhenLoaded(imageUrl);
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

    // clear any previous finalize state
    finalizedUrlRef.current = null;
    finalizeInFlightRef.current = false;

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
      await setRenderedWhenLoaded(enqueueImageUrl);
      return;
    }

    if (enqueueStatus === "failed") {
      setFailedNow(String(j?.error ?? j?.message ?? "Render failed"));
      return;
    }

    startPolling(qid);
  }

  // Fake progress while "running" (time-based, rounded to whole percent)
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

      const nextFloat = fakeProgressAt(elapsed);
      const nextInt = Math.round(nextFloat);

      setRenderProgressPct((prev) => {
        const cap = FAKE_PROGRESS.cap;
        // never go backwards; never exceed cap while running
        return clamp(Math.max(prev, nextInt), 0, cap);
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
    finalizedUrlRef.current = null;
    finalizeInFlightRef.current = false;

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