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

    // scope overrides to an industry
    industryKey: text("industry_key").notNull(),

    key: text("key").notNull(),
    label: text("label").notNull(),

    // ✅ match how your SQL uses it (merge route inserts created_at)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // unique key includes industryKey
    tenantIndustryKeyUq: uniqueIndex("tenant_sub_industries_tenant_id_industry_key_key_uq").on(
      t.tenantId,
      t.industryKey,
      t.key
    ),

    // fast reads by tenant+industry
    tenantIndustryIdx: index("tenant_sub_industries_tenant_id_industry_key_idx").on(t.tenantId, t.industryKey),

    // keep tenant-only index for any legacy usage
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

  // Onboarding “how you charge”
  pricingModel: text("pricing_model"),

  // Pricing model config (hybrid: AI suggests + backend computes)
  flatRateDefault: integer("flat_rate_default"),
  hourlyLaborRate: integer("hourly_labor_rate"),
  materialMarkupPercent: integer("material_markup_percent"),
  perUnitRate: integer("per_unit_rate"),
  perUnitLabel: text("per_unit_label"),
  packageJson: jsonb("package_json").$type<any>(),
  lineItemsJson: jsonb("line_items_json").$type<any>(),
  assessmentFeeAmount: integer("assessment_fee_amount"),
  assessmentFeeCreditTowardJob: boolean("assessment_fee_credit_toward_job"),

  // legacy + new (keep both for back-compat)
  renderingEnabled: boolean("rendering_enabled"),
  renderingStyle: text("rendering_style"),

  /**
   * Legacy single-field “house notes”.
   * We keep it for back-compat; UI will now write the new additive fields,
   * and we can optionally mirror them into this string for old pipelines.
   */
  renderingNotes: text("rendering_notes"),

  // ✅ NEW: tenant render prompt layer (additive)
  renderingPromptAddendum: text("rendering_prompt_addendum").notNull().default(""),
  renderingNegativeGuidance: text("rendering_negative_guidance").notNull().default(""),

  renderingMaxPerDay: integer("rendering_max_per_day"),
  renderingCustomerOptInRequired: boolean("rendering_customer_opt_in_required"),
  aiRenderingEnabled: boolean("ai_rendering_enabled"),

  liveQaEnabled: boolean("live_qa_enabled").notNull().default(false),
  liveQaMaxQuestions: integer("live_qa_max_questions").notNull().default(3),

  reportingTimezone: text("reporting_timezone"),
  weekStartsOn: integer("week_starts_on"),

  // PLAN (matches your real DB)
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
  tenantId: uuid("tenant_id")
    .notNull()
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),

  openaiKeyEnc: text("openai_key_enc"),
  openaiKeyLast4: text("openai_key_last4"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
 * Quote versions — human-initiated lifecycle (additive; does NOT replace quote_logs)
 *
 * ✅ MUST match prod DB shape you pasted:
 * columns:
 * - id (pk)
 * - quote_log_id (not null)
 * - tenant_id (not null)
 * - version (not null)
 * - output (not null)
 * - meta (not null)
 * - created_at (not null)
 * - ai_mode (nullable)
 * - created_by (not null)
 * - source (not null)
 * - reason (nullable)
 *
 * NOTE: prod does NOT have updated_at.
 */
export const quoteVersions = pgTable(
  "quote_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    quoteLogId: uuid("quote_log_id")
      .notNull()
      .references(() => quoteLogs.id, { onDelete: "cascade" }),

    version: integer("version").notNull().default(1),

    // nullable in prod
    aiMode: text("ai_mode"),

    // system | tenant_edit | ai_conversion
    source: text("source").notNull().default("tenant_edit"),

    // required in prod
    createdBy: text("created_by").notNull().default("system"),

    // optional in prod
    reason: text("reason"),

    output: jsonb("output").$type<any>().notNull().default({}),

    // required in prod (NOT NULL)
    meta: jsonb("meta").$type<any>().notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // matches your neon indexes list:
    // - quote_versions_pkey (implicit by primaryKey)
    // - quote_versions_quote_log_created_idx (quote_log_id, created_at desc)
    // - quote_versions_tenant_created_idx (tenant_id, created_at desc)
    // - unique (quote_log_id, version)
    quoteLogCreatedIdx: index("quote_versions_quote_log_created_idx").on(t.quoteLogId, t.createdAt),
    tenantCreatedIdx: index("quote_versions_tenant_created_idx").on(t.tenantId, t.createdAt),
    quoteLogVersionUq: uniqueIndex("quote_versions_quote_log_id_version_uq").on(t.quoteLogId, t.version),
  })
);

/**
 * Quote notes — tenant-authored notes (internal for now; can add visibility flags later)
 */
export const quoteNotes = pgTable(
  "quote_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    quoteLogId: uuid("quote_log_id")
      .notNull()
      .references(() => quoteLogs.id, { onDelete: "cascade" }),

    // Optional: attach to a specific version (recommended)
    quoteVersionId: uuid("quote_version_id").references(() => quoteVersions.id, { onDelete: "cascade" }),

    // Clerk user id or email (portable enough for now)
    actor: text("actor"),

    body: text("body").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index("quote_notes_tenant_id_idx").on(t.tenantId),
    quoteLogIdx: index("quote_notes_quote_log_id_idx").on(t.quoteLogId),
    quoteVersionIdx: index("quote_notes_quote_version_id_idx").on(t.quoteVersionId),
    createdIdx: index("quote_notes_created_at_idx").on(t.createdAt),
  })
);

/**
 * Quote renders — manual render attempts per quote version (stored history)
 */
export const quoteRenders = pgTable(
  "quote_renders",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    quoteLogId: uuid("quote_log_id")
      .notNull()
      .references(() => quoteLogs.id, { onDelete: "cascade" }),

    quoteVersionId: uuid("quote_version_id")
      .notNull()
      .references(() => quoteVersions.id, { onDelete: "cascade" }),

    // Attempt number per version (1..n)
    attempt: integer("attempt").notNull().default(1),

    // queued | running | rendered | failed
    status: text("status").notNull().default("queued"),

    // What we asked the renderer to do
    prompt: text("prompt"),
    shopNotes: text("shop_notes"),

    // Output
    imageUrl: text("image_url"),
    error: text("error"),

    // Which one is selected to show/send for the version
    isSelected: boolean("is_selected").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index("quote_renders_tenant_id_idx").on(t.tenantId),
    quoteLogIdx: index("quote_renders_quote_log_id_idx").on(t.quoteLogId),
    quoteVersionIdx: index("quote_renders_quote_version_id_idx").on(t.quoteVersionId),
    statusIdx: index("quote_renders_status_idx").on(t.status),
    createdIdx: index("quote_renders_created_at_idx").on(t.createdAt),
    versionAttemptUq: uniqueIndex("quote_renders_quote_version_attempt_uq").on(t.quoteVersionId, t.attempt),
  })
);

/**
 * Industries (✅ aligned to your Neon table shape)
 */
export const industries = pgTable(
  "industries",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),

    // neon table has these (you pasted them)
    status: text("status").notNull().default("approved"),
    createdBy: text("created_by").notNull().default("ai"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // keep your naming but align uniqueness
    keyIdx: uniqueIndex("industries_key_idx").on(t.key),
    statusIdx: index("industries_status_idx").on(t.status),
  })
);

/**
 * Global default sub-industries (✅ aligned: includes is_active)
 */
export const industrySubIndustries = pgTable(
  "industry_sub_industries",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    industryKey: text("industry_key").notNull(),
    key: text("key").notNull(),

    label: text("label").notNull(),
    description: text("description"),

    sortOrder: integer("sort_order").notNull().default(1000),

    // neon query uses isi.is_active
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    industryKeyIdx: index("industry_sub_industries_industry_key_idx").on(t.industryKey),
    industryKeySubKeyUq: uniqueIndex("industry_sub_industries_industry_key_key_uq").on(t.industryKey, t.key),
    sortIdx: index("industry_sub_industries_sort_idx").on(t.industryKey, t.sortOrder),
    activeIdx: index("industry_sub_industries_active_idx").on(t.industryKey, t.isActive),
  })
);

/**
 * Tenant onboarding (EXISTS IN PROD DB)
 */
export const tenantOnboarding = pgTable(
  "tenant_onboarding",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),

    website: text("website"),
    aiAnalysis: jsonb("ai_analysis").$type<any>(),

    currentStep: integer("current_step").notNull().default(1),
    completed: boolean("completed").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    completedIdx: index("tenant_onboarding_completed_idx").on(t.completed),
    stepIdx: index("tenant_onboarding_step_idx").on(t.currentStep),
  })
);

/**
 * Industry prompt packs (✅ aligned to what your PCC page + merge route query)
 *
 * Your code queries:
 * - enabled
 * - version
 * - pack
 * - models
 * - prompts
 * - updated_at
 *
 * And uses "multiple versions per industry", so DO NOT unique industry_key here.
 */
export const industryLlmPacks = pgTable(
  "industry_llm_packs",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    industryKey: text("industry_key").notNull(),

    enabled: boolean("enabled").notNull().default(true),

    version: integer("version").notNull().default(1),

    pack: jsonb("pack").$type<any>(),
    models: jsonb("models").$type<any>(),
    prompts: jsonb("prompts").$type<any>(),

    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    industryKeyIdx: index("industry_llm_packs_industry_key_idx").on(t.industryKey),
    industryEnabledIdx: index("industry_llm_packs_industry_key_enabled_idx").on(t.industryKey, t.enabled),
    industryVersionIdx: index("industry_llm_packs_industry_key_version_idx").on(t.industryKey, t.version),
    updatedAtIdx: index("industry_llm_packs_updated_at_idx").on(t.updatedAt),
  })
);

/**
 * Industry change log (append-only)
 * ✅ MUST match prod DB:
 * - source_industry_key / target_industry_key
 * - snapshot (jsonb)
 * - created_at
 * - action check in DB (we'll expand to include canonicalize)
 */
export const industryChangeLog = pgTable(
  "industry_change_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    action: text("action").notNull(), // delete | merge | canonicalize (after migration)

    sourceIndustryKey: text("source_industry_key").notNull(),
    targetIndustryKey: text("target_industry_key"), // nullable for delete/canonicalize

    actor: text("actor").notNull().default("platform"),
    reason: text("reason"),

    snapshot: jsonb("snapshot").$type<any>().notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    createdIdx: index("industry_change_log_created_at_idx").on(t.createdAt),
    sourceIdx: index("industry_change_log_source_idx").on(t.sourceIndustryKey),
    targetIdx: index("industry_change_log_target_idx").on(t.targetIndustryKey),
  })
);