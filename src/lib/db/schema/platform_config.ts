// src/lib/db/schema/platform_config.ts
import { pgTable, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const platformConfig = pgTable("platform_config", {
  id: text("id").primaryKey().notNull().default("singleton"),

  aiQuotingEnabled: boolean("ai_quoting_enabled").notNull().default(true),
  aiRenderingEnabled: boolean("ai_rendering_enabled").notNull().default(true),

  siteMode: text("site_mode").notNull().default("marketing_live"),
  siteModePayload: jsonb("site_mode_payload").$type<Record<string, any> | null>(),

  /**
   * Onboarding mode
   * - open: normal self-serve onboarding
   * - invite_only: requires a valid invite/code
   */
  onboardingMode: text("onboarding_mode").notNull().default("open"),

  adminBannerEnabled: boolean("admin_banner_enabled").notNull().default(false),
  adminBannerText: text("admin_banner_text"),
  adminBannerTone: text("admin_banner_tone").notNull().default("info"),
  adminBannerHref: text("admin_banner_href"),
  adminBannerCtaLabel: text("admin_banner_cta_label"),

  maintenanceEnabled: boolean("maintenance_enabled").notNull().default(false),
  maintenanceMessage: text("maintenance_message"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});