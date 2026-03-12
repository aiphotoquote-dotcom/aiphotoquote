// src/app/api/admin/quotes/[id]/notes/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { adminReassessQuote, type AdminReassessEngine, type QuoteLogRow } from "@/lib/quotes/adminReassess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  reassess: z.boolean().optional().default(false),
  engine: z.enum(["openai_assessment", "deterministic_only"]).optional().default("openai_assessment"),
  linkNoteToVersion: z.boolean().optional().default(true),
  contextNotesLimit: z.number().int().min(1).max(200).optional().default(50),
});

function safeTrim(v: unknown) {
  const s = String(v ?? "").trim();
  return s ? s : "";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });

  const p = await ctx.params;
  const quoteLogId = safeTrim((p as any)?.id);
  if (!quoteLogId) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

  const bodyJson = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY", issues: parsed.error.issues }, { status: 400 });
  }

  const { body, reassess, engine, linkNoteToVersion, contextNotesLimit } = parsed.data;

  // Load quote log (strict by ID)
  const qr = await db.execute(sql`
    select
      id::text as "id",
      tenant_id::text as "tenant_id",
      input as "input",
      qa as "qa",
      output as "output"
    from quote_logs
    where id = ${quoteLogId}::uuid
    limit 1
  `);

  const qrow: any = (qr as any)?.rows?.[0] ?? (Array.isArray(qr) ? (qr as any)[0] : null);
  if (!qrow?.id || !qrow?.tenant_id) {
    return NextResponse.json({ ok: false, error: "QUOTE_NOT_FOUND" }, { status: 404 });
  }

  const tenantId = String(qrow.tenant_id);

  // Membership check: must be active member of this tenant
  const mr = await db.execute(sql`
    select 1 as ok
    from tenant_members
    where tenant_id = ${tenantId}::uuid
      and clerk_user_id = ${userId}
      and status = 'active'
    limit 1
  `);
  const mok = Boolean((mr as any)?.rows?.[0]?.ok);
  if (!mok) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  // Insert note (unlinked for now)
  const nr = await db.execute(sql`
    insert into quote_notes (
      quote_log_id,
      tenant_id,
      body,
      created_by,
      created_at
    )
    values (
      ${quoteLogId}::uuid,
      ${tenantId}::uuid,
      ${body},
      ${userId},
      now()
    )
    returning id::text as "id", created_at as "created_at"
  `);

  const nrow: any = (nr as any)?.rows?.[0] ?? (Array.isArray(nr) ? (nr as any)[0] : null);
  const noteId = String(nrow?.id ?? "");
  if (!noteId) return NextResponse.json({ ok: false, error: "FAILED_TO_CREATE_NOTE" }, { status: 500 });

  // Fast path: note only
  if (!reassess) {
    return NextResponse.json({ ok: true, noteId, reassessed: false });
  }

  // Reassess via shared engine (creates quote_versions row + updates quote_logs.output)
  const quoteLog: QuoteLogRow = {
    id: String(qrow.id),
    tenant_id: tenantId,
    input: qrow.input ?? {},
    qa: qrow.qa ?? {},
    output: qrow.output ?? {},
  };

  const result = await adminReassessQuote({
    quoteLog,
    createdBy: userId,
    engine: engine as AdminReassessEngine,
    contextNotesLimit,
    source: "admin.notes",
    reason: "reassess_from_notes",
  });

  // Link note -> version (optional)
  if (linkNoteToVersion) {
    await db.execute(sql`
      update quote_notes
      set quote_version_id = ${result.versionId}::uuid
      where id = ${noteId}::uuid
        and tenant_id = ${tenantId}::uuid
    `);
  }

  return NextResponse.json({
    ok: true,
    noteId,
    reassessed: true,
    engine,
    versionId: result.versionId,
    version: result.version,
  });
}