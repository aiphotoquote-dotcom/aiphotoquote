// src/app/api/pcc/env/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { platformConfig } from "@/lib/db/schema/platform_config";
import { requirePlatformRole } from "@/lib/rbac/guards";
import { getPlatformConfig } from "@/lib/platform/getPlatformConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

const NullableTrimmedString = (max: number) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    const s = v.trim();
    return s === "" ? null : s;
  }, z.string().max(max).nullable());

const PayloadSchema = z.object({
  aiQuotingEnabled: z.boolean(),
  aiRenderingEnabled: z.boolean(),

  siteMode: z.enum(["marketing_live", "coming_soon"]),
  siteModePayload: z.record(z.string(), z.any()).nullable(),

  adminBannerEnabled: z.boolean(),
  adminBannerText: NullableTrimmedString(500),
  adminBannerTone: z.enum(["info", "success", "warning", "danger"]),
  adminBannerHref: NullableTrimmedString(500),
  adminBannerCtaLabel: NullableTrimmedString(80),

  maintenanceEnabled: z.boolean(),
  maintenanceMessage: NullableTrimmedString(500),
});

export async function GET() {
  try {
    await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

    const cfg = await getPlatformConfig();

    return json({
      ok: true,
      config: cfg,
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "FORBIDDEN",
        message: e?.message ?? "Forbidden.",
      },
      403
    );
  }
}

export async function POST(req: Request) {
  try {
    await requirePlatformRole(["platform_owner", "platform_admin"]);

    const body = await req.json().catch(() => null);
    const parsed = PayloadSchema.safeParse(body);

    if (!parsed.success) {
      return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
    }

    const data = parsed.data;

    await db
      .insert(platformConfig)
      .values({
        id: "singleton",

        aiQuotingEnabled: data.aiQuotingEnabled,
        aiRenderingEnabled: data.aiRenderingEnabled,

        siteMode: data.siteMode,
        siteModePayload: data.siteModePayload ?? null,

        adminBannerEnabled: data.adminBannerEnabled,
        adminBannerText: data.adminBannerText,
        adminBannerTone: data.adminBannerTone,
        adminBannerHref: data.adminBannerHref,
        adminBannerCtaLabel: data.adminBannerCtaLabel,

        maintenanceEnabled: data.maintenanceEnabled,
        maintenanceMessage: data.maintenanceMessage,

        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: platformConfig.id,
        set: {
          aiQuotingEnabled: data.aiQuotingEnabled,
          aiRenderingEnabled: data.aiRenderingEnabled,

          siteMode: data.siteMode,
          siteModePayload: data.siteModePayload ?? null,

          adminBannerEnabled: data.adminBannerEnabled,
          adminBannerText: data.adminBannerText,
          adminBannerTone: data.adminBannerTone,
          adminBannerHref: data.adminBannerHref,
          adminBannerCtaLabel: data.adminBannerCtaLabel,

          maintenanceEnabled: data.maintenanceEnabled,
          maintenanceMessage: data.maintenanceMessage,

          updatedAt: new Date(),
        },
      });

    const saved = await getPlatformConfig();

    return json({
      ok: true,
      config: saved,
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);

    if (msg === "FORBIDDEN") {
      return json({ ok: false, error: "FORBIDDEN", message: "Forbidden." }, 403);
    }

    return json(
      {
        ok: false,
        error: "SAVE_FAILED",
        message: msg,
      },
      500
    );
  }
}