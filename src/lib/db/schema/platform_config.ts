import { pgTable, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const platformConfig = pgTable("platform_config", {
  // singleton row id
  id: text("id").primaryKey().notNull().default("singleton"),

  // Global switches
  aiQuotingEnabled: boolean("ai_quoting_enabled").notNull().default(true),
  aiRenderingEnabled: boolean("ai_rendering_enabled").notNull().default(true),

  // Public website mode
  siteMode: text("site_mode").notNull().default("marketing_live"),
  siteModePayload: jsonb("site_mode_payload").$type<Record<string, any> | null>(),

  // Admin banner
  adminBannerEnabled: boolean("admin_banner_enabled").notNull().default(false),
  adminBannerText: text("admin_banner_text"),
  adminBannerTone: text("admin_banner_tone").notNull().default("info"),
  adminBannerHref: text("admin_banner_href"),
  adminBannerCtaLabel: text("admin_banner_cta_label"),

  // Maintenance
  maintenanceEnabled: boolean("maintenance_enabled").notNull().default(false),
  maintenanceMessage: text("maintenance_message"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});