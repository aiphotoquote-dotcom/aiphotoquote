// src/components/quote/useQuoteFlow.ts
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type QuoteMode = "entry" | "qa" | "results";
export type RenderStatus = "idle" | "running" | "rendered" | "failed";
export type WorkPhase = "idle" | "compressing" | "uploading" | "analyzing";

export type QuoteFlowVM = {
  title: string;
  subtitle: string;
  rightLabel: string;
  progressPct: number;

  sticky: boolean;
  doneLabel: string;
  doneDisabled: boolean;
  onDone: () => void;

  showRenderingMini: boolean;
  renderingLabel: string;

  renderProgressPct: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeFocus(el: HTMLElement | null | undefined) {
  if (!el) return;
  try {
    el.focus({ preventScroll: true } as any);
  } catch {
    try {
      (el as any).focus();
    } catch {
      // ignore
    }
  }
}

async function focusAndScroll(
  el: HTMLElement | null | undefined,
  opts?: { block?: ScrollLogicalPosition; behavior?: ScrollBehavior }
) {
  if (!el) return;
  const block = opts?.block ?? "start";
  const behavior = opts?.behavior ?? "smooth";

  try {
    el.scrollIntoView({ behavior, block });
  } catch {
    try {
      el.scrollIntoView();
    } catch {
      // ignore
    }
  }

  await sleep(25);
  safeFocus(el);
}

function computeWorkingStep(phase: WorkPhase) {
  if (phase === "compressing") return { idx: 1, total: 3, label: "Optimizing photos…" };
  if (phase === "uploading") return { idx: 2, total: 3, label: "Uploading…" };
  if (phase === "analyzing") return { idx: 3, total: 3, label: "Inspecting…" };
  return { idx: 0, total: 3, label: "Ready" };
}

function prettyCount(n: number) {
  if (!Number.isFinite(n)) return "0";
  if (n <= 999) return String(n);
  if (n <= 9_999) return `${Math.round(n / 100) / 10}k`;
  return `${Math.round(n / 1000)}k`;
}

export function useQuoteFlow(args: {
  mode: QuoteMode;
  working: boolean;
  phase: WorkPhase;
  error: string | null;

  photosOk: boolean;
  contactOk: boolean;
  photoCount: number;

  hasEstimate: boolean;
  confidenceLabel?: string;

  aiRenderingEnabled: boolean;
  renderOptIn: boolean;
  quoteLogId: string | null;
  renderStatus: RenderStatus;

  statusRef: React.RefObject<HTMLDivElement | null>;
  errorRef: React.RefObject<HTMLDivElement | null>;
  photosRef: React.RefObject<HTMLElement | null>;
  infoRef: React.RefObject<HTMLElement | null>;
  qaRef: React.RefObject<HTMLElement | null>;
  resultsRef: React.RefObject<HTMLElement | null>;
  renderPreviewRef: React.RefObject<HTMLDivElement | null>;
}): QuoteFlowVM {
  const step = useMemo(() => computeWorkingStep(args.phase), [args.phase]);

  const showRenderingMini = useMemo(
    () => Boolean(args.aiRenderingEnabled && args.renderOptIn),
    [args.aiRenderingEnabled, args.renderOptIn]
  );

  const renderingLabel = useMemo(() => {
    if (!args.aiRenderingEnabled) return "Disabled";
    if (!args.renderOptIn) return "Off";
    if (!args.quoteLogId) return "Waiting";
    if (args.renderStatus === "idle") return "Queued";
    if (args.renderStatus === "running") return "Rendering…";
    if (args.renderStatus === "rendered") return "Ready";
    if (args.renderStatus === "failed") return "Failed";
    return "Waiting";
  }, [args.aiRenderingEnabled, args.renderOptIn, args.quoteLogId, args.renderStatus]);

  // “feels-right” render progress while waiting
  const [renderProgressPct, setRenderProgressPct] = useState(0);
  const renderTickerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!showRenderingMini) {
      setRenderProgressPct(0);
      return;
    }

    if (args.renderStatus === "rendered") {
      setRenderProgressPct(100);
      return;
    }
    if (args.renderStatus === "failed") {
      setRenderProgressPct(100);
      return;
    }
    if (args.renderStatus !== "running") {
      setRenderProgressPct(10);
      return;
    }

    setRenderProgressPct((p) => (p < 10 ? 10 : p));

    if (renderTickerRef.current) window.clearInterval(renderTickerRef.current);
    renderTickerRef.current = window.setInterval(() => {
      setRenderProgressPct((p) => {
        const capped = Math.min(95, p);
        if (capped >= 95) return 95;
        const inc = capped < 40 ? 6 : capped < 70 ? 3 : 1;
        return Math.min(95, capped + inc);
      });
    }, 650);

    return () => {
      if (renderTickerRef.current) window.clearInterval(renderTickerRef.current);
      renderTickerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.renderStatus, showRenderingMini]);

  const progressPct = useMemo(() => {
    if (args.working) {
      const pct = Math.round((step.idx / Math.max(1, step.total)) * 100);
      return Math.max(5, Math.min(95, pct));
    }

    if (args.mode === "results" && showRenderingMini && args.renderStatus === "running") return 92;
    if (args.mode === "results") return 100;
    if (args.mode === "qa") return 80;

    if (!args.photosOk) return 20;
    if (!args.contactOk) return 45;
    return 60;
  }, [args.working, step.idx, step.total, args.mode, args.photosOk, args.contactOk, showRenderingMini, args.renderStatus]);

  const title = useMemo(() => {
    if (args.working) return step.label;
    if (args.error) return "Fix the issue";
    if (args.mode === "qa") return "Answer questions";
    if (args.mode === "results") {
      if (showRenderingMini && args.renderStatus === "running") return "Rendering in progress";
      return "Estimate ready";
    }
    if (!args.photosOk) return "Add photos";
    if (!args.contactOk) return "Enter your info";
    return "Ready to submit";
  }, [args.working, step.label, args.error, args.mode, args.photosOk, args.contactOk, showRenderingMini, args.renderStatus]);

  const subtitle = useMemo(() => {
    if (args.working && step.idx) {
      const photosLabel = args.photoCount
        ? `${prettyCount(args.photoCount)} photo${args.photoCount === 1 ? "" : "s"}`
        : null;
      return [photosLabel, "Hang tight — this usually takes a few seconds."].filter(Boolean).join(" • ");
    }
    if (args.error) return "Review the message below and try again.";
    if (args.mode === "qa") return "One more step — answer these and we’ll finalize your estimate.";
    if (args.mode === "results") {
      if (showRenderingMini && args.renderStatus === "running") return "Your AI preview is generating. Keep this tab open.";
      if (args.confidenceLabel) return `Confidence: ${args.confidenceLabel}`;
      return "Review your estimate details below.";
    }
    if (!args.photosOk) return "Add at least 1 photo — 2–6 is best.";
    if (!args.contactOk) return "Name, email, and phone are required so we can follow up.";
    return "Scroll down and tap Get Estimate when ready.";
  }, [
    args.working,
    step.idx,
    args.photoCount,
    args.error,
    args.mode,
    showRenderingMini,
    args.renderStatus,
    args.confidenceLabel,
    args.photosOk,
    args.contactOk,
  ]);

  const rightLabel = useMemo(() => {
    if (args.working && step.idx) return `Step ${step.idx} of ${step.total}`;
    if (args.error) return "Error";
    if (args.mode === "qa") return "Action needed";
    if (args.mode === "results") return "Done";
    return "Next";
  }, [args.working, step.idx, step.total, args.error, args.mode]);

  const sticky = useMemo(() => {
    if (args.working) return true;
    if (args.mode === "qa") return true;
    if (showRenderingMini && args.renderStatus === "running") return true;
    return false;
  }, [args.working, args.mode, showRenderingMini, args.renderStatus]);

  const doneLabel = useMemo(() => {
    if (args.working) return "Working…";
    if (args.error) return "View error";
    if (args.mode === "qa") return "Jump to questions";
    if (args.mode === "results") {
      if (showRenderingMini && args.renderStatus === "running") return "Jump to preview";
      return "View estimate";
    }
    if (!args.photosOk) return "Jump to photos";
    if (!args.contactOk) return "Jump to contact";
    return "Jump to submit";
  }, [args.working, args.error, args.mode, args.photosOk, args.contactOk, showRenderingMini, args.renderStatus]);

  const doneDisabled = useMemo(() => Boolean(args.working), [args.working]);

  const onDone = useMemo(() => {
    return async () => {
      if (args.working) return;

      if (args.error) return focusAndScroll(args.errorRef.current, { block: "start" });

      if (args.mode === "qa") return focusAndScroll(args.qaRef.current, { block: "start" });

      if (args.mode === "results") {
        if (showRenderingMini && args.renderStatus === "running") {
          return focusAndScroll(args.renderPreviewRef.current, { block: "start" });
        }
        return focusAndScroll(args.resultsRef.current, { block: "start" });
      }

      // entry mode
      if (!args.photosOk) return focusAndScroll(args.photosRef.current, { block: "start" });
      if (!args.contactOk) return focusAndScroll(args.infoRef.current, { block: "start" });
      return focusAndScroll(args.infoRef.current, { block: "start" });
    };
  }, [
    args.working,
    args.error,
    args.mode,
    args.photosOk,
    args.contactOk,
    showRenderingMini,
    args.renderStatus,
    args.errorRef,
    args.qaRef,
    args.resultsRef,
    args.renderPreviewRef,
    args.photosRef,
    args.infoRef,
  ]);

  return {
    title,
    subtitle,
    rightLabel,
    progressPct,
    sticky,
    doneLabel,
    doneDisabled,
    onDone,
    showRenderingMini,
    renderingLabel,
    renderProgressPct,
  };
}