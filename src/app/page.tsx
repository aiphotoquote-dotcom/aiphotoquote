// src/app/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import MarketingTopNav from "@/components/marketing/MarketingTopNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SparkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 2l1.2 4.3L17.5 8 13.2 9.2 12 13.5 10.8 9.2 6.5 8l4.3-1.7L12 2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M19 12l.9 3.2L23 16l-3.1 1.2L19 20.5l-1-3.3L14.9 16 18 15.2 19 12z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M5 12l.8 2.8L8.5 16l-2.7 1.1L5 20l-.8-2.9L1.5 16l2.7-1.2L5 12z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default async function HomePage() {
  const { userId } = await auth();

  // Signed-in users go straight to the centerpiece
  if (userId) redirect("/admin");

  // Signed-out users see marketing
  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <MarketingTopNav />

      <main>
        {/* HERO */}
        <section className="relative overflow-hidden">
          {/* soft background */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-40 left-1/2 h-[520px] w-[920px] -translate-x-1/2 rounded-full bg-gradient-to-r from-indigo-200 via-sky-200 to-emerald-200 blur-3xl opacity-60 dark:from-indigo-950 dark:via-sky-950 dark:to-emerald-950 dark:opacity-70" />
            <div className="absolute -bottom-48 left-1/3 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-gradient-to-r from-fuchsia-200 via-amber-200 to-lime-200 blur-3xl opacity-40 dark:from-fuchsia-950 dark:via-amber-950 dark:to-lime-950 dark:opacity-40" />
          </div>

          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-18">
            <div className="grid items-center gap-10 lg:grid-cols-2">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/70 px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-black/40 dark:text-gray-200">
                  <SparkIcon className="h-4 w-4" />
                  AI-Powered photo estimating for service businesses
                </div>

                <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl">
                  Turn customer photos into{" "}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-sky-600 to-emerald-600 dark:from-indigo-400 dark:via-sky-400 dark:to-emerald-400">
                    instant job estimates
                  </span>
                  .
                </h1>

                <p className="mt-4 max-w-xl text-lg text-gray-700 dark:text-gray-300">
                  Customers upload photos. AI produces a structured scope summary, estimate range, and smart
                  follow-up questions — with optional “after” concept renderings to help you close faster.
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <a
                    href="/sign-in"
                    className="inline-flex items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 dark:bg-white dark:text-black"
                  >
                    Start free (sign in)
                  </a>
                  <a
                    href="#demo"
                    className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white/80 px-5 py-3 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-black/40 dark:text-gray-100 dark:hover:bg-gray-900"
                  >
                    See it in action
                  </a>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Seconds, not hours", "Generate a quote-ready draft fast"],
                    ["Fewer wasted trips", "Confidence + inspection flagging"],
                    ["More wins", "Respond first, close more"],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="rounded-2xl border border-gray-200 bg-white/70 p-4 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-black/40"
                    >
                      <div className="text-sm font-semibold">{k}</div>
                      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{v}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-600 dark:text-gray-300">
                  {[
                    "Upholstery • Marine • Roofing • Paving • Remodeling",
                    "Branded lead emails",
                    "Optional AI renderings",
                  ].map((t) => (
                    <div key={t} className="inline-flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-600" />
                      {t}
                    </div>
                  ))}
                </div>
              </div>

              {/* “Demo” mock UI */}
              <div id="demo" className="relative">
                <div className="rounded-3xl border border-gray-200 bg-white/80 shadow-xl backdrop-blur dark:border-gray-800 dark:bg-black/40">
                  <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
                    <div className="text-sm font-semibold">AI Photo Quote — Estimate Preview</div>
                    <div className="flex gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-700" />
                      <div className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-700" />
                      <div className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-700" />
                    </div>
                  </div>

                  <div className="p-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-black">
                        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                          Customer Photos
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <div
                              key={i}
                              className="aspect-square rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100 dark:border-gray-800 dark:from-gray-900 dark:to-gray-950"
                            />
                          ))}
                        </div>
                        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                          Upload → auto-analysis → draft estimate
                        </div>
                      </div>

                      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-black">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                            AI Assessment
                          </div>
                          <div className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Confidence: High
                          </div>
                        </div>

                        <div className="mt-3 space-y-3">
                          <div>
                            <div className="text-sm font-semibold">Scope summary</div>
                            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                              Structured description of visible work, likely materials, and key
                              constraints based on images.
                            </div>
                          </div>

                          <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                              Estimate range
                            </div>
                            <div className="mt-1 text-2xl font-extrabold tracking-tight">
                              $1,250 – $1,950
                            </div>
                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              Includes assumptions + recommended questions
                            </div>
                          </div>

                          <div className="grid gap-2">
                            {[
                              "Inspection required: No (based on photos)",
                              "Questions: fabric choice, dimensions, timeline",
                              "Optional: generate concept render",
                            ].map((x) => (
                              <div key={x} className="flex items-start gap-2 text-sm">
                                <CheckIcon className="mt-0.5 h-4 w-4 text-gray-900 dark:text-gray-100" />
                                <span className="text-gray-700 dark:text-gray-300">{x}</span>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-wrap gap-2 pt-1">
                            <div className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold dark:border-gray-800 dark:bg-black">
                              Email sent to owner
                            </div>
                            <div className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold dark:border-gray-800 dark:bg-black">
                              Branded customer receipt
                            </div>
                            <div className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold dark:border-gray-800 dark:bg-black">
                              Track in dashboard
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-black">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                            Optional feature
                          </div>
                          <div className="text-sm font-semibold">AI “after” concept render</div>
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 dark:bg-gray-900 dark:text-gray-200">
                          Toggle per business
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="aspect-[16/9] rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100 dark:border-gray-800 dark:from-gray-900 dark:to-gray-950" />
                        <div className="aspect-[16/9] rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100 dark:border-gray-800 dark:from-gray-900 dark:to-gray-950" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* floating badge */}
                <div className="pointer-events-none absolute -bottom-6 left-6 rounded-2xl border border-gray-200 bg-white/90 px-4 py-3 text-sm font-semibold shadow-lg backdrop-blur dark:border-gray-800 dark:bg-black/60">
                  Respond first. Win more.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PROBLEM → SOLUTION */}
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm dark:border-gray-800 dark:bg-black">
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                Still writing every estimate by hand?
              </h2>
              <p className="mt-3 text-gray-700 dark:text-gray-300">
                Quoting steals nights and weekends. Leads go cold while you’re busy. Site visits get wasted on
                tire-kickers.
              </p>
              <ul className="mt-5 space-y-3 text-sm text-gray-700 dark:text-gray-300">
                {[
                  "Hours lost typing quotes instead of doing paid work",
                  "Inconsistent pricing from memory or notes",
                  "Driving out for jobs that never close",
                  "Slow response time = missed revenue",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-2">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-600" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm dark:border-gray-800 dark:bg-black">
              <h3 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                AI Photo Quote does the first 80%.
              </h3>
              <p className="mt-3 text-gray-700 dark:text-gray-300">
                Customers submit photos and basic context. AI returns a structured assessment, an estimate range,
                and the right follow-up questions — instantly.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  ["Fast responses", "Be first to reply and stay top-of-mind."],
                  ["Fewer wasted trips", "Flag when inspection is truly needed."],
                  ["Cleaner scope", "Assumptions and visible scope captured."],
                  ["Upsell-ready", "Optional renderings that sell the vision."],
                ].map(([t, d]) => (
                  <div key={t} className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
                    <div className="text-sm font-semibold">{t}</div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{d}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 dark:bg-white dark:text-black"
                >
                  Start free (sign in)
                </a>
                <a
                  href="#pricing"
                  className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
                >
                  View pricing
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">How it works</h2>
              <p className="mt-2 max-w-2xl text-gray-700 dark:text-gray-300">
                A simple flow that feels like magic — but stays practical for real-world jobs.
              </p>
            </div>
            <a
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
            >
              Try it now
            </a>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-4">
            {[
              ["1) Customer uploads photos", "They submit images + quick context. No back-and-forth."],
              ["2) AI analyzes the job", "Generates scope, assumptions, confidence, and questions."],
              ["3) You review in your dashboard", "Approve, adjust, and progress stage (read/unread, follow-ups)."],
              ["4) Send + close", "Customer gets a branded receipt. Optional renderings help sell the vision."],
            ].map(([t, d]) => (
              <div
                key={t}
                className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-black"
              >
                <div className="text-sm font-semibold">{t}</div>
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{d}</div>
              </div>
            ))}
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Features that actually help you win</h2>
          <p className="mt-2 max-w-2xl text-gray-700 dark:text-gray-300">
            Built for small service businesses that live and die by response speed, clear scope, and professional follow-up.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["⚡ Instant AI estimates", "Structured scope + estimate ranges in seconds."],
              ["📸 Photo-first intake", "Designed for real-world, messy job photos."],
              ["🧠 Confidence + inspection flag", "Know when you can quote remotely vs. schedule a visit."],
              ["🎨 Optional AI concept render", "Show the “after” and increase close rate / upsells."],
              ["✉️ Branded lead + customer emails", "Automatic receipts, owner alerts, and clean follow-ups."],
              ["🧾 Assumptions + questions included", "Capture unknowns and reduce surprises later."],
              ["🏷️ Business settings", "Control categories, routing, and behavior per business."],
              ["📋 Admin workflow", "Stages, read/unread, notes, and visibility."],
              ["🔒 Built for SaaS from day one", "Tenant isolation and clean boundaries under the hood."],
            ].map(([title, desc]) => (
              <div
                key={title}
                className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md dark:border-gray-800 dark:bg-black"
              >
                <div className="text-sm font-semibold">{title}</div>
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* INDUSTRIES */}
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-black">
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Built for service businesses</h2>
            <p className="mt-2 max-w-2xl text-gray-700 dark:text-gray-300">
              Photo-based quoting works anywhere customers can snap a picture and explain what they want.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                "Marine & Auto Upholstery",
                "Paving & Concrete",
                "Roofing & Siding",
                "Remodeling & Repairs",
                "Landscaping & Hardscapes",
                "Specialty Trades",
              ].map((x) => (
                <div
                  key={x}
                  className="rounded-2xl border border-gray-200 bg-white p-4 text-sm font-semibold shadow-sm dark:border-gray-800 dark:bg-black"
                >
                  {x}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Pricing</h2>
          <p className="mt-2 max-w-2xl text-gray-700 dark:text-gray-300">
            Simple tiers to start. Upgrade when you’re ready to scale.
          </p>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {/* Starter */}
            <div className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm dark:border-gray-800 dark:bg-black">
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">Starter</div>
              <div className="mt-2 text-4xl font-extrabold">$0</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Try the workflow and see the magic.
              </div>
              <ul className="mt-5 space-y-3 text-sm text-gray-700 dark:text-gray-300">
                {[
                  "AI estimate drafts",
                  "Lead capture page",
                  "Admin dashboard basics",
                  "Owner + customer email receipts",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-2">
                    <CheckIcon className="mt-0.5 h-4 w-4" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
              <a
                href="/sign-in"
                className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 dark:bg-white dark:text-black"
              >
                Start free
              </a>
              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                Replace placeholders with your real tiers anytime.
              </div>
            </div>

            {/* Pro (featured) */}
            <div className="relative rounded-3xl border border-gray-200 bg-white p-7 shadow-xl dark:border-gray-800 dark:bg-black">
              <div className="absolute -top-3 right-6 rounded-full bg-gradient-to-r from-indigo-600 via-sky-600 to-emerald-600 px-3 py-1 text-xs font-extrabold text-white shadow-sm">
                Most popular
              </div>

              <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">Pro</div>
              <div className="mt-2 text-4xl font-extrabold">$29</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                For serious owners who want speed + polish.
              </div>

              <ul className="mt-5 space-y-3 text-sm text-gray-700 dark:text-gray-300">
                {[
                  "Everything in Starter",
                  "Advanced stages + workflow",
                  "Smarter follow-up questions",
                  "Branding + routing settings",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-2">
                    <CheckIcon className="mt-0.5 h-4 w-4" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>

              <a
                href="/sign-in"
                className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 dark:bg-white dark:text-black"
              >
                Upgrade to Pro
              </a>

              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                (Placeholder pricing — wire to your billing later.)
              </div>
            </div>

            {/* Scale */}
            <div className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm dark:border-gray-800 dark:bg-black">
              <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">Scale</div>
              <div className="mt-2 text-4xl font-extrabold">$79</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Teams, higher volume, more control.
              </div>
              <ul className="mt-5 space-y-3 text-sm text-gray-700 dark:text-gray-300">
                {[
                  "Everything in Pro",
                  "Optional AI concept renderings",
                  "More customization controls",
                  "Team / multi-user workflow",
                ].map((x) => (
                  <li key={x} className="flex items-start gap-2">
                    <CheckIcon className="mt-0.5 h-4 w-4" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
              <a
                href="/sign-in"
                className="mt-6 inline-flex w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
              >
                Choose Scale
              </a>
              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                Great for high-lead, high-quote shops.
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-black">
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">FAQ</h2>
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {[
                [
                  "Does AI replace my pricing?",
                  "No. It accelerates your first draft. You control your business settings and final numbers.",
                ],
                [
                  "What if the photos are bad?",
                  "The AI asks better follow-up questions and can flag inspection-required when confidence is low.",
                ],
                [
                  "Do I have to use AI renderings?",
                  "No — it’s optional and can be toggled per business. Use it when it helps you sell the vision.",
                ],
                [
                  "What industries does this work for?",
                  "Any service business quoting from photos: upholstery, roofing, paving, remodeling, landscaping, and more.",
                ],
              ].map(([q, a]) => (
                <div key={q} className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
                  <div className="text-sm font-semibold">{q}</div>
                  <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{a}</div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Ready to see it on your business?
              </div>
              <div className="flex flex-wrap gap-3">
                <a
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 dark:bg-white dark:text-black"
                >
                  Start free (sign in)
                </a>
                <a
                  href="#features"
                  className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
                >
                  Review features
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-6 border-t border-gray-200 pt-8 dark:border-gray-800 sm:flex-row sm:items-center">
            <div>
              <div className="text-sm font-extrabold tracking-tight">AI Photo Quote</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                AI-Powered estimating that helps service businesses respond faster and win more.
              </div>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <a
                href="#how-it-works"
                className="rounded-lg px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-900"
              >
                How it works
              </a>
              <a
                href="#features"
                className="rounded-lg px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-900"
              >
                Features
              </a>
              <a
                href="#pricing"
                className="rounded-lg px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-900"
              >
                Pricing
              </a>
              <a
                href="/sign-in"
                className="rounded-lg bg-black px-3 py-2 font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Sign in
              </a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}