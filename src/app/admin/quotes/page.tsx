// src/app/admin/quotes/page.tsx
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

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
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

function fmtDate(d: any) {
  try {
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return String(d ?? "");
    return x.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(d ?? "");
  }
}

function safeStr(v: unknown) {
  const s = String(v ?? "").trim();
  return s;
}

function short(s: unknown, max = 80) {
  const t = safeStr(s);
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Extractors (defensive):
 * Your input/output JSON has evolved over time.
 * These helpers try multiple common shapes without exploding.
 */
function pick(obj: any, paths: string[]) {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const k of parts) {
      if (cur && typeof cur === "object" && k in cur) cur = cur[k];
      else {
        ok = false;
        break;
      }
    }
    if (ok && cur != null) return cur;
  }
  return undefined;
}

function renderPill(statusRaw: unknown) {
  const s = safeStr(statusRaw).toLowerCase();

  const base =
    "rounded-full border px-3 py-1 text-xs font-semibold inline-flex items-center";

  if (s === "rendered") {
    return (
      <span className={cn(base, "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200")}>
        Rendered
      </span>
    );
  }
  if (s === "failed") {
    return (
      <span className={cn(base, "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200")}>
        Render failed
      </span>
    );
  }
  if (s === "queued" || s === "running") {
    return (
      <span className={cn(base, "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200")}>
        Rendering
      </span>
    );
  }

  return (
    <span className={cn(base, "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200")}>
      Estimate
    </span>
  );
}

function estimateFromOutput(output: any): { low?: number; high?: number } {
  // Try a few shapes:
  // output.estimateLow / estimateHigh
  // output.estimate.low / estimate.high
  // output.pricing.low / pricing.high
  const low =
    pick(output, ["estimateLow", "estimate_low", "estimate.low", "pricing.low", "price.low"]) ??
    undefined;
  const high =
    pick(output, ["estimateHigh", "estimate_high", "estimate.high", "pricing.high", "price.high"]) ??
    undefined;

  const nLow = typeof low === "number" ? low : low != null ? Number(low) : undefined;
  const nHigh = typeof high === "number" ? high : high != null ? Number(high) : undefined;

  return {
    low: Number.isFinite(nLow as any) ? (nLow as number) : undefined,
    high: Number.isFinite(nHigh as any) ? (nHigh as number) : undefined,
  };
}

function meaningfulTitle(input: any, output: any) {
  // Prefer something “human”: item + category or short summary
  const item =
    pick(output, ["assessment.item", "item"]) ??
    pick(input, ["item", "customer_context.item", "customerContext.item"]) ??
    "";
  const cat =
    pick(output, ["assessment.category", "category"]) ??
    pick(input, ["category", "customer_context.category", "customerContext.category"]) ??
    pick(input, ["customer_context.service_type", "customerContext.service_type"]) ??
    "";

  const summary = pick(output, ["summary", "assessment.summary"]) ?? "";

  const a = safeStr(item);
  const b = safeStr(cat);

  if (a && b) return `${b}: ${a}`;
  if (a) return a;
  if (b) return b;
  if (summary) return short(summary, 64);
  return "Quote request";
}

function customerFromInput(input: any) {
  const name =
    pick(input, ["customer.name", "customerName", "name", "lead.name", "customer_context.name"]) ??
    "";
  const email =
    pick(input, ["customer.email", "customerEmail", "email", "lead.email", "customer_context.email"]) ??
    "";
  const phone =
    pick(input, ["customer.phone", "customerPhone", "phone", "lead.phone"]) ?? "";

  return {
    name: safeStr(name),
    email: safeStr(email),
    phone: safeStr(phone),
  };
}

function notesFromInput(input: any) {
  const notes =
    pick(input, ["customer_context.notes", "customerContext.notes", "notes", "lead.notes"]) ?? "";
  return safeStr(notes);
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
      output: quoteLogs.output,
      renderStatus: quoteLogs.renderStatus,
      renderOptIn: quoteLogs.renderOptIn,
      renderImageUrl: quoteLogs.renderImageUrl,
    })
    .from(quoteLogs)
    .where(eq(quoteLogs.tenantId, tenantId))
    .orderBy(desc(quoteLogs.createdAt))
    .limit(50);

  const mapped = rows.map((r) => {
    const input: any = r.input ?? {};
    const output: any = r.output ?? {};

    const cust = customerFromInput(input);
    const title = meaningfulTitle(input, output);
    const notes = notesFromInput(input);
    const est = estimateFromOutput(output);

    const estimateLabel =
      typeof est.low === "number" || typeof est.high === "number"
        ? `${money(est.low)}${est.high != null ? ` – ${money(est.high)}` : ""}`
        : "—";

    return {
      id: r.id,
      createdAt: r.createdAt,
      title,
      notes,
      cust,
      estimateLabel,
      renderStatus: r.renderStatus,
      renderOptIn: Boolean(r.renderOptIn),
      hasRenderImage: Boolean(r.renderImageUrl),
    };
  });

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Quotes</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Latest customer requests for the active tenant.
            </p>
          </div>

          <Link
            href="/dashboard"
            className="w-fit rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Back to dashboard
          </Link>
        </div>

        {/* Empty */}
        {!mapped.length ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-700 dark:border-gray-800 dark:bg-black dark:text-gray-300">
            No quotes yet. Submit a test quote from your public page to see it here.
          </div>
        ) : null}

        {/* List */}
        {mapped.length ? (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
            {/* Desktop header */}
            <div className="hidden grid-cols-12 gap-4 bg-gray-50 px-5 py-3 text-xs font-semibold text-gray-600 dark:bg-black dark:text-gray-300 md:grid">
              <div className="col-span-2">Created</div>
              <div className="col-span-4">Customer</div>
              <div className="col-span-3">Request</div>
              <div className="col-span-2">Estimate</div>
              <div className="col-span-1 text-right">Action</div>
            </div>

            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {mapped.map((q) => (
                <li key={q.id} className="px-5 py-4">
                  {/* Desktop row */}
                  <div className="hidden grid-cols-12 gap-4 md:grid">
                    <div className="col-span-2">
                      <div className="text-sm text-gray-900 dark:text-gray-100">
                        {fmtDate(q.createdAt)}
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-gray-500 dark:text-gray-400">
                        {q.id}
                      </div>
                    </div>

                    <div className="col-span-4">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {q.cust.name || "Customer"}
                      </div>
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        {q.cust.email ? q.cust.email : "—"}
                        {q.cust.phone ? <span className="ml-2">· {q.cust.phone}</span> : null}
                      </div>
                    </div>

                    <div className="col-span-3">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {q.title}
                      </div>
                      {q.notes ? (
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          {short(q.notes, 70)}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">—</div>
                      )}
                    </div>

                    <div className="col-span-2">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {q.estimateLabel}
                      </div>
                      <div className="mt-2">{renderPill(q.renderStatus)}</div>
                    </div>

                    <div className="col-span-1 flex justify-end">
                      <Link
                        href={`/admin/quotes/${q.id}`}
                        className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                      >
                        Review
                      </Link>
                    </div>
                  </div>

                  {/* Mobile card */}
                  <div className="md:hidden space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {q.cust.name || "Customer"}
                        </div>
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          {q.cust.email || "—"}
                          {q.cust.phone ? <span className="ml-2">· {q.cust.phone}</span> : null}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {fmtDate(q.createdAt)}
                        </div>
                        <div className="mt-2">{renderPill(q.renderStatus)}</div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-black">
                      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {q.title}
                      </div>
                      {q.notes ? (
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          {short(q.notes, 110)}
                        </div>
                      ) : null}

                      <div className="mt-3 flex items-center justify-between">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {q.estimateLabel}
                        </div>
                        <Link
                          href={`/admin/quotes/${q.id}`}
                          className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                        >
                          Review
                        </Link>
                      </div>

                      <div className="mt-2 font-mono text-[10px] text-gray-500 dark:text-gray-400">
                        {q.id}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </main>
  );
}
