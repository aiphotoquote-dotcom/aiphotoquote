import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, quoteLogs } from "@/lib/db/schema";

export const runtime = "nodejs";

const Req = z.object({
  tenantSlug: z.string().min(2),
  images: z.array(
    z.object({
      url: z.string().url(),
      shotType: z.string().optional(),
    })
  ).min(1),
  customer_context: z.object({
    notes: z.string().optional(),
    category: z.string().optional(),
    service_type: z.string().optional(),
  }).optional(),
  contact: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(7),
  }),
  render_opt_in: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const debugId = crypto.randomUUID();

  try {
    const json = await req.json();
    const parsed = Req.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_REQUEST",
          issues: parsed.error.issues,
          debugId,
        },
        { status: 400 }
      );
    }

    const { tenantSlug, render_opt_in, ...input } = parsed.data;

    // 1) Resolve tenant
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.slug, tenantSlug),
      columns: { id: true },
    });

    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "TENANT_NOT_FOUND", debugId },
        { status: 404 }
      );
    }

    // 2) Insert quote with REQUIRED output placeholder
    const [row] = await db
      .insert(quoteLogs)
      .values({
        tenantId: tenant.id,
        input,
        output: {
          status: "pending",
          message: "Quote submitted, analysis pending",
        },
        renderOptIn: Boolean(render_opt_in),
        renderStatus: render_opt_in ? "queued" : "not_requested",
      })
      .returning({ id: quoteLogs.id });

    return NextResponse.json({
      ok: true,
      quoteLogId: row.id,
      output: {
        status: "pending",
        message: "Quote received. We’ll email you shortly.",
      },
    });

  } catch (err: any) {
    console.error("QUOTE_SUBMIT_ERROR", debugId, err);
    return NextResponse.json(
      {
        ok: false,
        error: "REQUEST_FAILED",
        message: err?.message ?? "Unknown error",
        debugId,
      },
      { status: 500 }
    );
  }
}
