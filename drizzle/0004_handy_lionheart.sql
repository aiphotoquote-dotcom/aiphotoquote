CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_provider" text NOT NULL,
	"auth_subject" text NOT NULL,
	"email" text,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"email" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"access_token_enc" text,
	"access_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "industries" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "quote_logs" ALTER COLUMN "input" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_logs" ALTER COLUMN "output" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD PRIMARY KEY ("tenant_id");--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "owner_clerk_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "render_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "render_status" text DEFAULT 'not_requested' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "render_image_url" text;--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "render_prompt" text;--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "render_error" text;--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "rendered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "is_read" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_logs" ADD COLUMN "stage" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "business_name" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "lead_to_email" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "resend_from_email" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "email_send_mode" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "email_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "ai_mode" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "pricing_enabled" boolean;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "rendering_enabled" boolean;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "rendering_style" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "rendering_notes" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "rendering_max_per_day" integer;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "rendering_customer_opt_in_required" boolean;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "ai_rendering_enabled" boolean;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "reporting_timezone" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "week_starts_on" integer;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "email_identities" ADD CONSTRAINT "email_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_provider_subject_uq" ON "app_users" USING btree ("auth_provider","auth_subject");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_logs" DROP COLUMN "confidence";--> statement-breakpoint
ALTER TABLE "quote_logs" DROP COLUMN "estimate_low";--> statement-breakpoint
ALTER TABLE "quote_logs" DROP COLUMN "estimate_high";--> statement-breakpoint
ALTER TABLE "quote_logs" DROP COLUMN "inspection_required";--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP COLUMN "created_at";