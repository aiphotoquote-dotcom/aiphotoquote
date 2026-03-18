// src/app/api/platform/public/route.ts

import { NextResponse } from "next/server";

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

export async function GET() {
  try {
    const cfg = await getPlatformConfig();

    return json({
      ok: true,
      config: {
        siteMode: cfg.siteMode,
        siteModePayload: cfg.siteModePayload,

        adminBannerEnabled: cfg.adminBannerEnabled,
        adminBannerText: cfg.adminBannerText,
        adminBannerTone: cfg.adminBannerTone,
        adminBannerHref: cfg.adminBannerHref,
        adminBannerCtaLabel: cfg.adminBannerCtaLabel,

        maintenanceEnabled: cfg.maintenanceEnabled,
        maintenanceMessage: cfg.maintenanceMessage,
      },
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "PLATFORM_PUBLIC_FAILED",
        message: e?.message ?? "Failed to load platform config.",
      },
      500
    );
  }
}