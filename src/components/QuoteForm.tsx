// src/components/QuoteForm.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { StatusBar } from "./quote/StatusBar";
import { PhotoSection, type PhotoItem, type ShotType } from "./quote/PhotoSection";
import { InfoSection } from "./quote/InfoSection";
import { QaSection } from "./quote/QaSection";
import { ResultsSection } from "./quote/ResultsSection";

type RenderStatus = "idle" | "running" | "rendered" | "failed";

function digitsOnlyRaw(s: string) {
  return (s || "").replace(/\D/g, "");
}
function normalizeUSPhoneDigits(input: string) {
  const d = digitsOnlyRaw(input);
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.slice(0, 10);
}
function formatUSPhone(input: string) {
  const d = normalizeUSPhoneDigits(input);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (d.length <= 3) return a ? `(${a}` : "";
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}
function isValidEmail(email: string) {
  const s = (email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
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

async function compressImage(file: File, opts?: { maxDim?: number; quality?: number }): Promise<File> {
  const maxDim = opts?.maxDim ?? 1600;
  const quality = opts?.quality ?? 0.78;

  if (!file.type.startsWith("image/")) return file;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Failed to load image"));
    i.src = dataUrl;
  });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const scale = Math.min(1, maxDim / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(img, 0, 0, outW, outH);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Compression failed"))), "image/jpeg", quality);
  });

  const baseName = file.name.replace(/\.[^/.]+$/, "");
  const outName = `${baseName}.jpg`;
  return new File([blob], outName, { type: "image/jpeg" });
}

function defaultShotTypeForIndex(idx: number): ShotType {
  if (idx === 0) return "wide";
  if (idx === 1) return "closeup";
  return "extra";
}

async function uploadToBlob(files: File[]): Promise<string[]> {
  if (!files.length) return [];

  const form = new FormData();
  files.forEach((f) => form.append("files", f));

  const res = await fetch("/api/blob/upload", { method: "POST", body: form });
  const text = await res.text();

  let j: any = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Upload returned non-JSON (HTTP ${res.status}).`);
  }

  if (!res.ok || !j?.ok) {
    throw new Error(j?.error?.message || j?.message || `Blob upload failed (HTTP ${res.status})`);
  }

  const urls: string[] = Array.isArray(j?.urls)
    ? j.urls.map((x: any) => String(x)).filter(Boolean)
    : Array.isArray(j?.files)
      ? j.files.map((x: any) => String(x?.url)).filter(Boolean)
      : [];

  if (!urls.length) throw new Error("Blob upload returned no file urls.");
  return urls;
}

function computeWorkingStep(phase: "idle" | "compressing" | "uploading" | "analyzing") {
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

export default function QuoteForm({
  tenantSlug,
  aiRenderingEnabled = false,
}: {
  tenantSlug: string;
  aiRenderingEnabled?: boolean;
}) {
  const MIN_PHOTOS = 1;
  const MAX_PHOTOS = 12;

  // --- form state ---
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [renderOptIn, setRenderOptIn] = useState(false);

  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<"idle" | "compressing" | "uploading" | "analyzing">("idle");

  const [result, setResult] = useState<any>(null);
  const [quoteLogId, setQuoteLogId] = useState<string | null>(null);

  // Live Q&A (server-driven)
  const [needsQa, setNeedsQa] = useState(false);
  const [qaQuestions, setQaQuestions] = useState<string[]>([]);
  const [qaAnswers, setQaAnswers] = useState<string[]>([]);

  // Errors
  const [error, setError] = useState<string | null>(null);

  // Rendering
  const [renderStatus, setRenderStatus] = useState<RenderStatus>("idle");
  const [renderImageUrl, setRenderImageUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Fake-but-smooth render progress
  const [renderProgressPct, setRenderProgressPct] = useState(0);

  // --- refs ---
  const statusRegionRef = useRef<HTMLDivElement | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);

  const photosSectionRef = useRef<HTMLElement | null>(null);
  const infoSectionRef = useRef<HTMLElement | null>(null);
  const qaSectionRef = useRef<HTMLElement | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);

  const qaFirstInputRef = useRef<HTMLInputElement | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const renderPreviewRef = useRef<HTMLDivElement | null>(null);

  const renderAttemptedForQuoteRef = useRef<string | null>(null);

  // --- derived state ---
  const photoCount = photos.length;

  const contactOk = useMemo(() => {
    const nOk = customerName.trim().length > 0;
    const eOk = isValidEmail(email);
    const pOk = normalizeUSPhoneDigits(phone).length === 10;
    return nOk && eOk && pOk;
  }, [customerName, email, phone]);

  const photosOk = photoCount >= MIN_PHOTOS;

  const canSubmit = useMemo(() => !working && photosOk && contactOk, [working, photosOk, contactOk]);

  const disabledReason = useMemo(() => {
    if (working) return null;
    if (!photosOk) return `Add at least ${MIN_PHOTOS} photo to continue.`;
    if (!customerName.trim()) return "Enter your name to continue.";
    if (!isValidEmail(email)) return "Enter a valid email to continue.";
    if (normalizeUSPhoneDigits(phone).length !== 10) return "Enter a valid 10-digit phone number.";
    return null;
  }, [working, photosOk, customerName, email, phone, MIN_PHOTOS]);

  const hasEstimate = Boolean(result) && !needsQa;

  const workingStep = useMemo(() => computeWorkingStep(phase), [phase]);

  const showRendering = useMemo(() => aiRenderingEnabled && renderOptIn, [aiRenderingEnabled, renderOptIn]);

  const renderingLabel = useMemo(() => {
    if (!aiRenderingEnabled) return "Disabled";
    if (!renderOptIn) return "Off";
    if (!quoteLogId) return "Waiting";
    if (renderStatus === "idle") return "Queued";
    if (renderStatus === "running") return "Rendering…";
    if (renderStatus === "rendered") return "Ready";
    if (renderStatus === "failed") return "Failed";
    return "Waiting";
  }, [aiRenderingEnabled, renderOptIn, quoteLogId, renderStatus]);

  const mode: "entry" | "qa" | "results" = needsQa ? "qa" : hasEstimate ? "results" : "entry";

  // Status card copy + single action (no clutter)
  const statusModel = useMemo(() => {
    if (working) {
      const right = workingStep.idx ? `Step ${workingStep.idx}/${workingStep.total}` : "Working";
      const photosLabel = photoCount ? `${prettyCount(photoCount)} photo${photoCount === 1 ? "" : "s"}` : null;
      const subtitle = [photosLabel, "Hang tight — this usually takes a few seconds."].filter(Boolean).join(" • ");
      return {
        title: workingStep.label,
        subtitle,
        rightLabel: right,
        primaryLabel: undefined as string | undefined,
        onPrimary: undefined as (() => void) | undefined,
      };
    }

    if (error) {
      return {
        title: "Fix the issue",
        subtitle: "There was a problem — jump to the error and try again.",
        rightLabel: "Error",
        primaryLabel: "View error",
        onPrimary: () => focusAndScroll(errorSummaryRef.current, { block: "start" }),
      };
    }

    if (mode === "qa") {
      return {
        title: "Answer questions",
        subtitle: "One more step — answer these and we’ll finalize your estimate.",
        rightLabel: "Next",
        primaryLabel: "Jump to questions",
        onPrimary: () => focusAndScroll(qaSectionRef.current, { block: "start" }),
      };
    }

    if (mode === "results") {
      if (showRendering && renderStatus === "running") {
        return {
          title: "Estimate ready",
          subtitle: "Rendering your visual preview now…",
          rightLabel: "Rendering",
          primaryLabel: "Jump to preview",
          onPrimary: () => focusAndScroll(renderPreviewRef.current, { block: "start" }),
        };
      }

      return {
        title: "Estimate ready",
        subtitle: showRendering ? `Rendering: ${renderingLabel}` : "Review your estimate details below.",
        rightLabel: "Done",
        primaryLabel: "View estimate",
        onPrimary: () => focusAndScroll(resultsRef.current, { block: "start" }),
      };
    }

    // entry
    if (!photosOk) {
      return {
        title: "Add photos",
        subtitle: `Add at least ${MIN_PHOTOS} photo to continue — 2–6 is best.`,
        rightLabel: "Next",
        primaryLabel: "Jump to photos",
        onPrimary: () => focusAndScroll(photosSectionRef.current, { block: "start" }),
      };
    }

    if (!contactOk) {
      return {
        title: "Enter your info",
        subtitle: "Name, email, and phone are required so we can follow up.",
        rightLabel: "Next",
        primaryLabel: "Jump to contact",
        onPrimary: () => focusAndScroll(infoSectionRef.current, { block: "start" }),
      };
    }

    return {
      title: "Ready to submit",
      subtitle: "You’re ready — submit and we’ll inspect your photos.",
      rightLabel: "Ready",
      primaryLabel: "Jump to submit",
      onPrimary: () => focusAndScroll(infoSectionRef.current, { block: "start" }),
    };
  }, [
    working,
    workingStep.label,
    workingStep.idx,
    workingStep.total,
    photoCount,
    error,
    mode,
    showRendering,
    renderStatus,
    renderingLabel,
    photosOk,
    contactOk,
    MIN_PHOTOS,
  ]);

  // Overall progress for the top bar (never disappears)
  const progressPct = useMemo(() => {
    if (working) {
      const pct = Math.round((workingStep.idx / Math.max(1, workingStep.total)) * 100);
      return Math.max(5, Math.min(95, pct));
    }
    if (mode === "results") return 100;
    if (mode === "qa") return 80;
    if (!photosOk) return 20;
    if (!contactOk) return 45;
    return 60;
  }, [working, workingStep.idx, workingStep.total, mode, photosOk, contactOk]);

  // Sticky rules: keep the top bar available during the “important” states
  const sticky = useMemo(() => {
    if (working) return true;
    if (error) return true;
    if (mode === "qa") return true;
    if (mode === "results" && showRendering && renderStatus === "running") return true;
    return false;
  }, [working, error, mode, showRendering, renderStatus]);

  // Error auto-scroll only (avoid “focus all over the place”)
  useEffect(() => {
    if (!error) return;
    (async () => {
      await focusAndScroll(errorSummaryRef.current, { block: "start" });
    })();
  }, [error]);

  // When QA appears, focus first input (no auto-scroll)
  useEffect(() => {
    if (!needsQa) return;
    (async () => {
      await sleep(50);
      safeFocus(qaFirstInputRef.current);
    })();
  }, [needsQa]);

  // Render progress animation while running
  useEffect(() => {
    if (renderStatus !== "running") {
      setRenderProgressPct(renderStatus === "rendered" ? 100 : 0);
      return;
    }

    setRenderProgressPct(12);

    const t = window.setInterval(() => {
      setRenderProgressPct((prev) => {
        // ease toward 92, then hold until server returns
        const cap = 92;
        if (prev >= cap) return cap;
        const bump = prev < 50 ? 6 : prev < 75 ? 3 : 1;
        return Math.min(cap, prev + bump);
      });
    }, 650);

    return () => window.clearInterval(t);
  }, [renderStatus]);

  useEffect(() => {
    if (!aiRenderingEnabled) setRenderOptIn(false);
  }, [aiRenderingEnabled]);

  useEffect(() => {
    return () => {
      photos.forEach((p) => {
        if (p.previewSrc.startsWith("blob:")) URL.revokeObjectURL(p.previewSrc);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addCameraFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;

      setPhotos((prev) => {
        const next = [...prev];

        for (const f of files) {
          if (next.length >= MAX_PHOTOS) break;

          const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const previewSrc = URL.createObjectURL(f);
          const shotType = defaultShotTypeForIndex(next.length);

          next.push({ id, shotType, previewSrc, file: f });
        }

        return next;
      });
    },
    [MAX_PHOTOS]
  );

  const addUploadedUrls = useCallback(
    (urls: string[]) => {
      if (!urls.length) return;

      setPhotos((prev) => {
        const next = [...prev];

        for (const u of urls) {
          if (!u) continue;
          if (next.length >= MAX_PHOTOS) break;

          const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const shotType = defaultShotTypeForIndex(next.length);

          next.push({ id, shotType, previewSrc: u, uploadedUrl: u });
        }

        return next;
      });
    },
    [MAX_PHOTOS]
  );

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p?.previewSrc?.startsWith("blob:")) URL.revokeObjectURL(p.previewSrc);

      const next = prev.filter((x) => x.id !== id);

      return next.map((x, idx) => ({
        ...x,
        shotType: idx === 0 ? "wide" : idx === 1 ? "closeup" : x.shotType,
      }));
    });
  }, []);

  const setShotType = useCallback((id: string, shotType: ShotType) => {
    setPhotos((prev) => prev.map((x) => (x.id === id ? { ...x, shotType } : x)));
  }, []);

  function startOver() {
    setError(null);
    setResult(null);
    setQuoteLogId(null);

    setNeedsQa(false);
    setQaQuestions([]);
    setQaAnswers([]);

    setNotes("");
    setCustomerName("");
    setEmail("");
    setPhone("");

    setPhotos((prev) => {
      prev.forEach((p) => {
        if (p.previewSrc.startsWith("blob:")) URL.revokeObjectURL(p.previewSrc);
      });
      return [];
    });

    setWorking(false);
    setPhase("idle");

    setRenderStatus("idle");
    setRenderImageUrl(null);
    setRenderError(null);
    setRenderProgressPct(0);
    renderAttemptedForQuoteRef.current = null;

    if (!aiRenderingEnabled) setRenderOptIn(false);

    queueMicrotask(() => {
      focusAndScroll(statusRegionRef.current, { block: "start" });
    });
  }

  async function uploadPhotosNow(filesList: FileList) {
    const arr = Array.from(filesList ?? []);
    if (!arr.length) return;

    setError(null);
    setWorking(true);
    setPhase("compressing");

    try {
      const compressed = await Promise.all(arr.map((f) => compressImage(f)));
      setPhase("uploading");

      const urls = await uploadToBlob(compressed);
      addUploadedUrls(urls);
    } catch (e: any) {
      setError(e?.message ?? "Upload failed.");
    } finally {
      setWorking(false);
      setPhase("idle");
    }
  }

  async function submitEstimate() {
    setError(null);
    setResult(null);
    setQuoteLogId(null);

    setNeedsQa(false);
    setQaQuestions([]);
    setQaAnswers([]);

    setRenderStatus("idle");
    setRenderImageUrl(null);
    setRenderError(null);
    setRenderProgressPct(0);
    renderAttemptedForQuoteRef.current = null;

    queueMicrotask(() => {
      focusAndScroll(statusRegionRef.current, { block: "start" });
    });

    if (!tenantSlug || typeof tenantSlug !== "string") {
      setError("Missing tenant slug. Please reload the page (invalid tenant link).");
      return;
    }
    if (photos.length < MIN_PHOTOS) {
      setError(`Please add at least ${MIN_PHOTOS} photo for an accurate estimate.`);
      return;
    }
    if (photos.length > MAX_PHOTOS) {
      setError(`Please limit to ${MAX_PHOTOS} photos or fewer.`);
      return;
    }
    if (!customerName.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (normalizeUSPhoneDigits(phone).length !== 10) {
      setError("Please enter a valid 10-digit phone number.");
      return;
    }

    setWorking(true);

    try {
      let currentPhotos = photos;

      const needUpload = currentPhotos.filter((p) => !p.uploadedUrl && p.file);
      if (needUpload.length) {
        setPhase("compressing");
        const compressed = await Promise.all(needUpload.map((p) => compressImage(p.file!)));

        setPhase("uploading");
        const urls = await uploadToBlob(compressed);

        const byId = new Map<string, string>();
        needUpload.forEach((p, idx) => {
          const u = urls[idx];
          if (u) byId.set(p.id, u);
        });

        const mapped = currentPhotos.map((p) => {
          const u = byId.get(p.id);
          if (!u) return p;

          if (p.previewSrc.startsWith("blob:")) URL.revokeObjectURL(p.previewSrc);

          return { ...p, uploadedUrl: u, previewSrc: u, file: undefined };
        });

        setPhotos(mapped);
        currentPhotos = mapped;
      }

      const urls = currentPhotos.map((p) => p.uploadedUrl).filter(Boolean) as string[];
      if (urls.length !== currentPhotos.length) throw new Error("Some photos are not uploaded yet. Please try again.");

      setPhase("analyzing");

      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          images: currentPhotos.map((p) => ({ url: p.uploadedUrl!, shotType: p.shotType })),
          customer: {
            name: customerName.trim(),
            email: email.trim(),
            phone: normalizeUSPhoneDigits(phone),
          },
          customer_context: {
            notes: notes?.trim() || undefined,
            category: "service",
            service_type: "upholstery",
          },
          render_opt_in: aiRenderingEnabled ? Boolean(renderOptIn) : false,
        }),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Server returned non-JSON (HTTP ${res.status}).`);
      }

      if (!json?.ok) {
        const code = json?.error ? `\ncode: ${json.error}` : "";
        const msg = json?.message ? `\nmessage: ${json.message}` : "";
        const issues = json?.issues
          ? `\nissues:\n${json.issues.map((i: any) => `- ${i.path?.join(".")}: ${i.message}`).join("\n")}`
          : "";
        throw new Error(`Quote failed\nHTTP ${res.status}${code}${msg}${issues}`.trim());
      }

      const qid = (json?.quoteLogId ?? json?.quoteId ?? json?.id ?? null) as string | null;
      setQuoteLogId(qid);

      const needsQaFlag = Boolean(json?.needsQa ?? json?.needs_qa);
      const qsFromTop: string[] = Array.isArray(json?.questions) ? json.questions : [];
      const qsFromQaObj: string[] = Array.isArray(json?.qa?.questions) ? json.qa.questions : [];
      const qsMerged = (qsFromTop.length ? qsFromTop : qsFromQaObj).map((x: any) => String(x)).filter(Boolean);

      if (needsQaFlag && qsMerged.length) {
        setNeedsQa(true);
        setQaQuestions(qsMerged);
        setQaAnswers(qsMerged.map(() => ""));
        setResult(json?.output ?? json);
        renderAttemptedForQuoteRef.current = null;
        return;
      }

      setNeedsQa(false);
      setQaQuestions([]);
      setQaAnswers([]);
      setResult(json?.output ?? json);

      renderAttemptedForQuoteRef.current = null;
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setWorking(false);
      setPhase("idle");
      queueMicrotask(() => {
        if (errorSummaryRef.current) focusAndScroll(errorSummaryRef.current, { block: "start" });
      });
    }
  }

  async function submitQaAnswers() {
    setError(null);

    if (!tenantSlug) return setError("Missing tenant slug.");
    if (!quoteLogId) return setError("Missing quote reference. Please start over.");
    if (!qaQuestions.length) return setError("No questions to answer.");

    const trimmed = qaAnswers.map((a) => String(a ?? "").trim());
    const missingIdx = trimmed.findIndex((a) => !a);

    if (missingIdx !== -1) {
      setError(`Please answer: "${qaQuestions[missingIdx]}"`);
      queueMicrotask(async () => {
        await focusAndScroll(qaSectionRef.current, { block: "start" });
        await sleep(25);
        const el = document.getElementById(`qa-input-${missingIdx}`) as HTMLInputElement | null;
        safeFocus(el || qaFirstInputRef.current);
      });
      return;
    }

    setWorking(true);
    setPhase("analyzing");

    try {
      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantSlug, quoteLogId, qaAnswers: trimmed }),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Server returned non-JSON (HTTP ${res.status}).`);
      }

      if (!json?.ok) {
        const code = json?.error ? `\ncode: ${json.error}` : "";
        const msg = json?.message ? `\nmessage: ${json.message}` : "";
        const issues = json?.issues
          ? `\nissues:\n${json.issues.map((i: any) => `- ${i.path?.join(".")}: ${i.message}`).join("\n")}`
          : "";
        throw new Error(`Finalize failed\nHTTP ${res.status}${code}${msg}${issues}`.trim());
      }

      setNeedsQa(false);
      setQaQuestions([]);
      setQaAnswers([]);
      setResult(json?.output ?? json);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setWorking(false);
      setPhase("idle");
      queueMicrotask(() => {
        if (errorSummaryRef.current) focusAndScroll(errorSummaryRef.current, { block: "start" });
      });
    }
  }

  async function startRenderOnce(qid: string) {
    if (renderAttemptedForQuoteRef.current === qid) return;
    renderAttemptedForQuoteRef.current = qid;

    setRenderStatus("running");
    setRenderError(null);
    setRenderImageUrl(null);

    try {
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
        throw new Error(`Render returned non-JSON (HTTP ${res.status}).`);
      }

      if (!res.ok || !j?.ok) throw new Error(j?.message || j?.error || `Render failed (HTTP ${res.status})`);

      const url = (j?.imageUrl ?? j?.render_image_url ?? j?.url ?? null) as string | null;
      if (!url) throw new Error("Render completed but no imageUrl returned.");

      setRenderImageUrl(url);
      setRenderStatus("rendered");
      setRenderProgressPct(100);
    } catch (e: any) {
      setRenderStatus("failed");
      setRenderError(e?.message ?? "Render failed");
    }
  }

  useEffect(() => {
    if (!aiRenderingEnabled) return;
    if (!renderOptIn) return;
    if (!quoteLogId) return;
    if (renderAttemptedForQuoteRef.current === quoteLogId) return;
    startRenderOnce(quoteLogId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRenderingEnabled, renderOptIn, quoteLogId, tenantSlug]);

  return (
    <div className="w-full max-w-full min-w-0 overflow-x-hidden space-y-6">
      <StatusBar
        statusRef={statusRegionRef as any}
        title={statusModel.title}
        subtitle={statusModel.subtitle}
        rightLabel={statusModel.rightLabel}
        sticky={sticky}
        progressPct={progressPct}
        primaryLabel={statusModel.primaryLabel}
        onPrimary={statusModel.onPrimary}
        primaryDisabled={working}
      />

      {error ? (
        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          role="alert"
          aria-live="assertive"
          className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 whitespace-pre-wrap outline-none dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200"
        >
          <div className="font-semibold mb-1">There was a problem</div>
          {error}
        </div>
      ) : null}

      {mode === "entry" ? (
        <>
          <PhotoSection
            sectionRef={photosSectionRef as any}
            working={working}
            photos={photos}
            minPhotos={MIN_PHOTOS}
            recommendedPhotos={2}
            maxPhotos={MAX_PHOTOS}
            onAddCameraFiles={addCameraFiles}
            onUploadPhotosNow={uploadPhotosNow}
            onRemovePhoto={removePhoto}
            onSetShotType={setShotType}
          />

          <InfoSection
            sectionRef={infoSectionRef as any}
            working={working}
            customerName={customerName}
            email={email}
            phone={phone}
            notes={notes}
            disabledReason={disabledReason}
            canSubmit={canSubmit}
            aiRenderingEnabled={aiRenderingEnabled}
            renderOptIn={renderOptIn}
            onCustomerName={setCustomerName}
            onEmail={setEmail}
            onPhone={(v) => setPhone(formatUSPhone(v))}
            onNotes={setNotes}
            onRenderOptIn={setRenderOptIn}
            onSubmitEstimate={submitEstimate}
            onStartOver={startOver}
          />
        </>
      ) : null}

      {mode === "qa" ? (
        <QaSection
          sectionRef={qaSectionRef as any}
          firstInputRef={qaFirstInputRef}
          working={working}
          needsQa={needsQa}
          qaQuestions={qaQuestions}
          qaAnswers={qaAnswers}
          quoteLogId={quoteLogId}
          onAnswer={(idx, v) => {
            setQaAnswers((prev) => {
              const next = [...prev];
              next[idx] = v;
              return next;
            });
          }}
          onSubmit={submitQaAnswers}
          onStartOver={startOver}
        />
      ) : null}

      {mode === "results" ? (
        <ResultsSection
          sectionRef={resultsRef as any}
          headingRef={resultsHeadingRef}
          renderPreviewRef={renderPreviewRef as any}
          hasEstimate={hasEstimate}
          result={result}
          quoteLogId={quoteLogId}
          aiRenderingEnabled={aiRenderingEnabled}
          renderOptIn={renderOptIn}
          renderStatus={renderStatus}
          renderImageUrl={renderImageUrl}
          renderError={renderError}
          renderProgressPct={renderProgressPct}
        />
      ) : null}

      <p className="text-xs text-gray-600 dark:text-gray-300">
        By submitting, you agree we may contact you about this request. Photos are used only to prepare your estimate.
      </p>
    </div>
  );
}