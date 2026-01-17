import QuoteForm from "@/components/QuoteForm";
import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: { tenantSlug: string };
}) {
  const tenantSlug = params.tenantSlug;

  // Defaults (never crash public page)
  let tenantId: string | null = null;
  let tenantName = "Get a Photo Quote";
  let industry = "service";
  let aiRenderingEnabled = false;
  let settingsReadPath: "none" | "full" | "fallback" = "none";

  try {
    // ✅ Correctly read rows from db.execute()
    const tenantRes = await db.execute(sql`
      select id, name, slug
      from tenants
      where slug = ${tenantSlug}
      limit 1
    `);

    const tenant =
      (tenantRes as any)?.rows?.[0] ??
      (Array.isArray(tenantRes) ? (tenantRes as any)[0] : null);

    if (tenant?.id) {
      tenantId = tenant.id;
      if (tenant.name) tenantName = tenant.name;

      // Try full settings (including ai_rendering_enabled)
      try {
        const settingsRes = await db.execute(sql`
          select industry_key, ai_rendering_enabled
          from tenant_settings
          where tenant_id = ${tenant.id}::uuid
          limit 1
        `);

        const settings =
          (settingsRes as any)?.rows?.[0] ??
          (Array.isArray(settingsRes) ? (settingsRes as any)[0] : null);

        if (settings?.industry_key) industry = settings.industry_key;
        aiRenderingEnabled = settings?.ai_rendering_enabled === true;
        settingsReadPath = "full";
      } catch {
        // Fallback if column doesn't exist
        const settingsRes = await db.execute(sql`
          select industry_key
          from tenant_settings
          where tenant_id = ${tenant.id}::uuid
          limit 1
        `);

        const settings =
          (settingsRes as any)?.rows?.[0] ??
          (Array.isArray(settingsRes) ? (settingsRes as any)[0] : null);

        if (settings?.industry_key) industry = settings.industry_key;
        settingsReadPath = "fallback";
      }
    }
  } catch {
    // swallow — public page must render
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* 🔴 TEMP DEBUG — REMOVE LATER */}
      <pre className="m-4 rounded-xl border border-red-300 bg-red-50 p-4 text-xs text-red-800">
        {JSON.stringify(
          {
            tenantId,
            tenantName,
            industry_key: industry,
            ai_rendering_enabled: aiRenderingEnabled,
            settingsReadPath,
            aiRenderingEnabledComputed: aiRenderingEnabled,
          },
          null,
          2
        )}
      </pre>

      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-5 lg:items-start">
          <div className="lg:col-span-2">
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">
              {tenantName}
            </h1>
            <p className="mt-3 text-base text-gray-700 dark:text-gray-200">
              Get a fast estimate range by uploading a few clear photos.
            </p>
          </div>

          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <QuoteForm
                tenantSlug={tenantSlug}
                aiRenderingEnabled={aiRenderingEnabled}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
