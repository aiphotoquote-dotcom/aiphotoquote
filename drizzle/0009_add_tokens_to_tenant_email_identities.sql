-- Add token + from_email fields required for Gmail OAuth sending
alter table tenant_email_identities
  add column if not exists from_email text;

alter table tenant_email_identities
  add column if not exists refresh_token_enc text not null default '';

-- (Optional) if you want to quickly spot broken connects
create index if not exists tenant_email_identities_provider_idx
  on tenant_email_identities (provider);