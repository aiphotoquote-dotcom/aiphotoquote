ALTER TABLE "platform_config" ALTER COLUMN "id" DROP DEFAULT;
--> statement-breakpoint

ALTER TABLE "platform_config" ALTER COLUMN "id" SET DATA TYPE text;
--> statement-breakpoint

UPDATE "platform_config"
SET "id" = 'singleton';
--> statement-breakpoint

ALTER TABLE "platform_config" ALTER COLUMN "id" SET DEFAULT 'singleton';
--> statement-breakpoint

ALTER TABLE "platform_config" ADD COLUMN "site_mode" text DEFAULT 'marketing_live' NOT NULL;
--> statement-breakpoint

ALTER TABLE "platform_config" ADD COLUMN "site_mode_payload" jsonb;
--> statement-breakpoint

ALTER TABLE "platform_config" ADD COLUMN "admin_banner_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

ALTER TABLE "platform_config" ADD COLUMN "admin_banner_text" text;
--> statement-breakpoint

ALTER TABLE "platform_config" ADD COLUMN "admin_banner_tone" text DEFAULT 'info' NOT NULL;
--> statement-breakpoint

ALTER TABLE "platform_config" ADD COLUMN "admin_banner_href" text;
--> statement-breakpoint

ALTER TABLE "platform_config" ADD COLUMN "admin_banner_cta_label" text;