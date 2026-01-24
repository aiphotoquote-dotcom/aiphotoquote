-- drizzle/0009_add_email_tokens_to_tenant_email_identities.sql

alter table tenant_email_identities
  add column if not exists from_email text;

alter table tenant_email_identities
  add column if not exists refresh_token_enc text not null default '';

-- (optional) if you want faster lookups by provider
create index if not exists tenant_email_identities_provider_idx
  on tenant_email_identities (provider);