import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  uuid,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

/**
 * Tenants
 * NOTE: ownerClerkUserId is nullable temporarily to avoid migration failures
 * on existing rows. We'll backfill and make it NOT NULL next.
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),

    // TEMP nullable to allow smooth migration
    ownerClerkUserId: text("owner_clerk_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex("tenants_slug_idx").on(t.slug),
  })
);

/**
 * Tenant settings (non-sensitive)
 * DB reality (prod):
 *  - tenant_id (uuid) PK
 *  - industry_key (text)
 *  - redirect_url (text)
 *  - thank_you_url (text)
 *  - updated_at (timestamptz)
 *
 * Added:
 *  - reporting_timezone (text)  e.g. "America/New_York"
 *  - week_starts_on (int)       0..6 (Sun..Sat)
 */
export const tenantSettings = pgTable("tenant_settings", {
  // ✅ tenant_id is the PK in the live DB
  tenantId: uuid("tenant_id")
    .notNull()
    .primaryKey()
    .references(() => tenants.id),

  industryKey: text("industry_key").notNull(),

  redirectUrl: text("redirect_url"),
  thankYouUrl: text("thank_you_url"),

  // ✅ NEW reporting config
  reportingTimezone: text("reporting_timezone"),
  weekStartsOn: integer("week_starts_on"),

  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

/**
 * Tenant pricing guardrails
 */
export const tenantPricingRules = pgTable("tenant_pricing_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),

  minJob: integer("min_job"),
  typicalLow: integer("typical_low"),
  typicalHigh: integer("typical_high"),
  maxWithoutInspection: integer("max_without_inspection"),

  tone: text("tone").default("value"),
  riskPosture: text("risk_posture").default("conservative"),
  alwaysEstimateLanguage: boolean("always_estimate_language")
    .default(true)
    .notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Encrypted tenant secrets (never returned raw)
 */
export const tenantSecrets = pgTable("tenant_secrets", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),

  openaiKeyEnc: text("openai_key_enc").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Quote logs — MUST match prod DB.
 *
 * Prod table (confirmed):
 * id, tenant_id, input, output, created_at,
 * render_opt_in, render_status, render_image_url,
 * render_prompt, render_error, rendered_at
 */
export const quoteLogs = pgTable("quote_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),

  input: jsonb("input").$type<any>().notNull(),
  output: jsonb("output").$type<any>().notNull(),

  // --- AI Rendering (optional 2nd step) ---
  renderOptIn: boolean("render_opt_in").notNull().default(false),

  // "not_requested" | "queued" | "running" | "rendered" | "failed"
  renderStatus: text("render_status").notNull().default("not_requested"),

  renderImageUrl: text("render_image_url"),
  renderPrompt: text("render_prompt"),
  renderError: text("render_error"),
  renderedAt: timestamp("rendered_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Industries
 * Model existing table without trying to change PKs.
 * Assumes industries.id already exists and is the PK in your DB.
 */
export const industries = pgTable(
  "industries",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    keyIdx: uniqueIndex("industries_key_idx").on(t.key),
  })
);
