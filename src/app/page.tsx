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
  name: "spark" | "camera" | "bolt" | "mail" | "wand" | "check" | "arrow";
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
          <path
            d="M12 18a4 4 0 100-8 4 4 0 000 8z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
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
          <path
            d="M22 8l-10 7L2 8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "wand":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
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
          <path
            d="M5 12h12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M13 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ai" | "good";
}) {
  const toneClass =
    tone === "ai"
      ? "border-indigo-200 bg-indigo-50 text-indigo-700"
      : tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-gray-200 bg-white text-gray-700";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
        toneClass
      )}
    >
      {children}
    </span>
  );
}

/**
 * Card pop styling by "tone" so everything can have subtle color + definition.
 * - top gradient accent
 * - tinted background
 * - stronger shadow + hover
 * - icon badge tint
 */
function PopCard({
  tone,
  icon,
  corner,
  title,
  desc,
  bullets,
  footer,
}: {
  tone: "sky" | "indigo" | "emerald" | "amber" | "slate" | "fuchsia";
  icon: React.ReactNode;
  corner?: React.ReactNode;
  title: string;
  desc?: string;
  bullets?: string[];
  footer?: React.ReactNode;
}) {
  const T: Record<
    string,
    {
      cardBg: string;
      ring: string;
      top: string;
      iconWrap: string;
      corner: string;
      softText: string;
    }
  > = {
    sky: {
      cardBg: "bg-gradient-to-b from-sky-50/70 to-white",
      ring: "ring-sky-200",
      top: "from-sky-500 to-indigo-500",
      iconWrap: "border-sky-200 bg-sky-50 text-sky-700",
      corner: "border-sky-200 bg-sky-50 text-sky-700",
      softText: "text-sky-700",
    },
    indigo: {
      cardBg: "bg-gradient-to-b from-indigo-50/70 to-white",
      ring: "ring-indigo-200",
      top: "from-indigo-500 to-violet-500",
      iconWrap: "border-indigo-200 bg-indigo-50 text-indigo-700",
      corner: "border-indigo-200 bg-indigo-50 text-indigo-700",
      softText: "text-indigo-700",
    },
    emerald: {
      cardBg: "bg-gradient-to-b from-emerald-50/70 to-white",
      ring: "ring-emerald-200",
      top: "from-emerald-500 to-teal-500",
      iconWrap: "border-emerald-200 bg-emerald-50 text-emerald-700",
      corner: "border-emerald-200 bg-emerald-50 text-emerald-700",
      softText: "text-emerald-700",
    },
    amber: {
      cardBg: "bg-gradient-to-b from-amber-50/70 to-white",
      ring: "ring-amber-200",
      top: "from-amber-500 to-orange-500",
      iconWrap: "border-amber-200 bg-amber-50 text-amber-700",
      corner: "border-amber-200 bg-amber-50 text-amber-700",
      softText: "text-amber-700",
    },
    fuchsia: {
      cardBg: "bg-gradient-to-b from-fuchsia-50/70 to-white",
      ring: "ring-fuchsia-200",
      top: "from-fuchsia-500 to-pink-500",
      iconWrap: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
      corner: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
      softText: "text-fuchsia-700",
    },
    slate: {
      cardBg: "bg-gradient-to-b from-slate-50/70 to-white",
      ring: "ring-gray-200",
      top: "from-gray-700 to-gray-900",
      iconWrap: "border-gray-200 bg-gray-50 text-gray-900",
      corner: "border-gray-200 bg-gray-50 text-gray-700",
      softText: "text-gray-700",
    },
  };

  const st = T[tone] ?? T.slate;

  return (
    <div
      className={cx(
        "group relative rounded-3xl border border-gray-200 p-6 shadow-sm transition",
        "hover:-translate-y-0.5 hover:shadow-md",
        "ring-1 ring-black/5",
        st.cardBg
      )}
    >
      <div className={cx("absolute inset-x-0 top-0 h-1.5 rounded-t-3xl bg-gradient-to-r", st.top)} />

      <div className="flex items-center justify-between">
        <div
          className={cx(
            "inline-flex h-10 w-10 items-center justify-center rounded-2xl border",
            st.iconWrap
          )}
        >
          {icon}
        </div>

        {corner ? (
          <span className={cx("rounded-full border px-2.5 py-1 text-xs font-semibold", st.corner)}>
            {corner}
          </span>
        ) : null}
      </div>

      <div className="mt-4 text-sm font-extrabold text-gray-900">{title}</div>
      {desc ? <div className="mt-2 text-sm text-gray-600">{desc}</div> : null}

      {bullets?.length ? (
        <ul className="mt-4 space-y-2 text-sm text-gray-700">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <Icon name="check" className={cx("mt-0.5 h-4 w-4", st.softText)} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {footer ? <div className="mt-5">{footer}</div> : null}

      <div
        className={cx(
          "pointer-events-none absolute inset-0 rounded-3xl ring-2 opacity-0 transition group-hover:opacity-100",
          st.ring
        )}
      />
    </div>
  );
}

function PricingCard({
  name,
  price,
  note,
  items,
  cta,
  featured,
  tone,
}: {
  name: string;
  price: string;
  note: string;
  items: string[];
  cta: string;
  featured?: boolean;
  tone: "sky" | "indigo" | "emerald";
}) {
  const pillTone =
    tone === "sky"
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-indigo-200 bg-indigo-50 text-indigo-700";

  const buttonClass =
    featured
      ? "bg-gray-900 text-white hover:opacity-90"
      : "border border-gray-200 bg-white text-gray-900 hover:bg-gray-50";

  return (
    <div className="rounded-[34px] border border-gray-200 bg-white p-2 shadow-sm">
      <div className="rounded-[28px] border border-gray-200 bg-white shadow-sm">
        <div className="p-7">
          <div className="flex items-center justify-between">
            <div className="text-sm font-extrabold text-gray-900">{name}</div>
            {featured ? (
              <span className={cx("rounded-full border px-3 py-1 text-xs font-extrabold", pillTone)}>
                Most popular
              </span>
            ) : (
              <span className={cx("rounded-full border px-3 py-1 text-xs font-semibold", pillTone)}>
                {tone === "sky" ? "Starter" : tone === "indigo" ? "Best value" : "Scale"}
              </span>
            )}
          </div>

          <div className="mt-3 text-5xl font-extrabold tracking-tight text-gray-900">{price}</div>
          <div className="mt-2 text-sm text-gray-600">{note}</div>

          <ul className="mt-6 space-y-3 text-sm text-gray-700">
            {items.map((x) => (
              <li key={x} className="flex items-start gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 text-gray-900" />
                <span>{x}</span>
              </li>
            ))}
          </ul>

          <a
            href="/sign-in"
            className={cx(
              "mt-7 inline-flex w-full items-center justify-center rounded-2xl px-6 py-3 text-sm font-extrabold",
              buttonClass
            )}
          >
            {cta}
          </a>

          <div className="mt-3 text-xs text-gray-500">(Placeholder pricing)</div>
        </div>
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

      {/* HERO — bright “Apple/Stripe clean” */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-48 left-1/2 h-[520px] w-[980px] -translate-x-1/2 rounded-full bg-gradient-to-r from-indigo-200 via-sky-200 to-emerald-200 blur-3xl opacity-70" />
          <div className="absolute -bottom-56 left-1/2 h-[480px] w-[920px] -translate-x-1/2 rounded-full bg-gradient-to-r from-fuchsia-200 via-amber-200 to-lime-200 blur-3xl opacity-50" />
          <div className="absolute inset-0 bg-gradient-to-b from-white/70 via-white/80 to-white" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-16">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="ai">
                  <Icon name="spark" className="h-4 w-4" />
                  AI-Powered
                </Badge>
                <Badge tone="good">Built for service business owners</Badge>
                <Badge>Photos → Estimate → Close</Badge>
              </div>

              <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-6xl">
                Quote jobs from photos{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-sky-600 to-emerald-600">
                  in seconds
                </span>
                .
              </h1>

              <p className="mt-5 max-w-xl text-lg text-gray-700">
                Customers upload photos and answer a few quick questions. AI generates a quote-ready scope
                summary, estimate range, and smart follow-ups — with optional “after” concept renderings to help
                you win bigger jobs.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <a
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-6 py-3 text-sm font-extrabold text-white shadow-sm hover:opacity-90"
                >
                  Start free
                </a>
                <a
                  href="#demo"
                  className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50"
                >
                  See it in action
                </a>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  ["Save time", "Stop typing quotes at night."],
                  ["Fewer wasted trips", "AI flags when inspection is needed."],
                  ["Close more jobs", "Fast replies stay top-of-mind."],
                ].map(([t, d]) => (
                  <PopCard
                    key={t}
                    tone={t === "Save time" ? "indigo" : t === "Fewer wasted trips" ? "emerald" : "sky"}
                    icon={<Icon name={t === "Save time" ? "bolt" : t === "Fewer wasted trips" ? "check" : "mail"} />}
                    title={t}
                    desc={d}
                  />
                ))}
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

            {/* Right: light “product snapshot” with clean borders */}
            <div id="demo" className="relative">
              <div className="rounded-[34px] border border-gray-200 bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                  <div className="text-sm font-extrabold text-gray-900">AI Estimate Preview</div>
                  <div className="text-xs font-semibold text-gray-500">Example output</div>
                </div>

                <div className="p-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                        <Icon name="camera" className="h-4 w-4" />
                        Customer photos
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <div
                            key={i}
                            className="aspect-square rounded-2xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100"
                          />
                        ))}
                      </div>
                      <div className="mt-3 text-xs text-gray-500">Upload → AI analysis → draft estimate</div>
                    </div>

                    <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-gray-700">AI assessment</div>
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-700">
                          Confidence: High
                        </span>
                      </div>

                      <div className="mt-3 space-y-3">
                        <div>
                          <div className="text-sm font-extrabold text-gray-900">Scope summary</div>
                          <div className="mt-1 text-sm text-gray-600">
                            Quote-ready scope, assumptions, and what to ask next — based on what’s visible.
                          </div>
                        </div>

                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                          <div className="text-xs font-semibold text-gray-500">Estimate range</div>
                          <div className="mt-1 text-2xl font-extrabold tracking-tight text-gray-900">
                            $1,250 – $1,950
                          </div>
                          <div className="mt-1 text-xs text-gray-500">Includes assumptions + follow-ups</div>
                        </div>

                        <div className="grid gap-2 text-sm text-gray-700">
                          {["Inspection required flag", "Assumptions included", "Follow-up questions"].map((x) => (
                            <div key={x} className="flex items-start gap-2">
                              <Icon name="check" className="mt-0.5 h-4 w-4 text-gray-900" />
                              <span>{x}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                        <Icon name="wand" className="h-4 w-4" />
                        Optional AI “after” concept render
                      </div>
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-extrabold text-sky-700">
                        Toggle per business
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="aspect-[16/9] rounded-2xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100" />
                      <div className="aspect-[16/9] rounded-2xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100" />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      ["Owner alert", "Lead email with photos + AI summary."],
                      ["Customer receipt", "Branded confirmation email."],
                      ["Dashboard", "Track stages, notes, follow-ups."],
                    ].map(([t, d], idx) => (
                      <PopCard
                        key={t}
                        tone={idx === 0 ? "amber" : idx === 1 ? "sky" : "indigo"}
                        icon={<Icon name={idx === 0 ? "mail" : idx === 1 ? "mail" : "bolt"} />}
                        title={t}
                        desc={d}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* subtle callout */}
              <div className="pointer-events-none absolute -bottom-6 left-6 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-extrabold text-gray-900 shadow-lg">
                Respond faster. Win more.
              </div>
            </div>
          </div>

          {/* space for callout */}
          <div className="h-10 sm:h-14" />
        </div>
      </section>

      {/* HOW IT WORKS — POP cards */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">How it works</h2>
            <p className="mt-2 max-w-2xl text-gray-600">
              A simple, repeatable process your business can run every day.
            </p>
          </div>
          <a
            href="/sign-in"
            className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-5 py-2.5 text-sm font-extrabold text-white hover:opacity-90"
          >
            Try it now
          </a>
        </div>

        <div className="mt-8 rounded-[34px] border border-gray-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-4">
            <PopCard
              tone="sky"
              icon={<Icon name="camera" className="h-5 w-5" />}
              corner="1/4"
              title="Customer uploads"
              desc="Photos + quick details."
            />
            <PopCard
              tone="indigo"
              icon={<Icon name="bolt" className="h-5 w-5" />}
              corner="2/4"
              title="AI analyzes"
              desc="Scope + range + questions."
            />
            <PopCard
              tone="emerald"
              icon={<Icon name="check" className="h-5 w-5" />}
              corner="3/4"
              title="You review"
              desc="Approve and progress the lead."
            />
            <PopCard
              tone="amber"
              icon={<Icon name="mail" className="h-5 w-5" />}
              corner="4/4"
              title="Send & close"
              desc="Branded receipt + optional render."
            />
          </div>
        </div>
      </section>

      {/* FEATURES — now converted to POP cards */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <PopCard
            tone="indigo"
            icon={<Icon name="spark" className="h-5 w-5" />}
            corner={<span>Owner-first</span>}
            title="Designed for owners"
            desc="AI Photo Quote helps you respond faster and win more jobs — without adding admin work."
            bullets={[
              "Generate quote-ready drafts in seconds",
              "Flag when inspection is truly needed",
              "Optional renderings help sell the vision",
              "Branded receipts make you look pro",
            ]}
            footer={
              <a
                href="/sign-in"
                className="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-6 py-3 text-sm font-extrabold text-white hover:opacity-90"
              >
                Start free <Icon name="arrow" className="h-4 w-4" />
              </a>
            }
          />

          <div className="grid gap-4">
            <PopCard
              tone="sky"
              icon={<Icon name="bolt" className="h-5 w-5" />}
              title="Instant AI estimate drafts"
              desc="Structured scope + estimate ranges + follow-up questions."
            />
            <PopCard
              tone="emerald"
              icon={<Icon name="camera" className="h-5 w-5" />}
              title="Photo-first intake"
              desc="Works with real-world customer photos — not perfect studio shots."
            />
            <PopCard
              tone="fuchsia"
              icon={<Icon name="wand" className="h-5 w-5" />}
              title="Optional AI “after” concept renders"
              desc="Help customers visualize the result and increase upsells."
            />
            <PopCard
              tone="amber"
              icon={<Icon name="mail" className="h-5 w-5" />}
              title="Automatic branded emails"
              desc="Owner lead alerts + customer receipts sent instantly."
            />
          </div>
        </div>

        {/* industries */}
        <div className="mt-6">
          <PopCard
            tone="slate"
            icon={<Icon name="check" className="h-5 w-5" />}
            corner={<span>Flexible</span>}
            title="Works across industries"
            desc="If your customers can snap a picture of the job, you can quote faster with AI."
            footer={
              <div className="mt-1 flex flex-wrap gap-2">
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
            }
          />
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-3xl font-extrabold tracking-tight">Pricing</h2>
        <p className="mt-2 max-w-2xl text-gray-600">
          Placeholder tiers for now — we’ll wire these to your real SaaS billing when ready.
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          <PricingCard
            name="Starter"
            price="$0"
            note="Try it and prove the workflow."
            items={["AI estimate drafts", "Lead capture page", "Basic admin workflow", "Email receipts"]}
            cta="Start free"
            tone="sky"
          />
          <PricingCard
            name="Pro"
            price="$29"
            note="Best for most shops."
            items={["Everything in Starter", "Smarter follow-up questions", "Business settings", "Cleaner workflow"]}
            cta="Choose Pro"
            featured
            tone="indigo"
          />
          <PricingCard
            name="Scale"
            price="$79"
            note="Higher volume and teams."
            items={["Everything in Pro", "Optional AI concept render", "More customization", "Team workflows"]}
            cta="Choose Scale"
            tone="emerald"
          />
        </div>
      </section>

      {/* FAQ — POP cards */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="rounded-[34px] border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="text-3xl font-extrabold tracking-tight">FAQ</h2>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <PopCard
              tone="indigo"
              icon={<Icon name="spark" className="h-5 w-5" />}
              title="Does AI replace my pricing?"
              desc="No. It accelerates a quote-ready draft. You stay in control of the final number."
            />
            <PopCard
              tone="emerald"
              icon={<Icon name="check" className="h-5 w-5" />}
              title="What if photos are bad?"
              desc="AI asks better follow-up questions and can flag inspection-required when confidence is low."
            />
            <PopCard
              tone="fuchsia"
              icon={<Icon name="wand" className="h-5 w-5" />}
              title="Do I have to use AI renderings?"
              desc="No. It’s optional and can be toggled per business."
            />
            <PopCard
              tone="amber"
              icon={<Icon name="camera" className="h-5 w-5" />}
              title="What businesses does this work for?"
              desc="Any service business quoting from photos: upholstery, roofing, paving, remodeling, landscaping, and more."
            />
          </div>

          <div className="mt-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="text-sm text-gray-600">Ready to see it on your business?</div>
            <div className="flex flex-wrap gap-3">
              <a
                href="/sign-in"
                className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-6 py-3 text-sm font-extrabold text-white hover:opacity-90"
              >
                Start free
              </a>
              <a
                href="#features"
                className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50"
              >
                Review features
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
              <a
                key={t}
                href={href}
                className="rounded-xl px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50"
              >
                {t}
              </a>
            ))}
            <a
              href="/sign-in"
              className="rounded-xl bg-gray-900 px-3 py-2 font-extrabold text-white hover:opacity-90"
            >
              Sign in
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}