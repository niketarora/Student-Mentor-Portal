-- =====================================================================
-- 0005  Notifications (cross-portal glue)  +  Feature 6 achievements
-- =====================================================================
-- Notifications are what make the three portals feel connected: a ticket
-- raised in the student portal lands in the faculty bell instantly via
-- Supabase Realtime, with no polling.
-- =====================================================================

create table if not exists public.notifications (
  id            uuid primary key default extensions.gen_random_uuid(),
  recipient_id  uuid not null references public.user_profiles (id) on delete cascade,
  actor_id      uuid references public.user_profiles (id) on delete set null,
  type          public.notification_type not null,
  title         text not null,
  body          text,
  ticket_id     uuid references public.support_tickets (id) on delete cascade,
  link_path     text,
  is_read       boolean not null default false,
  read_at       timestamptz,
  created_at    timestamptz not null default now(),

  constraint notification_title_not_blank check (public.is_non_blank(title)),
  constraint notification_read_has_timestamp check (is_read = false or read_at is not null)
);

comment on table public.notifications is
  'In-app notifications. Written only by database triggers and the service role — never directly by a client.';

create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_unread_idx    on public.notifications (recipient_id) where is_read = false;
create index if not exists notifications_ticket_idx    on public.notifications (ticket_id);

-- ---------------------------------------------------------------------
-- Feature 6 — non-academic achievements, student maintained
-- ---------------------------------------------------------------------
create table if not exists public.student_achievements (
  id                  uuid primary key default extensions.gen_random_uuid(),
  student_id          uuid not null references public.user_profiles (id) on delete cascade,
  title               text not null,
  category            public.achievement_category not null default 'other',
  description         text,
  achieved_on         date,
  proof_file_path     text,                     -- Supabase Storage object path (private bucket)
  verified_by_faculty boolean not null default false,
  verified_by         uuid references public.user_profiles (id) on delete set null,
  verified_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint achievement_title_not_blank   check (public.is_non_blank(title)),
  constraint achievement_title_max_length  check (char_length(title) <= 200),
  constraint achievement_desc_max_length   check (description is null or char_length(description) <= 2000),
  constraint achievement_date_not_future   check (achieved_on is null or achieved_on <= current_date),
  constraint achievement_verified_has_verifier
    check (verified_by_faculty = false or verified_by is not null)
);

comment on table public.student_achievements is
  'Feature 6 — student-maintained achievements outside academics. Mentor may verify (badge only, never blocks display).';

create index if not exists achievements_student_idx  on public.student_achievements (student_id, achieved_on desc);
create index if not exists achievements_category_idx on public.student_achievements (category);

drop trigger if exists trg_achievements_updated_at on public.student_achievements;
create trigger trg_achievements_updated_at
  before update on public.student_achievements
  for each row execute function public.set_updated_at_timestamp();
