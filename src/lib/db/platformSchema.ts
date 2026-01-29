// src/lib/db/platformSchema.ts
import { pgTable, boolean, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Single-row table.
 * PCC will manage this later (v2), but v1 is read-only.
 */
export const platformConfig = pgTable("platform_config", {
  // Feature gates
  aiQuotingEnabled: boolean("ai_quoting_enabled").notNull().default(true),
  aiRenderingEnabled: boolean("ai_rendering_enabled").notNull().default(false),

  // Emergency controls
  maintenanceEnabled: boolean("maintenance_enabled").notNull().default(false),
  maintenanceMessage: text("maintenance_message"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});