import QuoteForm from "@/components/QuoteForm";
import { db } from "../../../lib/db/client";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: { tenantSlug: string };
}) {
  const tenantSlug = params.tenantSlug;

  // Default/fallback values so this page never hard-crashes.
  let tenantName = "Get a Photo Quote";
  let industry = "service";
  let aiRenderingEnabled = false;

  try {
    // Tenant lookup (safe)
    const tenantRes = await db.execute(sql`
      select "id", "name", "slug"
      from "tenants"
      where "slug" = ${tenantSlug}
      limit 1
    `);

    const tenant: any =
      (tenantRes as any)?.rows?.[0] ??
      (Array.isArray(tenantRes) ? (tenantRes as any)[0] : null);

    if (tenant?.name) tenantName = tenant.name;

    if (tenant?.id) {
      // Try the new settings schema first
      try {
        const settingsRes = await db.execute(sql`
          select "industry_key", "ai_rendering_enabled"
          from "tenant_settings"
          where "tenant_id" = ${tenant.id}::uuid
          limit 1
        `);

        const settings: any =
          (settingsRes as any)?.rows?.[0] ??
          (Array.isArray(settingsRes) ? (settingsRes as any)[0] : null);

        if (settings?.industry_key) industry = settings.industry_key;
        aiRenderingEnabled = settings?.ai_rendering_enabled === true;
      } catch {
        // Fallback for DBs that do not have ai_rendering_enabled yet
        const settingsRes = await db.execute(sql`
          select "industry_key"
          from "tenant_settings"
          where "tenant_id" = ${tenant.id}::uuid
          limit 1
        `);

        const settings: any =
          (settingsRes as any)?.rows?.[0] ??
          (Array.isArray(settingsRes) ? (settingsRes as any)[0] : null);

        if (settings?.industry_key) industry = settings.industry_key;
        aiRenderingEnabled = false;
      }
    }
  } catch {
    // swallow — page must render even if DB lookup fails
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-5 lg:items-start">
          <div className="lg:col-span-2">
            <div className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs text-gray-700">
              <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
              Photo quote powered by AI
            </div>

            <h1 className="mt-4 text-4xl font-semibold tracking-tight">
              {tenantName}
            </h1>

            <p className="mt-3 text-base text-gray-700">
              Get a fast estimate range by uploading a few clear photos. No phone
              calls required.
            </p>

            <div className="mt-6 space-y-3 text-sm text-gray-800">
              <div className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-black" />
                <p>
                  <span className="font-semibold">No obligation.</span> This is an
                  estimate range — final pricing depends on inspection and scope.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-black" />
                <p>
                  <span className="font-semibold">Best results:</span> 2–6 photos,
                  good lighting, include close-ups + a full view.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-black" />
                <p>
                  Tailored for <span className="font-semibold">{industry}</span>{" "}
                  quotes. We’ll follow up if anything needs clarification.
                </p>
              </div>

              {aiRenderingEnabled ? (
                <div className="flex gap-3">
                  <div className="mt-1 h-2 w-2 rounded-full bg-black" />
                  <p>
                    <span className="font-semibold">Optional:</span> You may be able
                    to request an AI concept rendering of the finished result.
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="rounded-2xl border bg-white p-6 shadow-sm md:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold">Get a Photo Quote</h2>
                  <p className="mt-2 text-sm text-gray-700">
                    Upload photos and add a quick note. We’ll return an estimate
                    range.
                  </p>
                </div>

                <div className="hidden md:flex flex-col items-end text-xs text-gray-600">
                  <span className="font-semibold text-gray-900">Tenant</span>
                  <span className="rounded-md bg-gray-50 px-2 py-1">
                    /q/{tenantSlug}
                  </span>
                </div>
              </div>

              <div className="mt-6">
                <QuoteForm tenantSlug={tenantSlug} aiRenderingEnabled={aiRenderingEnabled} />
              </div>

              <p className="mt-6 text-xs text-gray-600">
                By submitting, you agree we may contact you about this request.
                Photos are used only to prepare your estimate.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
