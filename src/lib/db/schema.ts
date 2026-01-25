// src/lib/db/schema.ts
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  uuid,
  uniqueIndex,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

/**
 * Portable internal users.
 * Anchor for mobility: swap auth providers later without rewriting tenant ownership.
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
    providerSubjectUq: uniqueIndex("app_users_provider_subject_uq").on(t.authProvider, t.authSubject),
  })
);

// --- tenant sub-industries (per-tenant override/extension) ---
export const tenantSubIndustries = pgTable(
  "tenant_sub_industries",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    key: text("key").notNull(),     // normalized key, e.g. "marine", "commercial"
    label: text("label").notNull(), // display label

    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull(),
  },
  (t) => ({
    // ensures one key per tenant (and enables our onConflictDoUpdate target)
    tenantKeyUq: uniqueIndex("tenant_sub_industries_tenant_id_key_uq").on(t.tenantId, t.key),
    tenantIdx: index("tenant_sub_industries_tenant_id_idx").on(t.tenantId),
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
 * Tenant members / RBAC
 */
export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    userId: uuid("user_id").references(() => appUsers.id, { onDelete: "cascade" }),

    // "owner" | "admin" | "member"
    role: text("role").notNull().default("member"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantUserUq: uniqueIndex("tenant_members_tenant_user_uq").on(t.tenantId, t.userId),
    tenantIdx: index("tenant_members_tenant_id_idx").on(t.tenantId),
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

  // NEW: tenant branding (logo URL stored as canonical string)
  // Can be a Vercel Blob URL or a user-provided https URL
  brandLogoUrl: text("brand_logo_url"),

  // NEW: email sending mode + identity pointer (OAuth identity record)
  // - emailSendMode: "standard" | "enterprise"
  // - emailIdentityId: UUID referencing tenant_email_identities.id
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
 * Tenant email identities (OAuth mailboxes)
 *
 * NOTE: Your DB currently shows these base columns:
 * id, tenant_id, provider, email, display_name, status, scopes, last_error, created_at, updated_at
 *
 * If you are adding from_email + refresh_token_enc via migration, keep them here ONCE each.
 * (The TypeScript error you hit happens when these keys get duplicated.)
 */
export const tenantEmailIdentities = pgTable(
  "tenant_email_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    // "gmail_oauth" | "microsoft_oauth"
    provider: text("provider").notNull(),

    // mailbox email (your DB uses column name "email")
    email: text("email").notNull(),

    displayName: text("display_name"),
    status: text("status").notNull().default("active"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),

    lastError: text("last_error"),

    // ✅ If/when your migration adds these columns, they belong here exactly once each:
    fromEmail: text("from_email"),
    refreshTokenEnc: text("refresh_token_enc").notNull().default(""),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index("tenant_email_identities_tenant_id_idx").on(t.tenantId),
    tenantProviderEmailUq: uniqueIndex("tenant_email_identities_uq").on(t.tenantId, t.provider, t.email),
  })
);

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