// src/app/admin/quotes/[id]/email/compose/page.tsx
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { resolveActiveTenantId } from "@/lib/admin/quotes/getActiveTenant";
import { findRedirectTenantForQuote, getAdminQuoteRow } from "@/lib/admin/quotes/getQuote";
import { getQuoteLifecycle } from "@/lib/admin/quotes/getLifecycle";
import { pickLead, pickPhotos } from "@/lib/admin/quotes/pageCompat";
import { safeTrim } from "@/lib/admin/quotes/utils";

import QuoteEmailComposeClient from "@/components/admin/quoteEmail/QuoteEmailComposeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

function asString(v: string | string[] | undefined) {
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v ?? "");
}

function parseCsvList(v: string) {
  return safeTrim(v)
    .split(",")
    .map((x) => safeTrim(x))
    .filter(Boolean);
}

export default async function QuoteEmailComposePage({ params, searchParams }: PageProps) {
  const session = await auth();
  const userId = session.userId;
  if (!userId) redirect("/sign-in");

  const p = await params;
  const id = safeTrim((p as any)?.id);
  if (!id) redirect("/admin/quotes");

  const sp = searchParams ? await searchParams : {};
  const templateKey = safeTrim(asString(sp.template)) || "standard";
  const renderIds = parseCsvList(asString(sp.renders));
  const photoKeys = parseCsvList(asString(sp.photos));

  const jar = await cookies();
  const tenantIdMaybe = await resolveActiveTenantId({ jar, userId });
  if (!tenantIdMaybe) redirect("/admin/quotes");
  const tenantId = String(tenantIdMaybe);

  let row = await getAdminQuoteRow({ id, tenantId });

  if (!row) {
    const redirectTenantId = await findRedirectTenantForQuote({ id, userId });
    if (redirectTenantId) {
      const next = `/admin/quotes/${encodeURIComponent(id)}/email/compose`;
      redirect(
        `/api/admin/tenant/activate?tenantId=${encodeURIComponent(redirectTenantId)}&next=${encodeURIComponent(next)}`
      );
    }
    redirect(`/admin/quotes/${encodeURIComponent(id)}?composeError=not_found`);
  }

  const lead = pickLead(row.input);
  const photos = pickPhotos(row.input);

  const { versionRows, renderRows } = await getQuoteLifecycle({ id, tenantId });

  // Only show rendered attempts in the picker
  const renderedRenders = (renderRows ?? []).filter((r: any) => String(r.status ?? "") === "rendered" && r.imageUrl);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <a
            href={`/admin/quotes/${encodeURIComponent(id)}`}
            className="text-sm font-semibold text-gray-600 hover:underline dark:text-gray-300"
          >
            ← Back to quote
          </a>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">Compose quote email</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Choose a layout, pick images, tweak wording, preview, then send.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Quote ID</div>
          <div className="mt-1 font-mono text-xs text-gray-800 dark:text-gray-200 break-all">{id}</div>
        </div>
      </div>

      <QuoteEmailComposeClient
        quoteId={id}
        tenantId={tenantId}
        lead={lead as any}
        versionRows={versionRows as any}
        customerPhotos={(photos as any[]) ?? []}
        renderedRenders={(renderedRenders as any[]) ?? []}
        initialTemplateKey={templateKey}
        initialSelectedRenderIds={renderIds}
        initialSelectedPhotoKeys={photoKeys}
      />
    </div>
  );
}