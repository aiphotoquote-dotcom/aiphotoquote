// src/lib/admin/quotes/getLifecycle.ts
import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { quoteNotes, quoteRenders, quoteVersions } from "@/lib/db/schema";
import { safeTrim } from "@/lib/admin/quotes/utils";

export type QuoteVersionRow = {
  id: string;
  version: number;
  createdAt: any;
  createdBy: string;
  source: string;
  reason: string | null;
  aiMode: string | null;
  output: any;
  meta: any;
};

export type QuoteNoteRow = {
  id: string;
  createdAt: any;
  actor: string | null; // keep UI compat (maps to created_by)
  body: string;
  quoteVersionId: string | null;
};

export type QuoteRenderRow = {
  id: string;
  attempt: number;
  status: string;
  createdAt: any;
  imageUrl: string | null;
  prompt: string | null;
  shopNotes: string | null;
  error: string | null;
  quoteVersionId: string;
};

export async function getQuoteLifecycle(args: { id: string; tenantId: string }) {
  const { id, tenantId } = args;

  let versionRows: QuoteVersionRow[] = [];
  let noteRows: QuoteNoteRow[] = [];
  let renderRows: QuoteRenderRow[] = [];
  let lifecycleReadError: string | null = null;

  try {
    versionRows = await db
      .select({
        id: quoteVersions.id,
        version: quoteVersions.version,
        createdAt: quoteVersions.createdAt,
        createdBy: quoteVersions.createdBy,
        source: quoteVersions.source,
        reason: quoteVersions.reason,
        aiMode: quoteVersions.aiMode,
        output: quoteVersions.output,
        meta: quoteVersions.meta,
      })
      .from(quoteVersions)
      .where(and(eq(quoteVersions.quoteLogId, id), eq(quoteVersions.tenantId, tenantId)))
      .orderBy(asc(quoteVersions.version), asc(quoteVersions.createdAt));
  } catch (e: any) {
    lifecycleReadError = safeTrim(e?.message) || "Failed to read quote_versions";
  }

  try {
    // ✅ prod column is created_by; we map it to "actor" for UI compatibility
    noteRows = await db
      .select({
        id: quoteNotes.id,
        createdAt: quoteNotes.createdAt,
        actor: quoteNotes.createdBy,
        body: quoteNotes.body,
        quoteVersionId: quoteNotes.quoteVersionId,
      })
      .from(quoteNotes)
      .where(and(eq(quoteNotes.quoteLogId, id), eq(quoteNotes.tenantId, tenantId)))
      .orderBy(desc(quoteNotes.createdAt))
      .limit(200);
  } catch (e: any) {
    lifecycleReadError = lifecycleReadError ?? (safeTrim(e?.message) || "Failed to read quote_notes");
  }

  try {
    renderRows = await db
      .select({
        id: quoteRenders.id,
        attempt: quoteRenders.attempt,
        status: quoteRenders.status,
        createdAt: quoteRenders.createdAt,
        imageUrl: quoteRenders.imageUrl,
        prompt: quoteRenders.prompt,
        shopNotes: quoteRenders.shopNotes,
        error: quoteRenders.error,
        quoteVersionId: quoteRenders.quoteVersionId,
      })
      .from(quoteRenders)
      .where(and(eq(quoteRenders.quoteLogId, id), eq(quoteRenders.tenantId, tenantId)))
      .orderBy(desc(quoteRenders.createdAt))
      .limit(200);
  } catch (e: any) {
    lifecycleReadError = lifecycleReadError ?? (safeTrim(e?.message) || "Failed to read quote_renders");
  }

  return { versionRows, noteRows, renderRows, lifecycleReadError };
}