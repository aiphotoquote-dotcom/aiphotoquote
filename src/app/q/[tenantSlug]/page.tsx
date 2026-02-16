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

function normalizeTenantSlug(v: any): string {
  return String(v ?? "").trim();
}

type AiMode = "assessment_only" | "range" | "fixed";

function normalizeAiMode(v: any): AiMode {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "fixed" || s === "range" || s === "assessment_only") return s as AiMode;
  return "assessment_only";
}

export default async function Page(props: PageProps) {
  const p = await props.params;
  const tenantSlug = normalizeTenantSlug(p?.tenantSlug);

  // Results
  let tenantId: string | null = null;
  let tenantName: string | null = null;

  let industry_key: string | null = null;

  // ✅ Pull BOTH canonical + legacy so we don’t “accidentally disable” rendering
  let ai_rendering_enabled: boolean | null = null; // canonical (legacy naming you already have in DB)
  let rendering_enabled: boolean | null = null; // legacy
  let rendering_customer_opt_in_required: boolean | null = null; // used later (UI)

  // ✅ Pricing + AI mode (for correct customer-facing language)
  let pricing_enabled: boolean | null = null;
  let ai_mode: AiMode = "assessment_only";

  let brand_logo_url: string | null = null;
  let business_name: string | null = null;

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

    // Settings lookup (prefer canonical columns; fall back to legacy)
    if (tenantId) {
      const settingsRes = await db.execute(sql`
        select
          "industry_key",

          "pricing_enabled",
          "ai_mode",

          "ai_rendering_enabled",
          "rendering_enabled",
          "rendering_customer_opt_in_required",

          "brand_logo_url",
          "business_name"
        from "tenant_settings"
        where "tenant_id" = ${tenantId}::uuid
        limit 1
      `);

      const settings = firstRow<{
        industry_key: string | null;

        pricing_enabled: boolean | null;
        ai_mode: string | null;

        ai_rendering_enabled: boolean | null;
        rendering_enabled: boolean | null;
        rendering_customer_opt_in_required: boolean | null;

        brand_logo_url: string | null;
        business_name: string | null;
      }>(settingsRes);

      industry_key = settings?.industry_key ?? null;

      pricing_enabled = typeof settings?.pricing_enabled === "boolean" ? settings.pricing_enabled : null;
      ai_mode = normalizeAiMode(settings?.ai_mode);

      ai_rendering_enabled =
        typeof settings?.ai_rendering_enabled === "boolean" ? settings.ai_rendering_enabled : null;

      rendering_enabled =
        typeof settings?.rendering_enabled === "boolean" ? settings.rendering_enabled : null;

      rendering_customer_opt_in_required =
        typeof settings?.rendering_customer_opt_in_required === "boolean"
          ? settings.rendering_customer_opt_in_required
          : null;

      brand_logo_url = settings?.brand_logo_url ?? null;
      business_name = settings?.business_name ?? null;

      if (industry_key) displayIndustry = industry_key;

      // ✅ Effective rendering: canonical wins, otherwise legacy wins
      aiRenderingEnabled =
        ai_rendering_enabled === true ? true : rendering_enabled === true ? true : false;

      // If tenantSettings has a business name, prefer it for display
      if (business_name && business_name.trim()) {
        displayTenantName = business_name.trim();
      }
    }
  } catch {
    // If anything fails, we still render the form; QuoteForm will show errors if submit fails
  }

  const logoUrl = (brand_logo_url ?? "").trim() || null;

  // -------------------------
  // Customer-facing language selection
  // -------------------------
  const pricingOn = pricing_enabled === true;
  const effectiveAiMode: AiMode = pricingOn ? ai_mode : "assessment_only";

  const headlineNoun =
    effectiveAiMode === "assessment_only" ? "assessment" : effectiveAiMode === "fixed" ? "estimate" : "estimate range";

  const heroSentence =
    effectiveAiMode === "assessment_only"
      ? "Get a fast assessment by uploading a few clear photos. No phone calls required."
      : effectiveAiMode === "fixed"
        ? "Get a fast estimate by uploading a few clear photos. No phone calls required."
        : "Get a fast estimate range by uploading a few clear photos. No phone calls required.";

  const cardSubtitle =
    effectiveAiMode === "assessment_only"
      ? "Upload photos and add a quick note. We’ll return an assessment."
      : effectiveAiMode === "fixed"
        ? "Upload photos and add a quick note. We’ll return an estimate."
        : "Upload photos and add a quick note. We’ll return an estimate range.";

  const bulletNoObligation =
    effectiveAiMode === "assessment_only"
      ? "No obligation. This is an assessment — final pricing depends on inspection and scope."
      : effectiveAiMode === "fixed"
        ? "No obligation. This is an estimate — final pricing depends on inspection and scope."
        : "No obligation. This is an estimate range — final pricing depends on inspection and scope.";

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-5 lg:items-start">
          <div className="lg:col-span-2">
            {/* Tenant branding */}
            {logoUrl ? (
              <div className="mb-4">
                <img
                  src={logoUrl}
                  alt={displayTenantName}
                  style={{ maxHeight: 64, width: "auto", objectFit: "contain", display: "block" }}
                />
              </div>
            ) : null}

            <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
              <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
              Photo quote powered by AI
            </div>

            <h1 className="mt-4 text-4xl font-semibold tracking-tight">{displayTenantName}</h1>

            <p className="mt-3 text-base text-gray-700 dark:text-gray-200">{heroSentence}</p>

            <div className="mt-6 space-y-3 text-sm text-gray-800 dark:text-gray-200">
              <div className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-black dark:bg-white" />
                <p>
                  <span className="font-semibold">No obligation.</span> {bulletNoObligation}
                </p>
              </div>
              <div className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-black dark:bg-white" />
                <p>
                  <span className="font-semibold">Best results:</span> 2–6 photos, good lighting, include close-ups + a full view.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-black dark:bg-white" />
                <p>
                  Tailored for <span className="font-semibold">{displayIndustry}</span> {headlineNoun}s. We’ll follow up if anything needs
                  clarification.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm md:p-8 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold">Get a Photo Quote</h2>
                  <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">{cardSubtitle}</p>
                </div>

                <div className="hidden md:flex flex-col items-end text-xs text-gray-600 dark:text-gray-300">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">Tenant</span>
                  <span className="rounded-md bg-gray-50 px-2 py-1 dark:bg-gray-950 dark:border dark:border-gray-800">
                    /q/{tenantSlug || "(missing)"}
                  </span>
                </div>
              </div>

              <div className="mt-6">
                {/* NOTE: opt-in-required is read above and will be wired next */}
                <QuoteForm tenantSlug={tenantSlug} aiRenderingEnabled={aiRenderingEnabled} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}