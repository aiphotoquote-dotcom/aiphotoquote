// src/app/admin/setup/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Tile(props: { title: string; subtitle: string; href: string }) {
  return (
    <Link
      href={props.href}
      className={cn(
        "rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition",
        "hover:bg-gray-50 dark:border-gray-800 dark:bg-neutral-950/40 dark:hover:bg-white/5"
      )}
    >
      <div className="text-sm font-semibold text-gray-900 dark:text-white">{props.title}</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{props.subtitle}</div>
      <div className="mt-3 text-xs font-semibold text-blue-700 dark:text-blue-300">Open →</div>
    </Link>
  );
}

export default async function AdminSetupHubPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Setup</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Configure the tenant experience. This hub prevents /admin/setup from redirecting.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Tile
          title="AI Policy"
          subtitle="Controls AI behavior, rendering opt-in, and guardrails."
          href="/admin/setup/ai-policy"
        />

        <Tile
          title="LLM Settings"
          subtitle="Tenant overrides for models + prompts (guardrails are platform-locked)."
          href="/admin/setup/llm"
        />

        <Tile
          title="Widgets"
          subtitle="Get embed code and button options for your website."
          href="/admin/setup/widget"
        />

        <Tile
          title="Sub-industries"
          subtitle="View available sub-industries for the tenant’s industry (read-only)."
          href="/admin/setup/sub-industries"
        />
      </div>
    </div>
  );
}