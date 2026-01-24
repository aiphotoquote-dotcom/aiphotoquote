-- Adds enterprise email mode fields to tenant_settings.

ALTER TABLE "tenant_settings"
  ADD COLUMN IF NOT EXISTS "email_send_mode" text;

ALTER TABLE "tenant_settings"
  ADD COLUMN IF NOT EXISTS "email_identity_id" uuid;

-- Set a safe default for new rows
ALTER TABLE "tenant_settings"
  ALTER COLUMN "email_send_mode" SET DEFAULT 'standard';

-- Backfill existing rows
UPDATE "tenant_settings"
SET "email_send_mode" = 'standard'
WHERE "email_send_mode" IS NULL;