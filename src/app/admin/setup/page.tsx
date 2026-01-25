// src/app/admin/setup/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function SetupCard(props: {
  title: string;
  subtitle: string;
  href: string;
  badge?: string;
}) {
  return (
    <Link
      href={props.href}
      className={cn(
        "group rounded-3xl border border-gray-200 bg-white p-6 shadow-sm transition",
        "hover:-translate-y-0.5 hover:shadow-md hover:border-gray-300",
        "dark:border-gray-800 dark:bg-gray-950 dark:hover:border-gray-700"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-gray-900 dark:text-white">
            {props.title}
          </div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {props.subtitle}
          </div>
        </div>

        {props.badge ? (
          <span className="shrink-0 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-white/5 dark:text-gray-200">
            {props.badge}
          </span>
        ) : null}
      </div>

      <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-gray-800 group-hover:underline dark:text-gray-100">
        Open <span aria-hidden>→</span>
      </div>
    </Link>
  );
}

export default async function AdminSetupHubPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">AI Setup</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            Configure your AI behavior and publish widgets for your tenant’s quote page.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <SetupCard
            title="AI Policy"
            subtitle="Control AI mode, rendering rules, daily limits, and customer opt-in behavior."
            href="/admin/setup/ai-policy"
            badge="Required"
          />

          <SetupCard
            title="Widgets"
            subtitle="Copy/paste embed code (link, iframe, popup) to publish your quote form anywhere."
            href="/admin/setup/widget"
            badge="Go live"
          />
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-6 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
          Tip: After setup, run one end-to-end test (estimate + optional render) to validate the full tenant experience.
        </div>
      </div>
    </main>
  );
}