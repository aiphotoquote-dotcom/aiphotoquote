// src/components/admin/quote/DetailsPanel.tsx
import React from "react";
import { chip } from "@/components/admin/quote/ui";
import { fmtNum } from "@/lib/admin/quotes/utils";

export default function DetailsPanel(props: {
  renderOptIn: boolean;

  estimateDisplay: { text: string | null; tone: "green" | "gray"; label: string };
  confidence: any;
  inspectionRequired: boolean | null;

  summary: string;
  questions: string[];
  assumptions: string[];
  visibleScope: string[];

  pricingBasis: any;
  pricingPolicySnap: any;
  pricingConfigSnap: any;
  pricingRulesSnap: any;

  industryKeySnap: string | null;
  llmKeySource: string | null;

  rawOutput: any;
}) {
  const {
    renderOptIn,
    estimateDisplay,
    confidence,
    inspectionRequired,
    summary,
    questions,
    assumptions,
    visibleScope,
    pricingBasis,
    pricingPolicySnap,
    pricingConfigSnap,
    pricingRulesSnap,
    industryKeySnap,
    llmKeySource,
    rawOutput,
  } = props;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Details</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">AI describes scope. Server computes dollars (deterministic).</p>
        </div>
        {renderOptIn ? chip("Customer opted into render", "blue") : chip("No render opt-in", "gray")}
      </div>

      <div className="mt-5 grid gap-4">
        {/* AI Assessment + Pricing */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold">AI assessment</div>
            <div className="flex flex-wrap items-center gap-2">
              {estimateDisplay.text ? chip(estimateDisplay.text, estimateDisplay.tone) : null}
              {chip(estimateDisplay.label, estimateDisplay.label === "Assessment only" ? "gray" : "blue")}
              {confidence ? chip(`Confidence: ${String(confidence)}`, "gray") : null}
              {inspectionRequired === true ? chip("Inspection required", "yellow") : null}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">Pricing engine</div>
              <div className="flex flex-wrap gap-2 items-center">
                {pricingBasis?.method ? chip(`Method: ${String(pricingBasis.method)}`, "blue") : chip("Method: —", "gray")}
                {pricingBasis?.model ? chip(`Model: ${String(pricingBasis.model)}`, "gray") : null}
                {pricingPolicySnap?.ai_mode ? chip(`AI mode: ${String(pricingPolicySnap.ai_mode)}`, "gray") : null}
                {typeof pricingPolicySnap?.pricing_enabled === "boolean"
                  ? chip(
                      `Pricing enabled: ${pricingPolicySnap.pricing_enabled ? "true" : "false"}`,
                      pricingPolicySnap.pricing_enabled ? "green" : "yellow"
                    )
                  : null}
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-black">
                <div className="font-semibold text-gray-700 dark:text-gray-200">Frozen context</div>
                <div className="mt-2 space-y-1 text-gray-700 dark:text-gray-300">
                  <div>
                    <span className="font-semibold">industryKey:</span> {industryKeySnap ?? "—"}
                  </div>
                  <div>
                    <span className="font-semibold">llmKeySource:</span> {llmKeySource ?? "—"}
                  </div>
                  <div>
                    <span className="font-semibold">pricing_model (policy):</span> {pricingPolicySnap?.pricing_model ?? "—"}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-black">
                <div className="font-semibold text-gray-700 dark:text-gray-200">Computed basis</div>
                <div className="mt-2 space-y-1 text-gray-700 dark:text-gray-300">
                  <div>
                    <span className="font-semibold">confW:</span> {pricingBasis?.confW ?? "—"}
                  </div>
                  <div>
                    <span className="font-semibold">complexity:</span> {pricingBasis?.complexity ?? "—"}
                  </div>
                  <div>
                    <span className="font-semibold">minJobApplied:</span> {pricingBasis?.minJobApplied ?? "—"}
                  </div>
                  <div>
                    <span className="font-semibold">maxWithoutInspectionApplied:</span> {pricingBasis?.maxWithoutInspectionApplied ?? "—"}
                  </div>
                  <div>
                    <span className="font-semibold">forcedInspection:</span> {pricingBasis?.forcedInspection ? "true" : "false"}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-black">
                <div className="font-semibold text-gray-700 dark:text-gray-200">Model math</div>
                <div className="mt-2 space-y-1 text-gray-700 dark:text-gray-300">
                  {pricingBasis?.hours ? (
                    <div>
                      <span className="font-semibold">hours:</span> {fmtNum(pricingBasis.hours?.low)} – {fmtNum(pricingBasis.hours?.high)}
                    </div>
                  ) : null}
                  {pricingBasis?.units ? (
                    <div>
                      <span className="font-semibold">units:</span> {fmtNum(pricingBasis.units?.low)} – {fmtNum(pricingBasis.units?.high)}
                    </div>
                  ) : null}
                  {pricingBasis?.hourly ? (
                    <div>
                      <span className="font-semibold">hourly:</span> {fmtNum(pricingBasis.hourly)}
                    </div>
                  ) : null}
                  {pricingBasis?.perUnitRate ? (
                    <div>
                      <span className="font-semibold">perUnitRate:</span> {fmtNum(pricingBasis.perUnitRate)}{" "}
                      {pricingBasis?.perUnitLabel ? `/${String(pricingBasis.perUnitLabel)}` : ""}
                    </div>
                  ) : null}
                  {pricingBasis?.base != null ? (
                    <div>
                      <span className="font-semibold">base:</span> {fmtNum(pricingBasis.base)}
                    </div>
                  ) : null}
                  {pricingBasis?.spread != null ? (
                    <div>
                      <span className="font-semibold">spread:</span> {fmtNum(pricingBasis.spread)}
                    </div>
                  ) : null}
                  {pricingBasis?.fee != null ? (
                    <div>
                      <span className="font-semibold">fee:</span> {fmtNum(pricingBasis.fee)}
                    </div>
                  ) : null}
                  {!pricingBasis ? <div className="italic text-gray-500">No pricing_basis found (older quote).</div> : null}
                </div>
              </div>
            </div>

            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">
                Frozen pricing snapshots (policy / config / rules)
              </summary>
              <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-black p-4 text-xs text-white dark:border-gray-800">
{JSON.stringify(
  {
    pricing_policy_snapshot: pricingPolicySnap ?? null,
    pricing_config_snapshot: pricingConfigSnap ?? null,
    pricing_rules_snapshot: pricingRulesSnap ?? null,
  },
  null,
  2
)}
              </pre>
            </details>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <div className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">SUMMARY</div>
              <div className="mt-2 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                {summary ? summary : <span className="italic text-gray-500">No summary found.</span>}
              </div>
            </div>

            <div className="grid gap-3">
              {questions.length ? (
                <div>
                  <div className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">QUESTIONS</div>
                  <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200 space-y-1">
                    {questions.slice(0, 8).map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {visibleScope.length ? (
                <div>
                  <div className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">VISIBLE SCOPE</div>
                  <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200 space-y-1">
                    {visibleScope.slice(0, 8).map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {assumptions.length ? (
                <div>
                  <div className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">ASSUMPTIONS</div>
                  <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200 space-y-1">
                    {assumptions.slice(0, 8).map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!rawOutput ? (
                <div className="text-sm text-gray-600 dark:text-gray-300 italic">No AI output found yet (quoteLogs.output is empty).</div>
              ) : null}
            </div>
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-300">Raw AI JSON (debug)</summary>
            <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-black p-4 text-xs text-white dark:border-gray-800">
{JSON.stringify(rawOutput ?? {}, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </section>
  );
}