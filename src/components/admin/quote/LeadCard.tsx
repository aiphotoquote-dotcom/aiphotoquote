// src/components/admin/quote/LeadCard.tsx
"use client";

import React, { useMemo, useState } from "react";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

function normalizePhone(raw: string) {
  const s = safeTrim(raw);
  if (!s) return "";
  // keep digits + leading +
  const digits = s.replace(/[^\d+]/g, "");
  return digits;
}

function PhoneIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={props.className ?? "h-4 w-4"}
    >
      <path
        d="M7.5 3.75h.76c.62 0 1.16.42 1.31 1.02l.7 2.8c.12.49-.06 1-.46 1.3l-1.14.86a12.2 12.2 0 0 0 5.52 5.52l.86-1.14c.3-.4.81-.58 1.3-.46l2.8.7c.6.15 1.02.69 1.02 1.31v.76c0 1.1-.9 2-2 2h-.5C9.3 20.27 3.73 14.7 3.73 7.5v-.5c0-1.1.9-2 2-2h1.77Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MailIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={props.className ?? "h-4 w-4"}
    >
      <path
        d="M4.5 7.5A2.25 2.25 0 0 1 6.75 5.25h10.5A2.25 2.25 0 0 1 19.5 7.5v9A2.25 2.25 0 0 1 17.25 18.75H6.75A2.25 2.25 0 0 1 4.5 16.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M6.75 7.5 12 11.25 17.25 7.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LeadCard(props: {
  quoteId: string;
  lead: any;
  stageNorm: string;
  setStageAction: any;
}) {
  const quoteId = safeTrim(props.quoteId);
  const lead: any = props.lead ?? {};

  const name =
    safeTrim(lead?.name) ||
    safeTrim(lead?.fullName) ||
    safeTrim(lead?.customerName) ||
    safeTrim(lead?.contactName) ||
    "Lead";

  const phoneRaw = safeTrim(lead?.phone ?? lead?.phoneNumber ?? lead?.mobile ?? "");
  const phoneDigits = normalizePhone(phoneRaw);

  const email = safeTrim(lead?.email ?? lead?.emailAddress ?? "");

  // stage UI (keep compact)
  const initialStage = safeTrim(props.stageNorm) || "new";
  const [stage, setStage] = useState<string>(initialStage);

  const telHref = phoneDigits ? `tel:${phoneDigits}` : "";
  const mailHref = email ? `mailto:${encodeURIComponent(email)}` : "";

  const contactPills = useMemo(() => {
    const xs: Array<{ label: string; href?: string; icon: React.ReactNode }> = [];
    if (phoneRaw) xs.push({ label: phoneRaw, href: telHref || undefined, icon: <PhoneIcon /> });
    if (email) xs.push({ label: email, href: mailHref || undefined, icon: <MailIcon /> });
    return xs;
  }, [phoneRaw, email, telHref, mailHref]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-extrabold tracking-wide text-gray-500 dark:text-gray-400">
            LEAD
          </div>

          {/* ✅ “Lead pops” block */}
          <div className="mt-2 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/30">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-extrabold text-gray-900 dark:text-gray-100">
                  {name}
                </div>

                {/* ✅ Subtle icon row, big tap targets */}
                {contactPills.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {contactPills.map((c) =>
                      c.href ? (
                        <a
                          key={c.label}
                          href={c.href}
                          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 active:scale-[0.99] dark:border-gray-800 dark:bg-gray-950/20 dark:text-gray-100 dark:hover:bg-gray-900/30"
                        >
                          <span className="text-gray-600 dark:text-gray-300">{c.icon}</span>
                          <span className="truncate max-w-[240px] sm:max-w-[320px]">{c.label}</span>
                        </a>
                      ) : (
                        <span
                          key={c.label}
                          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950/20 dark:text-gray-200"
                        >
                          <span className="text-gray-600 dark:text-gray-300">{c.icon}</span>
                          <span className="truncate max-w-[240px] sm:max-w-[320px]">{c.label}</span>
                        </span>
                      )
                    )}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    No contact details provided.
                  </div>
                )}
              </div>

              {/* ✅ Stage: smaller footprint */}
              <div className="w-full sm:w-[260px]">
                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950/20">
                  <div className="text-[11px] font-extrabold tracking-wide text-gray-500 dark:text-gray-400">
                    STAGE
                  </div>

                  <form action={props.setStageAction} className="mt-2 flex items-center gap-2">
                    <input type="hidden" name="quoteId" value={quoteId} />

                    <select
                      name="stage"
                      value={stage}
                      onChange={(e) => setStage(e.target.value)}
                      className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-black/10 dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-100 dark:focus:ring-white/10"
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

                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-semibold">Stage:</span>{" "}
                    <span className="font-mono">{safeTrim(stage) || "—"}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* right side intentionally unused now to keep lead primary */}
      </div>
    </div>
  );
}