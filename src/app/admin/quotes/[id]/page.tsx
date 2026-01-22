import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { quoteLogs, tenants } from "@/lib/db/schema";

export const runtime = "nodejs";

type PageProps = {
  params: { id: string };
};

const STAGES = [
  { key: "new", label: "New" },
  { key: "estimate", label: "Estimate" },
  { key: "contacted", label: "Contacted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "quoted", label: "Quoted" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

function normalizeStage(s: unknown): StageKey {
  const v = String(s ?? "").toLowerCase().trim();
  const hit = STAGES.find((x) => x.key === v)?.key;
  return (hit ?? "new") as StageKey;
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

export default async function AdminQuoteReviewPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const jar = await cookies();
  let tenantId = getCookieTenantId(jar);

  // fallback: tenant owned by user
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
      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-xl font-semibold">Quote</h1>
        <p className="mt-3 text-sm text-gray-600">
          No active tenant selected.
        </p>
        <Link href="/onboarding" className="underline">
          Go to Settings
        </Link>
      </div>
    );
  }

  /** 🔒 IMPORTANT: narrow for server actions */
  const tenantIdStrict = tenantId as string;
  const id = params.id;

  const row = await db
    .select({
      id: quoteLogs.id,
      createdAt: quoteLogs.createdAt,
      input: quoteLogs.input,
      stage: quoteLogs.stage,
      isRead: quoteLogs.isRead,
      renderStatus: quoteLogs.renderStatus,
    })
    .from(quoteLogs)
    .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantIdStrict)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-xl font-semibold">Quote not found</h1>
        <Link href="/admin/quotes" className="underline">
          Back to quotes
        </Link>
      </div>
    );
  }

  /** ✅ AUTO-MARK READ ON OPEN */
  if (!row.isRead) {
    await db
      .update(quoteLogs)
      .set({ isRead: true } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantIdStrict)));

    row.isRead = true;
  }

  async function setStage(formData: FormData) {
    "use server";
    const next = normalizeStage(formData.get("stage"));
    await db
      .update(quoteLogs)
      .set({ stage: next } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantIdStrict)));

    redirect(`/admin/quotes/${id}`);
  }

  async function markUnread() {
    "use server";
    await db
      .update(quoteLogs)
      .set({ isRead: false } as any)
      .where(and(eq(quoteLogs.id, id), eq(quoteLogs.tenantId, tenantIdStrict)));

    redirect(`/admin/quotes/${id}`);
  }

  const stage = normalizeStage(row.stage);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Quote Review</h1>
        <Link
          href="/admin/quotes"
          className="text-sm underline text-gray-600"
        >
          Back to quotes
        </Link>
      </div>

      {/* Status row */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full border px-3 py-1 text-xs font-semibold bg-gray-100">
          {row.isRead ? "Read" : "Unread"}
        </span>

        <span className="rounded-full border px-3 py-1 text-xs font-semibold bg-blue-50">
          Stage: {STAGES.find((s) => s.key === stage)?.label}
        </span>

        {row.renderStatus ? (
          <span className="rounded-full border px-3 py-1 text-xs font-semibold bg-green-50">
            Render: {row.renderStatus}
          </span>
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Only allow reverting to unread */}
        <form action={markUnread}>
          <button
            type="submit"
            className="rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
          >
            Mark unread
          </button>
        </form>

        {/* Stage select */}
        <form action={setStage} className="flex items-center gap-2">
          <label className="text-sm font-semibold">Stage</label>
          <select
            name="stage"
            defaultValue={stage}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            Update
          </button>
        </form>
      </div>

      {/* Raw payload (temporary) */}
      <div className="rounded-xl border bg-gray-50 p-4">
        <div className="text-xs font-semibold text-gray-600 mb-2">
          Quote payload (debug)
        </div>
        <pre className="text-xs overflow-auto">
          {JSON.stringify(row.input, null, 2)}
        </pre>
      </div>
    </div>
  );
}