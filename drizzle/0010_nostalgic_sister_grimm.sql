CREATE TABLE "industry_change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"source_industry_key" text NOT NULL,
	"target_industry_key" text,
	"actor" text DEFAULT 'platform' NOT NULL,
	"reason" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "industry_llm_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"industry_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"pack" jsonb,
	"models" jsonb,
	"prompts" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_log_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_version_id" uuid,
	"body" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT 'tenant' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_renders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_log_id" uuid NOT NULL,
	"quote_version_id" uuid NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"prompt" text,
	"shop_notes" text,
	"image_url" text,
	"error" text,
	"is_selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quote_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_log_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"ai_mode" text,
	"source" text DEFAULT 'tenant_edit' NOT NULL,
	"created_by" text DEFAULT 'system' NOT NULL,
	"reason" text,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_secrets" DROP CONSTRAINT "tenant_secrets_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "industries" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "tenant_secrets" ADD PRIMARY KEY ("tenant_id");--> statement-breakpoint
ALTER TABLE "tenant_secrets" ALTER COLUMN "openai_key_enc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "industries" ADD COLUMN "status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "industries" ADD COLUMN "created_by" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "industries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "industry_sub_industries" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "current_version" integer;--> statement-breakpoint
ALTER TABLE "tenant_secrets" ADD COLUMN "openai_key_last4" text;--> statement-breakpoint
ALTER TABLE "tenant_secrets" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "rendering_prompt_addendum" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "rendering_negative_guidance" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_sub_industries" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_notes" ADD CONSTRAINT "quote_notes_quote_log_id_quote_logs_id_fk" FOREIGN KEY ("quote_log_id") REFERENCES "public"."quote_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_notes" ADD CONSTRAINT "quote_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_notes" ADD CONSTRAINT "quote_notes_quote_version_id_quote_versions_id_fk" FOREIGN KEY ("quote_version_id") REFERENCES "public"."quote_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_renders" ADD CONSTRAINT "quote_renders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_renders" ADD CONSTRAINT "quote_renders_quote_log_id_quote_logs_id_fk" FOREIGN KEY ("quote_log_id") REFERENCES "public"."quote_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_renders" ADD CONSTRAINT "quote_renders_quote_version_id_quote_versions_id_fk" FOREIGN KEY ("quote_version_id") REFERENCES "public"."quote_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_quote_log_id_quote_logs_id_fk" FOREIGN KEY ("quote_log_id") REFERENCES "public"."quote_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "industry_change_log_created_at_idx" ON "industry_change_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "industry_change_log_source_idx" ON "industry_change_log" USING btree ("source_industry_key");--> statement-breakpoint
CREATE INDEX "industry_change_log_target_idx" ON "industry_change_log" USING btree ("target_industry_key");--> statement-breakpoint
CREATE INDEX "industry_llm_packs_industry_key_idx" ON "industry_llm_packs" USING btree ("industry_key");--> statement-breakpoint
CREATE INDEX "industry_llm_packs_industry_key_enabled_idx" ON "industry_llm_packs" USING btree ("industry_key","enabled");--> statement-breakpoint
CREATE INDEX "industry_llm_packs_industry_key_version_idx" ON "industry_llm_packs" USING btree ("industry_key","version");--> statement-breakpoint
CREATE INDEX "industry_llm_packs_updated_at_idx" ON "industry_llm_packs" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "quote_notes_quote_log_created_idx" ON "quote_notes" USING btree ("quote_log_id","created_at");--> statement-breakpoint
CREATE INDEX "quote_notes_tenant_created_idx" ON "quote_notes" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "quote_renders_tenant_id_idx" ON "quote_renders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "quote_renders_quote_log_id_idx" ON "quote_renders" USING btree ("quote_log_id");--> statement-breakpoint
CREATE INDEX "quote_renders_quote_version_id_idx" ON "quote_renders" USING btree ("quote_version_id");--> statement-breakpoint
CREATE INDEX "quote_renders_status_idx" ON "quote_renders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quote_renders_created_at_idx" ON "quote_renders" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_renders_quote_version_attempt_uq" ON "quote_renders" USING btree ("quote_version_id","attempt");--> statement-breakpoint
CREATE INDEX "quote_versions_quote_log_created_idx" ON "quote_versions" USING btree ("quote_log_id","created_at");--> statement-breakpoint
CREATE INDEX "quote_versions_tenant_created_idx" ON "quote_versions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_versions_quote_log_id_version_uq" ON "quote_versions" USING btree ("quote_log_id","version");--> statement-breakpoint
ALTER TABLE "tenant_secrets" ADD CONSTRAINT "tenant_secrets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "industries_status_idx" ON "industries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "industry_sub_industries_active_idx" ON "industry_sub_industries" USING btree ("industry_key","is_active");--> statement-breakpoint
ALTER TABLE "tenant_secrets" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "tenant_secrets" DROP COLUMN "created_at";