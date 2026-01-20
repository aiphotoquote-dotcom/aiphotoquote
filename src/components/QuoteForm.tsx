// src/app/q/[tenantSlug]/page.tsx
import QuoteForm from "@/components/QuoteForm";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ tenantSlug?: string }>;
};

function firstRow<T = any>(r: any): T | null {
  return (r?.rows?.[0] ?? (Array.isArray(r) ? r?.[0] : null)) as T | null;
}

function rowCount(r: any): number {
  if (Array.isArray(r)) return r.length;
  if (Array.isArray(r?.rows)) return r.rows.length;
  return 0;
}

function normalizeTenantSlug(v: any): string {
  return String(v ?? "").trim();
}

export default async function Page(props: PageProps) {
  const p = await props.params;
  const tenantSlug = normalizeTenantSlug(p?.tenantSlug);

  // Results
  let tenantId: string | null = null;
  let tenantName: string | null = null;
  let industry_key: string | null = null;
  let ai_rendering_enabled: boolean | null = null;

  // Display defaults
  let displayTenantName = "Get a Photo Quote";
  let displayIndustry = "service";
  let aiRenderingEnabled = false;

  try {
    if (!tenantSlug) throw new Error("tenantSlug param missing/empty at runtime");

    // Tenant lookup
    const tenantRes = await db.execute(sql`
      select "id", "name", "slug"
      from "tenants"
      where "slug" = ${tenantSlug}
      limit 1
    `);

    const tenant = firstRow<{ id: string; name: string | null; slug: string }>(tenantRes);
    tenantId = tenant?.id ?? null;
    tenantName = tenant?.name ?? null;

    if (tenantName) displayTenantName = tenantName;

    // Settings lookup (ai_rendering_enabled exists in your DB)
    if (tenantId) {
      try {
        const settingsRes = await db.execute(sql`
          select "industry_key", "ai_rendering_enabled"
          from "tenant_settings"
          where "tenant_id" = ${tenantId}::uuid
          limit 1
        `);

        const settings = firstRow<{
          industry_key: string | null;
          ai_rendering_enabled: boolean | null;
        }>(settingsRes);

        industry_key = settings?.industry_key ?? null;
        ai_rendering_enabled =
          typeof settings?.ai_rendering_enabled === "boolean"
            ? settings.ai_rendering_enabled
            : null;

        if (industry_key) displayIndustry = industry_key;
        aiRenderingEnabled = ai_rendering_enabled === true;
      } catch {
        const settingsRes = await db.execute(sql`
          select "industry_key"
          from "tenant_settings"
          where "tenant_id" = ${tenantId}::uuid
          limit 1
        `);

        const settings = firstRow<{ industry_key: string | null }>(settingsRes);
        industry_key = settings?.industry_key ?? null;

        if (industry_key) displayIndustry = industry_key;
        aiRenderingEnabled = false;
      }
    }
  } catch {
    // If anything fails, we still render the form; QuoteForm will show errors if submit fails
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-5 lg:items-start">
          <div className="lg:col-span-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
              <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
              Photo quote powered by AI
            </div>

            <h1 className="mt-4 text-4xl font-semibold tracking-tight">{displayTenantName}</h1>

            <p className="mt-3 text-base text-gray-700 dark:text-gray-200">
              Get a fast estimate range by uploading a few clear photos. No phone calls required.
            </p>

            <div className="mt-6 space-y-3 text-sm text-gray-800 dark:text-gray-200">
              <div className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-black dark:bg-white" />
                <p>
                  <span className="font-semibold">No obligation.</span> This is an estimate range — final
                  pricing depends on inspection and scope.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-black dark:bg-white" />
                <p>
                  <span className="font-semibold">Best results:</span> 2–6 photos, good lighting, include
                  close-ups + a full view.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-black dark:bg-white" />
                <p>
                  Tailored for <span className="font-semibold">{displayIndustry}</span> quotes. We’ll follow
                  up if anything needs clarification.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:p-8 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold">Get a Photo Quote</h2>
                  <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                    Upload photos and add a quick note. We’ll return an estimate range.
                  </p>
                </div>

                <div className="hidden md:flex flex-col items-end text-xs text-gray-600 dark:text-gray-300">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">Tenant</span>
                  <span className="rounded-md bg-gray-50 px-2 py-1 dark:bg-gray-950 dark:border dark:border-gray-800">
                    /q/{tenantSlug || "(missing)"}
                  </span>
                </div>
              </div>

              <div className="mt-6">
                <QuoteForm tenantSlug={tenantSlug} aiRenderingEnabled={aiRenderingEnabled} />
              </div>

              <p className="mt-6 text-xs text-gray-600 dark:text-gray-300">
                By submitting, you agree we may contact you about this request. Photos are used only to
                prepare your estimate.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
