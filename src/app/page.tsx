// src/app/page.tsx
import React from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import MarketingTopNav from "@/components/marketing/MarketingTopNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function Icon({
  name,
  className,
}: {
  name:
    | "spark"
    | "camera"
    | "bolt"
    | "mail"
    | "wand"
    | "check"
    | "arrow"
    | "shield"
    | "wrench"
    | "clock";
  className?: string;
}) {
  const common = { className: cx("h-5 w-5", className) };
  switch (name) {
    case "spark":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
          <path
            d="M12 2l1.4 5.1L18.5 9l-5.1 1.4L12 15.5l-1.4-5.1L5.5 9l5.1-1.9L12 2z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M19.2 12.3l.9 3.2 3 .8-3 1.2-.9 3.3-.9-3.3-3-1.2 3-.8.9-3.2z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "camera":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
          <path
            d="M7 7l1.5-2h7L17 7h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2h2z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M12 18a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "bolt":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
          <path
            d="M13 2L3 14h8l-1 8 11-14h-8l0-6z"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "mail":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
          <path
            d="M4 6h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M22 8l-10 7L2 8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case "wand":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
          <path d="M4 20l10.5-10.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path
            d="M14.5 9.5L19 5a2 2 0 012.8 2.8l-4.5 4.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M13 3l.7 2.2L16 6l-2.3.8L13 9l-.7-2.2L10 6l2.3-.8L13 3z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "check":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
          <path
            d="M20 6L9 17l-5-5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "arrow":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
          <path d="M5 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path
            d="M13 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
          <path
            d="M12 2l8 4v6c0 5-3.4 9.4-8 10-4.6-.6-8-5-8-10V6l8-4z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M9 12l2 2 4-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "wrench":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
          <path
            d="M21 7.5a5 5 0 01-6.8 4.7L8 18.4a2 2 0 01-2.8 0l-.6-.6a2 2 0 010-2.8l6.2-6.2A5 5 0 0116.5 3l-2.2 2.2 2.5 2.5L21 7.5z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "clock":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
          <path
            d="M12 22a10 10 0 100-20 10 10 0 000 20z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M12 6v6l4 2"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight text-gray-900">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{hint}</div>
    </div>
  );
}

function SteelCard({
  title,
  desc,
  icon,
  tone = "slate",
  bullets,
  cta,
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  tone?: "slate" | "graphite" | "olive" | "blue";
  bullets?: string[];
  cta?: { label: string; href: string };
}) {
  // “Masculine service” palette: slate/graphite/olive, *one* controlled blue.
  const toneMap: Record<
    string,
    { top: string; iconWrap: string; ring: string; bg: string }
  > = {
    slate: {
      top: "from-slate-700 to-slate-900",
      iconWrap: "border-slate-200 bg-slate-50 text-slate-900",
      ring: "ring-slate-200",
      bg: "bg-gradient-to-b from-slate-50/70 to-white",
    },
    graphite: {
      top: "from-zinc-700 to-zinc-900",
      iconWrap: "border-zinc-200 bg-zinc-50 text-zinc-900",
      ring: "ring-zinc-200",
      bg: "bg-gradient-to-b from-zinc-50/70 to-white",
    },
    olive: {
      top: "from-emerald-700 to-lime-800",
      iconWrap: "border-emerald-200 bg-emerald-50 text-emerald-900",
      ring: "ring-emerald-200",
      bg: "bg-gradient-to-b from-emerald-50/60 to-white",
    },
    blue: {
      top: "from-sky-700 to-indigo-900",
      iconWrap: "border-sky-200 bg-sky-50 text-sky-900",
      ring: "ring-sky-200",
      bg: "bg-gradient-to-b from-sky-50/60 to-white",
    },
  };

  const t = toneMap[tone] ?? toneMap.slate;

  return (
    <div
      className={cx(
        "group relative rounded-3xl border border-gray-200 p-6 shadow-sm transition",
        "hover:-translate-y-0.5 hover:shadow-md",
        "ring-1 ring-black/5",
        t.bg
      )}
    >
      <div className={cx("absolute inset-x-0 top-0 h-1.5 rounded-t-3xl bg-gradient-to-r", t.top)} />
      <div className="flex items-center gap-3">
        <div className={cx("inline-flex h-10 w-10 items-center justify-center rounded-2xl border", t.iconWrap)}>
          {icon}
        </div>
        <div className="text-sm font-extrabold text-gray-900">{title}</div>
      </div>

      <div className="mt-3 text-sm text-gray-700">{desc}</div>

      {bullets?.length ? (
        <ul className="mt-4 space-y-2 text-sm text-gray-700">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <Icon name="check" className="mt-0.5 h-4 w-4 text-gray-900" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {cta ? (
        <div className="mt-5">
          <a
            href={cta.href}
            className="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-5 py-2.5 text-sm font-extrabold text-white hover:opacity-90"
          >
            {cta.label} <Icon name="arrow" className="h-4 w-4" />
          </a>
        </div>
      ) : null}

      <div
        className={cx(
          "pointer-events-none absolute inset-0 rounded-3xl ring-2 opacity-0 transition group-hover:opacity-100",
          t.ring
        )}
      />
    </div>
  );
}

function MiniPanel({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="text-sm font-extrabold text-gray-900">{title}</div>
      <div className="mt-4 space-y-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-3">
            <div className="text-sm font-semibold text-gray-600">{k}</div>
            <div className="text-sm font-extrabold text-gray-900">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/admin");

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <MarketingTopNav />

      {/* HERO — “steel / professional / service-owner” */}
      <section className="relative overflow-hidden">
        {/* subtle industrial background: neutral, not rainbow */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(15,23,42,0.06),transparent_55%)]" />
          <div className="absolute inset-0 opacity-[0.25] [background-image:linear-gradient(to_right,rgba(2,6,23,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(2,6,23,0.06)_1px,transparent_1px)] [background-size:56px_56px]" />
          <div className="absolute inset-0 bg-gradient-to-b from-white via-white to-gray-50" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-16">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-extrabold text-gray-800 shadow-sm">
                <span className="inline-flex h-2 w-2 rounded-full bg-gray-900" />
                AI-Powered Estimating for Service Businesses
              </div>

              <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-6xl">
                Turn photos into{" "}
                <span className="text-gray-900 underline decoration-gray-300 decoration-4 underline-offset-8">
                  quote-ready
                </span>{" "}
                estimates.
              </h1>

              <p className="mt-5 max-w-xl text-lg text-gray-700">
                Capture leads, generate a structured scope summary, and deliver faster estimates — without living
                in your inbox. Optional “after” concept renders help you sell the job.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <a
                  href="/sign-up"
                  className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-6 py-3 text-sm font-extrabold text-white shadow-sm hover:opacity-90"
                >
                  Create account
                </a>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50"
                >
                  See how it works
                </a>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <Kpi label="Speed" value="Seconds" hint="Quote-ready draft output" />
                <Kpi label="Clarity" value="Structured" hint="Scope + assumptions + questions" />
                <Kpi label="Control" value="You decide" hint="Final price stays yours" />
              </div>

              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-600">
                {[
                  "Upholstery • Marine • Roofing • Paving • Remodeling",
                  "Branded lead + customer receipt emails",
                  "Optional AI “after” render toggle",
                ].map((x) => (
                  <div key={x} className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                    {x}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: “operator dashboard” preview (clean, monochrome) */}
            <div className="relative">
              <div className="rounded-[34px] border border-gray-200 bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                  <div className="text-sm font-extrabold text-gray-900">Job Intake → Estimate Draft</div>
                  <div className="text-xs font-semibold text-gray-500">Example</div>
                </div>

                <div className="p-6 space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <MiniPanel
                      title="Customer intake"
                      rows={[
                        ["Photos", "6 uploaded"],
                        ["Job type", "Service request"],
                        ["Urgency", "Normal"],
                        ["Location", "Provided"],
                      ]}
                    />

                    <MiniPanel
                      title="AI draft output"
                      rows={[
                        ["Confidence", "High"],
                        ["Inspection", "Not required"],
                        ["Estimate range", "$1,250–$1,950"],
                        ["Follow-ups", "3 questions"],
                      ]}
                    />
                  </div>

                  <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-extrabold text-gray-900">Scope summary</div>
                      <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-extrabold text-gray-700">
                        Structured
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
                      {["Visible scope captured", "Assumptions listed", "Risks noted", "Next questions generated"].map(
                        (x) => (
                          <div key={x} className="flex items-start gap-2">
                            <Icon name="check" className="mt-0.5 h-4 w-4 text-gray-900" />
                            <span>{x}</span>
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      ["Owner alert", "Email + dashboard lead card."],
                      ["Customer receipt", "Branded confirmation."],
                      ["Pipeline", "Stage + notes + follow-ups."],
                    ].map(([t, d]) => (
                      <div key={t} className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="text-sm font-extrabold text-gray-900">{t}</div>
                        <div className="mt-1 text-sm text-gray-600">{d}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pointer-events-none absolute -bottom-6 left-6 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-extrabold text-gray-900 shadow-lg">
                Built for fast quoting.
              </div>
            </div>
          </div>

          <div className="h-10 sm:h-14" />
        </div>
      </section>

      {/* TRUST / OUTCOMES */}
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <SteelCard
            tone="graphite"
            icon={<Icon name="clock" className="h-5 w-5" />}
            title="Stop quoting after hours"
            desc="AI produces a quote-ready draft so you can focus on paid work — then send fast when you’re ready."
          />
          <SteelCard
            tone="slate"
            icon={<Icon name="wrench" className="h-5 w-5" />}
            title="Reduce wasted trips"
            desc="Confidence + inspection flags help you decide what you can quote remotely vs. what needs a visit."
          />
          <SteelCard
            tone="olive"
            icon={<Icon name="shield" className="h-5 w-5" />}
            title="Look professional"
            desc="Branded receipts, structured scope, and consistent messaging builds trust with customers."
          />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">How it works</h2>
            <p className="mt-2 max-w-2xl text-gray-600">Straightforward. Repeatable. Built for daily use.</p>
          </div>
          <a
            href="/sign-up"
            className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-5 py-2.5 text-sm font-extrabold text-white hover:opacity-90"
          >
            Create account
          </a>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-4">
          <SteelCard
            tone="blue"
            icon={<Icon name="camera" className="h-5 w-5" />}
            title="1) Capture"
            desc="Customer uploads photos + quick details."
          />
          <SteelCard
            tone="graphite"
            icon={<Icon name="bolt" className="h-5 w-5" />}
            title="2) Analyze"
            desc="AI generates scope, range, and follow-up questions."
          />
          <SteelCard
            tone="slate"
            icon={<Icon name="check" className="h-5 w-5" />}
            title="3) Review"
            desc="You approve and progress the lead in your dashboard."
          />
          <SteelCard
            tone="olive"
            icon={<Icon name="mail" className="h-5 w-5" />}
            title="4) Send"
            desc="Branded receipt + optional “after” concept render."
          />
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Features that matter</h2>
            <p className="mt-2 max-w-2xl text-gray-600">
              No fluff — just the workflow pieces that make quoting faster and cleaner.
            </p>
          </div>
          <a href="/#pricing" className="text-sm font-extrabold text-gray-900 hover:underline">
            See pricing
          </a>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <SteelCard
            tone="graphite"
            icon={<Icon name="bolt" className="h-5 w-5" />}
            title="AI estimate drafts"
            desc="Scope + range + questions generated consistently."
            bullets={["Structured scope summary", "Assumptions captured", "Confidence + inspection flag"]}
          />
          <SteelCard
            tone="slate"
            icon={<Icon name="camera" className="h-5 w-5" />}
            title="Photo-first intake"
            desc="Optimized for real customer photos."
            bullets={["Mobile-friendly upload", "Guided questions", "Cleaner lead records"]}
          />
          <SteelCard
            tone="blue"
            icon={<Icon name="mail" className="h-5 w-5" />}
            title="Automatic emails"
            desc="Instant receipts keep you top-of-mind."
            bullets={["Owner lead alert", "Customer receipt", "Brand-consistent messaging"]}
          />

          <SteelCard
            tone="olive"
            icon={<Icon name="check" className="h-5 w-5" />}
            title="Admin pipeline"
            desc="Track every lead from new → closed."
            bullets={["Stages + read/unread", "Notes + follow-ups", "Simple daily workflow"]}
          />
          <SteelCard
            tone="graphite"
            icon={<Icon name="shield" className="h-5 w-5" />}
            title="Business controls"
            desc="You decide how AI behaves."
            bullets={["Per-tenant settings", "Optional render toggle", "Routing + categories"]}
          />
          <SteelCard
            tone="slate"
            icon={<Icon name="wand" className="h-5 w-5" />}
            title="Optional “after” render"
            desc="Sell the vision on higher-value jobs."
            bullets={["Concept visualization", "Customer-friendly", "Can be turned off"]}
          />
        </div>

        <div className="mt-6 rounded-[34px] border border-gray-200 bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-sm font-extrabold text-gray-900">Works across industries</div>
              <div className="mt-1 text-sm text-gray-600">
                If your customers can snap a picture of the job, you can quote it faster with AI.
              </div>
            </div>
            <a href="/sign-up" className="text-sm font-extrabold text-gray-900 hover:underline">
              Create account
            </a>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {[
              "Marine & Auto Upholstery",
              "Roofing",
              "Paving & Concrete",
              "Remodeling",
              "Landscaping",
              "Specialty Trades",
            ].map((x) => (
              <span
                key={x}
                className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700"
              >
                {x}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING — restrained, not “candy” */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-3xl font-extrabold tracking-tight">Pricing</h2>
        <p className="mt-2 max-w-2xl text-gray-600">
          Placeholder tiers for now — we’ll wire these to your real SaaS billing when ready.
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <SteelCard
            tone="slate"
            icon={<Icon name="check" className="h-5 w-5" />}
            title="Starter"
            desc="$0 — Try it and prove the workflow."
            bullets={["AI estimate drafts", "Lead capture", "Basic pipeline", "Email receipts"]}
            cta={{ label: "Start free", href: "/sign-up" }}
          />
          <SteelCard
            tone="blue"
            icon={<Icon name="bolt" className="h-5 w-5" />}
            title="Pro"
            desc="$29 — Best for most shops."
            bullets={["Everything in Starter", "More settings & control", "Smarter follow-ups", "Cleaner workflow"]}
            cta={{ label: "Choose Pro", href: "/sign-up" }}
          />
          <SteelCard
            tone="graphite"
            icon={<Icon name="shield" className="h-5 w-5" />}
            title="Scale"
            desc="$79 — Higher volume & teams."
            bullets={["Everything in Pro", "Optional render feature", "More customization", "Team workflows"]}
            cta={{ label: "Choose Scale", href: "/sign-up" }}
          />
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="rounded-[34px] border border-gray-200 bg-gray-50 p-8 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-2xl font-extrabold tracking-tight text-gray-900">
                Start quoting faster this week.
              </div>
              <div className="mt-1 text-sm text-gray-600">
                Create an account, customize your settings, and publish your intake link.
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href="/sign-up"
                className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-6 py-3 text-sm font-extrabold text-white hover:opacity-90"
              >
                Create account
              </a>
              <a
                href="/sign-in"
                className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50"
              >
                Sign in
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 border-t border-gray-200 pt-8 sm:flex-row sm:items-center">
          <div>
            <div className="text-sm font-extrabold tracking-tight text-gray-900">AI Photo Quote</div>
            <div className="mt-1 text-sm text-gray-600">
              AI-powered estimating that helps service businesses respond faster and win more.
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            {[
              ["How it works", "#how-it-works"],
              ["Features", "#features"],
              ["Pricing", "#pricing"],
            ].map(([t, href]) => (
              <a key={t} href={href} className="rounded-xl px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50">
                {t}
              </a>
            ))}
            <a
              href="/sign-in"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 font-extrabold text-gray-900 hover:bg-gray-50"
            >
              Sign in
            </a>
            <a
              href="/sign-up"
              className="rounded-xl bg-gray-900 px-3 py-2 font-extrabold text-white hover:opacity-90"
            >
              Create account
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}