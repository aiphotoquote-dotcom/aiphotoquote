import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { desc, eq } from "drizzle-orm";

import TopNav from "@/components/TopNav";
import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function pill(
  label: string,
  tone: "gray" | "green" | "yellow" | "red" | "blue" = "gray"
) {
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

  return (
    <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cls)}>
      {label}
    </span>
  );
}

function fmtDate(iso: unknown) {
  const d =
    typeof iso === "string"
      ? new Date(iso)
      : iso instanceof Date
        ? iso
        : new Date(String(iso ?? ""));
  if (Number.isNaN(d.getTime())) return String(iso ?? "—");
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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

function normalizeRenderStatus(v: unknown) {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (s === "rendered") return { label: "Rendered", tone: "green" as const };
  if (s === "failed") return { label: "Render failed", tone: "red" as const };
  if (s === "queued" || s === "running") return { label: "Rendering", tone: "blue" as const };
  if (s === "not_requested") return { label: "Not requested", tone: "gray" as const };
  if (!s) return { label: "—", tone: "gray" as const };
  return { label: String(v), tone: "gray" as const };
}

function pickFirstImageUrl(input: any): string | null {
  const imgs = Array.isArray(input?.images) ? input.images : [];
  for (const it of imgs) {
    if (typeof it?.url === "string" && it.url.length > 0) return it.url;
  }
  return null;
}

function pickEstimate(output: any) {
  const low = output?.estimate_low ?? output?.estimateLow ?? null;
  const high = output?.estimate_high ?? output?.estimateHigh ?? null;

  const lowNum = low == null ? null : Number(low);
  const highNum = high == null ? null : Number(high);

  return {
    low: Number.isFinite(lowNum as any) ? (lowNum as number) : null,
    high: Number.isFinite(highNum as any) ? (highNum as number) : null,
  };
}

/**
 * IMPORTANT:
 * - We only trust the cookie if that tenant is owned by this user.
 * - Otherwise fallback to first owned tenant.
 * This prevents "list used fallback tenant" but "detail used cookie tenant" mismatch.
 */
async function resolveActiveTenantId(userId: string): Promise<string | null> {
  const jar = await cookies();
  const cookieTenantId =
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value;

  if (cookieTenantId) {
    const okCookie = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, cookieTenantId))
      .limit(1);

    // Validate ownership (today's model). Later we can expand to membership.
    if (okCookie[0]?.id) {
      const owned = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, cookieTenantId))
        .limit(1);

      // If your schema uses ownerClerkUserId, validate it here:
      const ownedByUser = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.ownerClerkUserId, userId))
        .limit(100);

      if (ownedByUser.some((t) => t.id === cookieTenantId)) return cookieTenantId;
    }
  }

  const fallback = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.ownerClerkUserId, userId))
    .limit(1);

  return fallback[0]?.id ?? null;
}

export default async function AdminQuotesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const tenantId = await resolveActiveTenantId(userId);

  if (!tenantId) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <TopNav />
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <h1 className="text-2xl font-semibold">Admin · Quotes</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              No active tenant selected. Go to Settings and make sure your tenant is created/selected.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/onboarding"
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Go to Settings
              </Link>
              <Link
                href="/dashboard"
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const rows = await db
    .select()
    .from(quoteLogs)
    .where(eq(quoteLogs.tenantId, tenantId))
    .orderBy(desc(quoteLogs.createdAt))
    .limit(50);

  const items = rows.map((r: any) => {
    const input = r.input ?? {};
    const output = r.output ?? {};
    const thumb = pickFirstImageUrl(input);
    const est = pickEstimate(output);

    const status = normalizeRenderStatus(r.renderStatus ?? r.render_status);
    const renderOptIn = Boolean(r.renderOptIn ?? r.render_opt_in);
    const renderImageUrl = (r.renderImageUrl ?? r.render_image_url) || null;

    const estimateLabel =
      est.low != null || est.high != null
        ? `${money(est.low)}${est.high != null ? ` – ${money(est.high)}` : ""}`
        : "—";

    return {
      id: r.id as string,
      createdAt: r.createdAt ?? r.created_at,
      thumb,
      estimateLabel,
      status,
      renderOptIn,
      renderImageUrl,
    };
  });

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-sm text-gray-500 dark:text-gray-400">Admin</div>
            <h1 className="text-2xl font-semibold">Quotes</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Latest 50 quotes for this tenant.
            </p>
          </div>

          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Back to Dashboard
          </Link>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          <div className="grid grid-cols-12 gap-3 border-b border-gray-200 px-5 py-3 text-xs font-semibold text-gray-600 dark:border-gray-800 dark:text-gray-300">
            <div className="col-span-5">Quote</div>
            <div className="col-span-3">Created</div>
            <div className="col-span-2">Estimate</div>
            <div className="col-span-2 text-right">Action</div>
          </div>

          {items.length ? (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {items.map((q) => {
                const statusPill = pill(q.status.label, q.status.tone);

                return (
                  <li key={q.id} className="grid grid-cols-12 gap-3 px-5 py-4 items-center">
                    <div className="col-span-5 flex items-center gap-3">
                      <div className="h-12 w-12 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
                        {q.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={q.thumb} alt="thumb" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-500 dark:text-gray-400">
                            No photo
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate font-mono text-xs text-gray-700 dark:text-gray-300">
                            {q.id}
                          </div>
                          {statusPill}
                          {q.renderOptIn ? pill("Opt-in", "blue") : pill("No opt-in", "gray")}
                          {q.renderImageUrl ? pill("Has image", "green") : null}
                        </div>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Click review to see details, output, and rendering.
                        </div>
                      </div>
                    </div>

                    <div className="col-span-3 text-sm text-gray-700 dark:text-gray-300">
                      {fmtDate(q.createdAt)}
                    </div>

                    <div className="col-span-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {q.estimateLabel}
                    </div>

                    <div className="col-span-2 flex justify-end">
                      <Link
                        href={`/admin/quotes/${encodeURIComponent(q.id)}`}
                        className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
                      >
                        Review
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-5 py-10 text-sm text-gray-600 dark:text-gray-300">
              No quotes yet for this tenant. Run a test quote from your public page.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
