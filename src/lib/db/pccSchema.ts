// src/lib/db/pccSchema.ts
import { pgTable, text, timestamp, uuid, integer, jsonb, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";

export const platformRoleEnum = ["platform_owner", "platform_admin", "platform_support", "platform_billing"] as const;
export type PlatformRole = (typeof platformRoleEnum)[number];

export const platformMembers = pgTable("platform_members", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  role: text("role").notNull(), // constrained in app logic to PlatformRole
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorClerkUserId: text("actor_clerk_user_id").notNull(),
    tenantId: uuid("tenant_id"), // nullable because platform-wide events exist
    action: text("action").notNull(),
    meta: jsonb("meta").$type<Record<string, any>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: uniqueIndex("audit_events_id_idx").on(t.id),
  })
);

/**
 * Billing-ready (not full billing):
 * This is the "control plane" surface PCC will edit.
 */
export const tenantPlans = pgTable("tenant_plans", {
  tenantId: uuid("tenant_id").primaryKey(),
  planKey: text("plan_key").notNull().default("free"),
  status: text("status").notNull().default("active"), // active | past_due | canceled (app-controlled)
  seatsLimit: integer("seats_limit"),
  rendersIncluded: integer("renders_included"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Optional rollup for billing/insights later.
 * You can start writing to it whenever.
 */
export const tenantUsageMonthly = pgTable(
  "tenant_usage_monthly",
  {
    tenantId: uuid("tenant_id").notNull(),
    yyyymm: integer("yyyymm").notNull(), // e.g. 202601
    quotesCount: integer("quotes_count").notNull().default(0),
    rendersCount: integer("renders_count").notNull().default(0),
    storageBytes: integer("storage_bytes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.yyyymm] }),
    uniq: uniqueIndex("tenant_usage_monthly_tenant_yyyymm_idx").on(t.tenantId, t.yyyymm),
  })
);