import { NextResponse } from "next/server";

import { getPlatformConfig } from "@/lib/platform/getPlatformConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await getPlatformConfig();

  return NextResponse.json(
    {
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
    },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        pragma: "no-cache",
        expires: "0",
      },
    }
  );
}