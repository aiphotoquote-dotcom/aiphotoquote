// src/components/admin/quoteEmail/QuoteEmailComposeClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import QuoteEmailPreview, { type QuoteEmailPreviewModel } from "./QuoteEmailPreview";

function safeTrim(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

type TemplateKey = "standard" | "before_after" | "visual_first";

type RenderRow = {
  id: string;
  imageUrl?: string | null;
  createdAt?: any;
  attempt?: number | null;
  quoteVersionId?: string | null;
  status?: string | null;
};

type Photo = {
  url?: string;
  publicUrl?: string;
  blobUrl?: string;
};

function photoUrl(p: any) {
  return safeTrim(p?.url || p?.publicUrl || p?.blobUrl);
}

function photoKey(p: any, idx: number) {
  const u = photoUrl(p);
  return u ? `url:${u}` : `idx:${idx}`;
}

function templateLabel(k: TemplateKey) {
  if (k === "standard") return "Standard";
  if (k === "before_after") return "Before / After";
  return "Visual First";
}

function templateDesc(k: TemplateKey) {
  if (k === "standard") return "Balanced quote + visuals.";
  if (k === "before_after") return "Great for transformations.";
  return "Sales-first visuals, lighter text.";
}

function isTemplateKey(v: string): v is TemplateKey {
  return v === "standard" || v === "before_after" || v === "visual_first";
}

function chip(text: string) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
      {text}
    </span>
  );
}

function joinCsv(xs: string[]) {
  return xs
    .map((x) => safeTrim(x))
    .filter(Boolean)
    .join(",");
}

function parseEmailList(input: string): string[] {
  const s = safeTrim(input);
  if (!s) return [];
  return s
    .split(/[,;\n]+/g)
    .map((x) => safeTrim(x))
    .filter(Boolean);
}

function looksLikeEmail(email: string): boolean {
  const s = safeTrim(email);
  if (!s) return false;
  if (s.includes(" ")) return false;
  const at = s.indexOf("@");
  if (at <= 0) return false;
  const dot = s.lastIndexOf(".");
  if (dot < at + 2) return false;
  if (dot >= s.length - 1) return false;
  return true;
}

/* ------------------- Version output parsing (best effort) ------------------- */
function pickAiAssessmentFromAny(outAny: any) {
  const o = outAny ?? {};
  const candidates = [
    o?.ai_assessment,
    o?.output?.ai_assessment,
    o?.assessment,
    o?.output?.assessment,
    o?.aiAssessment,
    o?.output?.aiAssessment,
    o,
  ];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const hasAny =
      c?.summary ||
      c?.estimate_low ||
      c?.estimate_high ||
      c?.estimateLow ||
      c?.estimateHigh ||
      c?.confidence ||
      Array.isArray(c?.questions) ||
      Array.isArray(c?.assumptions);
    if (hasAny) return c;
  }
  return null;
}

function money(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v;
}

function formatMoney(n: number) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n)}`;
  }
}

function formatEstimateText(lowMaybe: any, highMaybe: any) {
  const low = money(lowMaybe);
  const high = money(highMaybe);
  if (low == null && high == null) return "";
  if (low != null && high != null) return `${formatMoney(low)} — ${formatMoney(high)}`;
  if (low != null) return `${formatMoney(low)}+`;
  return `Up to ${formatMoney(high!)}`;
}

function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => safeTrim(x)).filter(Boolean);
}

export default function QuoteEmailComposeClient(props: {
  quoteId: string;
  tenantId: string;
  lead: any;

  versionRows: any[];
  customerPhotos: Photo[];
  renderedRenders: RenderRow[];

  initialTemplateKey: string;
  initialSelectedVersionNumber?: string;
  initialSelectedRenderIds: string[];
  initialSelectedPhotoKeys: string[];

  // ✅ NEW: branding passed from server page (preferred)
  brandName?: string | null;
  brandLogoUrl?: string | null;
  brandTagline?: string | null;
}) {
  const {
    quoteId,
    tenantId,
    lead,
    versionRows,
    customerPhotos,
    renderedRenders,
    initialTemplateKey,
    initialSelectedVersionNumber,
    initialSelectedRenderIds,
    initialSelectedPhotoKeys,
    brandName,
    brandLogoUrl,
    brandTagline,
  } = props;

  const initialTemplate = ((): TemplateKey => {
    const t = safeTrim(initialTemplateKey);
    return isTemplateKey(t) ? (t as TemplateKey) : "standard";
  })();

  const [templateKey, setTemplateKey] = useState<TemplateKey>(initialTemplate);

  /* ------------------------------ version picker ------------------------------ */
  const versionOptions = useMemo(() => {
    const rows = Array.isArray(versionRows) ? versionRows : [];
    const mapped = rows
      .map((v: any) => {
        const n = Number(v?.version);
        const dt = v?.createdAt ?? v?.created_at ?? null;
        const labelTime = dt ? new Date(dt).toLocaleString() : "";
        const label = Number.isFinite(n)
          ? `v${n}${labelTime ? ` — ${labelTime}` : ""}`
          : safeTrim(v?.id)
            ? `version ${String(v.id).slice(0, 8)}…`
            : "version";
        return { value: Number.isFinite(n) ? String(n) : "", label, raw: v };
      })
      .filter((x) => x.value || x.label);

    mapped.sort((a, b) => Number(a.value || 0) - Number(b.value || 0));
    return mapped;
  }, [versionRows]);

  const initialVersionNumber = ((): string => {
    const v = safeTrim(initialSelectedVersionNumber);
    if (v && versionOptions.some((x) => x.value === v)) return v;
    const vs = versionOptions.map((x) => Number(x.value)).filter((n) => Number.isFinite(n));
    if (vs.length) return String(Math.max(...vs));
    return "";
  })();

  const [selectedVersionNumber, setSelectedVersionNumber] = useState<string>(initialVersionNumber);

  const selectedVersionRow = useMemo(() => {
    const rows = Array.isArray(versionRows) ? versionRows : [];
    const vnum = Number(selectedVersionNumber);
    if (!Number.isFinite(vnum)) return null;
    return rows.find((r: any) => Number(r?.version) === vnum) ?? null;
  }, [versionRows, selectedVersionNumber]);

  const assessment = useMemo(() => {
    const out = selectedVersionRow?.output ?? selectedVersionRow?.outputJson ?? selectedVersionRow?.result ?? null;
    return pickAiAssessmentFromAny(out);
  }, [selectedVersionRow]);

  const estimateText = useMemo(() => {
    if (!assessment) return "";
    const low =
      assessment?.estimate_low ??
      assessment?.estimateLow ??
      assessment?.estimate?.low ??
      assessment?.estimate?.estimate_low ??
      null;
    const high =
      assessment?.estimate_high ??
      assessment?.estimateHigh ??
      assessment?.estimate?.high ??
      assessment?.estimate?.estimate_high ??
      null;
    return formatEstimateText(low, high);
  }, [assessment]);

  const confidence = safeTrim(assessment?.confidence ?? "");
  const inspectionRequired =
    typeof assessment?.inspection_required === "boolean"
      ? assessment.inspection_required
      : typeof assessment?.inspectionRequired === "boolean"
        ? assessment.inspectionRequired
        : null;

  const summary = safeTrim(assessment?.summary ?? "");
  const questions = asStringArray(assessment?.questions);
  const assumptions = asStringArray(assessment?.assumptions);
  const visibleScope = asStringArray(assessment?.visible_scope ?? assessment?.visibleScope);

  /* ------------------------------ selection state ------------------------------ */
  const [selectedRenderIds, setSelectedRenderIds] = useState<string[]>(
    Array.isArray(initialSelectedRenderIds) ? initialSelectedRenderIds : []
  );

  const customerPhotoItems = useMemo(() => {
    return (customerPhotos ?? []).map((p: any, idx: number) => ({
      key: photoKey(p, idx),
      url: photoUrl(p),
      raw: p,
    }));
  }, [customerPhotos]);

  const [selectedPhotoKeys, setSelectedPhotoKeys] = useState<string[]>(
    Array.isArray(initialSelectedPhotoKeys) ? initialSelectedPhotoKeys : []
  );

  // Addressing fields
  const defaultTo = safeTrim(lead?.email || lead?.customerEmail || lead?.contact?.email || "");
  const defaultName = safeTrim(lead?.name || lead?.customerName || lead?.contact?.name || "");

  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");

  // Copy overrides (inline edited in preview)
  const [subject, setSubject] = useState(defaultName ? `Your quote is ready — ${defaultName}` : "Your quote is ready");
  const [headline, setHeadline] = useState("Your quote is ready ✅");
  const [intro, setIntro] = useState(
    `Hi ${defaultName || "there"},\n\nThanks for reaching out. We reviewed your photos and put together a quote package below.\n\nIf you'd like to move forward, reply to this email and we'll get you scheduled.`
  );

  // use lead shopName only for closing fallback (signature)
  const [closing, setClosing] = useState("Thanks,\n— " + (safeTrim(lead?.shopName) || "Your Shop"));

  /* ------------------------------ section toggles ------------------------------ */
  const [showPricing, setShowPricing] = useState(true);
  const [showSummary, setShowSummary] = useState(true);
  const [showScope, setShowScope] = useState(false);
  const [showQuestions, setShowQuestions] = useState(true);
  const [showAssumptions, setShowAssumptions] = useState(false);

  function toggleRender(id: string) {
    setSelectedRenderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function togglePhoto(k: string) {
    setSelectedPhotoKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  const selectedRenders = useMemo(() => {
    const set = new Set(selectedRenderIds);
    return (renderedRenders ?? []).filter((r) => set.has(String(r.id))).filter((r) => safeTrim(r.imageUrl));
  }, [renderedRenders, selectedRenderIds]);

  const selectedPhotos = useMemo(() => {
    const set = new Set(selectedPhotoKeys);
    return (customerPhotoItems ?? []).filter((p) => set.has(p.key)).filter((p) => safeTrim(p.url));
  }, [customerPhotoItems, selectedPhotoKeys]);

  const selectedImages = useMemo(() => {
    const imgs: Array<{ kind: "render" | "photo"; id: string; url: string; label: string }> = [];
    for (const r of selectedRenders) {
      const url = safeTrim(r.imageUrl);
      if (!url) continue;
      imgs.push({
        kind: "render",
        id: String(r.id),
        url,
        label: `Render${r.attempt != null ? ` #${Number(r.attempt)}` : ""}`,
      });
    }
    for (const p of selectedPhotos) {
      const url = safeTrim(p.url);
      if (!url) continue;
      imgs.push({ kind: "photo", id: p.key, url, label: "Customer photo" });
    }
    return imgs;
  }, [selectedRenders, selectedPhotos]);

  const totalSelectedImages = selectedImages.length;

  // ✅ BRAND: prefer server-provided branding props, then lead fallbacks.
  const brand = useMemo(() => {
    const name =
      safeTrim(brandName) ||
      safeTrim(lead?.shopName) ||
      safeTrim(lead?.shop?.name) ||
      safeTrim(lead?.tenantName) ||
      safeTrim(lead?.tenant?.name) ||
      "Your Shop Name";

    const logoUrl =
      safeTrim(brandLogoUrl) ||
      safeTrim(lead?.shopLogoUrl) ||
      safeTrim(lead?.shop?.logoUrl) ||
      safeTrim(lead?.shop?.logo_url) ||
      safeTrim(lead?.logoUrl) ||
      "";

    const tagline = safeTrim(brandTagline) || "Quote ready to review";

    return {
      name,
      logoUrl: logoUrl || null,
      tagline,
    };
  }, [brandName, brandLogoUrl, brandTagline, lead]);

  const previewModel: QuoteEmailPreviewModel = useMemo(() => {
    const featured =
      templateKey === "before_after"
        ? selectedImages.find((x) => x.kind === "photo") || selectedImages[0] || null
        : selectedImages.find((x) => x.kind === "render") || selectedImages[0] || null;

    const gallery = featured ? selectedImages.filter((x) => x.url !== featured.url) : selectedImages;

    return {
      templateKey,
      quoteId,
      tenantId,
      selectedVersionNumber: safeTrim(selectedVersionNumber),

      to,
      cc,
      bcc,
      subject,

      headline,
      intro,
      closing,

      featuredImage: featured ? { url: featured.url, label: featured.label } : null,
      galleryImages: gallery.map((x) => ({ url: x.url, label: x.label })),

      brand,

      quoteBlocks: {
        showPricing,
        showSummary,
        showScope,
        showQuestions,
        showAssumptions,

        estimateText: safeTrim(estimateText),
        confidence: safeTrim(confidence),
        inspectionRequired,

        summary: safeTrim(summary),
        visibleScope,
        questions,
        assumptions,
      },

      badges: [
        safeTrim(selectedVersionNumber) ? `v${safeTrim(selectedVersionNumber)}` : "",
        templateLabel(templateKey),
        totalSelectedImages ? `${totalSelectedImages} image${totalSelectedImages === 1 ? "" : "s"}` : "No images selected",
      ].filter(Boolean),
    };
  }, [
    templateKey,
    quoteId,
    tenantId,
    selectedVersionNumber,
    to,
    cc,
    bcc,
    subject,
    headline,
    intro,
    closing,
    selectedImages,
    totalSelectedImages,
    showPricing,
    showSummary,
    showScope,
    showQuestions,
    showAssumptions,
    estimateText,
    confidence,
    inspectionRequired,
    summary,
    visibleScope,
    questions,
    assumptions,
    brand,
  ]);

  /* ------------------------------ media drawer ------------------------------ */
  const [mediaOpen, setMediaOpen] = useState(false);
  function openMedia() {
    setMediaOpen(true);
  }
  function closeMedia() {
    setMediaOpen(false);
  }
  function clearMedia() {
    setSelectedRenderIds([]);
    setSelectedPhotoKeys([]);
  }

  const [didAutopromptMedia, setDidAutopromptMedia] = useState(false);
  useEffect(() => {
    if (didAutopromptMedia) return;
    if (totalSelectedImages === 0) {
      setMediaOpen(true);
      setDidAutopromptMedia(true);
    }
  }, [didAutopromptMedia, totalSelectedImages]);

  const shareUrl = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("template", templateKey);
    if (safeTrim(selectedVersionNumber)) sp.set("version", safeTrim(selectedVersionNumber));
    if (selectedRenderIds.length) sp.set("renders", joinCsv(selectedRenderIds));
    if (selectedPhotoKeys.length) sp.set("photos", joinCsv(selectedPhotoKeys));
    return `/admin/quotes/${encodeURIComponent(quoteId)}/email/compose?${sp.toString()}`;
  }, [templateKey, selectedVersionNumber, selectedRenderIds, selectedPhotoKeys, quoteId]);

  const [copied, setCopied] = useState(false);
  async function copyShareUrl() {
    try {
      const full = typeof window !== "undefined" ? new URL(shareUrl, window.location.origin).toString() : shareUrl;
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  function toggleBtn(active: boolean) {
    return (
      "rounded-full px-3 py-2 text-xs font-semibold transition border " +
      (active
        ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-200 dark:hover:bg-gray-900")
    );
  }

  const toOk = Boolean(safeTrim(to)) && looksLikeEmail(safeTrim(to));
  const ccList = useMemo(() => parseEmailList(cc), [cc]);
  const bccList = useMemo(() => parseEmailList(bcc), [bcc]);
  const ccOk = ccList.every(looksLikeEmail);
  const bccOk = bccList.every(looksLikeEmail);

  const canSend =
    toOk &&
    totalSelectedImages > 0 &&
    Boolean(safeTrim(subject)) &&
    Boolean(safeTrim(selectedVersionNumber)) &&
    ccOk &&
    bccOk;

  /* ------------------------------ send wiring (new engine) ------------------------------ */
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendOk, setSendOk] = useState<string | null>(null);

  async function doSend() {
    if (sending) return;
    setSendError(null);
    setSendOk(null);

    if (!toOk) return setSendError("Please enter a valid customer email in To.");
    if (!safeTrim(subject)) return setSendError("Subject is required.");
    if (!safeTrim(selectedVersionNumber)) return setSendError("Select a version to send.");
    if (!ccOk) return setSendError("One or more CC addresses look invalid.");
    if (!bccOk) return setSendError("One or more BCC addresses look invalid.");
    if (totalSelectedImages <= 0) return setSendError("Select at least one image to send.");

    const featuredImage = previewModel.featuredImage ?? null;
    const galleryImages = Array.isArray(previewModel.galleryImages) ? previewModel.galleryImages : [];
    if (!featuredImage && galleryImages.length === 0) return setSendError("No images available to send. Select at least one image.");

    setSending(true);
    try {
      const url = `/api/admin/quotes/${encodeURIComponent(quoteId)}/email/send`;

      const payload = {
        tenantId,
        quoteId,

        templateKey,
        versionNumber: safeTrim(selectedVersionNumber),
        renderIds: [...selectedRenderIds],
        photoKeys: [...selectedPhotoKeys],

        featuredImage,
        galleryImages,
        selectedImages: selectedImages.map((x) => ({ url: x.url, label: x.label })),

        to: safeTrim(to),
        cc: ccList,
        bcc: bccList,
        subject: safeTrim(subject),

        headline: safeTrim(headline),
        intro,
        closing,

        quoteBlocks: { showPricing, showSummary, showScope, showQuestions, showAssumptions },

        // ✅ send brand too so the final HTML can match
        brand,

        shareUrl: safeTrim(shareUrl),
      };

      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        const msg = safeTrim(j?.message) || safeTrim(j?.error) || (r.status ? `Send failed (${r.status})` : "Send failed");
        throw new Error(msg);
      }

      const messageId = safeTrim(j?.providerMessageId || j?.messageId || j?.id || "");
      setSendOk(messageId ? `Sent! (id: ${messageId})` : "Sent!");
    } catch (e: any) {
      setSendError(e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Sticky builder bar */}
      <div className="sticky top-0 z-30 -mx-6 border-b border-gray-200 bg-white/80 px-6 py-3 backdrop-blur dark:border-gray-800 dark:bg-black/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">1) Version</div>
              <select
                value={selectedVersionNumber}
                onChange={(e) => setSelectedVersionNumber(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              >
                {versionOptions.length ? (
                  versionOptions.map((v) => (
                    <option key={v.value || v.label} value={v.value}>
                      {v.label}
                    </option>
                  ))
                ) : (
                  <option value="">(no versions)</option>
                )}
              </select>
            </div>

            <div className="ml-1 flex items-center gap-2">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">2) Template</div>
              <div className="flex flex-wrap gap-2">
                {(["standard", "before_after", "visual_first"] as TemplateKey[]).map((k) => {
                  const active = k === templateKey;
                  return (
                    <button key={k} type="button" onClick={() => setTemplateKey(k)} className={toggleBtn(active)} title={templateDesc(k)}>
                      {templateLabel(k)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="ml-1 flex items-center gap-2">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">3) Sections</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setShowPricing((v) => !v)} className={toggleBtn(showPricing)}>
                  Pricing
                </button>
                <button type="button" onClick={() => setShowSummary((v) => !v)} className={toggleBtn(showSummary)}>
                  Summary
                </button>
                <button type="button" onClick={() => setShowQuestions((v) => !v)} className={toggleBtn(showQuestions)}>
                  Questions
                </button>
                <button type="button" onClick={() => setShowAssumptions((v) => !v)} className={toggleBtn(showAssumptions)}>
                  Assumptions
                </button>
                <button type="button" onClick={() => setShowScope((v) => !v)} className={toggleBtn(showScope)}>
                  Scope
                </button>
              </div>
            </div>

            <div className="ml-1 flex flex-wrap gap-2">
              {chip(`${totalSelectedImages} selected`)}
              {safeTrim(selectedVersionNumber) ? chip(`v${safeTrim(selectedVersionNumber)}`) : chip("v—")}
              {estimateText ? chip(estimateText) : chip("estimate —")}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openMedia}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
            >
              Select images
            </button>

            <button
              type="button"
              onClick={clearMedia}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-900"
              title="Clear all selected images"
            >
              Clear
            </button>

            <button
              type="button"
              onClick={copyShareUrl}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-900"
              title="Copy shareable builder URL"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>

            <button
              type="button"
              onClick={doSend}
              disabled={!canSend || sending}
              className={
                "rounded-lg px-4 py-2 text-sm font-semibold " +
                (canSend && !sending
                  ? "bg-black text-white hover:opacity-90 dark:bg-white dark:text-black"
                  : "bg-black text-white opacity-50 dark:bg-white dark:text-black")
              }
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>

        {(sendError || sendOk) && (
          <div className="mt-3">
            {sendError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                <div className="font-semibold">Send failed</div>
                <div className="mt-1">{sendError}</div>
              </div>
            ) : null}
            {sendOk ? (
              <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200">
                <div className="font-semibold">Success</div>
                <div className="mt-1">{sendOk}</div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Address row */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">To</div>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="customer@email.com"
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
            {!toOk && safeTrim(to) ? (
              <div className="mt-2 text-xs font-semibold text-red-700 dark:text-red-200">Please enter a valid email.</div>
            ) : null}
          </div>

          <div className="lg:col-span-3">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">CC</div>
            <input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="optional"
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
            {!ccOk && safeTrim(cc) ? (
              <div className="mt-2 text-xs font-semibold text-red-700 dark:text-red-200">One or more CC addresses look invalid.</div>
            ) : null}
          </div>

          <div className="lg:col-span-4">
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">BCC</div>
            <input
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              placeholder="optional"
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
            {!bccOk && safeTrim(bcc) ? (
              <div className="mt-2 text-xs font-semibold text-red-700 dark:text-red-200">One or more BCC addresses look invalid.</div>
            ) : null}
          </div>
        </div>

        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Subject</div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
          />
        </div>

        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Shareable builder URL:{" "}
          <a className="font-mono underline" href={shareUrl}>
            {shareUrl}
          </a>
        </div>
      </section>

      {/* Preview canvas */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Email preview</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">This is the customer-facing email. Click into text to edit.</p>
          </div>
          <div className="flex flex-wrap gap-2">{previewModel.badges.map((b) => chip(b))}</div>
        </div>

        <div className="mt-4">
          <QuoteEmailPreview
            model={previewModel}
            onEdit={{
              setHeadline,
              setIntro,
              setClosing,
            }}
          />
        </div>
      </section>

      {/* Media drawer (unchanged) */}
      {mediaOpen ? (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={closeMedia} />
          <div className="absolute right-0 top-0 h-full w-full max-w-3xl bg-white shadow-2xl dark:bg-black">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Select images</div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  Pick renders and/or customer photos — the preview updates instantly.
                </div>
              </div>
              <div className="flex items-center gap-2">
                {chip(`Selected: ${totalSelectedImages}`)}
                <button
                  type="button"
                  onClick={closeMedia}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                >
                  Done
                </button>
              </div>
            </div>

            <div className="h-[calc(100%-64px)] overflow-auto px-6 py-5 space-y-8">
              {/* Renders */}
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Renders</div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">Rendered only</div>
                </div>

                {renderedRenders?.length ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {renderedRenders.map((r) => {
                      const url = safeTrim(r.imageUrl);
                      if (!url) return null;
                      const active = selectedRenderIds.includes(String(r.id));
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => toggleRender(String(r.id))}
                          className={
                            "group rounded-2xl border overflow-hidden text-left transition " +
                            (active
                              ? "border-black ring-2 ring-black dark:border-white dark:ring-white"
                              : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700")
                          }
                          title="Toggle render"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="Render" className="h-40 w-full object-cover bg-black/5" />
                          <div className="p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                                Render {r.attempt != null ? `#${Number(r.attempt)}` : ""}
                              </div>
                              {active ? (
                                <span className="rounded-full bg-black px-2 py-1 text-[11px] font-semibold text-white dark:bg-white dark:text-black">
                                  SELECTED
                                </span>
                              ) : (
                                <span className="text-[11px] text-gray-500 dark:text-gray-400 group-hover:underline">
                                  Click to select
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                    No rendered images found yet.
                  </div>
                )}
              </div>

              {/* Customer Photos */}
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">Customer photos</div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">From the quote</div>
                </div>

                {customerPhotoItems?.length ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {customerPhotoItems.map((p) => {
                      const active = selectedPhotoKeys.includes(p.key);
                      const url = safeTrim(p.url);
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => togglePhoto(p.key)}
                          className={
                            "group rounded-2xl border overflow-hidden text-left transition " +
                            (active
                              ? "border-black ring-2 ring-black dark:border-white dark:ring-white"
                              : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700")
                          }
                          title="Toggle customer photo"
                        >
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt="Customer photo" className="h-32 w-full object-cover bg-black/5" />
                          ) : (
                            <div className="h-32 w-full flex items-center justify-center text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-black">
                              Missing URL
                            </div>
                          )}
                          <div className="p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">Customer photo</div>
                              {active ? (
                                <span className="rounded-full bg-black px-2 py-1 text-[11px] font-semibold text-white dark:bg-white dark:text-black">
                                  SELECTED
                                </span>
                              ) : (
                                <span className="text-[11px] text-gray-500 dark:text-gray-400 group-hover:underline">
                                  Click to select
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300">
                    No customer photos found on this quote.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
                <div className="font-semibold">Tip</div>
                <div className="mt-1">The preview chooses a featured image automatically based on the template, then builds a clean gallery.</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}