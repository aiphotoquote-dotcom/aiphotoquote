// 🔧 PATCH: Blob upload failures are now NON-FATAL

// (File header unchanged)
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* -------------------- helpers -------------------- */

const Req = z.object({
  tenantSlug: z.string().min(3),
  quoteLogId: z.string().uuid(),
});

function json(data: any, status = 200, debugId?: string) {
  return NextResponse.json(
    debugId ? { debugId, ...data } : data,
    { status }
  );
}

function safeJson(v: any) {
  try {
    if (v == null) return null;
    if (typeof v === "object") return v;
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function getBaseUrl(req: Request) {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  return `${proto}://${host}`;
}

/* -------------------- route -------------------- */

export async function POST(req: Request) {
  const debugId = crypto.randomBytes(6).toString("hex");

  try {
    const body = Req.parse(await req.json());
    const { tenantSlug, quoteLogId } = body;

    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)
      .then(r => r[0]);

    if (!tenant) {
      return json({ ok: false, error: "TENANT_NOT_FOUND" }, 404, debugId);
    }

    const keyEnc = await db.execute(sql`
      select openai_key_enc
      from tenant_secrets
      where tenant_id = ${tenant.id}
      limit 1
    `);

    const openAiKey = decryptSecret(keyEnc.rows[0]?.openai_key_enc);
    if (!openAiKey) {
      return json({ ok: false, error: "OPENAI_KEY_MISSING" }, 500, debugId);
    }

    const logRes = await db.execute(sql`
      select input, output
      from quote_logs
      where id = ${quoteLogId}::uuid
      limit 1
    `);

    const row = logRes.rows[0];
    const input = safeJson(row.input) || {};
    const output = safeJson(row.output) || {};

    if (!input.render_opt_in) {
      return json({ ok: false, error: "NOT_OPTED_IN" }, 400, debugId);
    }

    const images = input.images?.map((i: any) => i.url).filter(Boolean);
    if (!images?.length) {
      return json({ ok: false, error: "NO_IMAGES" }, 400, debugId);
    }

    const prompt = [
      "Create a realistic after-completion upholstery rendering.",
      input.customer_context?.notes && `Customer notes: ${input.customer_context.notes}`,
    ].filter(Boolean).join("\n");

    const openai = new OpenAI({ apiKey: openAiKey });

    const img = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    } as any);

    const openAiUrl = img.data?.[0]?.url;
    if (!openAiUrl) {
      throw new Error("OpenAI returned no image URL");
    }

    let finalUrl = openAiUrl;

    // 🔧 NON-FATAL blob upload
    try {
      const baseUrl = getBaseUrl(req);
      const res = await fetch(openAiUrl);
      const buf = await res.arrayBuffer();

      const fd = new FormData();
      fd.append(
        "files",
        new Blob([buf], { type: "image/png" }),
        `render-${quoteLogId}.png`
      );

      const up = await fetch(`${baseUrl}/api/blob/upload`, {
        method: "POST",
        body: fd,
      });

      const j = await up.json();
      if (j?.ok && j.files?.[0]?.url) {
        finalUrl = j.files[0].url;
      }
    } catch {
      // swallow blob failure
    }

    await db.execute(sql`
      update quote_logs
      set output = ${JSON.stringify({
        ...output,
        rendering: {
          status: "rendered",
          imageUrl: finalUrl,
        },
      })}::jsonb
      where id = ${quoteLogId}::uuid
    `);

    return json(
      {
        ok: true,
        imageUrl: finalUrl,
      },
      200,
      debugId
    );

  } catch (err: any) {
    return json(
      { ok: false, error: err.message || "REQUEST_FAILED" },
      500,
      debugId
    );
  }
}
