import TopNav from "@/components/TopNav";
import Link from "next/link";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type MeSettingsResponse =
  | {
      ok: true;
      tenant: { id: string; name: string; slug: string };
      settings: {
        tenant_id: string;
        industry_key: string | null;
        redirect_url: string | null;
        thank_you_url: string | null;
        updated_at: string | null;
      } | null;
    }
  | { ok: false; error: any };

function baseUrlFromHeaders() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  if (!host) return "";
  return `${proto}://${host}`;
}

async function getMeSettings(): Promise<MeSettingsResponse | null> {
  try {
    const baseUrl = baseUrlFromHeaders();
    if (!baseUrl) return null;

    const res = await fetch(`${baseUrl}/api/tenant/me-settings`, {
      cache: "no-store",
      // Important: include cookies so the API sees the signed-in session
      headers: { cookie: headers().get("cookie") || "" },
    });

    const json = (await res.json()) as MeSettingsResponse;
    return json;
  } catch {
    return null;
  }
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6">
      <h2 className="font-semibold text-gray-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export default async function DashboardPage() {
  const me = await getMeSettings();

  const ok = Boolean(me && "ok" in me && (me as any).ok === true);
  const tenant = ok ? (me as any).tenant : null;
  const settings = ok ? (me as any).settings : null;

  const tenantName = tenant?.name || "";
  const tenantSlug = tenant?.slug || "";

  const industryKey = settings?.industry_key ?? null;
  const redirectUrl = settings?.redirect_url ?? null;
  const thankYouUrl = settings?.thank_you_url ?? null;

  // Setup completeness (simple + deterministic)
  const hasIndustry = Boolean((industryKey ?? "").trim());
  const hasRedirects = Boolean(((redirectUrl ?? "").trim() && (thankYouUrl ?? "").trim()));
  const setupComplete = hasIndustry; // keep minimal for now, per your earlier preference

  const publicQuotePath = tenantSlug ? `/q/${tenantSlug}` : null;

  return (
    <main className="min-h-screen bg-gray-50">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-700">
              Tenant:{" "}
              <span className="font-semibold">
                {tenantName || (ok ? "Unnamed tenant" : "Not resolved")}
              </span>
              {tenantSlug ? (
                <span className="ml-2 font-mono text-xs text-gray-600">/{tenantSlug}</span>
              ) : null}
            </p>
          </div>

          {publicQuotePath ? (
            <Link
              href={publicQuotePath}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              Open Public Quote →
            </Link>
          ) : (
            <Link
              href="/onboarding"
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
            >
              Configure →
            </Link>
          )}
        </div>

        {!ok ? (
          <Card title="Tenant not resolved">
            <p className="text-sm text-gray-700">
              We couldn’t load your tenant context. If you just signed in, try refreshing.
              Otherwise go to Configure and complete onboarding.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link className="underline text-sm" href="/onboarding">
                Go to Configure
              </Link>
              <Link className="underline text-sm" href="/admin">
                Go to Admin
              </Link>
            </div>
          </Card>
        ) : (
          <>
            <Card title="Setup status">
              <div className="text-sm text-gray-800 space-y-2">
                <div>
                  Industry:{" "}
                  {hasIndustry ? (
                    <span className="font-semibold text-green-700">Set</span>
                  ) : (
                    <span className="font-semibold text-amber-800">Missing</span>
                  )}
                  {industryKey ? (
                    <span className="ml-2 font-mono text-xs text-gray-600">
                      {industryKey}
                    </span>
                  ) : null}
                </div>

                <div>
                  Redirect URLs:{" "}
                  {hasRedirects ? (
                    <span className="font-semibold text-green-700">Set</span>
                  ) : (
                    <span className="font-semibold text-gray-600">Optional / not complete</span>
                  )}
                </div>

                <div>
                  Overall:{" "}
                  {setupComplete ? (
                    <span className="font-semibold text-green-700">Ready</span>
                  ) : (
                    <span className="font-semibold text-amber-800">
                      Needs configuration
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href="/onboarding"
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold"
                >
                  {setupComplete ? "Review settings" : "Finish Configure"}
                </Link>

                <Link
                  href="/admin/setup/openai"
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold"
                >
                  OpenAI Key
                </Link>

                <Link
                  href="/admin/setup/ai-policy"
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold"
                >
                  AI Policy
                </Link>

                <Link
                  href="/admin"
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold"
                >
                  Admin
                </Link>
              </div>

              {!hasIndustry ? (
                <p className="mt-4 text-xs text-gray-600">
                  Tip: industry is what drives pricing and prompt defaults. Set that first.
                </p>
              ) : null}
            </Card>

            <Card title="Quick actions">
              <ul className="list-disc pl-5 text-sm text-gray-700 space-y-2">
                <li>
                  Test public quote flow{" "}
                  {publicQuotePath ? (
                    <>
                      at{" "}
                      <Link className="underline font-mono" href={publicQuotePath}>
                        {publicQuotePath}
                      </Link>
                    </>
                  ) : (
                    <>
                      after you set your tenant slug in{" "}
                      <Link className="underline" href="/onboarding">
                        Configure
                      </Link>
                    </>
                  )}
                </li>
                <li>
                  Review leads & quote logs in{" "}
                  <Link className="underline" href="/admin/quotes">
                    Admin → Quotes
                  </Link>
                </li>
                <li>
                  Adjust redirects in{" "}
                  <Link className="underline" href="/onboarding">
                    Configure
                  </Link>{" "}
                  (optional)
                </li>
              </ul>
            </Card>

            <Card title="What’s next">
              <p className="text-sm text-gray-700">
                Next we’ll refine the tenant dashboard into real modules:
                <span className="block mt-2">
                  • Setup checklist (OpenAI key, AI policy, pricing guardrails)
                </span>
                <span className="block">
                  • Usage + cost (per-tenant token/image counters)
                </span>
                <span className="block">
                  • Recent activity (latest leads + render status)
                </span>
              </p>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
