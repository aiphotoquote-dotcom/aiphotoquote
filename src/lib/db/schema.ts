// src/lib/db/schema.ts
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
 * Portable internal users.
 * This is the anchor for mobility: swap auth providers later without rewriting tenant ownership.
 */
export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authProvider: text("auth_provider").notNull(),
    authSubject: text("auth_subject").notNull(),
    email: text("email"),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerSubjectUq: uniqueIndex("app_users_provider_subject_uq").on(
      t.authProvider,
      t.authSubject
    ),
  })
);

export const tenantEmailIdentities = pgTable(
  "tenant_email_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    provider: text("provider").notNull(),
    email: text("email").notNull(),

    displayName: text("display_name"),
    status: text("status").notNull().default("active"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    lastError: text("last_error"),

    // ✅ NEW columns required by OAuth provider
    fromEmail: text("from_email"),
    refreshTokenEnc: text("refresh_token_enc").notNull().default(""),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantProviderEmailUq: uniqueIndex("tenant_email_identities_uq").on(t.tenantId, t.provider, t.email),
  })
);

/**
 * Tenants
 * Back-compat: ownerClerkUserId stays while we transition.
 * New: ownerUserId points to app_users.id (portable).
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),

    // NEW portable owner pointer
    ownerUserId: uuid("owner_user_id").references(() => appUsers.id),

    // BACK-COMPAT (will remove later)
    ownerClerkUserId: text("owner_clerk_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex("tenants_slug_idx").on(t.slug),
  })
);

/**
 * Tenant settings (non-sensitive)
 */
export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .notNull()
    .primaryKey()
    .references(() => tenants.id),

  industryKey: text("industry_key").notNull(),

  redirectUrl: text("redirect_url"),
  thankYouUrl: text("thank_you_url"),

  businessName: text("business_name"),
  leadToEmail: text("lead_to_email"),
  resendFromEmail: text("resend_from_email"),

  // NEW: email sending mode + identity pointer (OAuth identity record)
  // - emailSendMode: "standard" | "enterprise"
  // - emailIdentityId: UUID referencing email_identities.id
  emailSendMode: text("email_send_mode"),
  emailIdentityId: uuid("email_identity_id"),

  aiMode: text("ai_mode"),
  pricingEnabled: boolean("pricing_enabled"),
  renderingEnabled: boolean("rendering_enabled"),
  renderingStyle: text("rendering_style"),
  renderingNotes: text("rendering_notes"),
  renderingMaxPerDay: integer("rendering_max_per_day"),
  renderingCustomerOptInRequired: boolean("rendering_customer_opt_in_required"),
  aiRenderingEnabled: boolean("ai_rendering_enabled"),
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
  alwaysEstimateLanguage: boolean("always_estimate_language").default(true).notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Quote logs — MUST match prod DB.
 */
export const quoteLogs = pgTable("quote_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),

  input: jsonb("input").$type<any>().notNull(),
  output: jsonb("output").$type<any>().notNull(),

  renderOptIn: boolean("render_opt_in").notNull().default(false),
  renderStatus: text("render_status").notNull().default("not_requested"),
  renderImageUrl: text("render_image_url"),
  renderPrompt: text("render_prompt"),
  renderError: text("render_error"),
  renderedAt: timestamp("rendered_at", { withTimezone: true }),

  isRead: boolean("is_read").notNull().default(false),
  stage: text("stage").notNull().default("new"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Industries
 */
export const industries = pgTable(
  "industries",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    keyIdx: uniqueIndex("industries_key_idx").on(t.key),
  })
);

/**
 * Email identities (OAuth mailbox connections)
 */
export const emailIdentities = pgTable(
  "email_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    // "gmail_oauth" | "microsoft_oauth" (we’re doing gmail first)
    provider: text("provider").notNull(),

    emailAddress: text("email_address").notNull(),
    fromEmail: text("from_email").notNull(),

    // encrypted refresh token
    refreshTokenEnc: text("refresh_token_enc").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantProviderEmailUq: uniqueIndex("email_identities_tenant_provider_email_uq").on(
      t.tenantId,
      t.provider,
      t.emailAddress
    ),
  })
);