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
    | "camera"
    | "bolt"
    | "check"
    | "mail"
    | "shield"
    | "clock"
    | "wrench"
    | "chart"
    | "arrow"
    | "spark";
  className?: string;
}) {
  const common = { className: cx("h-5 w-5", className) };
  switch (name) {
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
    case "clock":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
          <path d="M12 22a10 10 0 100-20 10 10 0 000 20z" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 6v6l4 2"
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
    case "chart":
      return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...common}>
          <path d="M4 19V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4 19h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M8 15V11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M12 15V8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M16 15V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
  }
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-extrabold tracking-wide text-white">
      {children}
    </span>
  );
}

function SteelCard({
  title,
  desc,
  icon,
  tone = "steel",
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  tone?: "steel" | "blueprint" | "olive";
}) {
  const tones =
    tone === "blueprint"
      ? {
          top: "from-slate-700 to-slate-950",
          ring: "ring-slate-300/40",
          iconWrap: "border-slate-300/40 bg-slate-50 text-slate-900",
          bg: "bg-gradient-to-b from-white to-slate-50",
        }
      : tone === "olive"
      ? {
          top: "from-emerald-900 to-lime-950",
          ring: "ring-emerald-300/30",
          iconWrap: "border-emerald-300/30 bg-emerald-50 text-emerald-950",
          bg: "bg-gradient-to-b from-white to-emerald-50/60",
        }
      : {
          top: "from-zinc-700 to-zinc-950",
          ring: "ring-zinc-300/40",
          iconWrap: "border-zinc-300/40 bg-zinc-50 text-zinc-950",
          bg: "bg-gradient-to-b from-white to-zinc-50",
        };

  return (
    <div
      className={cx(
        "group relative rounded-3xl border border-gray-200 p-6 shadow-sm transition",
        "hover:-translate-y-0.5 hover:shadow-md",
        "ring-1 ring-black/5",
        tones.bg
      )}
    >
      <div className={cx("absolute inset-x-0 top-0 h-1.5 rounded-t-3xl bg-gradient-to-r", tones.top)} />
      <div className="flex items-start gap-3">
        <div className={cx("mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl border", tones.iconWrap)}>
          {icon}
        </div>
        <div>
          <div className="text-sm font-extrabold text-gray-900">{title}</div>
          <div className="mt-2 text-sm text-gray-600">{desc}</div>
        </div>
      </div>

      <div className={cx("pointer-events-none absolute inset-0 rounded-3xl ring-2 opacity-0 transition group-hover:opacity-100", tones.ring)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-xs font-semibold text-white/70">{label}</div>
      <div className="mt-1 text-xl font-extrabold tracking-tight text-white">{value}</div>
    </div>
  );
}

function PhotoTile({
  src,
  label,
}: {
  src: string;
  label: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/20 shadow-2xl">
      <div
        className="h-44 w-full bg-cover bg-center"
        style={{ backgroundImage: `url('${src}')` }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      <div className="absolute bottom-3 left-3">
        <span className="rounded-full border border-white/15 bg-black/30 px-3 py-1 text-xs font-extrabold text-white">
          {label}
        </span>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-px w-full bg-gradient-to-r from-transparent via-gray-200 to-transparent" />;
}

export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/admin");

  // Industrial / service stock imagery (used as CSS backgrounds, no Next/Image config needed)
  const heroImg =
    "https://images.unsplash.com/photo-1581092918484-8313c8e7c9c5?auto=format&fit=crop&w=1800&q=80";
  const tile1 =
    "https://images.unsplash.com/photo-1557324232-b8917d3c3dcb?auto=format&fit=crop&w=1400&q=80";
  const tile2 =
    "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1400&q=80";
  const tile3 =
    "https://images.unsplash.com/photo-1581093588401-12c38a6c9f33?auto=format&fit=crop&w=1400&q=80";
  const stripImg =
    "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=1800&q=80";

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <MarketingTopNav />

      {/* ================= HERO ================= */}
      <section className="relative isolate overflow-hidden">
        {/* Background photo */}
        <div className="absolute inset-0">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url('${heroImg}')` }}
          />
          {/* Contrast */}
          <div className="absolute inset-0 bg-black/70" />
          {/* “Brushed steel” + “blueprint grid” overlays (no external assets) */}
          <svg className="absolute inset-0 h-full w-full opacity-[0.22]" aria-hidden="true">
            <defs>
              <pattern id="grid" width="72" height="72" patternUnits="userSpaceOnUse">
                <path d="M72 0H0V72" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
                <path d="M36 0V72M0 36H72" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              </pattern>
              <linearGradient id="steel" x1="0" x2="1">
                <stop offset="0" stopColor="rgba(255,255,255,0.06)" />
                <stop offset="0.2" stopColor="rgba(255,255,255,0.02)" />
                <stop offset="0.5" stopColor="rgba(255,255,255,0.10)" />
                <stop offset="0.8" stopColor="rgba(255,255,255,0.03)" />
                <stop offset="1" stopColor="rgba(255,255,255,0.06)" />
              </linearGradient>
              <pattern id="brushed" width="6" height="6" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill="rgba(0,0,0,0)" />
                <path d="M0 1H6M0 3H6M0 5H6" stroke="url(#steel)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            <rect width="100%" height="100%" fill="url(#brushed)" />
          </svg>
          {/* Vignette */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/60 to-black/85" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
            {/* Left */}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Pill>
                  <Icon name="spark" className="h-4 w-4" />
                  AI-as-a-Service for Main Street
                </Pill>
                <Pill>
                  <Icon name="wrench" className="h-4 w-4" />
                  Built for working owners
                </Pill>
              </div>

              <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
                Industrial-speed quoting.
                <br />
                <span className="text-white/70">From photos to estimate drafts.</span>
              </h1>

              <p className="mt-6 max-w-2xl text-lg text-white/80">
                AI Photo Quote turns customer photos into a structured scope, estimate range, and follow-up questions —
                so you can respond fast, stay consistent, and close more jobs without living in your inbox.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="/sign-up"
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-extrabold text-gray-950 shadow-lg hover:bg-gray-100"
                >
                  Create account
                </a>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
                >
                  See the workflow
                </a>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                <Stat label="Speed" value="Seconds per draft" />
                <Stat label="Clarity" value="Scope + assumptions" />
                <Stat label="Control" value="You set final price" />
              </div>

              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
                {[
                  "Upholstery • Marine • Roofing • Paving • Remodeling",
                  "Branded owner alerts + customer receipts",
                  "Optional AI “after” concept render toggle",
                ].map((x) => (
                  <div key={x} className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
                    {x}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: graphical collage + “sample output” */}
            <div className="space-y-4">
              <div className="grid gap-4">
                <PhotoTile src={tile1} label="Job Photos" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
                  <PhotoTile src={tile2} label="Customer Intake" />
                  <PhotoTile src={tile3} label="Shop Workflow" />
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/35 p-5 backdrop-blur">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-extrabold text-white">Example AI Draft Output</div>
                  <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-extrabold text-white/80">
                    Preview
                  </span>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-4">
                  <div className="grid gap-3 text-sm text-white/85">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-semibold text-white/70">Confidence</div>
                      <div className="font-extrabold">High</div>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-semibold text-white/70">Inspection</div>
                      <div className="font-extrabold">Not required</div>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-semibold text-white/70">Estimate range</div>
                      <div className="font-extrabold">$1,250 – $1,950</div>
                    </div>
                    <Divider />
                    <div className="text-xs font-semibold text-white/60">Included:</div>
                    <div className="grid gap-2">
                      {["Scope summary", "Assumptions", "Follow-up questions"].map((x) => (
                        <div key={x} className="flex items-start gap-2">
                          <Icon name="check" className="mt-0.5 h-4 w-4 text-white" />
                          <span className="text-sm text-white/80">{x}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/75">
                    <Icon name="mail" className="h-4 w-4" /> Owner alert
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/75">
                    <Icon name="mail" className="h-4 w-4" /> Customer receipt
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* “logo strip” style divider */}
        <div className="relative border-t border-white/10 bg-black/65">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-white/55">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Upholstery</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Roofing</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Paving</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Remodeling</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Marine</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Specialty Trades</span>
            </div>
          </div>
        </div>
      </section>

      {/* ================= WHY IT EXISTS ================= */}
      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <div className="text-xs font-extrabold tracking-widest uppercase text-gray-500">The reality</div>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
                Most owners are still quoting at night.
              </h2>
              <p className="mt-4 text-lg text-gray-600">
                Wasted trips, slow responses, and inconsistent estimates cost you real money. This is the
                “digital estimator” your business should’ve had years ago.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <SteelCard
                  tone="steel"
                  icon={<Icon name="clock" />}
                  title="Faster response"
                  desc="Reply while the customer is still shopping — not tomorrow."
                />
                <SteelCard
                  tone="blueprint"
                  icon={<Icon name="chart" />}
                  title="Consistent drafts"
                  desc="Same quality output every time — with assumptions spelled out."
                />
              </div>
            </div>

            <div className="rounded-[34px] border border-gray-200 bg-gradient-to-b from-gray-50 to-white p-6 shadow-sm">
              <div className="text-sm font-extrabold text-gray-900">Before vs After</div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="text-xs font-extrabold text-gray-500 uppercase">Before</div>
                  <ul className="mt-3 space-y-2 text-sm text-gray-700">
                    {[
                      "Inbox chaos",
                      "Scope written from scratch",
                      "Pricing logic varies",
                      "Slow follow-up",
                    ].map((x) => (
                      <li key={x} className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-gray-300" />
                        <span>{x}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="text-xs font-extrabold text-gray-500 uppercase">After</div>
                  <ul className="mt-3 space-y-2 text-sm text-gray-700">
                    {[
                      "Structured lead record",
                      "AI scope + assumptions",
                      "Estimate range draft",
                      "Follow-ups generated",
                    ].map((x) => (
                      <li key={x} className="flex items-start gap-2">
                        <Icon name="check" className="mt-0.5 h-4 w-4 text-gray-900" />
                        <span>{x}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                <span className="font-extrabold">Owner-friendly AI:</span> no prompts, no tinkering — just a repeatable
                quoting workflow.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= HOW IT WORKS (graphical) ================= */}
      <section id="how-it-works" className="bg-gray-50 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-extrabold tracking-widest uppercase text-gray-500">The workflow</div>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
                A quoting pipeline that looks like work — not software.
              </h2>
              <p className="mt-4 max-w-3xl text-lg text-gray-600">
                Capture → Analyze → Review → Send. Each step produces something you can actually use.
              </p>
            </div>
            <a
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-6 py-3 text-sm font-extrabold text-white hover:opacity-90"
            >
              Create account <Icon name="arrow" className="h-4 w-4" />
            </a>
          </div>

          <div className="mt-10 rounded-[34px] border border-gray-200 bg-white p-6 shadow-sm">
            {/* Graphical pipeline */}
            <div className="grid gap-4 lg:grid-cols-4">
              {[
                { t: "1) Capture", d: "Customer uploads photos + quick details.", i: "camera" as const, tone: "steel" as const },
                { t: "2) Analyze", d: "AI generates scope, assumptions, range, questions.", i: "bolt" as const, tone: "blueprint" as const },
                { t: "3) Review", d: "You adjust/approve and progress the lead.", i: "check" as const, tone: "steel" as const },
                { t: "4) Send", d: "Owner alert + customer receipt. Optional render.", i: "mail" as const, tone: "olive" as const },
              ].map((s) => (
                <SteelCard
                  key={s.t}
                  tone={s.tone}
                  icon={<Icon name={s.i} />}
                  title={s.t}
                  desc={s.d}
                />
              ))}
            </div>

            <div className="mt-6 rounded-3xl border border-gray-200 bg-gradient-to-r from-gray-50 to-white p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-extrabold text-gray-900">What you get every time</div>
                  <div className="mt-1 text-sm text-gray-600">A repeatable output package you can send or refine.</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {["Scope", "Assumptions", "Estimate range", "Follow-ups", "Confidence flag"].map((x) => (
                    <span key={x} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700">
                      {x}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= FEATURE GRID (meat) ================= */}
      <section id="features" className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-xs font-extrabold tracking-widest uppercase text-gray-500">What’s inside</div>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
            Built like a tool — not a toy.
          </h2>
          <p className="mt-4 max-w-3xl text-lg text-gray-600">
            Everything here is designed to move jobs through your pipeline faster and cleaner.
          </p>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            <SteelCard
              tone="steel"
              icon={<Icon name="camera" />}
              title="Photo-first intake"
              desc="Optimized for real customer photos — not perfect studio shots."
            />
            <SteelCard
              tone="blueprint"
              icon={<Icon name="bolt" />}
              title="AI estimate drafts"
              desc="Consistent scope + assumptions + estimate ranges you can refine."
            />
            <SteelCard
              tone="olive"
              icon={<Icon name="shield" />}
              title="Confidence + inspection flag"
              desc="Know when you can quote remotely vs. when a site visit is required."
            />
            <SteelCard
              tone="steel"
              icon={<Icon name="mail" />}
              title="Automatic emails"
              desc="Owner alerts + customer receipts sent instantly with your branding."
            />
            <SteelCard
              tone="blueprint"
              icon={<Icon name="chart" />}
              title="Admin pipeline"
              desc="Stage leads, track follow-ups, and keep your quoting organized."
            />
            <SteelCard
              tone="olive"
              icon={<Icon name="wrench" />}
              title="Optional concept renders"
              desc="Help customers visualize the finished work — great for upgrades and higher-ticket jobs."
            />
          </div>
        </div>
      </section>

      {/* ================= INDUSTRIAL STRIP (graphic / photo) ================= */}
      <section className="relative overflow-hidden py-16">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('${stripImg}')` }}
        />
        <div className="absolute inset-0 bg-slate-950/80" />
        <svg className="absolute inset-0 h-full w-full opacity-[0.18]" aria-hidden="true">
          <defs>
            <pattern id="diag" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(25)">
              <path d="M0 9H18" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
              <path d="M0 9H18" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#diag)" />
        </svg>

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div className="text-white">
              <div className="text-xs font-extrabold tracking-widest uppercase text-white/60">
                AIaaS for service owners
              </div>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
                You don’t need “AI.” You need jobs to close.
              </h2>
              <p className="mt-4 text-lg text-white/75">
                AI Photo Quote runs behind the scenes like an estimator who never gets tired: consistent drafts,
                faster replies, cleaner records.
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                {["No prompt engineering", "Owner controls final price", "Optional renders", "Works across trades"].map((x) => (
                  <span key={x} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80">
                    {x}
                  </span>
                ))}
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="/sign-up"
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-extrabold text-gray-950 hover:bg-gray-100"
                >
                  Create account
                </a>
                <a
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Sign in
                </a>
              </div>
            </div>

            <div className="rounded-[34px] border border-white/10 bg-white/5 p-6 backdrop-blur">
              <div className="text-sm font-extrabold text-white">“Owner language” marketing, not tech-speak</div>
              <div className="mt-4 grid gap-3">
                {[
                  ["Fewer wasted trips", "Confidence flag tells you when a visit is needed."],
                  ["Faster replies", "Send a clean draft while competitors are still “getting back to them.”"],
                  ["More consistency", "Same structure every estimate — easier to scale."],
                ].map(([t, d]) => (
                  <div key={t} className="rounded-3xl border border-white/10 bg-black/25 p-4">
                    <div className="text-sm font-extrabold text-white">{t}</div>
                    <div className="mt-1 text-sm text-white/75">{d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= PRICING (simple placeholder) ================= */}
      <section id="pricing" className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-extrabold tracking-widest uppercase text-gray-500">Pricing</div>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
                Simple tiers. Built for real shops.
              </h2>
              <p className="mt-4 max-w-3xl text-lg text-gray-600">
                Placeholder tiers for now — we’ll wire billing to your real SaaS plans next.
              </p>
            </div>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            <SteelCard tone="steel" icon={<Icon name="check" />} title="Starter" desc="$0 — prove the workflow." />
            <SteelCard tone="blueprint" icon={<Icon name="bolt" />} title="Pro" desc="$29 — best for most shops." />
            <SteelCard tone="olive" icon={<Icon name="shield" />} title="Scale" desc="$79 — higher volume & teams." />
          </div>

          <div className="mt-8 rounded-[34px] border border-gray-200 bg-gray-50 p-8 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-2xl font-extrabold tracking-tight text-gray-900">
                  Put quoting on autopilot this week.
                </div>
                <div className="mt-1 text-sm text-gray-600">
                  Create an account, publish your intake link, and start capturing photo-based leads.
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
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-white pb-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="border-t border-gray-200 pt-8">
            <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
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
          </div>
        </div>
      </footer>
    </div>
  );
}