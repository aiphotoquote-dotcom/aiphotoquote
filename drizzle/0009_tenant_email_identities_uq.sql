-- Ensure ON CONFLICT (tenant_id, provider, email_address) works
create unique index if not exists tenant_email_identities_tenant_provider_email_uq
  on tenant_email_identities (tenant_id, provider, email_address);