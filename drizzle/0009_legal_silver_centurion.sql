CREATE TABLE "industry_sub_industries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"industry_key" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 1000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_quoting_enabled" boolean DEFAULT true NOT NULL,
	"ai_rendering_enabled" boolean DEFAULT false NOT NULL,
	"maintenance_enabled" boolean DEFAULT false NOT NULL,
	"maintenance_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform_role" text DEFAULT 'readonly' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_clerk_user_id" text,
	"actor_email" text,
	"actor_ip" text,
	"reason" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_onboarding" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"website" text,
	"ai_analysis" jsonb,
	"current_step" integer DEFAULT 1 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_members" DROP CONSTRAINT "tenant_members_user_id_app_users_id_fk";
--> statement-breakpoint
DROP INDEX "tenant_members_tenant_user_uq";--> statement-breakpoint
DROP INDEX "tenant_sub_industries_tenant_id_key_uq";--> statement-breakpoint
ALTER TABLE "tenant_settings" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "tenant_settings" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_sub_industries" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "tenant_sub_industries" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_sub_industries" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "qa" jsonb;--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "qa_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "qa_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "qa_answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "clerk_user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "brand_logo_variant" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "pricing_model" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "flat_rate_default" integer;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "hourly_labor_rate" integer;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "material_markup_percent" integer;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "per_unit_rate" integer;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "per_unit_label" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "package_json" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "line_items_json" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "assessment_fee_amount" integer;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "assessment_fee_credit_toward_job" boolean;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "live_qa_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "live_qa_max_questions" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "plan_tier" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "monthly_quote_limit" integer;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "activation_grace_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "activation_grace_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "plan_selected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_sub_industries" ADD COLUMN "industry_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "archived_by" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "archived_reason" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_audit_log" ADD CONSTRAINT "tenant_audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_onboarding" ADD CONSTRAINT "tenant_onboarding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "industry_sub_industries_industry_key_idx" ON "industry_sub_industries" USING btree ("industry_key");--> statement-breakpoint
CREATE UNIQUE INDEX "industry_sub_industries_industry_key_key_uq" ON "industry_sub_industries" USING btree ("industry_key","key");--> statement-breakpoint
CREATE INDEX "industry_sub_industries_sort_idx" ON "industry_sub_industries" USING btree ("industry_key","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_users_user_uq" ON "platform_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_users_role_idx" ON "platform_users" USING btree ("platform_role");--> statement-breakpoint
CREATE INDEX "tenant_audit_log_tenant_id_idx" ON "tenant_audit_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_audit_log_action_idx" ON "tenant_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "tenant_audit_log_created_at_idx" ON "tenant_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tenant_onboarding_completed_idx" ON "tenant_onboarding" USING btree ("completed");--> statement-breakpoint
CREATE INDEX "tenant_onboarding_step_idx" ON "tenant_onboarding" USING btree ("current_step");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_members_tenant_clerk_user_uq" ON "tenant_members" USING btree ("tenant_id","clerk_user_id");--> statement-breakpoint
CREATE INDEX "tenant_members_clerk_user_id_idx" ON "tenant_members" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "tenant_members_role_idx" ON "tenant_members" USING btree ("role");--> statement-breakpoint
CREATE INDEX "tenant_members_status_idx" ON "tenant_members" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_sub_industries_tenant_id_industry_key_key_uq" ON "tenant_sub_industries" USING btree ("tenant_id","industry_key","key");--> statement-breakpoint
CREATE INDEX "tenant_sub_industries_tenant_id_industry_key_idx" ON "tenant_sub_industries" USING btree ("tenant_id","industry_key");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
ALTER TABLE "tenant_members" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "tenant_members" DROP COLUMN "user_id";