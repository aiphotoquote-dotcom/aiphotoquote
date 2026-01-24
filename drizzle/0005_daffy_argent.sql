ALTER TABLE "email_identities" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "email_identities" ADD COLUMN "scopes" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_email_identity_id_email_identities_id_fk" FOREIGN KEY ("email_identity_id") REFERENCES "public"."email_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_identities_tenant_provider_email_uq" ON "email_identities" USING btree ("tenant_id","provider","email");--> statement-breakpoint
ALTER TABLE "email_identities" DROP COLUMN "access_token_enc";--> statement-breakpoint
ALTER TABLE "email_identities" DROP COLUMN "access_token_expires_at";--> statement-breakpoint
ALTER TABLE "email_identities" DROP COLUMN "scope";