// src/app/admin/setup/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, tenantSettings } from "@/lib/db/schema";

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

function Pill(props: { children: React.ReactNode; tone: "good" | "warn" | "neutral" }) {
  const cls =
    props.tone === "good"
      ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200"
      : props.tone === "warn"
        ? "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200"
        : "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200";

  return (
    <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", cls)}>
      {props.children}
    </span>
  );
}

function SetupCard(props: {
  title: string;
  subtitle: string;
  href: string;
  status: { label: string; tone: "good" | "warn" | "neutral" };
  details?: string;
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
          <div className="text-lg font-semibold text-gray-900 dark:text-white">{props.title}</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{props.subtitle}</div>
        </div>

        <div className="shrink-0">
          <Pill tone={props.status.tone}>{props.status.label}</Pill>
        </div>
      </div>

      {props.details ? (
        <div className="mt-4 text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
          {props.details}
        </div>
      ) : null}

      <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-gray-800 group-hover:underline dark:text-gray-100">
        Open <span aria-hidden>→</span>
      </div>
    </Link>
  );
}

export default async function AdminSetupHubPage() {
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

  // If no tenant, show hub but warn (no hard fail)
  const tenant = tenantId
    ? await db
        .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
        .then((r) => r[0] ?? null)
    : null;

  const settings = tenant?.id
    ? await db
        .select({
          tenantId: tenantSettings.tenantId,
          industryKey: tenantSettings.industryKey,
          aiMode: tenantSettings.aiMode,
          renderingEnabled: tenantSettings.renderingEnabled,
          aiRenderingEnabled: tenantSettings.aiRenderingEnabled,
          renderingMaxPerDay: tenantSettings.renderingMaxPerDay,
          renderingCustomerOptInRequired: tenantSettings.renderingCustomerOptInRequired,
        })
        .from(tenantSettings)
        .where(eq(tenantSettings.tenantId, tenant.id))
        .limit(1)
        .then((r) => r[0] ?? null)
    : null;

  const hasTenant = Boolean(tenant?.id);
  const tenantName = tenant?.name ?? "Your Business";
  const tenantSlug = (tenant?.slug ?? "").trim();

  // --- statuses ---
  const aiPolicyConfigured = Boolean(settings?.tenantId);
  const aiPolicyStatus = aiPolicyConfigured
    ? { label: "Configured", tone: "good" as const }
    : hasTenant
      ? { label: "Needs setup", tone: "warn" as const }
      : { label: "No tenant", tone: "neutral" as const };

  const widgetsReady = tenantSlug.length >= 3;
  const widgetsStatus = widgetsReady
    ? { label: "Ready", tone: "good" as const }
    : hasTenant
      ? { label: "Needs slug", tone: "warn" as const }
      : { label: "No tenant", tone: "neutral" as const };

  const aiDetails = aiPolicyConfigured
    ? [
        `Tenant: ${tenantName}${tenantSlug ? ` (${tenantSlug})` : ""}`,
        `industry_key: ${settings?.industryKey ?? "(not set)"}`,
        `ai_mode: ${settings?.aiMode ?? "(default)"}`,
        `rendering_enabled: ${String(settings?.renderingEnabled ?? false)}`,
        `ai_rendering_enabled: ${String(settings?.aiRenderingEnabled ?? false)}`,
        `rendering_max_per_day: ${settings?.renderingMaxPerDay ?? "(not set)"}`,
        `rendering_customer_opt_in_required: ${String(settings?.renderingCustomerOptInRequired ?? false)}`,
      ].join("\n")
    : hasTenant
      ? `Tenant: ${tenantName}${tenantSlug ? ` (${tenantSlug})` : ""}\nNo tenant_settings row yet.`
      : "Create/select a tenant first.";

  const widgetDetails = widgetsReady
    ? `Public quote page: /q/${tenantSlug}`
    : hasTenant
      ? "Widgets require a tenant slug so your public link becomes /q/<tenantSlug>."
      : "Create/select a tenant first.";

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-black dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">AI Setup</h1>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Configure AI behavior and publish widgets for your tenant’s quote page.
          </p>

          {hasTenant ? (
            <div className="text-sm text-gray-800 dark:text-gray-200">
              Tenant: <span className="font-semibold">{tenantName}</span>
              {tenantSlug ? (
                <span className="ml-2 font-mono text-xs text-gray-600 dark:text-gray-400">
                  ({tenantSlug})
                </span>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
              No active tenant found for this user yet. Create a tenant first (or set the active tenant cookie).
            </div>
          )}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <SetupCard
            title="AI Policy"
            subtitle="Control AI mode, rendering rules, daily limits, and customer opt-in behavior."
            href="/admin/setup/ai-policy"
            status={aiPolicyStatus}
            details={aiDetails}
          />

          <SetupCard
            title="Widgets"
            subtitle="Copy/paste embed code (link, iframe, popup) to publish your quote form anywhere."
            href="/admin/setup/widget"
            status={widgetsStatus}
            details={widgetDetails}
          />
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-6 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
          Tip: After setup, run one end-to-end test (estimate + optional render) to validate the full tenant experience.
        </div>
      </div>
    </main>
  );
}