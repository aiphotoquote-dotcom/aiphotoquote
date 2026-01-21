// src/app/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import MarketingTopNav from "@/components/marketing/MarketingTopNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { userId } = await auth();

  // If already signed in, take them to the new centerpiece dashboard (/admin)
  if (userId) redirect("/admin");

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100">
      <MarketingTopNav />

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          <div>
            <p className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-200">
              AI Photo Quote • Multi-tenant SaaS
            </p>

            <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
              Turn customer photos into{" "}
              <span className="text-gray-900 dark:text-white">fast, consistent quotes</span>.
            </h1>

            <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
              Capture photos, generate an estimate, and manage leads in a clean admin workflow —
              built for mobility and scale.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href="/sign-up"
                className="inline-flex items-center justify-center rounded-lg bg-black px-5 py-3 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Get started
              </a>

              <a
                href="/#how-it-works"
                className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
              >
                See how it works
              </a>
            </div>

            <div className="mt-6 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1 dark:border-gray-800 dark:bg-black">
                Lead inbox
              </span>
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1 dark:border-gray-800 dark:bg-black">
                Email routing
              </span>
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1 dark:border-gray-800 dark:bg-black">
                Tenant controls
              </span>
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1 dark:border-gray-800 dark:bg-black">
                Optional rendering
              </span>
            </div>
          </div>

          {/* RIGHT SIDE "product preview" */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-black">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Admin Dashboard</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Live metrics</div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-xs text-gray-500 dark:text-gray-400">New leads</div>
                <div className="mt-2 text-2xl font-extrabold">24</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Last 7 days</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-xs text-gray-500 dark:text-gray-400">Quoted</div>
                <div className="mt-2 text-2xl font-extrabold">9</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Last 7 days</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-xs text-gray-500 dark:text-gray-400">Avg response</div>
                <div className="mt-2 text-2xl font-extrabold">12m</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Median</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
                <div className="text-xs text-gray-500 dark:text-gray-400">Rendering</div>
                <div className="mt-2 text-2xl font-extrabold">On</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">Per-tenant</div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-black">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                Workflow snapshot
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-semibold text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
                  New
                </span>
                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 font-semibold text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-200">
                  Estimate
                </span>
                <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 font-semibold text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200">
                  Quoted
                </span>
                <span className="rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1 font-semibold text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
                  Closed
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="border-t border-gray-200 dark:border-gray-800">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight">Built for speed and scale</h2>
          <p className="mt-3 max-w-2xl text-gray-600 dark:text-gray-300">
            Mobility-first UX, tenant isolation, and clean APIs — so this can be sold, transferred,
            and scaled without rework.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Lead inbox",
                desc: "A focused list view with workflow stages, read status, and quick actions.",
              },
              {
                title: "Tenant-ready",
                desc: "Per-tenant settings, email routing, and rendering controls.",
              },
              {
                title: "Email pipeline",
                desc: "Operational status visibility for sender setup + routing readiness.",
              },
              {
                title: "Admin workflow",
                desc: "Stages that match the business: new → estimate → quoted → closed.",
              },
              {
                title: "Optional rendering",
                desc: "Offer rendering when enabled, without forcing it on every tenant.",
              },
              {
                title: "Portable architecture",
                desc: "Clear seams between auth identity, app users, tenant membership, and billing.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-black"
              >
                <div className="text-sm font-semibold">{f.title}</div>
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="border-t border-gray-200 dark:border-gray-800">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight">How it works</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              { n: "1", t: "Customer submits photos", d: "Simple intake form with images + context." },
              { n: "2", t: "Estimate generated", d: "Consistent structure and language every time." },
              { n: "3", t: "You close the deal", d: "Move leads through stages and keep momentum." },
            ].map((s) => (
              <div
                key={s.n}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-black"
              >
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Step {s.n}</div>
                <div className="mt-2 text-lg font-extrabold">{s.t}</div>
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{s.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="border-t border-gray-200 dark:border-gray-800">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight">Pricing</h2>
              <p className="mt-2 text-gray-600 dark:text-gray-300">
                Start simple. Scale when you’re ready.
              </p>
            </div>
            <a
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-lg bg-black px-5 py-3 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Create your account
            </a>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              { title: "Starter", price: "$", desc: "Perfect for solo shops.", bullets: ["Lead inbox", "Email routing", "Basic metrics"] },
              { title: "Pro", price: "$$", desc: "Best for growing teams.", bullets: ["Multi-tenant", "Stage workflow", "Rendering controls"] },
              { title: "Scale", price: "$$$", desc: "For serious volume.", bullets: ["Advanced reporting", "Higher limits", "Priority support"] },
            ].map((p) => (
              <div
                key={p.title}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-black"
              >
                <div className="flex items-baseline justify-between">
                  <div className="text-lg font-extrabold">{p.title}</div>
                  <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">{p.price}</div>
                </div>
                <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{p.desc}</div>
                <ul className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-200">
                  {p.bullets.map((b) => (
                    <li key={b} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-black dark:bg-white" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-gray-200 dark:border-gray-800">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              © {new Date().getFullYear()} AI Photo Quote
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <a href="/#features" className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white">
                Features
              </a>
              <span className="text-gray-300 dark:text-gray-700">•</span>
              <a href="/#pricing" className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white">
                Pricing
              </a>
              <span className="text-gray-300 dark:text-gray-700">•</span>
              <a href="/sign-in" className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white">
                Sign in
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}