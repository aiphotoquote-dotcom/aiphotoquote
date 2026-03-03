// src/components/admin/quote/QuoteIntakeCard.tsx
import React from "react";
import QuotePhotoGallery from "@/components/admin/QuotePhotoGallery";

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

function digitsOnlyPhone(raw: string) {
  const s = safeTrim(raw);
  if (!s) return "";
  // Keep + if present; otherwise just digits
  const plus = s.trim().startsWith("+") ? "+" : "";
  const digits = s.replace(/[^\d]/g, "");
  return digits ? `${plus}${digits}` : "";
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

  const phoneDial = digitsOnlyPhone(phone);
  const emailHref = email ? `mailto:${encodeURIComponent(email)}` : "";

  const notesRaw = safeTrim(props.notes);
  const notes = notesRaw || "—";

  const estimate = safeTrim(props.estimateDisplay) || "—";
  const confidence = props.confidence == null || props.confidence === "" ? null : String(props.confidence);
  const inspectionRequired = typeof props.inspectionRequired === "boolean" ? props.inspectionRequired : null;

  const summary = safeTrim(props.summary);

  const questions = Array.isArray(props.questions) ? props.questions.map((x) => safeTrim(x)).filter(Boolean) : [];
  const assumptions = Array.isArray(props.assumptions) ? props.assumptions.map((x) => safeTrim(x)).filter(Boolean) : [];
  const visibleScope = Array.isArray(props.visibleScope) ? props.visibleScope.map((x) => safeTrim(x)).filter(Boolean) : [];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950/40">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[260px]">
          <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Customer inputs & assessment</div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            Customer info, notes, photos, and the baseline AI assessment.
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

      {/* Lead + compact Stage */}
      <div className="mt-5 grid gap-4 lg:grid-cols-12">
        {/* Lead (big / primary) */}
        <div className="lg:col-span-8 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Lead</div>
              <div className="mt-2 text-lg font-extrabold text-gray-900 dark:text-gray-100">{name || "—"}</div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Tap to call/email</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {phoneDial ? (
                <a
                  href={`tel:${phoneDial}`}
                  className="inline-flex items-center rounded-lg bg-black px-3 py-2 text-xs font-extrabold text-white hover:opacity-90 dark:bg-white dark:text-black"
                >
                  Call {phone}
                </a>
              ) : phone ? (
                <span className="inline-flex items-center rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-800 dark:bg-gray-900/40 dark:text-gray-200">
                  {phone}
                </span>
              ) : null}

              {email ? (
                <a
                  href={emailHref}
                  className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950/20 dark:text-gray-100 dark:hover:bg-gray-900/30"
                >
                  Email {email}
                </a>
              ) : null}
            </div>
          </div>
        </div>

        {/* Stage (small / compact) */}
        <div className="lg:col-span-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Stage</div>
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Quick update (doesn’t affect read/unread).</div>

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
              className="h-10 shrink-0 rounded-lg bg-black px-4 text-sm font-extrabold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Save
            </button>
          </form>

          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Current: <span className="font-mono">{safeTrim(props.stageNorm) || "new"}</span>
          </div>
        </div>

        {/* Customer notes (bigger / full width) */}
        <div className="lg:col-span-12 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Customer notes</div>
          <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-900 dark:border-gray-900/50 dark:bg-gray-950/30 dark:text-gray-100 whitespace-pre-wrap">
            {notes}
          </div>
        </div>
      </div>

      {/* Photos */}
      <div className="mt-5">
        <div className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Photos</div>
        <div className="mt-3">
          <QuotePhotoGallery photos={props.photos} />
        </div>
      </div>

      {/* AI assessment */}
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