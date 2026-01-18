import Link from "next/link";
import TopNav from "@/components/TopNav";

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

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Card({
  title,
  desc,
  href,
  tone = "default",
  right,
}: {
  title: string;
  desc: string;
  href: string;
  tone?: "default" | "primary" | "warn";
  right?: React.ReactNode;
}) {
  const base =
    "group rounded-2xl border p-5 transition hover:shadow-sm flex items-start justify-between gap-4";
  const toneCls =
    tone === "primary"
      ? "border-gray-900 bg-gray-900 text-white"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-gray-200 bg-white text-gray-900";

  const titleCls =
    tone === "primary" ? "text-white" : tone === "warn" ? "text-amber-950" : "text-gray-900";
  const descCls =
    tone === "primary" ? "text-gray-100/90" : tone === "warn" ? "text-amber-900" : "text-gray-600";

  const linkCls =
    tone === "primary"
      ? "text-white underline decoration-white/40 group-hover:decoration-white"
      : "text-gray-900 underline decoration-gray-300 group-hover:decoration-gray-500";

  return (
    <Link href={href} className={cn(base, toneCls)}>
      <div className="min-w-0">
        <div className={cn("text-sm font-semibold", titleCls)}>{title}</div>
        <div className={cn("mt-1 text-xs", descCls)}>{desc}</div>
        <div className={cn("mt-3 text-xs font-semibold", linkCls)}>Open →</div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </Link>
  );
}

function Pill({ label, tone }: { label: string; tone: "ok" | "warn" | "idle" }) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-gray-200 bg-white text-gray-700";

  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", cls)}>
      {label}
    </span>
  );
}

export default async function DashboardPage() {
  // Server-side read of tenant/settings (works fine even if it returns ok:false; we handle it).
  let me: MeSettingsResponse | null = null;

  try {
    // Relative fetch is OK in Next server components.
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/tenant/me-settings`, {
      cache: "no-store",
      // If NEXT_PUBLIC_APP_URL isn't set, Next will still try relative in production,
      // but local dev can be weird. So we fall back below if needed.
    } as any);

    if (res.ok) {
      me = (await res.json()) as MeSettingsResponse;
    }
  } catch {
    // ignore
  }

  // Fallback: if absolute fetch failed (common locally), try relative.
  if (!me) {
    try {
      const res2 = await fetch(`/api/tenant/me-settings`, { cache: "no-store" } as any);
      if (res2.ok) me = (await res2.json()) as MeSettingsResponse;
    } catch {
      // ignore
    }
  }

  const ok = Boolean(me && "ok" in me && (me as any).ok === true);

  const tenantName = ok ? (me as any).tenant?.name ?? "" : "";
  const tenantSlug = ok ? (me as any).tenant?.slug ?? "" : "";
  const industryKey = ok ? (me as any).settings?.industry_key ?? null : null;
  const redirectUrl = ok ? (me as any).settings?.redirect_url ?? null : null;
  const thankYouUrl = ok ? (me as any).settings?.thank_you_url ?? null : null;

  const setupComplete = Boolean((industryKey ?? "").trim());
  const hasPublicPage = Boolean((tenantSlug ?? "").trim());

  return (
    <main className="min-h-screen bg-white">
      <TopNav />

      <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
            {ok ? (
              setupComplete ? <Pill label="Setup complete" tone="ok" /> : <Pill label="Setup needed" tone="warn" />
            ) : (
              <Pill label="Not signed in / no tenant" tone="idle" />
            )}
          </div>

          {ok ? (
            <div className="text-sm text-gray-600">
              Tenant: <span className="font-semibold text-gray-900">{tenantName || "Untitled"}</span>{" "}
              {tenantSlug ? (
                <>
                  · Public slug: <span className="font-mono text-gray-900">{tenantSlug}</span>
                </>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              Sign in to manage your tenant, settings, and quotes.
            </div>
          )}
        </div>

        {/* Quick actions */}
        <section className="space-y-3">
          <div className="text-sm font-semibold text-gray-900">Quick actions</div>

          <div className="grid gap-3 md:grid-cols-2">
            <Card
              title={setupComplete ? "Review Settings" : "Finish Setup"}
              desc={
                setupComplete
                  ? "Industry + redirect settings. OpenAI key + AI policy live under Admin."
                  : "Pick your industry, redirect + thank-you URLs, and confirm your tenant is ready."
              }
              href="/onboarding"
              tone={setupComplete ? "default" : "warn"}
              right={setupComplete ? <Pill label="Ready" tone="ok" /> : <Pill label="Do this first" tone="warn" />}
            />

            <Card
              title="Admin"
              desc="Tenant OpenAI key, pricing rules, AI policy, and quote logs."
              href="/admin"
              tone="default"
            />

            <Card
              title="Public Quote Page"
              desc={
                hasPublicPage
                  ? `Customer intake page: /q/${tenantSlug}`
                  : "No tenant slug found yet. Finish setup first."
              }
              href={hasPublicPage ? `/q/${tenantSlug}` : "/onboarding"}
              tone={hasPublicPage ? "primary" : "warn"}
              right={hasPublicPage ? <Pill label="Live link" tone="ok" /> : <Pill label="Missing slug" tone="warn" />}
            />

            <Card
              title="Polish Navigation"
              desc="We’ll refine flow: Dashboard → Configure → Admin setup pages, with completion badges."
              href="/dashboard"
              tone="default"
            />
          </div>
        </section>

        {/* Setup summary */}
        {ok ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-6 space-y-3">
            <div className="text-sm font-semibold text-gray-900">Setup summary</div>

            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="text-gray-700">Industry</div>
                <div className="font-mono text-gray-900">{industryKey ? industryKey : "—"}</div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="text-gray-700">Redirect URL</div>
                <div className="font-mono text-gray-900">{redirectUrl ? redirectUrl : "—"}</div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="text-gray-700">Thank-you URL</div>
                <div className="font-mono text-gray-900">{thankYouUrl ? thankYouUrl : "—"}</div>
              </div>
            </div>

            <div className="pt-2 text-xs text-gray-600">
              Note: OpenAI key + AI policy are in <span className="font-semibold text-gray-900">Admin</span>. This keeps the “customer uses tenant key” model intact.
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
