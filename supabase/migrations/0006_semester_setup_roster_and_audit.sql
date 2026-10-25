-- =====================================================================
-- 0006  HOD semester setup, roster imports, reassignment log,
--       canned replies and the audit trail
-- =====================================================================

create table if not exists public.semester_cycles (
  id                     uuid primary key default extensions.gen_random_uuid(),
  academic_year          text not null,                    -- e.g. '2026-27'
  term                   public.semester_term not null default 'Odd',
  is_initialized         boolean not null default false,
  current_step           smallint not null default 1,      -- 1 New .. 5 Accounts created
  faculty_imported_count integer not null default 0,
  student_imported_count integer not null default 0,
  initialized_at         timestamptz,
  created_by             uuid references public.user_profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint semester_year_shape   check (academic_year ~ '^[0-9]{4}-[0-9]{2}$'),
  constraint semester_step_range   check (current_step between 1 and 5),
  constraint one_cycle_per_term    unique (academic_year, term)
);

comment on table public.semester_cycles is 'HOD semester initialisation wizard state (5-step stepper).';

drop trigger if exists trg_semester_cycles_updated_at on public.semester_cycles;
create trigger trg_semester_cycles_updated_at
  before update on public.semester_cycles
  for each row execute function public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------
-- Every roster spreadsheet upload is recorded, successes and failures
-- ---------------------------------------------------------------------
create table if not exists public.roster_import_batches (
  id                 uuid primary key default extensions.gen_random_uuid(),
  semester_cycle_id  uuid references public.semester_cycles (id) on delete set null,
  import_type        public.roster_import_type not null,
  original_filename  text not null,
  total_rows         integer not null default 0,
  created_count      integer not null default 0,
  skipped_count      integer not null default 0,
  failed_count       integer not null default 0,
  row_errors         jsonb not null default '[]'::jsonb,
  uploaded_by        uuid references public.user_profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists roster_batches_cycle_idx on public.roster_import_batches (semester_cycle_id, created_at desc);

-- ---------------------------------------------------------------------
-- Feature 8 — every mentor reassignment is permanently logged
-- ---------------------------------------------------------------------
create table if not exists public.mentor_reassignment_log (
  id             uuid primary key default extensions.gen_random_uuid(),
  student_id     uuid not null references public.user_profiles (id) on delete cascade,
  from_mentor_id uuid references public.user_profiles (id) on delete set null,
  to_mentor_id   uuid not null references public.user_profiles (id) on delete cascade,
  reason         text,
  performed_by   uuid references public.user_profiles (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint reassignment_changes_mentor check (from_mentor_id is null or from_mentor_id <> to_mentor_id)
);

create index if not exists reassignment_student_idx on public.mentor_reassignment_log (student_id, created_at desc);
create index if not exists reassignment_from_idx    on public.mentor_reassignment_log (from_mentor_id);

-- ---------------------------------------------------------------------
-- Faculty canned replies (Phase 2 quick-reply feature)
-- ---------------------------------------------------------------------
create table if not exists public.canned_replies (
  id         uuid primary key default extensions.gen_random_uuid(),
  owner_id   uuid references public.user_profiles (id) on delete cascade,
  title      text not null,
  body       text not null,
  is_global  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint canned_reply_title_not_blank check (public.is_non_blank(title)),
  constraint canned_reply_body_max_length check (char_length(body) <= 2000),
  constraint canned_reply_owner_or_global check (is_global = true or owner_id is not null)
);

drop trigger if exists trg_canned_replies_updated_at on public.canned_replies;
create trigger trg_canned_replies_updated_at
  before update on public.canned_replies
  for each row execute function public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------
-- Append-only audit trail for security-relevant actions
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.user_profiles (id) on delete set null,
  actor_role  public.user_role,
  action      text not null,
  entity_type text,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only. No UPDATE or DELETE policy exists for any client role, including HOD.';

create index if not exists audit_log_actor_idx  on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, created_at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);
