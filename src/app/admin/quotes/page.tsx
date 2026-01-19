import TopNav from "@/components/TopNav";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function fmtDate(v: unknown) {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function pill(label: string, tone: "gray" | "green" | "yellow" | "red" | "blue" = "gray") {
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : tone === "yellow"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          : tone === "blue"
            ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200"
            : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

  return <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cls)}>{label}</span>;
}

function statusTone(renderStatus: string) {
  const s = (renderStatus || "").toLowerCase();
  if (s === "rendered") return "green" as const;
  if (s === "failed") return "red" as const;
  if (s === "queued" || s === "running") return "blue" as const;
  return "gray" as const;
}

function statusLabel(renderStatus: string, renderOptIn?: boolean | null) {
  const s = (renderStatus || "not_requested").toLowerCase();
  if (s === "rendered") return "Rendered";
  if (s === "failed") return "Render failed";
  if (s === "queued" || s === "running") return "Rendering";
  if (renderOptIn) return "Render requested";
  return "Estimate";
}

export default async function AdminQuotesPage() {
  const session = await auth();
  if (!session?.userId) redirect("/sign-in");

  const rows = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      renderOptIn: quoteLogs.renderOptIn,
      renderStatus: quoteLogs.renderStatus,
    })
    .from(quoteLogs)
    .orderBy(desc(quoteLogs.createdAt))
    .limit(50);

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Admin · Quotes</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Latest submissions across tenants.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600 dark:bg-gray-950 dark:text-gray-300">
            <div className="col-span-3">Created</div>
            <div className="col-span-6">Quote ID</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1 text-right"> </div>
          </div>

          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {rows.map((q) => {
              const label = statusLabel(String(q.renderStatus || "not_requested"), q.renderOptIn);
              const tone = statusTone(String(q.renderStatus || "not_requested"));

              return (
                <li key={q.id} className="grid grid-cols-12 items-center px-4 py-3">
                  <div className="col-span-3 text-sm text-gray-800 dark:text-gray-200">
                    {fmtDate(q.createdAt)}
                  </div>

                  <div className="col-span-6 font-mono text-xs text-gray-700 dark:text-gray-300 break-all">
                    {q.id}
                  </div>

                  <div className="col-span-2">{pill(label, tone)}</div>

                  <div className="col-span-1 flex justify-end">
                    {/* ✅ CRITICAL: must match /admin/quotes/[id] */}
                    <Link
                      href={`/admin/quotes/${q.id}`}
                      className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                    >
                      Review
                    </Link>
                  </div>
                </li>
              );
            })}

            {!rows.length ? (
              <li className="px-4 py-10 text-sm text-gray-600 dark:text-gray-300">No quotes found yet.</li>
            ) : null}
          </ul>
        </div>
      </div>
    </main>
  );
}
