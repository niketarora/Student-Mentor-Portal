-- =====================================================================
-- ci-supabase-stubs.sql
-- =====================================================================
-- Minimal stand-ins for the parts of a real Supabase project that the
-- migrations depend on (auth schema, storage schema, the three Postgres
-- roles, auth.uid()). Used ONLY by CI so migrations can be applied to a
-- throwaway Postgres 15 container and any SQL error is caught before
-- deploy. Never run this against a real Supabase project — Supabase
-- already provides all of it.
-- =====================================================================

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role;  exception when duplicate_object then null; end $$;

create extension if not exists "pgcrypto" with schema extensions;

create table if not exists auth.users (
  instance_id        uuid,
  id                 uuid primary key default extensions.gen_random_uuid(),
  aud                varchar(255),
  role               varchar(255),
  email              varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  confirmation_token varchar(255),
  recovery_token     varchar(255),
  email_change_token_new varchar(255),
  email_change       varchar(255)
);

create table if not exists auth.identities (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid references auth.users (id) on delete cascade,
  provider_id     text,
  identity_data   jsonb,
  provider        text,
  last_sign_in_at timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now()
);

create table if not exists storage.objects (
  id         uuid primary key default extensions.gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid,
  created_at timestamptz default now()
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$ select string_to_array(name, '/') $$;
