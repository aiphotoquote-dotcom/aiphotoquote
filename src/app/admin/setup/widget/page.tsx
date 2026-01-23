// src/app/admin/setup/widget/page.tsx
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import CopyButtonClient from "@/components/admin/CopyButtonClient";

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

async function getBaseUrl() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return host ? `${proto}://${host}` : "";
}

function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle ? (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

function CodeBlock({
  title,
  description,
  code,
}: {
  title: string;
  description: string;
  code: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-lg font-semibold">{title}</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{description}</div>
        </div>

        <div className="shrink-0">
          <CopyButtonClient text={code} />
        </div>
      </div>

      {/* Critical: contain overflow HERE, never on the page */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-black dark:border-gray-800">
        <pre className="min-w-full p-4 text-xs text-white whitespace-pre">
{code}
        </pre>
      </div>

      <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Tip: If this looks cut off in your editor, scroll horizontally inside the code box (not the whole page).
      </div>
    </div>
  );
}

function ButtonOptions({
  quoteUrl,
}: {
  quoteUrl: string;
}) {
  const label = "Get an AI Photo Quote";

  const btnPrimary = `<a href="${quoteUrl}" target="_blank" rel="noopener"
  style="display:inline-block;background:#111;color:#fff;padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:700;">
  ${label}
</a>`;

  const btnOutline = `<a href="${quoteUrl}" target="_blank" rel="noopener"
  style="display:inline-block;background:transparent;color:#111;padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:700;border:2px solid #111;">
  ${label}
</a>`;

  const btnDarkPill = `<a href="${quoteUrl}" target="_blank" rel="noopener"
  style="display:inline-flex;align-items:center;gap:10px;background:#0b0b0b;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:800;letter-spacing:.2px;">
  <span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:#22c55e;"></span>
  ${label}
</a>`;

  const btnSoft = `<a href="${quoteUrl}" target="_blank" rel="noopener"
  style="display:inline-block;background:#f3f4f6;color:#111;padding:12px 16px;border-radius:12px;text-decoration:none;font-weight:800;border:1px solid rgba(0,0,0,.12);">
  ${label}
</a>`;

  const btnCompact = `<a href="${quoteUrl}" target="_blank" rel="noopener"
  style="display:inline-block;background:#111;color:#fff;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:800;font-size:14px;">
  ${label}
</a>`;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-lg font-semibold">Button options</div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Pick one button style and paste into your site. These are plain HTML + inline CSS, so they work almost everywhere.
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <CodeBlock
          title="Primary (recommended)"
          description="Clean, bold button. Works on light backgrounds."
          code={btnPrimary}
        />
        <CodeBlock
          title="Outline"
          description="Great if you already have a dark background section."
          code={btnOutline}
        />
        <CodeBlock
          title="Dark pill"
          description="Sticky/floating CTA feel with a green dot."
          code={btnDarkPill}
        />
        <CodeBlock
          title="Soft"
          description="Subtle style for sidebars or secondary CTAs."
          code={btnSoft}
        />
      </div>

      <div className="mt-4">
        <CodeBlock
          title="Compact"
          description="Smaller size for nav bars / tight layouts."
          code={btnCompact}
        />
      </div>
    </div>
  );
}

export default async function WidgetSetupPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const jar = await cookies();
  const baseUrl = await getBaseUrl();

  let tenantId = getCookieTenantId(jar);

  // fallback: first tenant owned by this user (back-compat)
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
        <SectionHeader
          title="Widgets"
          subtitle="Copy/paste embed code for your website."
          right={
            <Link
              href="/onboarding"
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
            >
              Go to Settings
            </Link>
          }
        />

        <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-5 text-sm text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/40 dark:text-yellow-200">
          No active tenant selected. Go to{" "}
          <Link className="underline" href="/onboarding">
            Settings
          </Link>{" "}
          and make sure your tenant is created/selected.
        </div>
      </div>
    );
  }

  const tenant = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!tenant?.slug) redirect("/admin/setup");

  const tenantSlug = tenant.slug;
  const tenantName = tenant.name ?? "Your Business";

  const quoteUrl = baseUrl
    ? `${baseUrl}/q/${encodeURIComponent(tenantSlug)}`
    : `/q/${encodeURIComponent(tenantSlug)}`;

  const linkText = "Get an AI Photo Quote";

  const directLinkHtml = `<a href="${quoteUrl}" target="_blank" rel="noopener">${linkText}</a>`;

  const iframeHtml = `<iframe
  src="${quoteUrl}"
  style="width:100%;max-width:980px;height:900px;border:0;border-radius:16px;overflow:hidden;"
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade"
></iframe>`;

  const popupScript = `<!-- AI Photo Quote Popup Widget -->
<div id="apq-root"></div>
<script>
(function () {
  var quoteUrl = ${JSON.stringify(quoteUrl)};
  var root = document.getElementById("apq-root");
  if (!root) return;

  var btn = document.createElement("button");
  btn.innerText = ${JSON.stringify(linkText)};
  btn.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:999999;padding:12px 16px;border-radius:999px;border:0;background:#111;color:#fff;font-weight:800;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.2);";
  root.appendChild(btn);

  var overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:999998;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;padding:16px;";
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) overlay.style.display = "none";
  });

  var panel = document.createElement("div");
  panel.style.cssText = "width:100%;max-width:980px;height:90vh;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35);position:relative;";

  var close = document.createElement("button");
  close.innerText = "Close";
  close.style.cssText = "position:absolute;top:10px;right:10px;z-index:2;padding:8px 10px;border-radius:10px;border:1px solid rgba(0,0,0,.15);background:rgba(255,255,255,.9);font-weight:800;cursor:pointer;";
  close.addEventListener("click", function () { overlay.style.display = "none"; });

  var iframe = document.createElement("iframe");
  iframe.src = quoteUrl;
  iframe.style.cssText = "width:100%;height:100%;border:0;";

  panel.appendChild(close);
  panel.appendChild(iframe);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  btn.addEventListener("click", function () {
    overlay.style.display = "flex";
  });
})();
</script>`;

  const wordpress = `<!-- WordPress: paste into a Custom HTML block -->
${iframeHtml}`;

  const shopify = `{% comment %} AI Photo Quote Embed {% endcomment %}
<div style="max-width:980px;margin:0 auto;">
${iframeHtml}
</div>`;

  const builders = `<!-- Wix / Squarespace: paste into an Embed/Code block -->
${iframeHtml}`;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <SectionHeader
        title="Widgets"
        subtitle={`Embed your Photo Quote form anywhere. Tenant: ${tenantName}`}
        right={
          <Link
            href="/admin/setup"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Back to Setup
          </Link>
        }
      />

      {/* Public URL */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-black">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Your public quote URL</div>
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              This is the page your embeds point to.
            </div>
          </div>

          <Link
            href={`/q/${encodeURIComponent(tenantSlug)}`}
            target="_blank"
            className="shrink-0 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
          >
            Preview
          </Link>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-950">
          <div className="min-w-0 truncate font-mono text-xs text-gray-700 dark:text-gray-200">{quoteUrl}</div>
          <div className="shrink-0">
            <CopyButtonClient text={quoteUrl} />
          </div>
        </div>
      </div>

      {/* Button options */}
      <ButtonOptions quoteUrl={quoteUrl} />

      {/* Embed options */}
      <div className="grid gap-6">
        <CodeBlock
          title="Option 1: Simple link"
          description="Best if you want a basic hyperlink in your nav, footer, or body text."
          code={directLinkHtml}
        />

        <CodeBlock
          title="Option 2: Embed inline (iframe)"
          description="Best universal option. Put this on any page where you want the form embedded."
          code={iframeHtml}
        />

        <CodeBlock
          title="Option 3: Floating popup widget"
          description="Adds a floating button and opens the form in a popup overlay. Paste before </body> if possible."
          code={popupScript}
        />

        <CodeBlock
          title="WordPress"
          description="Paste into a Custom HTML block (Gutenberg) or an HTML widget."
          code={wordpress}
        />

        <CodeBlock
          title="Shopify"
          description="Paste into a section/template file. Works in Liquid themes."
          code={shopify}
        />

        <CodeBlock
          title="Wix / Squarespace"
          description="Paste into an Embed/Code block."
          code={builders}
        />
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400">
        Tip: If the iframe height is too tall/short, change <span className="font-mono">height:900px</span>.
      </div>
    </div>
  );
}