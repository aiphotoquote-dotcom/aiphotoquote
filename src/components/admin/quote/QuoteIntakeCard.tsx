// src/components/admin/quote/QuoteIntakeCard.tsx
import React from "react";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function pickFirstString(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = safeTrim(obj?.[k]);
    if (v) return v;
  }
  return "";
}

function normalizePhotos(photos: any): Array<{ url: string; label?: string }> {
  const xs = Array.isArray(photos) ? photos : [];
  const out: Array<{ url: string; label?: string }> = [];

  for (const p of xs) {
    const url =
      safeTrim(p?.url) ||
      safeTrim(p?.publicUrl) ||
      safeTrim(p?.blobUrl) ||
      safeTrim(p?.imageUrl) ||
      safeTrim(p);
    if (!url) continue;

    const label = safeTrim(p?.label) || safeTrim(p?.name) || "";
    out.push({ url, label: label || undefined });
  }

  return out;
}

export default function QuoteIntakeCard(props: {
  quoteId: string;

  lead: any;
  notes: any;
  photos: any;

  stageNorm: string;
  setStageAction: any;

  estimateDisplay: string;
  confidence: any;
  inspectionRequired: boolean | null;

  summary: string;
  questions: string[];
  assumptions: string[];
  visibleScope: string[];
}) {
  const leadAny: any = props.lead ?? {};
  const name = pickFirstString(leadAny, ["name", "fullName", "customerName", "contactName", "leadName"]);
  const email = pickFirstString(leadAny, ["email", "customerEmail", "leadEmail"]);
  const phone = pickFirstString(leadAny, ["phone", "phoneNumber", "customerPhone", "leadPhone"]);

  const notes = safeTrim(props.notes) || "—";
  const photos = normalizePhotos(props.photos);

  const estimate = safeTrim(props.estimateDisplay) || "—";
  const confidence = props.confidence == null || props.confidence === "" ? null : String(props.confidence);
  const inspectionRequired = typeof props.inspectionRequired === "boolean" ? props.inspectionRequired : null;

  const summary = safeTrim(props.summary);

  const questions = Array.isArray(props.questions) ? props.questions.map((x) => safeTrim(x)).filter(Boolean) : [];
  const assumptions = Array.isArray(props.assumptions) ? props.assumptions.map((x) => safeTrim(x)).filter(Boolean) : [];
  const visibleScope = Array.isArray(props.visibleScope) ? props.visibleScope.map((x) => safeTrim(x)).filter(Boolean) : [];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950/40">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[260px]">
          <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Customer inputs & assessment</div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            Everything the customer submitted + your AI baseline assessment in one place.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-extrabold text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">
            Estimate: {estimate}
          </span>

          {confidence ? (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-extrabold text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">
              Confidence: {confidence}
            </span>
          ) : null}

          {inspectionRequired != null ? (
            <span
              className={
                "inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold " +
                (inspectionRequired
                  ? "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200"
                  : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200")
              }
            >
              {inspectionRequired ? "Inspection required" : "No inspection"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Lead</div>

          <div className="mt-2 space-y-2 text-sm">
            <div className="font-semibold text-gray-900 dark:text-gray-100">{name || "—"}</div>

            <div className="flex flex-wrap gap-2">
              {phone ? (
                <span className="inline-flex items-center rounded-lg bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-800 dark:bg-gray-900/40 dark:text-gray-200">
                  {phone}
                </span>
              ) : null}

              {email ? (
                <span className="inline-flex items-center rounded-lg bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-800 dark:bg-gray-900/40 dark:text-gray-200">
                  {email}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Stage</div>
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Stage is separate from read/unread.</div>

          <form action={props.setStageAction} className="mt-3 flex items-center gap-2">
            <input type="hidden" name="quoteId" value={safeTrim(props.quoteId)} />
            <select
              name="stage"
              defaultValue={safeTrim(props.stageNorm) || "new"}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-950/20 dark:text-gray-100"
            >
              <option value="new">New</option>
              <option value="estimate">Estimate</option>
              <option value="quoted">Quoted</option>
              <option value="contacted">Contacted</option>
              <option value="scheduled">Scheduled</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="archived">Archived</option>
            </select>

            <button
              type="submit"
              className="h-10 rounded-lg bg-black px-4 text-sm font-extrabold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Save
            </button>
          </form>

          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Stage: <span className="font-mono">{safeTrim(props.stageNorm) || "new"}</span>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Customer notes
          </div>
          <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-900 dark:border-gray-900/50 dark:bg-gray-950/30 dark:text-gray-100">
            {notes}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Photos</div>
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">{photos.length} total</div>
        </div>

        {photos.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((p, idx) => (
              <a
                key={`${p.url}-${idx}`}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950/10"
                title={p.label || "Open image"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={p.label || `Photo ${idx + 1}`}
                  className="h-44 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                />
                {p.label ? (
                  <div className="truncate border-t border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:text-gray-300">
                    {p.label}
                  </div>
                ) : null}
              </a>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-gray-200 p-4 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-400">
            No photos submitted.
          </div>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
        <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">AI assessment</div>

        {summary ? (
          <div className="mt-2 text-sm text-gray-900 dark:text-gray-100">{summary}</div>
        ) : (
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">No summary provided.</div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Questions</div>
            {questions.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-900 dark:text-gray-100">
                {questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">None</div>
            )}
          </div>

          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Assumptions</div>
            {assumptions.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-900 dark:text-gray-100">
                {assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">None</div>
            )}
          </div>

          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Visible scope</div>
            {visibleScope.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-900 dark:text-gray-100">
                {visibleScope.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">None</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}