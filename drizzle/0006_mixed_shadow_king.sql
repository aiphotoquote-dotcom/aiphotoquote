ALTER TABLE "email_identities" DROP CONSTRAINT "email_identities_tenant_id_tenants_id_fk";
--> statement-breakpoint
DROP INDEX "email_identities_tenant_provider_email_uq";--> statement-breakpoint
ALTER TABLE "email_identities" ADD COLUMN "email_address" text NOT NULL;--> statement-breakpoint
ALTER TABLE "email_identities" ADD COLUMN "from_email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "email_identities" ADD CONSTRAINT "email_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_identities_tenant_provider_email_uq" ON "email_identities" USING btree ("tenant_id","provider","email_address");--> statement-breakpoint
ALTER TABLE "email_identities" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "email_identities" DROP COLUMN "display_name";--> statement-breakpoint
ALTER TABLE "email_identities" DROP COLUMN "scopes";