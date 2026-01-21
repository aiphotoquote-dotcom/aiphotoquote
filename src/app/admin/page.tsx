// src/app/admin/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Card({
  title,
  description,
  href,
  cta,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition",
        "hover:shadow-md hover:border-gray-300",
        "dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
      )}
    >
      <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</div>
      <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{description}</div>
      <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {cta}
        <span aria-hidden>→</span>
      </div>
    </Link>
  );
}

export default async function AdminDashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Manage inbound leads, review quotes, and configure your tenant.
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card
            title="Quotes"
            description="Review new leads, mark stages, and open details."
            href="/admin/quotes"
            cta="Open quotes"
          />
          <Card
            title="Settings"
            description="Edit tenant settings and operational preferences."
            href="/admin/settings"
            cta="Open settings"
          />
          <Card
            title="Setup"
            description="Finish onboarding steps and configure integrations."
            href="/admin/setup"
            cta="Open setup"
          />
        </div>
      </div>
    </main>
  );
}