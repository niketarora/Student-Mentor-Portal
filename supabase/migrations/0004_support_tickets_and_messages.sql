-- =====================================================================
-- 0004  Support tickets + threaded messages
--       Feature 3 — student resolution-confirmation loop
-- =====================================================================

-- Ticket codes come from a sequence, not count(*). count(*) races under
-- concurrency and can mint duplicate codes; a sequence never does.
create sequence if not exists public.ticket_code_seq start with 1001;

create table if not exists public.support_tickets (
  id                            uuid primary key default extensions.gen_random_uuid(),
  ticket_code                   text not null unique,
  student_id                    uuid not null references public.user_profiles (id) on delete cascade,
  mentor_id                     uuid not null references public.user_profiles (id) on delete restrict,

  subject                       text not null,
  category                      public.ticket_category not null,
  priority                      public.ticket_priority not null default 'Medium',
  status                        public.ticket_status   not null default 'Open',

  -- ── Feature 3: resolution confirmation loop ────────────────────────
  resolution_status             public.resolution_status not null default 'none',
  resolved_by                   uuid references public.user_profiles (id) on delete set null,
  resolved_at                   timestamptz,
  student_confirmation          public.confirmation_response,
  student_confirmation_at       timestamptz,
  student_confirmation_comment  text,
  reopen_count                  integer not null default 0,

  -- ── Analytics timestamps (populated by trigger, never by clients) ──
  first_response_at             timestamptz,
  last_message_at               timestamptz not null default now(),
  satisfaction_rating           smallint,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  constraint ticket_subject_not_blank    check (public.is_non_blank(subject)),
  constraint ticket_subject_max_length   check (char_length(subject) <= 200),
  constraint ticket_comment_max_length   check (student_confirmation_comment is null
                                                or char_length(student_confirmation_comment) <= 1000),
  constraint ticket_rating_range         check (satisfaction_rating is null
                                                or satisfaction_rating between 1 and 5),
  constraint ticket_student_is_not_mentor check (student_id <> mentor_id),
  constraint ticket_resolved_has_resolver
    check (resolution_status = 'none' or resolved_by is not null),
  constraint ticket_confirmation_has_timestamp
    check (student_confirmation is null or student_confirmation_at is not null)
);

comment on table public.support_tickets is
  'Support tickets raised by students against their assigned mentor. Visible to owner, assigned mentor and HOD only (enforced by RLS).';
comment on column public.support_tickets.resolution_status is
  'Feature 3 — none -> pending_confirmation (faculty resolved) -> confirmed | reopened (student answered).';

create index if not exists tickets_student_idx           on public.support_tickets (student_id, created_at desc);
create index if not exists tickets_mentor_idx            on public.support_tickets (mentor_id, created_at desc);
create index if not exists tickets_status_idx            on public.support_tickets (status);
create index if not exists tickets_category_idx          on public.support_tickets (category);
create index if not exists tickets_resolution_status_idx on public.support_tickets (resolution_status)
                                                          where resolution_status <> 'none';
create index if not exists tickets_updated_at_idx        on public.support_tickets (updated_at desc);
create index if not exists tickets_subject_trgm_idx      on public.support_tickets using gin (subject extensions.gin_trgm_ops);

drop trigger if exists trg_tickets_updated_at on public.support_tickets;
create trigger trg_tickets_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------
-- Threaded conversation on a ticket
-- ---------------------------------------------------------------------
create table if not exists public.ticket_messages (
  id                 uuid primary key default extensions.gen_random_uuid(),
  ticket_id          uuid not null references public.support_tickets (id) on delete cascade,
  sender_id          uuid references public.user_profiles (id) on delete set null,
  body               text not null,
  is_system_message  boolean not null default false,
  created_at         timestamptz not null default now(),

  constraint message_body_not_blank  check (public.is_non_blank(body)),
  constraint message_body_max_length check (char_length(body) <= 5000)
);

comment on table public.ticket_messages is
  'Messages on a ticket. Inserted only through post_ticket_message() so authorisation and side-effects always run.';

create index if not exists ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);
create index if not exists ticket_messages_sender_idx on public.ticket_messages (sender_id);

-- ---------------------------------------------------------------------
-- Ticket code generator: AN-1001, AN-1002, ...
-- ---------------------------------------------------------------------
create or replace function public.assign_ticket_code()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.ticket_code is null or btrim(new.ticket_code) = '' then
    new.ticket_code := 'AN-' || nextval('public.ticket_code_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_ticket_code on public.support_tickets;
create trigger trg_assign_ticket_code
  before insert on public.support_tickets
  for each row execute function public.assign_ticket_code();
