CREATE TABLE "tenant_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_sub_industries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_identities" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "email_identities" CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "brand_logo_url" text;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_sub_industries" ADD CONSTRAINT "tenant_sub_industries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_members_tenant_user_uq" ON "tenant_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "tenant_members_tenant_id_idx" ON "tenant_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_sub_industries_tenant_id_key_uq" ON "tenant_sub_industries" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "tenant_sub_industries_tenant_id_idx" ON "tenant_sub_industries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_email_identities_tenant_id_idx" ON "tenant_email_identities" USING btree ("tenant_id");