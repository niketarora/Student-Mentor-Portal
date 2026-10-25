-- =====================================================================
-- 0001  Extensions, enumerated types and shared helper functions
-- =====================================================================
-- Everything the rest of the schema depends on. Run first.
-- =====================================================================

create extension if not exists "pgcrypto"  with schema extensions;   -- gen_random_uuid()
create extension if not exists "citext"    with schema extensions;   -- case-insensitive email
create extension if not exists "pg_trgm"   with schema extensions;   -- fast ILIKE search on names

-- ---------------------------------------------------------------------
-- Enumerated types
-- Using real enums (not free text) means an invalid value is rejected by
-- the database itself, not just by application validation.
-- ---------------------------------------------------------------------

do $$ begin
  create type public.user_role as enum ('student', 'faculty', 'hod');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_category as enum ('Academic', 'ERP/Tech', 'Infrastructure');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_status as enum ('Open', 'In Progress', 'Resolved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_priority as enum ('Low', 'Medium', 'High', 'Urgent');
exception when duplicate_object then null; end $$;

-- Feature 3 — student confirmation loop after faculty marks a ticket resolved
do $$ begin
  create type public.resolution_status as enum ('none', 'pending_confirmation', 'confirmed', 'reopened');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.confirmation_response as enum ('yes', 'no');
exception when duplicate_object then null; end $$;

-- Feature 8 — HOD faculty roster management
do $$ begin
  create type public.employment_status as enum ('active', 'on_leave', 'departed');
exception when duplicate_object then null; end $$;

-- Feature 1 — Form A parent occupation radio group
do $$ begin
  create type public.parent_occupation as enum (
    'Entrepreneur', 'Family Business', 'Public Sector',
    'Professional', 'Govt. Employee', 'Pvt. Company', 'Home Maker'
  );
exception when duplicate_object then null; end $$;

-- Feature 6 — non-academic achievements
do $$ begin
  create type public.achievement_category as enum (
    'sports', 'cultural', 'technical', 'volunteering',
    'certification', 'leadership', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_type as enum (
    'ticket_created',
    'ticket_message',
    'ticket_resolution_pending',
    'ticket_confirmed',
    'ticket_reopened',
    'ticket_rated',
    'mentor_reassigned',
    'star_mentee_assigned',
    'achievement_verified',
    'onboarding_reminder',
    'account_provisioned'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.semester_term as enum ('Odd', 'Even');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.roster_import_type as enum ('faculty', 'student');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Shared trigger helper: keep updated_at honest
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at_timestamp is
  'BEFORE UPDATE trigger — stamps updated_at server-side so clients cannot forge it.';

-- ---------------------------------------------------------------------
-- Reject blank / whitespace-only text where the app expects real content
-- ---------------------------------------------------------------------
create or replace function public.is_non_blank(value text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select value is not null and length(btrim(value)) > 0;
$$;
