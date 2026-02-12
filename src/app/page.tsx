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

function Icon({ name, className }: { name: "bolt" | "camera" | "wand" | "mail" | "check" | "spark"; className?: string }) {
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
  }
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ai" | "success";
}) {
  const toneClass =
    tone === "ai"
      ? "border-indigo-400/30 bg-indigo-400/10 text-indigo-100"
      : tone === "success"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
      : "border-white/10 bg-white/5 text-white/80";
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold backdrop-blur", toneClass)}>
      {children}
    </span>
  );
}

function TinyStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <div className="text-xs font-semibold text-white/60">{k}</div>
      <div className="mt-1 text-sm font-extrabold text-white">{v}</div>
    </div>
  );
}

export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/admin");

  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <MarketingTopNav />

      {/* HERO — “big product energy”, cleaner + more premium than the last attempt */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          {/* aurora */}
          <div className="absolute -top-40 left-1/2 h-[520px] w-[980px] -translate-x-1/2 rounded-full bg-gradient-to-r from-indigo-500/25 via-sky-400/20 to-emerald-400/20 blur-3xl" />
          <div className="absolute -bottom-56 left-1/2 h-[520px] w-[980px] -translate-x-1/2 rounded-full bg-gradient-to-r from-violet-500/20 via-fuchsia-400/15 to-amber-300/10 blur-3xl" />
          {/* subtle grid */}
          <div className="absolute inset-0 opacity-[0.28] [background-image:linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:56px_56px]" />
          {/* vignette */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/60 to-black/90" />
        </div>

        <div className="mx-auto max-w-6xl px-4 pt-10 pb-14 sm:px-6 sm:pt-12 sm:pb-20">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
            {/* left */}
            <div className="pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="ai">
                  <Icon name="spark" className="h-4 w-4" />
                  AI-Powered
                </Pill>
                <Pill tone="success">
                  <span className="h-2 w-2 rounded-full bg-emerald-300" />
                  Built for small service businesses
                </Pill>
                <Pill>Photos → Estimate → Close</Pill>
              </div>

              <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-6xl">
                Quote jobs from photos —{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-300 via-indigo-300 to-emerald-300">
                  instantly
                </span>
                .
              </h1>

              <p className="mt-5 max-w-xl text-lg text-white/80">
                Customers upload photos and answer a few quick questions. AI generates a quote-ready scope summary,
                estimate range, and smart follow-ups. Optional “after” concept renderings help you win bigger jobs.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <a
                  href="/sign-in"
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 text-sm font-extrabold text-black shadow-sm hover:opacity-90"
                >
                  Start free
                </a>
                <a
                  href="#features"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white/90 hover:bg-white/10"
                >
                  Explore features
                </a>
              </div>

              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                <TinyStat k="Speed" v="Quote-ready drafts in seconds" />
                <TinyStat k="Waste" v="Fewer “tire-kicker” trips" />
                <TinyStat k="Win" v="Faster replies = more closes" />
              </div>

              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
                {[
                  "Upholstery • Marine • Roofing • Paving • Remodeling",
                  "Branded lead + customer receipt emails",
                  "Optional AI “after” render toggle",
                ].map((x) => (
                  <div key={x} className="inline-flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
                    {x}
                  </div>
                ))}
              </div>
            </div>

            {/* right: stacked “output cards” (cleaner than faux app window) */}
            <div className="relative">
              <div className="rounded-[30px] border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-extrabold tracking-tight">What you get</div>
                  <div className="text-xs font-semibold text-white/60">Example AI output</div>
                </div>

                <div className="mt-4 grid gap-3">
                  {/* Card 1 */}
                  <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white/85">
                      <Icon name="camera" className="h-4 w-4" />
                      Customer photos & context
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="aspect-square rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5" />
                      ))}
                    </div>
                    <div className="mt-3 text-xs text-white/60">Upload → AI reads the job → output</div>
                  </div>

                  {/* Card 2 */}
                  <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white/85">Structured scope summary</div>
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-extrabold text-emerald-100">
                        Confidence: High
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs font-semibold text-white/60">Scope</div>
                        <div className="mt-2 text-sm text-white/75">
                          Quote-ready description of what’s visible, what’s likely, and what needs confirmation.
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-white/80">
                          {["Visible scope", "Assumptions", "Follow-up questions"].map((x) => (
                            <div key={x} className="flex items-start gap-2">
                              <Icon name="check" className="mt-0.5 h-4 w-4 text-white" />
                              <span>{x}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs font-semibold text-white/60">Estimate range</div>
                        <div className="mt-2 text-3xl font-extrabold tracking-tight">$1,250 – $1,950</div>
                        <div className="mt-1 text-xs text-white/60">Includes inspection flag + confidence</div>
                        <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-3">
                          <div className="text-xs font-semibold text-white/60">Inspection required</div>
                          <div className="mt-1 text-sm font-extrabold text-white">No</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card 3 */}
                  <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white/85">
                        <Icon name="mail" className="h-4 w-4" />
                        Automatic branded emails
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/70">
                        Owner + customer receipt
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {[
                        ["Owner lead alert", "New lead arrives with photos and AI summary."],
                        ["Customer receipt", "Branded confirmation keeps you top-of-mind."],
                      ].map(([t, d]) => (
                        <div key={t} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <div className="text-sm font-extrabold">{t}</div>
                          <div className="mt-1 text-sm text-white/70">{d}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Card 4 */}
                  <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white/85">
                        <Icon name="wand" className="h-4 w-4" />
                        Optional AI “after” concept render
                      </div>
                      <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-extrabold text-sky-100">
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

              {/* floating CTA card */}
              <div className="absolute -bottom-8 left-6 right-6 rounded-[26px] border border-white/10 bg-gradient-to-r from-white/10 to-white/5 p-4 shadow-2xl backdrop-blur">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-xs font-semibold text-white/60">Owner outcome</div>
                    <div className="text-sm font-extrabold">Respond faster. Win more jobs.</div>
                  </div>
                  <a
                    href="/sign-in"
                    className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-2.5 text-sm font-extrabold text-black hover:opacity-90"
                  >
                    Start free
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* spacing for floating card */}
          <div className="h-10 sm:h-14" />
        </div>
      </section>

      {/* “Owner pain” strip (clean + simple) */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-4 rounded-[34px] border border-white/10 bg-white/5 p-6 backdrop-blur sm:p-8 lg:grid-cols-3">
          {[
            ["Stop quoting at night", "AI produces a quote-ready draft so you can focus on paid work."],
            ["Reduce wasted site visits", "Confidence + inspection flagging helps you pick your battles."],
            ["Look more professional", "Branded receipts and structured scope builds trust fast."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-[28px] border border-white/10 bg-black/30 p-6">
              <div className="text-sm font-extrabold">{t}</div>
              <div className="mt-2 text-sm text-white/70">{d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS — minimal + elegant */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">How it works</h2>
            <p className="mt-2 max-w-2xl text-white/70">A simple loop you’ll use every day.</p>
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
            { t: "1) Capture", d: "Customer uploads photos + quick details.", i: "camera" as const },
            { t: "2) Analyze", d: "AI generates scope, assumptions, and questions.", i: "bolt" as const },
            { t: "3) Review", d: "You adjust and progress the lead in your admin.", i: "check" as const },
            { t: "4) Close", d: "Send quickly. Optional renders help upsell.", i: "wand" as const },
          ].map((s) => (
            <div key={s.t} className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/30">
                <Icon name={s.i} className="h-5 w-5" />
              </div>
              <div className="mt-4 text-sm font-extrabold">{s.t}</div>
              <div className="mt-2 text-sm text-white/70">{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES — tighter, more “product-led” */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="rounded-[34px] border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-7 backdrop-blur sm:p-10">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight">Everything you need to quote faster</h2>
              <p className="mt-2 max-w-2xl text-white/70">
                Built for owners who want speed, clarity, and fewer headaches.
              </p>
            </div>
            <Pill tone="ai">
              <Icon name="spark" className="h-4 w-4" />
              AI-first workflow
            </Pill>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Instant AI estimate drafts", "Scope + range + questions generated in seconds."],
              ["Confidence & inspection flag", "Know when to quote remotely vs. schedule a visit."],
              ["Assumptions included", "Avoid surprises by tracking unknowns explicitly."],
              ["Branded emails automatically", "Owner alert + customer receipt every time."],
              ["Optional “after” concept render", "Help customers visualize and upsell."],
              ["Simple admin workflow", "Stages, read/unread, notes, and follow-ups."],
              ["Photo-first intake", "Designed for real-world, imperfect photos."],
              ["Business settings", "Control categories, routing, and AI behavior."],
              ["SaaS-grade foundation", "Clean, scalable platform architecture."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-[28px] border border-white/10 bg-black/30 p-6 shadow-xl shadow-black/20">
                <div className="text-sm font-extrabold">{t}</div>
                <div className="mt-2 text-sm text-white/70">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING — still placeholder but polished */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="text-3xl font-extrabold tracking-tight">Pricing</h2>
        <p className="mt-2 max-w-2xl text-white/70">
          Placeholder tiers — wire to your real billing when ready.
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {[
            {
              name: "Starter",
              price: "$0",
              note: "Try it and prove the workflow.",
              primary: false,
              items: ["AI estimate drafts", "Lead capture page", "Basic admin workflow", "Email receipts"],
              cta: "Start free",
            },
            {
              name: "Pro",
              price: "$29",
              note: "Best for most shops.",
              primary: true,
              items: ["Everything in Starter", "Better questions + structure", "More settings & control", "Cleaner workflow"],
              cta: "Choose Pro",
            },
            {
              name: "Scale",
              price: "$79",
              note: "Higher volume and teams.",
              primary: false,
              items: ["Everything in Pro", "Optional AI concept render", "More customization", "Team workflows"],
              cta: "Choose Scale",
            },
          ].map((p) => (
            <div
              key={p.name}
              className={cx(
                "rounded-[34px] border p-7 backdrop-blur",
                p.primary
                  ? "border-indigo-400/30 bg-gradient-to-b from-indigo-400/12 to-white/5 shadow-2xl shadow-indigo-500/10"
                  : "border-white/10 bg-white/5"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-extrabold">{p.name}</div>
                {p.primary ? (
                  <span className="rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs font-extrabold text-indigo-100">
                    Most popular
                  </span>
                ) : null}
              </div>

              <div className="mt-3 text-5xl font-extrabold tracking-tight">{p.price}</div>
              <div className="mt-2 text-sm text-white/70">{p.note}</div>

              <ul className="mt-6 space-y-3 text-sm text-white/75">
                {p.items.map((x) => (
                  <li key={x} className="flex items-start gap-2">
                    <Icon name="check" className="mt-0.5 h-4 w-4 text-white" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>

              <a
                href="/sign-in"
                className={cx(
                  "mt-7 inline-flex w-full items-center justify-center rounded-2xl px-6 py-3 text-sm font-extrabold",
                  p.primary ? "bg-white text-black hover:opacity-90" : "border border-white/15 bg-white/5 text-white/90 hover:bg-white/10"
                )}
              >
                {p.cta}
              </a>

              <div className="mt-3 text-xs text-white/50">(Placeholder pricing)</div>
            </div>
          ))}
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