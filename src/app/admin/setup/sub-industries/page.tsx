import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings, tenantSubIndustries } from "@/lib/db/schema";
import { mergeSubIndustries } from "@/lib/industry/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function getCookieTenantId(jar: Awaited<ReturnType<typeof cookies>>) {
  const candidates = [
    jar.get("activeTenantId")?.value,
    jar.get("active_tenant_id")?.value,
    jar.get("tenantId")?.value,
    jar.get("tenant_id")?.value,
  ].filter(Boolean) as string[];
  return candidates[0] || null;
}

function SectionTitle(props: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{props.title}</h1>
        {props.subtitle ? (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{props.subtitle}</p>
        ) : null}
      </div>
      {props.right ? <div className="shrink-0">{props.right}</div> : null}
    </div>
  );
}

function Pill(props: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" }) {
  const tone = props.tone ?? "neutral";
  const cls =
    tone === "good"
      ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/40 dark:bg-green-950/40 dark:text-green-200"
      : tone === "warn"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/40 dark:text-yellow-100"
        : "border-gray-200 bg-white text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200";

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", cls)}>
      {props.children}
    </span>
  );
}

export default async function AdminSetupSubIndustriesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const jar = await cookies();
  let tenantId = getCookieTenantId(jar);

  // fallback: first tenant owned by user
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
      <div className="mx-auto max-w-6xl px-6 py-10">
        <SectionTitle
          title="Sub-industries"
          subtitle="No active tenant selected."
          right={
            <Link
              href="/admin/setup"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to Setup
            </Link>
          }
        />

        <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
          No tenant found for this user yet. Create/select a tenant first.
        </div>
      </div>
    );
  }

  // verify ownership
  const tenant = await db
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name, ownerClerkUserId: tenants.ownerClerkUserId })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.ownerClerkUserId, userId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!tenant) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <SectionTitle
          title="Sub-industries"
          subtitle="Tenant not found or not owned."
          right={
            <Link
              href="/admin/setup"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to Setup
            </Link>
          }
        />
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          TENANT_NOT_FOUND_OR_NOT_OWNED
        </div>
      </div>
    );
  }

  const settings = await db
    .select({ industryKey: tenantSettings.industryKey })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenant.id))
    .limit(1)
    .then((r) => r[0] ?? null);

  const rows = await db
    .select({ key: tenantSubIndustries.key, label: tenantSubIndustries.label })
    .from(tenantSubIndustries)
    .where(eq(tenantSubIndustries.tenantId, tenant.id));

  const tenantCustom = rows.map((r) => ({ key: r.key, label: r.label }));
  const merged = mergeSubIndustries(settings?.industryKey ?? null, tenantCustom);

  const industryKey = settings?.industryKey ?? null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <SectionTitle
        title="Sub-industries"
        subtitle="Read-only view. Next we’ll add tenant-managed edits safely."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={industryKey ? "good" : "warn"}>
              Industry: <span className="ml-1 font-mono">{industryKey ?? "not set"}</span>
            </Pill>
            <Pill>
              Tenant: <span className="ml-1 font-mono">{tenant.slug}</span>
            </Pill>
            <Link
              href="/admin/setup"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Back to Setup
            </Link>
          </div>
        }
      />

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-neutral-950/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white">Available sub-industries</div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Merged list (defaults for the industry + tenant custom).
            </div>
          </div>
          <Pill>{merged.length} total</Pill>
        </div>

        {merged.length === 0 ? (
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">None yet.</div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {merged.map((s) => (
              <span
                key={s.key}
                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm text-gray-800 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
                title={s.key}
              >
                <span className="font-semibold">{s.label}</span>
                <span className="text-xs font-mono text-gray-500 dark:text-gray-400">{s.key}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-neutral-950/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white">Tenant custom sub-industries</div>
            <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Only values saved specifically for this tenant.
            </div>
          </div>
          <Pill>{tenantCustom.length} custom</Pill>
        </div>

        {tenantCustom.length === 0 ? (
          <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">
            None yet. Next step: Add UI (POST) with validation and refresh.
          </div>
        ) : (
          <div className="mt-4 overflow-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs font-semibold text-gray-700 dark:bg-white/5 dark:text-gray-200">
                <tr>
                  <th className="px-4 py-3">Label</th>
                  <th className="px-4 py-3">Key</th>
                </tr>
              </thead>
              <tbody>
                {tenantCustom.map((s) => (
                  <tr key={s.key} className="border-t border-gray-200 dark:border-gray-800">
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{s.label}</td>
                    <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-300">{s.key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400">
        Next: wire into intake as an optional question and route tenant prompts (including rendering prompts).
      </div>
    </div>
  );
}
