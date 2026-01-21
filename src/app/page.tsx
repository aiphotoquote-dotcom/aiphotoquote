// src/app/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import MarketingTopNav from "@/components/marketing/MarketingTopNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { userId } = await auth();

  // Signed-in users go straight to the centerpiece
  if (userId) redirect("/admin");

  // Signed-out users see marketing
  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <MarketingTopNav />

      {/* Minimal marketing scaffold (you can replace sections anytime) */}
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <section className="py-10">
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            Instant photo-based estimates for service businesses.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-gray-600 dark:text-gray-300">
            Customers upload photos. You get a structured scope, estimate range, and (optionally) an AI render of the finished work.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/sign-in"
              className="inline-flex rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Sign in
            </a>
            <a
              href="#features"
              className="inline-flex rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
            >
              See features
            </a>
          </div>
        </section>

        <section id="features" className="py-10">
          <h2 className="text-2xl font-bold">Features</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Lead capture", "Turn photos into a quote-ready lead record."],
              ["AI estimate", "Consistent scope + estimate ranges."],
              ["Rendering (optional)", "Show a “finished product” concept render."],
              ["Multi-tenant SaaS", "Per-tenant branding, routing, and settings."],
              ["Admin workflow", "Stage, read/unread, and follow-ups."],
              ["Portable architecture", "Provider-agnostic user layer + clean boundaries."],
            ].map(([title, desc]) => (
              <div
                key={title}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-black"
              >
                <div className="text-sm font-semibold">{title}</div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="py-10">
          <h2 className="text-2xl font-bold">Pricing</h2>
          <p className="mt-2 text-gray-600 dark:text-gray-300">
            (Placeholder — we’ll wire this to your real SaaS tiers next.)
          </p>
        </section>

        <section id="how-it-works" className="py-10">
          <h2 className="text-2xl font-bold">How it works</h2>
          <ol className="mt-4 grid gap-3 text-sm text-gray-700 dark:text-gray-300">
            <li>1) Customer uploads photos</li>
            <li>2) AI creates a structured assessment + estimate range</li>
            <li>3) Admin reviews in dashboard + progresses stage</li>
            <li>4) Optional render produced for customer-facing concept</li>
          </ol>
        </section>
      </main>
    </div>
  );
}