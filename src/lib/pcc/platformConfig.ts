// src/lib/pcc/platformConfig.ts
import { db } from "@/lib/db/client";
import { platformConfig } from "@/lib/db/schema/platform_config";

export type PlatformSiteMode = "marketing_live" | "coming_soon";
export type PlatformBannerTone = "info" | "success" | "warning" | "danger";

export type PlatformConfig = {
  aiQuotingEnabled: boolean;
  aiRenderingEnabled: boolean;

  siteMode: PlatformSiteMode;
  siteModePayload: Record<string, any> | null;

  adminBannerEnabled: boolean;
  adminBannerText: string | null;
  adminBannerTone: PlatformBannerTone;
  adminBannerHref: string | null;
  adminBannerCtaLabel: string | null;

  maintenanceEnabled: boolean;
  maintenanceMessage: string | null;
};

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  aiQuotingEnabled: true,
  aiRenderingEnabled: false,

  siteMode: "marketing_live",
  siteModePayload: null,

  adminBannerEnabled: false,
  adminBannerText: null,
  adminBannerTone: "info",
  adminBannerHref: null,
  adminBannerCtaLabel: null,

  maintenanceEnabled: false,
  maintenanceMessage: null,
};

function normalizeSiteMode(v: unknown): PlatformSiteMode {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "coming_soon" ? "coming_soon" : "marketing_live";
}

function normalizeBannerTone(v: unknown): PlatformBannerTone {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "success") return "success";
  if (s === "warning") return "warning";
  if (s === "danger") return "danger";
  return "info";
}

/**
 * Read platform config (single row).
 * - If there are 0 rows, return defaults.
 * - If table isn't migrated yet or query fails, return defaults (no hard crash).
 */
export async function getPlatformConfig(): Promise<PlatformConfig> {
  try {
    const rows = await db.select().from(platformConfig).limit(1);
    const r = rows?.[0];

    if (!r) return DEFAULT_PLATFORM_CONFIG;

    return {
      aiQuotingEnabled: Boolean((r as any).aiQuotingEnabled),
      aiRenderingEnabled: Boolean((r as any).aiRenderingEnabled),

      siteMode: normalizeSiteMode((r as any).siteMode),
      siteModePayload:
        (r as any).siteModePayload && typeof (r as any).siteModePayload === "object"
          ? (r as any).siteModePayload
          : null,

      adminBannerEnabled: Boolean((r as any).adminBannerEnabled),
      adminBannerText: (r as any).adminBannerText ? String((r as any).adminBannerText) : null,
      adminBannerTone: normalizeBannerTone((r as any).adminBannerTone),
      adminBannerHref: (r as any).adminBannerHref ? String((r as any).adminBannerHref) : null,
      adminBannerCtaLabel: (r as any).adminBannerCtaLabel ? String((r as any).adminBannerCtaLabel) : null,

      maintenanceEnabled: Boolean((r as any).maintenanceEnabled),
      maintenanceMessage: (r as any).maintenanceMessage ? String((r as any).maintenanceMessage) : null,
    };
  } catch {
    return DEFAULT_PLATFORM_CONFIG;
  }
}