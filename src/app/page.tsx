// src/app/page.tsx
import React from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import MarketingTopNav from "@/components/marketing/MarketingTopNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function IconSpark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
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
}

function IconCheck(props: React.SVGProps<SVGSVGElement>) {
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

function IconBolt(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M13 2L3 14h8l-1 8 11-14h-8l0-6z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCamera(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 7l1.5-2h7L17 7h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2h2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 18a4 4 0 100-8 4 4 0 000 8z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function IconMail(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 6h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M22 8l-10 7L2 8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconWand(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 20l10.5-10.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
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
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "ai";
}) {
  const tones: Record<string, string> = {
    neutral:
      "border-white/10 bg-white/5 text-white/80 dark:border-white/10 dark:bg-white/5 dark:text-white/80",
    good:
      "border-emerald-400/20 bg-emerald-400/10 text-emerald-100 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100",
    ai: "border-sky-400/20 bg-sky-400/10 text-sky-100 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-100",
  };

  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold backdrop-blur",
        tones[tone],
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/admin");

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingTopNav />

      {/* HERO (new look: dark, high-contrast, premium) */}
      <section className="relative overflow-hidden">
        {/* background */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_20%_10%,rgba(56,189,248,0.18),transparent_60%),radial-gradient(800px_500px_at_80%_15%,rgba(16,185,129,0.14),transparent_60%),radial-gradient(900px_600px_at_50%_90%,rgba(139,92,246,0.16),transparent_60%)]" />
          <div className="absolute inset-0 opacity-[0.25] [background-image:linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:44px_44px]" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/70 to-black" />
        </div>

        <div className="mx-auto max-w-6xl px-4 pt-10 pb-14 sm:px-6 sm:pt-12 sm:pb-20">
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-12">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="ai">
                  <IconSpark className="h-4 w-4" />
                  AI-Powered Estimating
                </Badge>
                <Badge tone="good">
                  <span className="h-2 w-2 rounded-full bg-emerald-300" />
                  Built for service businesses
                </Badge>
                <Badge>Respond faster • Win more</Badge>
              </div>

              <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-6xl">
                Turn customer photos into{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-300 via-emerald-300 to-violet-300">
                  quote-ready estimates
                </span>{" "}
                in seconds.
              </h1>

              <p className="mt-5 max-w-xl text-lg text-white/80">
                Your customers upload photos. AI generates a structured scope summary, estimate range, and smart
                follow-up questions. Add optional “after” concept renderings to help close bigger jobs.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <a
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-extrabold text-black shadow-sm hover:opacity-90"
                >
                  Start free
                </a>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white/90 hover:bg-white/10"
                >
                  See how it works
                </a>
              </div>

              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                {[
                  ["Save time", "Stop typing quotes at night."],
                  ["Fewer trips", "AI flags when inspection is needed."],
                  ["More wins", "Fast replies stay top-of-mind."],
                ].map(([t, d]) => (
                  <div
                    key={t}
                    className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur"
                  >
                    <div className="text-sm font-extrabold">{t}</div>
                    <div className="mt-1 text-sm text-white/70">{d}</div>
                  </div>
                ))}
              </div>

              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
                {[
                  "Upholstery • Marine • Roofing • Paving • Remodeling",
                  "Branded customer receipt emails",
                  "Optional AI “after” render",
                ].map((x) => (
                  <div key={x} className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
                    {x}
                  </div>
                ))}
              </div>
            </div>

            {/* HERO RIGHT: crisp “product cards” instead of the big faux window */}
            <div className="relative">
              <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-extrabold tracking-tight">Live estimate preview</div>
                  <div className="text-xs font-semibold text-white/60">Example output</div>
                </div>

                <div className="mt-4 grid gap-3">
                  {/* intake */}
                  <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
                      <IconCamera className="h-4 w-4" />
                      Customer photos + context
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div
                          key={i}
                          className="aspect-square rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5"
                        />
                      ))}
                    </div>
                    <div className="mt-3 text-xs text-white/60">
                      Upload → AI analysis → structured output
                    </div>
                  </div>

                  {/* output */}
                  <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white/80">AI assessment</div>
                      <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-extrabold text-emerald-100">
                        Confidence: High
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs font-semibold text-white/60">Scope summary</div>
                        <div className="mt-2 text-sm text-white/75">
                          Clean, quote-ready scope written from what’s visible — plus assumptions and what to ask next.
                        </div>
                        <div className="mt-3 space-y-2 text-sm">
                          {["Visible scope", "Assumptions", "Follow-up questions"].map((x) => (
                            <div key={x} className="flex items-start gap-2 text-white/80">
                              <IconCheck className="mt-0.5 h-4 w-4 text-white" />
                              <span>{x}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs font-semibold text-white/60">Estimate range</div>
                        <div className="mt-2 text-3xl font-extrabold tracking-tight">$1,250 – $1,950</div>
                        <div className="mt-1 text-xs text-white/60">
                          Inspection flagging + confidence included
                        </div>

                        <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-3">
                          <div className="text-xs font-semibold text-white/60">Inspection required</div>
                          <div className="mt-1 text-sm font-extrabold text-white">No</div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {["Email to owner", "Customer receipt", "Track in dashboard"].map((x) => (
                            <span
                              key={x}
                              className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs font-semibold text-white/75"
                            >
                              {x}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
                          <IconWand className="h-4 w-4" />
                          Optional AI “after” concept render
                        </div>
                        <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs font-extrabold text-sky-100">
                          Toggle per business
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="aspect-[16/9] rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5" />
                        <div className="aspect-[16/9] rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pointer-events-none absolute -bottom-6 left-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-extrabold text-white/90 shadow-xl backdrop-blur">
                <span className="text-white/70">Owner outcome:</span> quote faster, close more.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST STRIP */}
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-3 rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur sm:grid-cols-3">
          {[
            ["Fast replies", "Be first to respond—customers pick the fastest pro."],
            ["Cleaner scope", "No more vague texts. Get structured scope + assumptions."],
            ["Built to scale", "A real SaaS platform under the hood (not a form builder)."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-3xl border border-white/10 bg-black/30 p-5">
              <div className="text-sm font-extrabold">{t}</div>
              <div className="mt-2 text-sm text-white/70">{d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">How it works</h2>
            <p className="mt-2 max-w-2xl text-white/70">
              Practical, fast, and built for real-world jobs — not perfect photos.
            </p>
          </div>
          <a
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white/90 hover:bg-white/10"
          >
            Try it now
          </a>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-4">
          {[
            {
              title: "1) Intake",
              desc: "Customer uploads photos + basic context.",
              icon: <IconCamera className="h-5 w-5" />,
            },
            {
              title: "2) AI analysis",
              desc: "Scope, assumptions, confidence, and questions generated.",
              icon: <IconBolt className="h-5 w-5" />,
            },
            {
              title: "3) Review",
              desc: "You approve, edit, and progress the lead in your dashboard.",
              icon: <IconCheck className="h-5 w-5" />,
            },
            {
              title: "4) Send + close",
              desc: "Customer gets a branded receipt. Optional renders sell the vision.",
              icon: <IconMail className="h-5 w-5" />,
            },
          ].map((s) => (
            <div
              key={s.title}
              className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur"
            >
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/30">
                {s.icon}
              </div>
              <div className="mt-4 text-sm font-extrabold">{s.title}</div>
              <div className="mt-2 text-sm text-white/70">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES (owner-language, premium cards) */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="rounded-[32px] border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-7 sm:p-10">
          <h2 className="text-3xl font-extrabold tracking-tight">Features that help you win jobs</h2>
          <p className="mt-2 max-w-2xl text-white/70">
            Not “AI for AI’s sake.” These features directly reduce time, reduce waste, and increase close rate.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["⚡ Instant AI estimate draft", "Get structured scope + estimate ranges in seconds."],
              ["🧠 Confidence scoring", "Know when you can quote remotely vs. schedule a site visit."],
              ["🧾 Assumptions + questions", "Capture unknowns so you don’t get burned later."],
              ["✉️ Branded emails", "Owner alert + customer receipt sent automatically."],
              ["🎨 Optional AI “after” render", "Help customers visualize the end result and upsell."],
              ["📋 Simple admin workflow", "Stages, read/unread, notes, and follow-ups."],
              ["📸 Made for imperfect photos", "Works with messy, real customer submissions."],
              ["🏷️ Business settings", "Control behavior, categories, and routing per business."],
              ["🔒 SaaS-grade foundation", "A real multi-tenant product, built clean and scalable."],
            ].map(([t, d]) => (
              <div
                key={t}
                className="rounded-[28px] border border-white/10 bg-black/30 p-6 shadow-xl shadow-black/20"
              >
                <div className="text-sm font-extrabold">{t}</div>
                <div className="mt-2 text-sm text-white/70">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* INDUSTRIES */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-6 rounded-[32px] border border-white/10 bg-white/5 p-7 backdrop-blur sm:p-10 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Built for service businesses</h2>
            <p className="mt-2 max-w-xl text-white/70">
              If your customers can take pictures of the job, you can quote faster with AI.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["Upholstery", "Marine", "Roofing", "Paving", "Remodeling", "Landscaping", "Specialty trades"].map(
                (x) => (
                  <span
                    key={x}
                    className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs font-semibold text-white/75"
                  >
                    {x}
                  </span>
                )
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-black/30 p-6">
            <div className="text-sm font-extrabold">Why owners love it</div>
            <div className="mt-4 space-y-3 text-sm text-white/75">
              {[
                "Reply to leads fast (even after hours).",
                "Spend less time quoting and more time producing.",
                "Reduce wasted trips with inspection flagging.",
                "Win upsells when customers can see the vision.",
              ].map((x) => (
                <div key={x} className="flex items-start gap-2">
                  <IconCheck className="mt-0.5 h-4 w-4 text-white" />
                  <span>{x}</span>
                </div>
              ))}
            </div>
            <a
              href="/sign-in"
              className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-extrabold text-black hover:opacity-90"
            >
              Start free
            </a>
          </div>
        </div>
      </section>

      {/* PRICING (still placeholder but looks premium) */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-extrabold tracking-tight">Pricing</h2>
          <p className="max-w-2xl text-white/70">
            Placeholder tiers for now — we’ll wire these to your real SaaS plans when you’re ready.
          </p>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {[
            {
              name: "Starter",
              price: "$0",
              note: "Try it and prove the workflow.",
              cta: "Start free",
              primary: false,
              items: ["AI estimate drafts", "Lead capture page", "Basic admin workflow", "Email receipts"],
            },
            {
              name: "Pro",
              price: "$29",
              note: "Best for most shops.",
              cta: "Choose Pro",
              primary: true,
              items: ["Everything in Starter", "Better questions + structure", "More settings & control", "Cleaner workflow"],
            },
            {
              name: "Scale",
              price: "$79",
              note: "Higher volume and teams.",
              cta: "Choose Scale",
              primary: false,
              items: ["Everything in Pro", "Optional AI concept render", "More customization", "Team workflows"],
            },
          ].map((p) => (
            <div
              key={p.name}
              className={[
                "rounded-[32px] border p-7 backdrop-blur",
                p.primary
                  ? "border-sky-400/30 bg-gradient-to-b from-sky-400/10 to-white/5 shadow-2xl shadow-sky-500/10"
                  : "border-white/10 bg-white/5",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-extrabold">{p.name}</div>
                {p.primary ? (
                  <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-extrabold text-sky-100">
                    Most popular
                  </span>
                ) : null}
              </div>
              <div className="mt-3 text-5xl font-extrabold tracking-tight">{p.price}</div>
              <div className="mt-2 text-sm text-white/70">{p.note}</div>

              <ul className="mt-6 space-y-3 text-sm text-white/75">
                {p.items.map((x) => (
                  <li key={x} className="flex items-start gap-2">
                    <IconCheck className="mt-0.5 h-4 w-4 text-white" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>

              <a
                href="/sign-in"
                className={[
                  "mt-7 inline-flex w-full items-center justify-center rounded-2xl px-6 py-3 text-sm font-extrabold",
                  p.primary
                    ? "bg-white text-black hover:opacity-90"
                    : "border border-white/15 bg-white/5 text-white/90 hover:bg-white/10",
                ].join(" ")}
              >
                {p.cta}
              </a>

              <div className="mt-3 text-xs text-white/50">(Placeholder pricing)</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="rounded-[32px] border border-white/10 bg-white/5 p-7 backdrop-blur sm:p-10">
          <h2 className="text-3xl font-extrabold tracking-tight">FAQ</h2>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            {[
              ["Does AI replace my pricing?", "No. It accelerates a quote-ready draft. You stay in control of the final number."],
              ["What if photos are bad?", "AI asks better follow-up questions and can flag inspection-required when confidence is low."],
              ["Do I have to use AI renderings?", "No. It’s optional and can be toggled per business."],
              ["What businesses does this work for?", "Any service business quoting from photos: upholstery, roofing, paving, remodeling, landscaping, and more."],
            ].map(([q, a]) => (
              <div key={q} className="rounded-[28px] border border-white/10 bg-black/30 p-6">
                <div className="text-sm font-extrabold">{q}</div>
                <div className="mt-2 text-sm text-white/70">{a}</div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="text-sm text-white/70">Ready to see it on your business?</div>
            <div className="flex flex-wrap gap-3">
              <a
                href="/sign-in"
                className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-extrabold text-black hover:opacity-90"
              >
                Start free
              </a>
              <a
                href="#features"
                className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white/90 hover:bg-white/10"
              >
                Review features
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 border-t border-white/10 pt-8 sm:flex-row sm:items-center">
          <div>
            <div className="text-sm font-extrabold tracking-tight">AI Photo Quote</div>
            <div className="mt-1 text-sm text-white/60">
              AI-powered estimating that helps service businesses respond faster and win more.
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            {[
              ["How it works", "#how-it-works"],
              ["Features", "#features"],
              ["Pricing", "#pricing"],
            ].map(([t, href]) => (
              <a
                key={t}
                href={href}
                className="rounded-xl px-3 py-2 font-semibold text-white/80 hover:bg-white/5 hover:text-white"
              >
                {t}
              </a>
            ))}
            <a
              href="/sign-in"
              className="rounded-xl bg-white px-3 py-2 font-extrabold text-black hover:opacity-90"
            >
              Sign in
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}