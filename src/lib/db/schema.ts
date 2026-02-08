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

/**
 * Platform users / RBAC
 */
export const platformUsers = pgTable(
  "platform_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),

    platformRole: text("platform_role").notNull().default("readonly"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userUq: uniqueIndex("platform_users_user_uq").on(t.userId),
    roleIdx: index("platform_users_role_idx").on(t.platformRole),
  })
);

/**
 * Platform config (single-row feature gates)
 */
export const platformConfig = pgTable("platform_config", {
  id: uuid("id").defaultRandom().primaryKey(),

  aiQuotingEnabled: boolean("ai_quoting_enabled").notNull().default(true),
  aiRenderingEnabled: boolean("ai_rendering_enabled").notNull().default(false),

  maintenanceEnabled: boolean("maintenance_enabled").notNull().default(false),
  maintenanceMessage: text("maintenance_message"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Tenants
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),

    // portable owner pointer
    ownerUserId: uuid("owner_user_id").references(() => appUsers.id),

    // BACK-COMPAT
    ownerClerkUserId: text("owner_clerk_user_id"),

    /**
     * ARCHIVE PLAN
     * - active: normal tenant
     * - archived: soft-disabled + hidden from normal UI, but data retained
     * - deleted: reserved for future purge pipeline (optional later)
     */
    status: text("status").notNull().default("active"),

    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: text("archived_by"), // clerk user id (portable enough for now)
    archivedReason: text("archived_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex("tenants_slug_idx").on(t.slug),
    statusIdx: index("tenants_status_idx").on(t.status),
  })
);

/**
 * Tenant audit log (append-only)
 * - Stores: who/what/when + small JSON snapshot for forensics
 */
export const tenantAuditLog = pgTable(
  "tenant_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    // e.g. tenant.archived | tenant.restored | tenant.purged | plan.changed | key.added
    action: text("action").notNull(),

    actorClerkUserId: text("actor_clerk_user_id"),
    actorEmail: text("actor_email"),
    actorIp: text("actor_ip"),

    // optional free text reason (esp. archive/purge)
    reason: text("reason"),

    // tiny “what changed” snapshot (safe, no secrets)
    meta: jsonb("meta").$type<any>(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index("tenant_audit_log_tenant_id_idx").on(t.tenantId),
    actionIdx: index("tenant_audit_log_action_idx").on(t.action),
    createdIdx: index("tenant_audit_log_created_at_idx").on(t.createdAt),
  })
);

// --- tenant sub-industries (per-tenant override/extension) ---
export const tenantSubIndustries = pgTable(
  "tenant_sub_industries",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    key: text("key").notNull(),
    label: text("label").notNull(),

    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantKeyUq: uniqueIndex("tenant_sub_industries_tenant_id_key_uq").on(t.tenantId, t.key),
    tenantIdx: index("tenant_sub_industries_tenant_id_idx").on(t.tenantId),
  })
);

/**
 * Tenant members / RBAC
 *
 * IMPORTANT: table has NO id column in your DB.
 */
export const tenantMembers = pgTable(
  "tenant_members",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    clerkUserId: text("clerk_user_id").notNull(),

    role: text("role").notNull().default("member"), // owner | admin | member
    status: text("status").notNull().default("active"), // active | invited | disabled

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantClerkUserUq: uniqueIndex("tenant_members_tenant_clerk_user_uq").on(t.tenantId, t.clerkUserId),
    tenantIdx: index("tenant_members_tenant_id_idx").on(t.tenantId),
    clerkIdx: index("tenant_members_clerk_user_id_idx").on(t.clerkUserId),
    roleIdx: index("tenant_members_role_idx").on(t.role),
    statusIdx: index("tenant_members_status_idx").on(t.status),
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

  brandLogoUrl: text("brand_logo_url"),
  // logo rendering hint for email/UI: auto | light | dark
  brandLogoVariant: text("brand_logo_variant"),

  emailSendMode: text("email_send_mode"),
  emailIdentityId: uuid("email_identity_id"),

  aiMode: text("ai_mode"),
  pricingEnabled: boolean("pricing_enabled"),

  // legacy + new (keep both for back-compat)
  renderingEnabled: boolean("rendering_enabled"),
  renderingStyle: text("rendering_style"),
  renderingNotes: text("rendering_notes"),
  renderingMaxPerDay: integer("rendering_max_per_day"),
  renderingCustomerOptInRequired: boolean("rendering_customer_opt_in_required"),
  aiRenderingEnabled: boolean("ai_rendering_enabled"),

  liveQaEnabled: boolean("live_qa_enabled").notNull().default(false),
  liveQaMaxQuestions: integer("live_qa_max_questions").notNull().default(3),

  reportingTimezone: text("reporting_timezone"),
  weekStartsOn: integer("week_starts_on"),

  // ✅ PLAN (matches your real DB)
  planTier: text("plan_tier").notNull().default("free"),
  monthlyQuoteLimit: integer("monthly_quote_limit"), // null => unlimited
  activationGraceCredits: integer("activation_grace_credits").notNull().default(0),
  activationGraceUsed: integer("activation_grace_used").notNull().default(0),
  planSelectedAt: timestamp("plan_selected_at", { withTimezone: true }),

  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Tenant email identities (OAuth mailboxes)
 */
export const tenantEmailIdentities = pgTable(
  "tenant_email_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    provider: text("provider").notNull(), // gmail_oauth | microsoft_oauth
    email: text("email").notNull(),

    displayName: text("display_name"),
    status: text("status").notNull().default("active"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),

    lastError: text("last_error"),

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

  qa: jsonb("qa").$type<any>(),
  qaStatus: text("qa_status").notNull().default("none"),
  qaAskedAt: timestamp("qa_asked_at", { withTimezone: true }),
  qaAnsweredAt: timestamp("qa_answered_at", { withTimezone: true }),

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