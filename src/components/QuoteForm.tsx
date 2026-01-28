// src/components/QuoteForm.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ShotType = "wide" | "closeup" | "extra";

type PhotoItem = {
  id: string;
  shotType: ShotType;
  previewSrc: string;
  uploadedUrl?: string;
  file?: File;
};

type RenderStatus = "idle" | "running" | "rendered" | "failed";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

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

  // Scroll first (mobile Safari is less jumpy this way)
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

function shotBadge(t: ShotType) {
  return t === "wide" ? "Wide shot" : t === "closeup" ? "Close-up" : "Extra";
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

function money(n: any) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function toneBadge(label: string, tone: "gray" | "green" | "yellow" | "red" | "blue" = "gray") {
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          : tone === "blue"
            ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
            : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-black dark:text-gray-200";

  return <span className={cn(base, cls)}>{label}</span>;
}
function ProgressBar({ title, label, active }: { title: string; label: string; active: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        <div className="text-xs text-gray-700 dark:text-gray-200">{label}</div>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
        <div
          className={cn(
            "h-full rounded-full bg-black transition-all duration-500 dark:bg-white",
            active ? "w-1/2 animate-pulse" : "w-full"
          )}
        />
      </div>
    </div>
  );
}

type StepState = "todo" | "active" | "done";
type StepperStep = { key: string; label: string; state: StepState };

function Stepper({ steps }: { steps: StepperStep[] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Progress</div>

      <div className="mt-3 grid gap-2">
        {steps.map((s) => {
          const dot =
            s.state === "done"
              ? "bg-green-600"
              : s.state === "active"
                ? "bg-black dark:bg-white"
                : "bg-gray-300 dark:bg-gray-700";

          const text =
            s.state === "done"
              ? "text-gray-900 dark:text-gray-100"
              : s.state === "active"
                ? "text-gray-900 dark:text-gray-100"
                : "text-gray-600 dark:text-gray-300";

          return (
            <div key={s.key} className="flex items-center gap-3">
              <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
              <span className={cn("text-xs font-semibold", text)}>{s.label}</span>

              <span className="ml-auto text-[11px] text-gray-500 dark:text-gray-400">
                {s.state === "done" ? "Done" : s.state === "active" ? "In progress" : "Pending"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function QuoteForm({
  tenantSlug,
  aiRenderingEnabled = false,
}: {
  tenantSlug: string;
  aiRenderingEnabled?: boolean;
}) {
  const MIN_PHOTOS = 1;
  const RECOMMENDED_PHOTOS = 2;
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

  // --- refs for focus/scroll management ---
  const statusRegionRef = useRef<HTMLDivElement | null>(null); // “Working / progress” wrapper
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
  const recommendedOk = photoCount >= RECOMMENDED_PHOTOS;

  const canSubmit = useMemo(() => !working && photosOk && contactOk, [working, photosOk, contactOk]);

  const disabledReason = useMemo(() => {
    if (working) return null;
    if (!photosOk) return `Add at least ${MIN_PHOTOS} photo to continue.`;
    if (!customerName.trim()) return "Enter your name to continue.";
    if (!isValidEmail(email)) return "Enter a valid email to continue.";
    if (normalizeUSPhoneDigits(phone).length !== 10) return "Enter a valid 10-digit phone number.";
    return null;
  }, [working, photosOk, customerName, email, phone, MIN_PHOTOS]);

  const workingLabel = useMemo(() => {
    if (!working) return "Ready";
    if (phase === "compressing") return "Optimizing photos…";
    if (phase === "uploading") return "Uploading…";
    if (phase === "analyzing") return "Inspecting…";
    return "Working…";
  }, [working, phase]);

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

  const hasEstimate = Boolean(result) && !needsQa;

  // --- Stepper (reflects the current flow) ---
  const stepperSteps: StepperStep[] = useMemo(() => {
    const hasResult = Boolean(result) && !needsQa;

    const photosState: StepState = photosOk ? "done" : "active";
    const contactState: StepState = !photosOk ? "todo" : contactOk ? "done" : "active";

    const optimizeState: StepState =
      working && phase === "compressing"
        ? "active"
        : working && (phase === "uploading" || phase === "analyzing" || hasResult)
          ? "done"
          : "todo";

    const uploadState: StepState =
      working && phase === "uploading"
        ? "active"
        : working && (phase === "analyzing" || hasResult)
          ? "done"
          : "todo";

    const inspectState: StepState = working && phase === "analyzing" ? "active" : hasResult ? "done" : "todo";
    const estimateState: StepState = hasResult ? "done" : "todo";

    return [
      { key: "photos", label: "Add photos", state: photosState },
      { key: "contact", label: "Enter your info", state: contactState },
      { key: "optimize", label: "Optimize", state: optimizeState },
      { key: "upload", label: "Upload", state: uploadState },
      { key: "inspect", label: "Inspect", state: inspectState },
      { key: "estimate", label: "Estimate ready", state: estimateState },
    ];
  }, [photosOk, contactOk, working, phase, result, needsQa]);

  // --- focus/scroll rules ---
  useEffect(() => {
    if (!error) return;
    (async () => {
      await focusAndScroll(errorSummaryRef.current, { block: "start" });
    })();
  }, [error]);

  useEffect(() => {
    if (!needsQa) return;
    (async () => {
      await sleep(50);
      await focusAndScroll(qaSectionRef.current, { block: "start" });
      await sleep(50);
      safeFocus(qaFirstInputRef.current);
    })();
  }, [needsQa]);

  useEffect(() => {
    if (!working) return;
    if (phase === "idle") return;
    (async () => {
      await focusAndScroll(statusRegionRef.current, { block: "start" });
    })();
  }, [working, phase]);

  useEffect(() => {
    if (!hasEstimate) return;
    (async () => {
      await sleep(75);
      await focusAndScroll(resultsRef.current, { block: "start" });
      await sleep(25);
      safeFocus(resultsHeadingRef.current);
    })();
  }, [hasEstimate]);

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

      // Preserve ordering semantics
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

      queueMicrotask(() => {
        focusAndScroll(photosSectionRef.current, { block: "start" });
      });
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
    renderAttemptedForQuoteRef.current = null;

    queueMicrotask(() => {
      focusAndScroll(statusRegionRef.current, { block: "start" });
    });

    if (!tenantSlug || typeof tenantSlug !== "string") {
      setError("Missing tenant slug. Please reload the page (invalid tenant link).");
      queueMicrotask(() => focusAndScroll(errorSummaryRef.current, { block: "start" }));
      return;
    }

    if (photos.length < MIN_PHOTOS) {
      setError(`Please add at least ${MIN_PHOTOS} photo for an accurate estimate.`);
      queueMicrotask(() => focusAndScroll(errorSummaryRef.current, { block: "start" }));
      return;
    }

    if (photos.length > MAX_PHOTOS) {
      setError(`Please limit to ${MAX_PHOTOS} photos or fewer.`);
      queueMicrotask(() => focusAndScroll(errorSummaryRef.current, { block: "start" }));
      return;
    }

    if (!customerName.trim()) {
      setError("Please enter your name.");
      queueMicrotask(() => focusAndScroll(errorSummaryRef.current, { block: "start" }));
      return;
    }

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      queueMicrotask(() => focusAndScroll(errorSummaryRef.current, { block: "start" }));
      return;
    }

    if (normalizeUSPhoneDigits(phone).length !== 10) {
      setError("Please enter a valid 10-digit phone number.");
      queueMicrotask(() => focusAndScroll(errorSummaryRef.current, { block: "start" }));
      return;
    }

    setWorking(true);

    try {
      let currentPhotos = photos;
      const needUpload = currentPhotos.filter((p) => !p.uploadedUrl && p.file);

      if (needUpload.length) {
        setPhase("compressing");
        queueMicrotask(() => focusAndScroll(statusRegionRef.current, { block: "start" }));

        const compressed = await Promise.all(needUpload.map((p) => compressImage(p.file!)));

        setPhase("uploading");
        queueMicrotask(() => focusAndScroll(statusRegionRef.current, { block: "start" }));

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

          return {
            ...p,
            uploadedUrl: u,
            previewSrc: u,
            file: undefined,
          };
        });

        setPhotos(mapped);
        currentPhotos = mapped;
      }

      const urls = currentPhotos.map((p) => p.uploadedUrl).filter(Boolean) as string[];
      if (urls.length !== currentPhotos.length) {
        throw new Error("Some photos are not uploaded yet. Please try again.");
      }

      setPhase("analyzing");
      queueMicrotask(() => focusAndScroll(statusRegionRef.current, { block: "start" }));

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

      const qsMerged = (qsFromTop.length ? qsFromTop : qsFromQaObj)
        .map((x: any) => String(x))
        .filter(Boolean);

      if (needsQaFlag && qsMerged.length) {
        setNeedsQa(true);
        setQaQuestions(qsMerged);
        setQaAnswers(qsMerged.map(() => ""));
        setResult(json?.output ?? json);

        queueMicrotask(async () => {
          await focusAndScroll(qaSectionRef.current, { block: "start" });
          await sleep(25);
          safeFocus(qaFirstInputRef.current);
        });

        renderAttemptedForQuoteRef.current = null;
        return;
      }

      setNeedsQa(false);
      setQaQuestions([]);
      setQaAnswers([]);
      setResult(json?.output ?? json);

      renderAttemptedForQuoteRef.current = null;

      queueMicrotask(async () => {
        await sleep(25);
        safeFocus(resultsHeadingRef.current);
      });
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
      setPhase("idle");
      queueMicrotask(() => focusAndScroll(errorSummaryRef.current, { block: "start" }));
    } finally {
      setWorking(false);
      setPhase("idle");
    }
  }
  async function submitQaAnswers() {
    setError(null);

    queueMicrotask(() => focusAndScroll(statusRegionRef.current, { block: "start" }));

    if (!tenantSlug) {
      setError("Missing tenant slug.");
      queueMicrotask(() => focusAndScroll(errorSummaryRef.current, { block: "start" }));
      return;
    }

    if (!quoteLogId) {
      setError("Missing quote reference. Please start over.");
      queueMicrotask(() => focusAndScroll(errorSummaryRef.current, { block: "start" }));
      return;
    }

    if (!qaQuestions.length) {
      setError("No questions to answer.");
      queueMicrotask(() => focusAndScroll(errorSummaryRef.current, { block: "start" }));
      return;
    }

    const trimmed = qaAnswers.map((a) => String(a ?? "").trim());
    const missingIdx = trimmed.findIndex((a) => !a);

    if (missingIdx !== -1) {
      setError(`Please answer: "${qaQuestions[missingIdx]}"`);

      queueMicrotask(async () => {
        await focusAndScroll(qaSectionRef.current, { block: "start" });
        await sleep(25);
        const el = document.getElementById(`qa-input-${missingIdx}`) as HTMLInputElement | null;
        if (el) safeFocus(el);
        else safeFocus(qaFirstInputRef.current);
      });

      return;
    }

    setWorking(true);
    setPhase("analyzing");

    try {
      const res = await fetch("/api/quote/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug,
          quoteLogId,
          qaAnswers: trimmed,
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
        throw new Error(`Finalize failed\nHTTP ${res.status}${code}${msg}${issues}`.trim());
      }

      setNeedsQa(false);
      setQaQuestions([]);
      setQaAnswers([]);
      setResult(json?.output ?? json);

      queueMicrotask(async () => {
        await sleep(25);
        safeFocus(resultsHeadingRef.current);
      });
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
      queueMicrotask(() => focusAndScroll(errorSummaryRef.current, { block: "start" }));
    } finally {
      setWorking(false);
      setPhase("idle");
    }
  }

  async function startRenderOnce(qid: string) {
    if (renderAttemptedForQuoteRef.current === qid) return;
    renderAttemptedForQuoteRef.current = qid;

    setRenderStatus("running");
    setRenderError(null);
    setRenderImageUrl(null);

    queueMicrotask(() => focusAndScroll(statusRegionRef.current, { block: "start" }));

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

      queueMicrotask(async () => {
        await sleep(50);
        await focusAndScroll(renderPreviewRef.current, { block: "start" });
      });
    } catch (e: any) {
      setRenderStatus("failed");
      setRenderError(e?.message ?? "Render failed");
      queueMicrotask(() => focusAndScroll(errorSummaryRef.current, { block: "start" }));
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

  async function retryRender() {
    if (!quoteLogId) return;
    renderAttemptedForQuoteRef.current = null;
    await startRenderOnce(String(quoteLogId));
  }

  // --- structured result helpers (used in Results UI) ---
  const estLow = money(result?.estimate_low ?? result?.estimateLow);
  const estHigh = money(result?.estimate_high ?? result?.estimateHigh);
  const summary = String(result?.summary ?? "").trim();
  const inspection = Boolean(result?.inspection_required ?? result?.inspectionRequired);
  const confidence = String(result?.confidence ?? "").toLowerCase();

  const scope: string[] = Array.isArray(result?.visible_scope)
    ? result.visible_scope
    : Array.isArray(result?.visibleScope)
      ? result.visibleScope
      : [];

  const assumptions: string[] = Array.isArray(result?.assumptions) ? result.assumptions : [];
  const questions: string[] = Array.isArray(result?.questions) ? result.questions : [];

  const confidenceTone =
    confidence === "high"
      ? "green"
      : confidence === "medium"
        ? "yellow"
        : confidence === "low"
          ? "red"
          : "gray";
  return (
    <div className="space-y-6">
      {/* Status / Progress region (focus target while working/rendering) */}
      <div
        ref={statusRegionRef}
        tabIndex={-1}
        aria-label="Status and progress"
        className="grid gap-3 outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20 rounded-xl"
      >
        <ProgressBar title="Working" label={workingLabel} active={working} />
        <Stepper steps={stepperSteps} />
        {aiRenderingEnabled ? (
          <ProgressBar title="AI Rendering" label={renderingLabel} active={renderStatus === "running"} />
        ) : null}
      </div>

      {/* Error summary (focus target on any error) */}
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

      {/* Photos */}
      <section
        ref={photosSectionRef}
        className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
      >
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Add photos</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Minimum <b>{MIN_PHOTOS}</b> photo to submit — but <b>{RECOMMENDED_PHOTOS}–6</b> photos usually gives a better
            estimate. (max {MAX_PHOTOS})
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <input
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={async (e) => {
                try {
                  const f = Array.from(e.target.files ?? []);
                  if (f.length) addCameraFiles(f);
                } catch (err: any) {
                  setError(err?.message ?? "Failed to add photo");
                } finally {
                  e.currentTarget.value = "";
                }
              }}
              disabled={working}
            />
            <div className="w-full rounded-xl bg-black text-white py-4 text-center font-semibold cursor-pointer select-none dark:bg-white dark:text-black">
              Take Photo
            </div>
          </label>

          <label className="block">
            <input
              className="hidden"
              type="file"
              accept="image/*"
              multiple
              onChange={async (e) => {
                try {
                  if (e.target.files) await uploadPhotosNow(e.target.files);
                } catch (err: any) {
                  setError(err?.message ?? "Upload failed");
                } finally {
                  e.currentTarget.value = "";
                }
              }}
              disabled={working}
            />
            <div className="w-full rounded-xl border border-gray-200 py-4 text-center font-semibold cursor-pointer select-none dark:border-gray-800">
              Upload Photos
            </div>
          </label>
        </div>

        {photos.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {photos.map((p, idx) => {
              const badge = shotBadge(p.shotType);
              return (
                <div key={p.id} className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.previewSrc} alt={`photo ${idx + 1}`} className="h-44 w-full object-cover" />
                    <div className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-xs font-semibold text-white">
                      {badge}
                    </div>
                    <button
                      type="button"
                      className="absolute top-2 right-2 rounded-md bg-white/90 border border-gray-200 px-2 py-1 text-xs disabled:opacity-50 dark:bg-gray-900/90 dark:border-gray-800"
                      onClick={() => removePhoto(p.id)}
                      disabled={working}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="p-3 flex flex-wrap items-center gap-2">
                    <div className="text-xs text-gray-600 dark:text-gray-300 mr-1">Label:</div>

                    {(["wide", "closeup", "extra"] as ShotType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={cn(
                          "rounded-md px-2 py-1 text-xs font-semibold border",
                          p.shotType === t
                            ? "bg-black text-white border-black dark:bg-white dark:text-black dark:border-white"
                            : "bg-white text-gray-900 border-gray-200 dark:bg-gray-950 dark:text-gray-100 dark:border-gray-800"
                        )}
                        onClick={() => setShotType(p.id, t)}
                        disabled={working}
                      >
                        {t === "wide" ? "Wide" : t === "closeup" ? "Close-up" : "Extra"}
                      </button>
                    ))}

                    {!p.uploadedUrl && p.file ? (
                      <span className="ml-auto text-[11px] text-gray-500 dark:text-gray-300">
                        Camera photo (uploads on submit)
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
            No photos yet. Add at least one photo to continue — two or more is better.
          </div>
        )}

        <div className="text-xs text-gray-600 dark:text-gray-300">
          {photoCount >= MIN_PHOTOS ? (
            <>
              ✅ {photoCount} photo{photoCount === 1 ? "" : "s"} added{" "}
              {!recommendedOk ? (
                <span className="text-gray-500 dark:text-gray-400">· Add 1+ more for best results</span>
              ) : null}
            </>
          ) : (
            `Add ${MIN_PHOTOS} photo (you have ${photoCount})`
          )}
        </div>
      </section>

      {/* Details */}
      <section
        ref={infoSectionRef}
        className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
      >
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Your info</h2>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Required so we can send your estimate and follow up if needed.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="text-xs text-gray-700 dark:text-gray-200">
              Name <span className="text-red-600">*</span>
            </div>
            <input
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Your name"
              disabled={working}
              autoComplete="name"
            />
          </label>

          <label className="block">
            <div className="text-xs text-gray-700 dark:text-gray-200">
              Email <span className="text-red-600">*</span>
            </div>
            <input
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              disabled={working}
              inputMode="email"
              autoComplete="email"
            />
          </label>
        </div>

        <label className="block">
          <div className="text-xs text-gray-700 dark:text-gray-200">
            Phone <span className="text-red-600">*</span>
          </div>
          <input
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            value={phone}
            onChange={(e) => setPhone(formatUSPhone(e.target.value))}
            placeholder="(555) 555-5555"
            disabled={working}
            inputMode="tel"
            autoComplete="tel"
          />
          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            Tip: if you type a leading “1”, we’ll normalize it automatically.
          </div>
        </label>

        <label className="block">
          <div className="text-xs text-gray-700 dark:text-gray-200">Notes</div>
          <textarea
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What are you looking to do? Material preference, timeline, constraints?"
            disabled={working}
          />
        </label>

        {aiRenderingEnabled ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex items-start gap-3">
              <input
                id="renderOptIn"
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={renderOptIn}
                onChange={(e) => setRenderOptIn(e.target.checked)}
                disabled={working}
              />
              <label htmlFor="renderOptIn" className="cursor-pointer">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Optional: AI rendering preview
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  If selected, we’ll generate a visual “after” concept as a second step after your estimate.
                </div>
              </label>
            </div>
          </div>
        ) : null}

        <button
          className="w-full rounded-xl bg-black text-white py-4 font-semibold disabled:opacity-50 dark:bg-white dark:text-black"
          onClick={submitEstimate}
          disabled={!canSubmit}
        >
          {working ? "Working…" : "Get Estimate"}
        </button>

        {disabledReason ? <div className="text-xs text-gray-600 dark:text-gray-300">{disabledReason}</div> : null}

        <button
          type="button"
          className="w-full rounded-xl border border-gray-200 py-3 text-sm font-semibold dark:border-gray-800"
          onClick={startOver}
          disabled={working}
        >
          Start Over
        </button>
      </section>

      {/* Live Q&A */}
      {needsQa ? (
        <section
          ref={qaSectionRef}
          className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
        >
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Quick questions</h2>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              One more step — answer these and we’ll finalize your estimate.
            </p>
          </div>

          <div className="space-y-3">
            {qaQuestions.map((q, i) => (
              <label key={i} className="block">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                  {i + 1}. {q} <span className="text-red-600">*</span>
                </div>
                <input
                  id={`qa-input-${i}`}
                  ref={i === 0 ? qaFirstInputRef : undefined}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
                  value={qaAnswers[i] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setQaAnswers((prev) => {
                      const next = [...prev];
                      next[i] = v;
                      return next;
                    });
                  }}
                  placeholder="Type your answer…"
                  disabled={working}
                />
              </label>
            ))}
          </div>

          <button
            className="w-full rounded-xl bg-black text-white py-4 font-semibold disabled:opacity-50 dark:bg-white dark:text-black"
            onClick={submitQaAnswers}
            disabled={working || !quoteLogId}
          >
            {working ? "Working…" : "Finalize Estimate"}
          </button>

          <div className="text-xs text-gray-600 dark:text-gray-300">
            Ref: {quoteLogId ? quoteLogId.slice(0, 8) : "(missing)"}
          </div>
        </section>
      ) : null}

      {/* Results */}
      {hasEstimate ? (
        <section
          ref={resultsRef}
          className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                ref={resultsHeadingRef}
                tabIndex={-1}
                className="text-lg font-semibold text-gray-900 dark:text-gray-100 outline-none"
              >
                Your estimate
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                This is a fast estimate range based on your photos + notes. Final pricing may change after inspection.
              </p>
            </div>
            {quoteLogId ? (
              <div className="text-xs text-gray-500 dark:text-gray-400">Ref: {quoteLogId.slice(0, 8)}</div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex flex-wrap items-center gap-2">
              {toneBadge(confidence ? `Confidence: ${confidence}` : "Confidence: unknown", confidenceTone as any)}
              {inspection ? toneBadge("Inspection recommended", "yellow") : toneBadge("No inspection required", "green")}
              {aiRenderingEnabled && renderOptIn ? toneBadge("Rendering requested", "blue") : null}
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <div className="text-xs font-semibold tracking-wide text-gray-600 dark:text-gray-300">ESTIMATE RANGE</div>
              <div className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
                {estLow && estHigh ? `$${estLow} – $${estHigh}` : "We need a bit more info"}
              </div>

              {summary ? (
                <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">{summary}</div>
              ) : (
                <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                  We’ll follow up if we need any clarifications.
                </div>
              )}
            </div>
          </div>

          {scope.length || assumptions.length || questions.length ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Visible scope</div>
                <div className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-200">
                  {scope.length ? (
                    <ul className="list-disc pl-5 space-y-1">
                      {scope.slice(0, 10).map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-gray-500 dark:text-gray-400 italic">Not enough detail yet.</div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Assumptions</div>
                <div className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-200">
                  {assumptions.length ? (
                    <ul className="list-disc pl-5 space-y-1">
                      {assumptions.slice(0, 10).map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-gray-500 dark:text-gray-400 italic">None.</div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Questions</div>
                <div className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-200">
                  {questions.length ? (
                    <ul className="list-disc pl-5 space-y-1">
                      {questions.slice(0, 10).map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-gray-500 dark:text-gray-400 italic">No follow-ups needed.</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {aiRenderingEnabled && renderOptIn ? (
            <div
              ref={renderPreviewRef}
              className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3 dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Rendering preview</div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">Status: {renderStatus}</div>
                </div>

                <button
                  type="button"
                  className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-800"
                  onClick={retryRender}
                  disabled={!quoteLogId || working || renderStatus === "running"}
                >
                  Retry Render
                </button>
              </div>

              {renderError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                  {renderError}
                </div>
              ) : null}

              {renderImageUrl ? (
                <div className="rounded-xl border border-gray-200 overflow-hidden dark:border-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={renderImageUrl} alt="AI rendering" className="w-full object-cover" />
                </div>
              ) : (
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  If enabled, your visual concept will appear here when ready.
                </div>
              )}
            </div>
          ) : null}

          <details className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
            <summary className="cursor-pointer text-sm font-semibold">Raw result (debug)</summary>
            <pre className="mt-4 overflow-auto rounded-xl border border-gray-200 bg-black p-4 text-xs text-white dark:border-gray-800">
{JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </section>
      ) : null}

      <p className="text-xs text-gray-600 dark:text-gray-300">
        By submitting, you agree we may contact you about this request. Photos are used only to prepare your estimate.
      </p>
    </div>
  );
}