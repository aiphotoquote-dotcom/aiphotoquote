import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  numeric,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * Tenants (one per customer/business)
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex("tenants_slug_unique").on(t.slug),
  })
);

/**
 * Supported industries (seeded)
 */
export const industries = pgTable(
  "industries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    keyIdx: uniqueIndex("industries_key_unique").on(t.key),
  })
);

/**
 * Tenant-level settings
 */
export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  industryKey: text("industry_key").notNull(),
  redirectUrl: text("redirect_url"),
  thankYouUrl: text("thank_you_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Pricing guardrails per tenant
 */
export const tenantPricingRules = pgTable("tenant_pricing_rules", {
  tenantId: uuid("tenant_id").primaryKey(),
  minJob: numeric("min_job"),
  typicalLow: numeric("typical_low"),
  typicalHigh: numeric("typical_high"),
  maxWithoutInspection: numeric("max_without_inspection"),
  serviceFee: numeric("service_fee"),
  tone: text("tone").default("value").notNull(),
  riskPosture: text("risk_posture").default("conservative").notNull(),
  alwaysEstimateLanguage: boolean("always_estimate_language")
    .default(true)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Encrypted tenant secrets (OpenAI keys, etc.)
 */
export const tenantSecrets = pgTable("tenant_secrets", {
  tenantId: uuid("tenant_id").primaryKey(),
  openaiKeyEnc: text("openai_key_enc"),
  openaiKeyLast4: text("openai_key_last4"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Quote request + response logs
 */
export const quoteLogs = pgTable("quote_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  input: jsonb("input").notNull(),
  output: jsonb("output").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
