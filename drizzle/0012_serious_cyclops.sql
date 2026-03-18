CREATE TABLE "platform_onboarding_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"email" text,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"used_by_tenant_id" uuid,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_config" ADD COLUMN "onboarding_mode" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_onboarding_invites_code_uq" ON "platform_onboarding_invites" USING btree ("code");--> statement-breakpoint
CREATE INDEX "platform_onboarding_invites_status_idx" ON "platform_onboarding_invites" USING btree ("status");--> statement-breakpoint
CREATE INDEX "platform_onboarding_invites_email_idx" ON "platform_onboarding_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "platform_onboarding_invites_used_by_tenant_id_idx" ON "platform_onboarding_invites" USING btree ("used_by_tenant_id");