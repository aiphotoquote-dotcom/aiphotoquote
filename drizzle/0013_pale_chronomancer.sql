CREATE TABLE "platform_onboarding_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid,
	"invite_code" text,
	"clerk_user_id" text,
	"email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"tenant_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_onboarding_sessions" ADD CONSTRAINT "platform_onboarding_sessions_invite_id_platform_onboarding_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."platform_onboarding_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_onboarding_sessions" ADD CONSTRAINT "platform_onboarding_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_onboarding_sessions_status_idx" ON "platform_onboarding_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "platform_onboarding_sessions_invite_id_idx" ON "platform_onboarding_sessions" USING btree ("invite_id");--> statement-breakpoint
CREATE INDEX "platform_onboarding_sessions_clerk_user_id_idx" ON "platform_onboarding_sessions" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "platform_onboarding_sessions_tenant_id_idx" ON "platform_onboarding_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "platform_onboarding_sessions_expires_at_idx" ON "platform_onboarding_sessions" USING btree ("expires_at");