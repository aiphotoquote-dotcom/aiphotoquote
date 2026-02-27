// src/components/admin/quote/LeadCard.tsx
import React from "react";
import { chip } from "@/components/admin/quote/ui";
import { digitsOnly } from "@/lib/admin/quotes/utils";
import { STAGES } from "@/lib/admin/quotes/normalize";

export default function LeadCard(props: {
  lead: { name: string; phone: string | null; phoneDigits: string | null; email: string | null };
  stageNorm: string;
  setStageAction: any;
}) {
  const { lead, stageNorm, setStageAction } = props;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{lead.name}</h2>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
            {lead.phone ? (
              <a
                href={`tel:${lead.phoneDigits ?? digitsOnly(lead.phone)}`}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm hover:bg-white dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
              >
                {lead.phone}
              </a>
            ) : (
              <span className="italic text-gray-500">No phone</span>
            )}

            {lead.email ? (
              <a
                href={`mailto:${lead.email}`}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm hover:bg-white dark:border-gray-800 dark:bg-black dark:hover:bg-gray-900"
              >
                {lead.email}
              </a>
            ) : null}
          </div>
        </div>

        <div className="w-full lg:w-[340px]">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
            <div className="text-sm font-semibold">Stage</div>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">Stage is separate from read/unread.</p>

            <form action={setStageAction} className="mt-4 flex items-center gap-2">
              <select
                name="stage"
                defaultValue={stageNorm === "read" ? "new" : (stageNorm as any)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-black"
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Save
              </button>
            </form>

            {stageNorm === "read" ? (
              <div className="mt-3 text-xs text-yellow-900 dark:text-yellow-200">
                Note: legacy stage value <span className="font-mono">read</span>. Saving will normalize it.
              </div>
            ) : null}

            <div className="mt-4">{chip(`Stage: ${stageNorm}`, "gray")}</div>
          </div>
        </div>
      </div>
    </section>
  );
}