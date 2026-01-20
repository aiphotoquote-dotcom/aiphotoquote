import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];

  return candidates[0] || null;
}

function fmtWhen(d: Date | string | null | undefined) {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return String(d);
  return x.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function money(n: unknown) {
  const x = typeof n === "number" ? n : n == null ? null : Number(n);
  if (x == null || Number.isNaN(x)) return "";
  return x.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function pickString(obj: any, paths: string[]) {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    for (const part of parts) cur = cur?.[part];
    if (typeof cur === "string" && cur.trim()) return cur.trim();
  }
  return "";
}

function pickNumber(obj: any, paths: string[]) {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    for (const part of parts) cur = cur?.[part];
    const n = typeof cur === "number" ? cur : cur == null ? NaN : Number(cur);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeStatus(renderStatusRaw: unknown) {
  const s = String(renderStatusRaw ?? "").toLowerCase();
  if (s === "rendered") return { label: "Rendered", tone: "green" as const };
  if (s === "failed") return { label: "Render failed", tone: "red" as const };
  if (s === "queued" || s === "running") return { label: "Rendering", tone: "blue" as const };
  return { label: "Estimate", tone: "gray" as const };
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

  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

export default async function AdminQuotesPage() {
  const { userId } = await auth();
  if (!userId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
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
  let tenantId = getCookieTenantId(jar);

  // Fallback: if cookie isn't set, use the tenant owned by this user
  if (!tenantId) {
    const t = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.ownerClerkUserId, userId))
      .limit(1)
      .then((r) => r[0] ?? null);

    tenantId = t?.id ?? null;
  }

  if (!tenantId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Quotes</h1>

          <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
            No active tenant selected. Go to{" "}
            <Link className="underline" href="/onboarding">
              Settings
            </Link>{" "}
            and make sure your tenant is created/selected.
          </div>

          <div className="mt-6">
            <Link className="underline" href="/dashboard">
              Back to dashboard
            </Link>
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
      output: quoteLogs.output,
      renderStatus: quoteLogs.renderStatus,
      renderOptIn: quoteLogs.renderOptIn,
    })
    .from(quoteLogs)
    .where(eq(quoteLogs.tenantId, tenantId))
    .orderBy(desc(quoteLogs.createdAt))
    .limit(50);

  const items = rows.map((r) => {
    const input: any = r.input ?? {};
    const output: any = r.output ?? {};

    // Try hard to find customer-ish fields without assuming shape
    const customerName =
      pickString(input, ["customer.name", "customer_name", "name", "customerContext.name", "customer_context.name"]) ||
      pickString(output, ["customer.name", "customer_name", "name"]) ||
      "New customer";

    const email =
      pickString(input, ["customer.email", "email", "customer_email", "customerContext.email", "customer_context.email"]) ||
      pickString(output, ["customer.email", "email"]) ||
      "";

    const phone =
      pickString(input, ["customer.phone", "phone", "customer_phone", "customerContext.phone", "customer_context.phone"]) ||
      "";

    const category =
      pickString(input, ["category", "customer_context.category", "customerContext.category", "service_type"]) ||
      pickString(output, ["category", "assessment.category"]) ||
      "";

    const notes =
      pickString(input, ["notes", "customer_context.notes", "customerContext.notes"]) ||
      pickString(output, ["summary", "assessment.summary"]) ||
      "";

    // Estimate range: support several possible shapes
    const low =
      pickNumber(output, ["estimate.low", "estimateLow", "estimate_low", "pricing.low", "pricing.typicalLow"]) ??
      pickNumber(output, ["assessment.estimate_low", "assessment.low"]);

    const high =
      pickNumber(output, ["estimate.high", "estimateHigh", "estimate_high", "pricing.high", "pricing.typicalHigh"]) ??
      pickNumber(output, ["assessment.estimate_high", "assessment.high"]);

    const status = normalizeStatus(r.renderStatus);
    const when = fmtWhen(r.createdAt);

    const subtitleBits = [
      category ? category : "",
      email ? email : "",
      phone ? phone : "",
    ].filter(Boolean);

    const subtitle = subtitleBits.join(" · ");

    const estimate =
      typeof low === "number" || typeof high === "number"
        ? `${money(low)}${typeof high === "number" ? ` – ${money(high)}` : ""}`.trim()
        : "";

    return {
      id: r.id,
      when,
      customerName,
      subtitle,
      notes,
      estimate,
      status,
      renderOptIn: Boolean(r.renderOptIn),
    };
  });

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Quotes</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Customer-friendly view (IDs are still available, just not the star of the show).
            </p>
          </div>

          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Back to dashboard
          </Link>
        </div>

        {items.length ? (
          <ul className="space-y-3">
            {items.map((q) => (
              <li
                key={q.id}
                className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {q.customerName}
                      </div>
                      {pill(q.status.label, q.status.tone)}
                      {q.renderOptIn ? pill("Render opt-in", "blue") : null}
                    </div>

                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                      {q.when}
                      {q.subtitle ? <span> · {q.subtitle}</span> : null}
                    </div>

                    {q.notes ? (
                      <div className="mt-3 text-sm text-gray-800 dark:text-gray-200 line-clamp-2">
                        {q.notes}
                      </div>
                    ) : (
                      <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                        No notes provided.
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {q.estimate ? (
                        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-black dark:text-gray-100">
                          {q.estimate}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Estimate not available.
                        </div>
                      )}

                      <div className="font-mono text-[11px] text-gray-500 dark:text-gray-500">
                        {q.id}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <Link
                      href={`/admin/quotes/${q.id}`}
                      className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                    >
                      Review
                    </Link>
                    <Link
                      href={`/admin/quotes/${q.id}`}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                    >
                      Details
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
            No quotes yet.
          </div>
        )}
      </div>
    </main>
  );
}
