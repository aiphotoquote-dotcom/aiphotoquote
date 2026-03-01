// src/app/admin/quotes/[id]/actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenantMembers } from "@/lib/db/schema";
import { resolveActiveTenantId } from "@/lib/admin/quotes/getActiveTenant";

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

async function ensureActiveMembership(actorUserId: string, tenantIdNow: string) {
  const membership = await db
    .select({ ok: sql<number>`1` })
    .from(tenantMembers)
    .where(
      and(eq(tenantMembers.tenantId, tenantIdNow), eq(tenantMembers.clerkUserId, actorUserId), eq(tenantMembers.status, "active"))
    )
    .limit(1)
    .then((r) => r[0] ?? null);

  return Boolean(membership?.ok);
}

export async function deleteRenderAction(formData: FormData) {
  const session = await auth();
  const actorUserId = session.userId;
  if (!actorUserId) redirect("/sign-in");

  const quoteId = safeTrim(formData.get("quote_id"));
  const renderId = safeTrim(formData.get("render_id"));
  if (!quoteId || !renderId) redirect("/admin/quotes");

  const jar = await cookies();
  const tenantIdNowMaybe = await resolveActiveTenantId({ jar, userId: actorUserId });
  if (!tenantIdNowMaybe) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?deleteError=no_active_tenant#renders`);
  const tenantIdNow = String(tenantIdNowMaybe);

  const okMember = await ensureActiveMembership(actorUserId, tenantIdNow);
  if (!okMember) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?deleteError=forbidden#renders`);

  await db.execute(sql`
    delete from quote_renders
    where id = ${renderId}::uuid
      and tenant_id = ${tenantIdNow}::uuid
      and quote_log_id = ${quoteId}::uuid
  `);

  redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#renders`);
}

export async function deleteNoteAction(formData: FormData) {
  const session = await auth();
  const actorUserId = session.userId;
  if (!actorUserId) redirect("/sign-in");

  const quoteId = safeTrim(formData.get("quote_id"));
  const noteId = safeTrim(formData.get("note_id"));
  if (!quoteId || !noteId) redirect("/admin/quotes");

  const jar = await cookies();
  const tenantIdNowMaybe = await resolveActiveTenantId({ jar, userId: actorUserId });
  if (!tenantIdNowMaybe) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?deleteError=no_active_tenant#lifecycle`);
  const tenantIdNow = String(tenantIdNowMaybe);

  const okMember = await ensureActiveMembership(actorUserId, tenantIdNow);
  if (!okMember) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?deleteError=forbidden#lifecycle`);

  await db.execute(sql`
    delete from quote_notes
    where id = ${noteId}::uuid
      and tenant_id = ${tenantIdNow}::uuid
      and quote_log_id = ${quoteId}::uuid
  `);

  redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#lifecycle`);
}

export async function deleteVersionAction(formData: FormData) {
  const session = await auth();
  const actorUserId = session.userId;
  if (!actorUserId) redirect("/sign-in");

  const quoteId = safeTrim(formData.get("quote_id"));
  const versionId = safeTrim(formData.get("version_id"));
  const versionNumber = safeTrim(formData.get("version_number"));
  const activeVersion = safeTrim(formData.get("active_version"));

  if (!quoteId || !versionId) redirect("/admin/quotes");

  // Prevent deleting active version (UI safety)
  if (activeVersion && versionNumber && Number(activeVersion) === Number(versionNumber)) {
    redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?deleteError=cannot_delete_active_version#lifecycle`);
  }

  const jar = await cookies();
  const tenantIdNowMaybe = await resolveActiveTenantId({ jar, userId: actorUserId });
  if (!tenantIdNowMaybe) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?deleteError=no_active_tenant#lifecycle`);
  const tenantIdNow = String(tenantIdNowMaybe);

  const okMember = await ensureActiveMembership(actorUserId, tenantIdNow);
  if (!okMember) redirect(`/admin/quotes/${encodeURIComponent(quoteId)}?deleteError=forbidden#lifecycle`);

  // Delete renders attached to this version
  await db.execute(sql`
    delete from quote_renders
    where tenant_id = ${tenantIdNow}::uuid
      and quote_log_id = ${quoteId}::uuid
      and quote_version_id = ${versionId}::uuid
  `);

  // Delete notes linked to this version
  await db.execute(sql`
    delete from quote_notes
    where tenant_id = ${tenantIdNow}::uuid
      and quote_log_id = ${quoteId}::uuid
      and quote_version_id = ${versionId}::uuid
  `);

  // Delete the version itself
  await db.execute(sql`
    delete from quote_versions
    where id = ${versionId}::uuid
      and tenant_id = ${tenantIdNow}::uuid
      and quote_log_id = ${quoteId}::uuid
  `);

  redirect(`/admin/quotes/${encodeURIComponent(quoteId)}#lifecycle`);
}