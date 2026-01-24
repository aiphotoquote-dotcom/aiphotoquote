DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'tenant_settings'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%email_send_mode%'
  LOOP
    EXECUTE format('ALTER TABLE tenant_settings DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE tenant_settings
  ADD CONSTRAINT tenant_settings_email_send_mode_chk
  CHECK (
    email_send_mode IS NULL
    OR email_send_mode IN ('standard', 'enterprise')
  );