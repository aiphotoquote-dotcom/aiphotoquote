import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs } from "@/lib/db/schema";

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

function pickCustomer(input: any): { name: string; phone: string; email: string } {
  const c = input?.customer ?? input?.customer_context ?? input?.contact ?? input ?? {};
  const name =
    String(c?.name ?? c?.full_name ?? c?.fullName ?? c?.customer_name ?? c?.customerName ?? "")
      .trim() || "New customer";

  const phone =
    String(c?.phone ?? c?.phone_number ?? c?.phoneNumber ?? c?.mobile ?? "")
      .trim() || "";

  const email =
    String(c?.email ?? c?.email_address ?? c?.emailAddress ?? "")
      .trim() || "";

  return { name, phone, email };
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
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

function stagePill(stageRaw: unknown) {
  const s = String(stageRaw ?? "new").toLowerCase();
  if (s === "new") return pill("New", "blue");
  if (s === "open") return pill("Open", "gray");
  if (s === "in_progress") return pill("In progress", "yellow");
  if (s === "sent") return pill("Sent", "green");
  if (s === "closed") return pill("Closed", "gray");
  return pill(s, "gray");
}

function renderPill(statusRaw: unknown) {
  const s = String(statusRaw ?? "").toLowerCase();
  if (s === "rendered") return pill("Rendered", "green");
  if (s === "failed") return pill("Render failed", "red");
  if (s === "queued" || s === "running") return pill("Rendering", "blue");
  return pill("Estimate", "gray");
}

export default async function AdminQuotesPage() {
  const { userId } = await auth();
  if (!userId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">You must be signed in.</p>
          <div className="mt-6">
            <Link className="underline" href="/sign-in">
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const jar = await cookies();
  const tenantId = getCookieTenantId(jar);

  if (!tenantId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quotes</h1>
          <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
            No active tenant selected. Go to{" "}
            <Link className="underline" href="/onboarding">
              Settings
            </Link>{" "}
            and make sure your tenant is created/selected.
          </div>
        </div>
      </main>
    );
  }

  const rows = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      renderStatus: quoteLogs.renderStatus,
      renderOptIn: quoteLogs.renderOptIn,

      // NEW fields (must exist in schema + DB)
      isRead: (quoteLogs as any).isRead,
      stage: (quoteLogs as any).stage,
      readAt: (quoteLogs as any).readAt,
    })
    .from(quoteLogs)
    .where(eq(quoteLogs.tenantId, tenantId))
    .orderBy(desc(quoteLogs.createdAt))
    .limit(50);

  const mapped = rows.map((r: any) => {
    const c = pickCustomer(r.input);
    const isRead = Boolean(r.isRead);
    const stage = String(r.stage ?? "new");
    return { ...r, customer: c, isRead, stage };
  });

  const unreadCount = mapped.filter((r) => !r.isRead).length;

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Quotes</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Latest requests for the active tenant.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {pill(`${mapped.length} total`, "gray")}
              {unreadCount ? pill(`${unreadCount} unread`, "blue") : pill("All read", "green")}
            </div>
          </div>

          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Back to dashboard
          </Link>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
          <div className="grid grid-cols-12 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            <div className="col-span-4">Customer</div>
            <div className="col-span-3">Created</div>
            <div className="col-span-3">Status</div>
            <div className="col-span-2 text-right">Action</div>
          </div>

          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {mapped.length ? (
              mapped.map((q: any) => (
                <li key={q.id} className={cn("px-4 py-3", q.isRead ? "" : "bg-blue-50/40 dark:bg-blue-950/20")}>
                  <div className="grid grid-cols-12 items-center gap-3">
                    <div className="col-span-4">
                      <div className="flex items-center gap-2">
                        <div className={cn("text-sm font-semibold", q.isRead ? "text-gray-900 dark:text-gray-100" : "text-blue-900 dark:text-blue-100")}>
                          {q.customer.name}
                        </div>
                        {!q.isRead ? <span className="inline-block h-2 w-2 rounded-full bg-blue-600" /> : null}
                      </div>
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        {q.customer.phone ? <span className="font-mono">{q.customer.phone}</span> : <span className="italic">No phone</span>}
                        {q.customer.email ? <span className="ml-2">· {q.customer.email}</span> : null}
                      </div>
                    </div>

                    <div className="col-span-3 text-sm text-gray-800 dark:text-gray-200">
                      {q.createdAt ? new Date(q.createdAt).toLocaleString() : "—"}
                    </div>

                    <div className="col-span-3 flex flex-wrap items-center gap-2">
                      {stagePill(q.stage)}
                      {renderPill(q.renderStatus)}
                      {q.renderOptIn ? pill("Opt-in", "yellow") : null}
                    </div>

                    <div className="col-span-2 flex justify-end">
                      <Link
                        href={`/admin/quotes/${q.id}`}
                        className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                      >
                        Open
                      </Link>
                    </div>
                  </div>

                  {/* de-emphasized technical id (still available) */}
                  <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 font-mono">
                    {q.id}
                  </div>
                </li>
              ))
            ) : (
              <li className="px-4 py-6 text-sm text-gray-600 dark:text-gray-300">No quotes yet.</li>
            )}
          </ul>
        </div>
      </div>
    </main>
  );
}
