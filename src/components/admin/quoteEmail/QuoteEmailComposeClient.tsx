// src/components/admin/quoteEmail/QuoteEmailComposeClient.tsx
"use client";

import React, { useMemo, useState } from "react";

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
  // anything else your pickPhotos returns
};

function photoUrl(p: any) {
  return safeTrim(p?.url || p?.publicUrl || p?.blobUrl);
}

/**
 * We need a stable selection key for customer photos.
 * In v1: use URL when present; fallback to index key.
 */
function photoKey(p: any, idx: number) {
  const u = photoUrl(p);
  return u ? `url:${u}` : `idx:${idx}`;
}

function templateLabel(k: TemplateKey) {
  if (k === "standard") return "Standard Quote";
  if (k === "before_after") return "Before / After";
  return "Visual First";
}

function templateOneLiner(k: TemplateKey) {
  if (k === "standard") return "Balanced: featured render + details.";
  if (k === "before_after") return "Transformation: before/after emphasis.";
  return "Sales-first: big visuals, minimal text.";
}

function chip(text: string) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
      {text}
    </span>
  );
}

function splitEmails(v: string) {
  return safeTrim(v)
    .split(",")
    .map((x) => safeTrim(x))
    .filter(Boolean);
}

function MiniLabel({ label }: { label: string }) {
  return <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">{label}</div>;
}

function Hr() {
  return <div className="h-px w-full bg-gray-200 dark:bg-gray-800" />;
}

function EmailSheet({
  templateKey,
  brandName,
  preheader,
  subject,
  intro,
  scopeBullets,
  closing,
  signature,
  selectedRenders,
  selectedPhotos,
}: {
  templateKey: TemplateKey;
  brandName: string;
  preheader: string;
  subject: string;
  intro: string;
  scopeBullets: string[];
  closing: string;
  signature: string;
  selectedRenders: RenderRow[];
  selectedPhotos: Array<{ key: string; url: string }>;
}) {
  const renders = selectedRenders.filter((r) => safeTrim(r.imageUrl));
  const photos = selectedPhotos.filter((p) => safeTrim(p.url));

  const heroUrl =
    templateKey === "visual_first"
      ? safeTrim(renders[0]?.imageUrl) || safeTrim(photos[0]?.url)
      : safeTrim(renders[0]?.imageUrl) || safeTrim(photos[0]?.url);

  // Light “marketing” accent without hardcoding brand colors too much.
  // Later: drive from tenant branding config.
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950 overflow-hidden">
      {/* top accent */}
      <div className="h-1 w-full bg-black dark:bg-white" />

      {/* “Email header” */}
      <div className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* logo placeholder */}
            <div className="h-10 w-10 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center dark:bg-black dark:border-gray-800">
              <span className="text-xs font-black text-gray-700 dark:text-gray-200">APQ</span>
            </div>
            <div>
              <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{brandName}</div>
              <div className="text-[11px] text-gray-600 dark:text-gray-300">{preheader}</div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-[11px] text-gray-500 dark:text-gray-400">Subject</div>
            <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">{subject}</div>
          </div>
        </div>

        <div className="mt-5">
          <Hr />
        </div>

        {/* Template-specific visual section */}
        <div className="mt-6 space-y-4">
          {templateKey === "visual_first" ? (
            <>
              {heroUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={heroUrl}
                  alt="Featured visual"
                  className="w-full max-h-[420px] object-cover rounded-2xl border border-gray-200 dark:border-gray-800 bg-black/5"
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-300">
                  Select at least one render or photo to feature here.
                </div>
              )}

              {(renders.length + photos.length) > 1 ? (
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                  {[
                    ...renders.slice(0, 6).map((r) => ({ key: `r:${r.id}`, url: safeTrim(r.imageUrl) })),
                    ...photos.slice(0, 6).map((p) => ({ key: p.key, url: safeTrim(p.url) })),
                  ]
                    .filter((x) => x.url)
                    .slice(0, 6)
                    .map((x) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={x.key}
                        src={x.url}
                        alt="Gallery"
                        className="h-32 w-full object-cover rounded-xl border border-gray-200 dark:border-gray-800 bg-black/5"
                      />
                    ))}
                </div>
              ) : null}
            </>
          ) : templateKey === "before_after" ? (
            <>
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-3">
                  <div className="text-[11px] font-bold text-gray-700 dark:text-gray-300">BEFORE</div>
                  <div className="mt-2">
                    {photos[0]?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photos[0].url}
                        alt="Before"
                        className="h-56 w-full object-cover rounded-xl border border-gray-200 dark:border-gray-800 bg-black/5"
                      />
                    ) : (
                      <div className="h-56 rounded-xl border border-dashed border-gray-300 dark:border-gray-800 flex items-center justify-center text-sm text-gray-600 dark:text-gray-300">
                        Select a customer photo
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-3">
                  <div className="text-[11px] font-bold text-gray-700 dark:text-gray-300">AFTER</div>
                  <div className="mt-2">
                    {renders[0]?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={safeTrim(renders[0].imageUrl)}
                        alt="After"
                        className="h-56 w-full object-cover rounded-xl border border-gray-200 dark:border-gray-800 bg-black/5"
                      />
                    ) : (
                      <div className="h-56 rounded-xl border border-dashed border-gray-300 dark:border-gray-800 flex items-center justify-center text-sm text-gray-600 dark:text-gray-300">
                        Select a render
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* small strip */}
              {(renders.length + photos.length) > 2 ? (
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                  {[
                    ...photos.slice(1, 5).map((p) => ({ key: p.key, url: safeTrim(p.url) })),
                    ...renders.slice(1, 5).map((r) => ({ key: `r:${r.id}`, url: safeTrim(r.imageUrl) })),
                  ]
                    .filter((x) => x.url)
                    .slice(0, 4)
                    .map((x) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={x.key}
                        src={x.url}
                        alt="More"
                        className="h-24 w-full object-cover rounded-xl border border-gray-200 dark:border-gray-800 bg-black/5"
                      />
                    ))}
                </div>
              ) : null}
            </>
          ) : (
            // standard
            <>
              {heroUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={heroUrl}
                  alt="Featured"
                  className="w-full max-h-[360px] object-cover rounded-2xl border border-gray-200 dark:border-gray-800 bg-black/5"
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-300">
                  Select at least one render or photo to feature here.
                </div>
              )}

              {(renders.length + photos.length) > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {renders.slice(0, 4).map((r) => (
                    <span key={r.id} className="text-[11px] text-gray-600 dark:text-gray-300">
                      • Render #{r.attempt ?? "?"}
                    </span>
                  ))}
                  {photos.slice(0, 4).map((p) => (
                    <span key={p.key} className="text-[11px] text-gray-600 dark:text-gray-300">
                      • Customer photo
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Copy + bullets */}
        <div className="mt-6 space-y-4">
          <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap leading-relaxed">{intro}</div>

          {scopeBullets.length ? (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4 bg-gray-50 dark:bg-black">
              <div className="text-xs font-bold text-gray-900 dark:text-gray-100">Scope highlights</div>
              <ul className="mt-2 list-disc pl-5 space-y-1">
                {scopeBullets.map((b, idx) => (
                  <li key={idx} className="text-sm text-gray-800 dark:text-gray-200">
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap leading-relaxed">{closing}</div>

          <div className="pt-2">
            <Hr />
            <div className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
              {signature}
            </div>
            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              Sent via AI Photo Quote · Reply to this email to reach the shop
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function QuoteEmailComposeClient(props: {
  quoteId: string;
  tenantId: string;
  lead: any;

  versionRows: any[];
  customerPhotos: Photo[];
  renderedRenders: RenderRow[];

  initialTemplateKey: string;
  initialSelectedRenderIds: string[];
  initialSelectedPhotoKeys: string[];
}) {
  const {
    quoteId,
    lead,
    customerPhotos,
    renderedRenders,
    initialTemplateKey,
    initialSelectedRenderIds,
    initialSelectedPhotoKeys,
  } = props;

  const initialTemplate = ((): TemplateKey => {
    const t = safeTrim(initialTemplateKey) as TemplateKey;
    if (t === "standard" || t === "before_after" || t === "visual_first") return t;
    return "standard";
  })();

  const [templateKey] = useState<TemplateKey>(initialTemplate);

  const customerPhotoItems = useMemo(() => {
    return (customerPhotos ?? []).map((p: any, idx: number) => ({
      key: photoKey(p, idx),
      url: photoUrl(p),
      raw: p,
    }));
  }, [customerPhotos]);

  const [selectedRenderIds, setSelectedRenderIds] = useState<string[]>(
    Array.isArray(initialSelectedRenderIds) ? initialSelectedRenderIds : []
  );
  const [selectedPhotoKeys, setSelectedPhotoKeys] = useState<string[]>(
    Array.isArray(initialSelectedPhotoKeys) ? initialSelectedPhotoKeys : []
  );

  const selectedRenders = useMemo(() => {
    const set = new Set(selectedRenderIds.map(String));
    return (renderedRenders ?? []).filter((r) => set.has(String(r.id)));
  }, [renderedRenders, selectedRenderIds]);

  const selectedPhotos = useMemo(() => {
    const set = new Set(selectedPhotoKeys);
    return (customerPhotoItems ?? []).filter((p) => set.has(p.key));
  }, [customerPhotoItems, selectedPhotoKeys]);

  const totalSelectedImages = selectedRenders.length + selectedPhotos.length;

  // Draft fields
  const defaultTo = safeTrim(lead?.email || lead?.customerEmail || lead?.contact?.email || "");
  const defaultName = safeTrim(lead?.name || lead?.customerName || lead?.contact?.name || "");

  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(
    defaultName ? `Your quote is ready — ${defaultName}` : "Your quote is ready"
  );

  const [intro, setIntro] = useState(
    `Hi ${defaultName || "there"},\n\nThanks for sending the photos. Here’s a first look at the scope and next steps.`
  );

  const [scopeBulletsRaw, setScopeBulletsRaw] = useState(
    [
      "Review the visuals and let us know what you like (materials/colors).",
      "If anything changes about the scope, we can update the quote quickly.",
      "Reply to approve and we’ll schedule your job.",
    ].join("\n")
  );

  const [closing, setClosing] = useState(
    `\nIf you have any questions, just hit reply — we’re happy to walk through options.\n\nThanks!`
  );

  const [signature, setSignature] = useState("— The Shop");

  const scopeBullets = useMemo(() => {
    return scopeBulletsRaw
      .split("\n")
      .map((x) => safeTrim(x))
      .filter(Boolean);
  }, [scopeBulletsRaw]);

  const brandName = "Your Shop"; // v1 placeholder; later: tenant branding
  const preheader = `${templateOneLiner(templateKey)} · ${totalSelectedImages} image${totalSelectedImages === 1 ? "" : "s"}`;

  const toOk = safeTrim(to).includes("@");
  const sendDisabled = true; // until wired
  const previewDisabled = false;

  function toggleRender(id: string) {
    setSelectedRenderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function togglePhoto(k: string) {
    setSelectedPhotoKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  const changeSelectionHref = `/admin/quotes/${encodeURIComponent(quoteId)}#renders`;

  return (
    <div className="space-y-6">
      {/* Header actions (stacked, no builder vibe) */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-gray-600 dark:text-gray-300">Compose quote email</div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Template <span className="font-mono">{templateKey}</span> · {totalSelectedImages} selected image
                {totalSelectedImages === 1 ? "" : "s"}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {chip(`Template: ${templateLabel(templateKey)}`)}
              {chip(`Renders: ${selectedRenders.length}`)}
              {chip(`Photos: ${selectedPhotos.length}`)}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={changeSelectionHref}
                className="text-sm font-semibold text-gray-700 hover:underline dark:text-gray-200"
              >
                ← Change layout/images
              </a>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                (takes you back to the quote selection area)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={previewDisabled}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:hover:bg-gray-900"
                title="Preview is already shown below"
              >
                Preview
              </button>
              <button
                type="button"
                disabled={sendDisabled || !toOk}
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
                title="Send wiring comes next"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Quick selection picker (optional, lightweight) */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Selected images</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Click to include/exclude. (Fast tweaks without going back.)
            </p>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Tip: Visual First looks best with at least 1 render selected.
          </div>
        </div>

        {/* Renders */}
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Renders</div>
          {renderedRenders?.length ? (
            <div className="mt-2 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {renderedRenders
                .filter((r) => safeTrim(r.imageUrl))
                .slice(0, 12)
                .map((r) => {
                  const active = selectedRenderIds.includes(String(r.id));
                  const url = safeTrim(r.imageUrl);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleRender(String(r.id))}
                      className={
                        "rounded-2xl border overflow-hidden text-left transition " +
                        (active
                          ? "border-black ring-2 ring-black dark:border-white dark:ring-white"
                          : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700")
                      }
                      title="Toggle render"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="Render" className="h-28 w-full object-cover bg-black/5" />
                      <div className="p-2 flex items-center justify-between">
                        <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-200">
                          Render {r.attempt != null ? `#${Number(r.attempt)}` : ""}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">{active ? "✓" : "+"}</div>
                      </div>
                    </button>
                  );
                })}
            </div>
          ) : (
            <div className="mt-2 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300">
              No rendered images found yet.
            </div>
          )}
        </div>

        {/* Customer photos */}
        <div className="mt-6">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Customer photos</div>
          {customerPhotoItems?.length ? (
            <div className="mt-2 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
              {customerPhotoItems
                .filter((p) => safeTrim(p.url))
                .slice(0, 15)
                .map((p) => {
                  const active = selectedPhotoKeys.includes(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => togglePhoto(p.key)}
                      className={
                        "rounded-2xl border overflow-hidden text-left transition " +
                        (active
                          ? "border-black ring-2 ring-black dark:border-white dark:ring-white"
                          : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700")
                      }
                      title="Toggle photo"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="Customer" className="h-24 w-full object-cover bg-black/5" />
                      <div className="p-2 flex items-center justify-between">
                        <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-200">Photo</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">{active ? "✓" : "+"}</div>
                      </div>
                    </button>
                  );
                })}
            </div>
          ) : (
            <div className="mt-2 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300">
              No customer photos found on this quote.
            </div>
          )}
        </div>
      </section>

      {/* Recipients + subject (stacked) */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recipients</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Keep it simple. (BCC-to-shop checkbox comes next.)
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <MiniLabel label="To" />
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="customer@email.com"
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
            {!toOk ? (
              <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">Enter a valid To address.</div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <MiniLabel label="CC (optional, comma-separated)" />
              <input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="cc@email.com"
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              />
            </div>
            <div>
              <MiniLabel label="BCC (optional, comma-separated)" />
              <input
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                placeholder="shop@email.com"
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              />
            </div>
          </div>

          <div>
            <MiniLabel label="Subject" />
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
          </div>
        </div>
      </section>

      {/* Editor controls (stacked) */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Message editor</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Edit the parts you care about — the preview updates below.
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <MiniLabel label="Intro" />
            <textarea
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              rows={4}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
          </div>

          <div>
            <MiniLabel label="Scope bullets (one per line)" />
            <textarea
              value={scopeBulletsRaw}
              onChange={(e) => setScopeBulletsRaw(e.target.value)}
              rows={4}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black font-mono text-[12px]"
            />
          </div>

          <div>
            <MiniLabel label="Closing" />
            <textarea
              value={closing}
              onChange={(e) => setClosing(e.target.value)}
              rows={4}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
          </div>

          <div>
            <MiniLabel label="Signature" />
            <input
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
            />
          </div>
        </div>
      </section>

      {/* Preview-first (marketing-style sheet) */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Live preview</h2>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              This is what the customer email will look like.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {chip(`To: ${safeTrim(to) || "—"}`)}
            {cc ? chip(`CC: ${splitEmails(cc).length}`) : chip("CC: 0")}
            {bcc ? chip(`BCC: ${splitEmails(bcc).length}`) : chip("BCC: 0")}
          </div>
        </div>

        <EmailSheet
          templateKey={templateKey}
          brandName={brandName}
          preheader={preheader}
          subject={subject}
          intro={intro}
          scopeBullets={scopeBullets}
          closing={closing}
          signature={signature}
          selectedRenders={selectedRenders}
          selectedPhotos={selectedPhotos.map((p) => ({ key: p.key, url: p.url }))}
        />

        <div className="text-[11px] text-gray-500 dark:text-gray-400 font-mono break-all">
          template={templateKey} · quote={quoteId} · renders={selectedRenders.length} · photos={selectedPhotos.length}
        </div>
      </section>
    </div>
  );
}