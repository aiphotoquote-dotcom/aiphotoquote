// src/lib/platform/getPlatformConfig.ts

import { db } from "@/lib/db/client";
import { platformConfig } from "@/lib/db/schema/platform_config";
import { eq } from "drizzle-orm";

export type PlatformSiteMode = "marketing_live" | "coming_soon";

export type RuntimePlatformConfig = {
  id: string;
  aiQuotingEnabled: boolean;
  aiRenderingEnabled: boolean;

  siteMode: PlatformSiteMode;
  siteModePayload: Record<string, any> | null;

  adminBannerEnabled: boolean;
  adminBannerText: string | null;
  adminBannerTone: "info" | "success" | "warning" | "danger";
  adminBannerHref: string | null;
  adminBannerCtaLabel: string | null;

  maintenanceEnabled: boolean;
  maintenanceMessage: string | null;

  updatedAt: Date;
};

function normalizeSiteMode(v: unknown): PlatformSiteMode {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "coming_soon" ? "coming_soon" : "marketing_live";
}

function normalizeBannerTone(v: unknown): "info" | "success" | "warning" | "danger" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "success") return "success";
  if (s === "warning") return "warning";
  if (s === "danger") return "danger";
  return "info";
}

function normalizeRow(row: any): RuntimePlatformConfig {
  return {
    id: String(row?.id ?? "singleton"),
    aiQuotingEnabled: Boolean(row?.aiQuotingEnabled ?? true),
    aiRenderingEnabled: Boolean(row?.aiRenderingEnabled ?? false),

    siteMode: normalizeSiteMode(row?.siteMode),
    siteModePayload:
      row?.siteModePayload && typeof row.siteModePayload === "object" ? row.siteModePayload : null,

    adminBannerEnabled: Boolean(row?.adminBannerEnabled ?? false),
    adminBannerText: row?.adminBannerText ? String(row.adminBannerText) : null,
    adminBannerTone: normalizeBannerTone(row?.adminBannerTone),
    adminBannerHref: row?.adminBannerHref ? String(row.adminBannerHref) : null,
    adminBannerCtaLabel: row?.adminBannerCtaLabel ? String(row.adminBannerCtaLabel) : null,

    maintenanceEnabled: Boolean(row?.maintenanceEnabled ?? false),
    maintenanceMessage: row?.maintenanceMessage ? String(row.maintenanceMessage) : null,

    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt : new Date(),
  };
}

/**
 * Always returns the platform config.
 * If the singleton row does not exist, it is created automatically.
 */
export async function getPlatformConfig(): Promise<RuntimePlatformConfig> {
  try {
    const rows = await db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.id, "singleton"))
      .limit(1);

    if (rows.length === 1) {
      return normalizeRow(rows[0]);
    }

    const inserted = await db
      .insert(platformConfig)
      .values({ id: "singleton" })
      .returning();

    return normalizeRow(inserted[0]);
  } catch {
    /**
     * LAST-RESORT SAFE DEFAULTS
     * (prevents total platform lockout if DB is unavailable or migrations lag)
     */
    return {
      id: "singleton",
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

      updatedAt: new Date(),
    };
  }
}