import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const platformConfig = pgTable("platform_config", {
  // singleton row id
  id: text("id").primaryKey().notNull().default("singleton"),

  // Global switches
  aiQuotingEnabled: boolean("ai_quoting_enabled").notNull().default(true),
  aiRenderingEnabled: boolean("ai_rendering_enabled").notNull().default(true),

  // Maintenance
  maintenanceEnabled: boolean("maintenance_enabled").notNull().default(false),
  maintenanceMessage: text("maintenance_message"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});