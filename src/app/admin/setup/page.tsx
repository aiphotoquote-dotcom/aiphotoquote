import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function Card(props: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <Link
      href={props.href}
      className="group rounded-2xl border border-gray-200 bg-white p-6 transition
                 hover:border-gray-900 hover:bg-gray-50
                 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-white dark:hover:bg-gray-900"
    >
      <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {props.title}
      </div>
      <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
        {props.description}
      </div>
      <div className="mt-4 text-sm font-semibold text-gray-900 underline underline-offset-4
                      dark:text-gray-100">
        {props.cta} →
      </div>
    </Link>
  );
}

export default async function AdminSetupPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-12 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Setup</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            Configure how AI Photo Quote works for your tenant.
          </p>
        </div>

        {/* Setup cards */}
        <div className="grid gap-6 sm:grid-cols-2">
          <Card
            title="AI Policy"
            description="Control AI behavior, pricing logic, and rendering rules for this tenant."
            href="/admin/setup/ai-policy"
            cta="Configure AI policy"
          />

          <Card
            title="Widgets"
            description="Embed AI Photo Quote on your website using buttons, iframes, or popups."
            href="/admin/setup/widget"
            cta="View widget options"
          />
        </div>

        {/* Future-proof note */}
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6
                        dark:border-gray-700 dark:bg-gray-950">
          <div className="text-sm font-semibold">Coming next</div>
          <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-1">
            <li>Industry & sub-industry configuration</li>
            <li>Per-industry AI prompting</li>
            <li>Advanced rendering controls</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
