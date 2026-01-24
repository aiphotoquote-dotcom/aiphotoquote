-- drizzle/0009_add_from_email_refresh_token_enc.sql

alter table "tenant_email_identities"
  add column if not exists "from_email" text;

alter table "tenant_email_identities"
  add column if not exists "refresh_token_enc" text not null default '';

-- Optional: helpful if you want to track a default "from"
update "tenant_email_identities"
set "from_email" = coalesce("from_email", "email")
where "from_email" is null;