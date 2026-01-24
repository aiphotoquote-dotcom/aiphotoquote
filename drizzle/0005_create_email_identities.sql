create table if not exists "email_identities" (
  "id" uuid primary key default gen_random_uuid(),
  "tenant_id" uuid not null references "tenants"("id") on delete cascade,
  "provider" text not null,
  "email_address" text not null,
  "from_email" text not null,
  "refresh_token_enc" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create unique index if not exists "email_identities_tenant_provider_email_uq"
  on "email_identities" ("tenant_id", "provider", "email_address");