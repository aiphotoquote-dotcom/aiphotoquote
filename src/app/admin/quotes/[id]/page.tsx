import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";

import TopNav from "@/components/TopNav";
import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

function fmtJson(v: any) {
  try {
    return JSON.stringify(v ?? null, null, 2);
  } catch {
    return String(v);
  }
}

async function resolveActiveTenantId(userId: string): Promise<string | null> {
  const jar = await cookies();
  const cookieTenantId =
    jar.get("activeTenantId")?.value ||
    jar.get("active_tenant_id")?.value ||
    jar.get("tenantId")?.value ||
    jar.get("tenant_id")?.value;

  if (cookieTenantId) return cookieTenantId;

  const owned = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.ownerClerkUserId, userId))
    .limit(1);

  return owned[0]?.id ?? null;
}

export default async function AdminQuoteDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const activeTenantId = await resolveActiveTenantId(userId);
  if (!activeTenantId) redirect("/onboarding");

  const id = params.id;

  const rows = await db
    .select()
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, activeTenantId)))
    .limit(1);

  const q: any = rows[0];

  if (!q) {
    return (
      <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        <TopNav />
        <div className="mx-auto max-w-6xl px-6 py-10 space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <h1 className="text-2xl font-semibold">Quote not found</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              This quote either doesn’t exist or isn’t in your active tenant.
            </p>
            <div className="mt-4 flex gap-3">
              <Link
                href="/admin/quotes"
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-black"
              >
                Back to quotes
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const renderStatus = q.renderStatus ?? q.render_status ?? "—";
  const renderImageUrl = q.renderImageUrl ?? q.render_image_url ?? null;

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
      <TopNav />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-sm text-gray-500 dark:text-gray-400">Admin</div>
            <h1 className="text-2xl font-semibold">Quote review</h1>
            <div className="mt-2 font-mono text-xs text-gray-600 dark:text-gray-300">
              {q.id}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Render status: {String(renderStatus)}
            </div>
          </div>

          <Link
            href="/admin/quotes"
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
          >
            Back to quotes
          </Link>
        </div>

        {renderImageUrl ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <h2 className="font-semibold">Rendered image</h2>
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={renderImageUrl} alt="render" className="w-full object-cover" />
            </div>
          </section>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <h2 className="font-semibold">Input</h2>
            <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-800 dark:bg-gray-900">
              {fmtJson(q.input)}
            </pre>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-950">
            <h2 className="font-semibold">Output</h2>
            <pre className="mt-3 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-800 dark:bg-gray-900">
              {fmtJson(q.output)}
            </pre>
          </section>
        </div>
      </div>
    </main>
  );
}
