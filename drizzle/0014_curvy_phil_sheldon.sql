ALTER TABLE "platform_onboarding_invites" ADD COLUMN "created_by_email" text;--> statement-breakpoint
ALTER TABLE "platform_onboarding_invites" ADD COLUMN "campaign_key" text;--> statement-breakpoint
ALTER TABLE "platform_onboarding_invites" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "platform_onboarding_invites" ADD COLUMN "target_industry_key" text;--> statement-breakpoint
ALTER TABLE "platform_onboarding_invites" ADD COLUMN "target_industry_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_onboarding_sessions" ADD COLUMN "campaign_key" text;--> statement-breakpoint
ALTER TABLE "platform_onboarding_sessions" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "platform_onboarding_sessions" ADD COLUMN "target_industry_key" text;--> statement-breakpoint
ALTER TABLE "platform_onboarding_sessions" ADD COLUMN "target_industry_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "platform_onboarding_invites_campaign_key_idx" ON "platform_onboarding_invites" USING btree ("campaign_key");--> statement-breakpoint
CREATE INDEX "platform_onboarding_invites_target_industry_key_idx" ON "platform_onboarding_invites" USING btree ("target_industry_key");--> statement-breakpoint
CREATE INDEX "platform_onboarding_sessions_campaign_key_idx" ON "platform_onboarding_sessions" USING btree ("campaign_key");--> statement-breakpoint
CREATE INDEX "platform_onboarding_sessions_target_industry_key_idx" ON "platform_onboarding_sessions" USING btree ("target_industry_key");