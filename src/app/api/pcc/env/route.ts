// src/app/api/pcc/env/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

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

const PayloadSchema = z.object({
  aiQuotingEnabled: z.boolean(),
  aiRenderingEnabled: z.boolean(),

  siteMode: z.enum(["marketing_live", "coming_soon"]),
  siteModePayload: z.record(z.string(), z.any()).nullable(),

  onboardingMode: z.enum(["open", "invite_only"]),

  adminBannerEnabled: z.boolean(),
  adminBannerText: z.string().trim().max(500).nullable(),
  adminBannerTone: z.enum(["info", "success", "warning", "danger"]),
  adminBannerHref: z.string().trim().max(500).nullable(),
  adminBannerCtaLabel: z.string().trim().max(80).nullable(),

  maintenanceEnabled: z.boolean(),
  maintenanceMessage: z.string().trim().max(500).nullable(),
});

export async function GET() {
  await requirePlatformRole(["platform_owner", "platform_admin", "platform_support"]);

  const cfg = await getPlatformConfig();

  return json({
    ok: true,
    config: cfg,
  });
}

export async function POST(req: Request) {
  await requirePlatformRole(["platform_owner", "platform_admin"]);

  const body = await req.json().catch(() => null);
  const parsed = PayloadSchema.safeParse(body);

  if (!parsed.success) {
    return json({ ok: false, error: "BAD_REQUEST", issues: parsed.error.issues }, 400);
  }

  const data = parsed.data;

  try {
    await db
      .insert(platformConfig)
      .values({
        id: "singleton",

        aiQuotingEnabled: data.aiQuotingEnabled,
        aiRenderingEnabled: data.aiRenderingEnabled,

        siteMode: data.siteMode,
        siteModePayload: data.siteModePayload ?? null,

        onboardingMode: data.onboardingMode,

        adminBannerEnabled: data.adminBannerEnabled,
        adminBannerText: data.adminBannerText ?? null,
        adminBannerTone: data.adminBannerTone,
        adminBannerHref: data.adminBannerHref ?? null,
        adminBannerCtaLabel: data.adminBannerCtaLabel ?? null,

        maintenanceEnabled: data.maintenanceEnabled,
        maintenanceMessage: data.maintenanceMessage ?? null,

        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: platformConfig.id,
        set: {
          aiQuotingEnabled: data.aiQuotingEnabled,
          aiRenderingEnabled: data.aiRenderingEnabled,

          siteMode: data.siteMode,
          siteModePayload: data.siteModePayload ?? null,

          onboardingMode: data.onboardingMode,

          adminBannerEnabled: data.adminBannerEnabled,
          adminBannerText: data.adminBannerText ?? null,
          adminBannerTone: data.adminBannerTone,
          adminBannerHref: data.adminBannerHref ?? null,
          adminBannerCtaLabel: data.adminBannerCtaLabel ?? null,

          maintenanceEnabled: data.maintenanceEnabled,
          maintenanceMessage: data.maintenanceMessage ?? null,

          updatedAt: new Date(),
        },
      });

    const saved = await db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.id, "singleton"))
      .limit(1);

    return json({
      ok: true,
      config: saved[0] ?? null,
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "SAVE_FAILED",
        message: e?.message ?? String(e),
      },
      500
    );
  }
}