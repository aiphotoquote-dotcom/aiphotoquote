CREATE TABLE "tenant_email_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_email" text,
	"refresh_token_enc" text DEFAULT '' NOT NULL,
	"provider" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" DROP CONSTRAINT "tenant_settings_email_identity_id_email_identities_id_fk";
--> statement-breakpoint
ALTER TABLE "tenant_email_identities" ADD CONSTRAINT "tenant_email_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_email_identities_uq" ON "tenant_email_identities" USING btree ("tenant_id","provider","email");