// src/app/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { userId } = await auth();

  // ✅ Signed in users go straight to the new centerpiece dashboard
  if (userId) redirect("/admin");

  // ✅ Otherwise: marketing home
  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-black dark:bg-white" />
            AI Photo Quote
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/sign-in"
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
            >
              Get started
            </Link>
          </div>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Instant photo quotes for service businesses.
            </h1>
            <p className="mt-4 text-lg text-gray-700 dark:text-gray-300">
              Customers upload photos. You get a clean lead, an AI-assisted estimate range, and an option
              for AI rendering — all in one workflow.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/sign-up"
                className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Create an account
              </Link>
              <Link
                href="/q/demo"
                className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-800 dark:bg-black dark:text-gray-100 dark:hover:bg-gray-900"
              >
                View demo quote form
              </Link>
            </div>

            <div className="mt-8 grid gap-3 text-sm text-gray-700 dark:text-gray-300">
              <div className="flex gap-3">
                <div className="mt-2 h-2 w-2 rounded-full bg-black dark:bg-white" />
                <p>
                  <span className="font-semibold">Fast intake:</span> photo upload + notes + contact info.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="mt-2 h-2 w-2 rounded-full bg-black dark:bg-white" />
                <p>
                  <span className="font-semibold">Clean admin:</span> quotes list, stages, and a polished detail view.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="mt-2 h-2 w-2 rounded-full bg-black dark:bg-white" />
                <p>
                  <span className="font-semibold">Optional rendering:</span> customer opt-in supported per tenant.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-gray-50 p-8 shadow-sm dark:border-gray-800 dark:bg-gray-950">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              How it works
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black">
                <div className="text-sm font-semibold">1) Customer submits photos</div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  Wide + close-up recommended. Notes help accuracy.
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black">
                <div className="text-sm font-semibold">2) AI suggests estimate range</div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  Includes assumptions + questions when needed.
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-black">
                <div className="text-sm font-semibold">3) Admin follows up</div>
                <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  Track stage, mark read, render on demand, and convert to a quoted job.
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between rounded-2xl bg-black px-5 py-4 text-white dark:bg-white dark:text-black">
              <div>
                <div className="text-sm font-semibold">Ready to try it?</div>
                <div className="text-xs opacity-80">Sign up and get your first tenant going.</div>
              </div>
              <Link
                href="/sign-up"
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-90 dark:bg-black dark:text-white"
              >
                Start →
              </Link>
            </div>
          </div>
        </div>

        <footer className="mt-16 border-t border-gray-200 pt-8 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          © {new Date().getFullYear()} AI Photo Quote. All rights reserved.
        </footer>
      </div>
    </main>
  );
}