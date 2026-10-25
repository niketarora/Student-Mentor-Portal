-- =====================================================================
-- 0011  Cross-portal notification triggers
-- =====================================================================
-- This file is what makes the three portals feel like one system.
-- Every event that one role causes and another role needs to see is
-- turned into a notification row here, at the database level — so it
-- fires no matter whether the action came from the web app, the admin
-- API, or a direct RPC call.
--
--   student raises ticket        -> faculty bell
--   either party sends message   -> the other party's bell
--   faculty resolves             -> student is asked to confirm
--   student confirms / reopens   -> faculty bell
--   student rates                -> faculty bell
--   HOD reassigns mentor         -> student + both faculty
--   faculty stars a mentee       -> student bell
--   faculty verifies achievement -> student bell
-- =====================================================================

create or replace function public.enqueue_notification(
  p_recipient uuid,
  p_actor     uuid,
  p_type      public.notification_type,
  p_title     text,
  p_body      text,
  p_ticket    uuid,
  p_link      text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Never notify someone about their own action.
  if p_recipient is null or p_recipient = p_actor then
    return;
  end if;
  insert into public.notifications (recipient_id, actor_id, type, title, body, ticket_id, link_path)
  values (p_recipient, p_actor, p_type, p_title, p_body, p_ticket, p_link);
end;
$$;

-- ── Student raised a ticket -> assigned faculty ───────────────────────
create or replace function public.notify_on_ticket_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student text;
begin
  select full_name into v_student from public.user_profiles where id = new.student_id;
  perform public.enqueue_notification(
    new.mentor_id, new.student_id, 'ticket_created',
    format('New %s ticket from %s', new.category, coalesce(v_student, 'a student')),
    format('%s — %s', new.ticket_code, new.subject),
    new.id, '/faculty/tickets/' || new.id::text
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_ticket_created on public.support_tickets;
create trigger trg_notify_ticket_created
  after insert on public.support_tickets
  for each row execute function public.notify_on_ticket_created();

-- ── New message -> the other party ────────────────────────────────────
create or replace function public.notify_on_ticket_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket    public.support_tickets;
  v_sender    text;
  v_recipient uuid;
  v_link      text;
begin
  if new.is_system_message then
    return new;   -- resolution/confirmation triggers cover these
  end if;

  select * into v_ticket from public.support_tickets where id = new.ticket_id;
  if v_ticket.id is null then return new; end if;

  select full_name into v_sender from public.user_profiles where id = new.sender_id;

  if new.sender_id = v_ticket.student_id then
    v_recipient := v_ticket.mentor_id;
    v_link := '/faculty/tickets/' || v_ticket.id::text;
  else
    v_recipient := v_ticket.student_id;
    v_link := '/student/tickets/' || v_ticket.id::text;
  end if;

  perform public.enqueue_notification(
    v_recipient, new.sender_id, 'ticket_message',
    format('New reply from %s', coalesce(v_sender, 'a user')),
    left(new.body, 140),
    v_ticket.id, v_link
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_ticket_message on public.ticket_messages;
create trigger trg_notify_ticket_message
  after insert on public.ticket_messages
  for each row execute function public.notify_on_ticket_message();

-- ── Resolution lifecycle ──────────────────────────────────────────────
create or replace function public.notify_on_ticket_resolution_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text;
begin
  if new.resolution_status is not distinct from old.resolution_status then
    -- not a resolution change; check for a fresh rating instead
    if new.satisfaction_rating is not null and old.satisfaction_rating is null then
      perform public.enqueue_notification(
        new.mentor_id, new.student_id, 'ticket_rated',
        format('Ticket %s rated %s/5', new.ticket_code, new.satisfaction_rating),
        new.subject, new.id, '/faculty/tickets/' || new.id::text
      );
    end if;
    return new;
  end if;

  select full_name into v_actor from public.user_profiles where id = coalesce(new.resolved_by, new.mentor_id);

  if new.resolution_status = 'pending_confirmation' then
    perform public.enqueue_notification(
      new.student_id, new.resolved_by, 'ticket_resolution_pending',
      'Was your issue fixed?',
      format('%s marked "%s" as resolved. Please confirm.', coalesce(v_actor, 'Your mentor'), new.subject),
      new.id, '/student/tickets/' || new.id::text
    );

  elsif new.resolution_status = 'confirmed' then
    perform public.enqueue_notification(
      new.mentor_id, new.student_id, 'ticket_confirmed',
      format('%s confirmed as resolved', new.ticket_code),
      new.subject, new.id, '/faculty/tickets/' || new.id::text
    );

  elsif new.resolution_status = 'reopened' then
    perform public.enqueue_notification(
      new.mentor_id, new.student_id, 'ticket_reopened',
      format('%s reopened by the student', new.ticket_code),
      coalesce(new.student_confirmation_comment, 'The student reported the issue is not resolved.'),
      new.id, '/faculty/tickets/' || new.id::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_ticket_resolution on public.support_tickets;
create trigger trg_notify_ticket_resolution
  after update on public.support_tickets
  for each row execute function public.notify_on_ticket_resolution_change();

-- ── Mentor reassignment (Feature 8) -> student + both faculty + log ───
create or replace function public.notify_on_mentor_reassignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_mentor text;
  v_student    text := new.full_name;
begin
  if new.assigned_mentor_id is not distinct from old.assigned_mentor_id then
    return new;
  end if;

  select full_name into v_new_mentor from public.user_profiles where id = new.assigned_mentor_id;

  insert into public.mentor_reassignment_log (student_id, from_mentor_id, to_mentor_id, performed_by)
  select new.id, old.assigned_mentor_id, new.assigned_mentor_id, auth.uid()
  where new.assigned_mentor_id is not null
    and old.assigned_mentor_id is distinct from new.assigned_mentor_id;

  perform public.enqueue_notification(
    new.id, auth.uid(), 'mentor_reassigned',
    'Your faculty mentor has changed',
    format('You are now mentored by %s.', coalesce(v_new_mentor, 'a new faculty member')),
    null, '/student/profile'
  );

  perform public.enqueue_notification(
    new.assigned_mentor_id, auth.uid(), 'mentor_reassigned',
    'New mentee assigned',
    format('%s is now one of your mentees.', v_student),
    null, '/faculty/mentees'
  );

  perform public.enqueue_notification(
    old.assigned_mentor_id, auth.uid(), 'mentor_reassigned',
    'Mentee reassigned',
    format('%s has been reassigned to another mentor.', v_student),
    null, '/faculty/mentees'
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_mentor_reassignment on public.user_profiles;
create trigger trg_notify_mentor_reassignment
  after update of assigned_mentor_id on public.user_profiles
  for each row execute function public.notify_on_mentor_reassignment();

-- ── Star mentee (Feature 7) -> student ────────────────────────────────
create or replace function public.notify_on_star_mentee_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_star_mentee = true and old.is_star_mentee = false then
    perform public.enqueue_notification(
      new.id, new.star_mentee_assigned_by, 'star_mentee_assigned',
      'You are now the student representative',
      'Your mentor has marked you as the star mentee for your mentor group.',
      null, '/student/profile'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_star_mentee on public.user_profiles;
create trigger trg_notify_star_mentee
  after update of is_star_mentee on public.user_profiles
  for each row execute function public.notify_on_star_mentee_change();

-- ── Achievement verified (Feature 6) -> student ───────────────────────
create or replace function public.notify_on_achievement_verified()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.verified_by_faculty = true and old.verified_by_faculty = false then
    perform public.enqueue_notification(
      new.student_id, new.verified_by, 'achievement_verified',
      'Achievement verified',
      format('"%s" has been verified by your mentor.', new.title),
      null, '/student/achievements'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_achievement_verified on public.student_achievements;
create trigger trg_notify_achievement_verified
  after update of verified_by_faculty on public.student_achievements
  for each row execute function public.notify_on_achievement_verified();

revoke all on function public.enqueue_notification(uuid, uuid, public.notification_type, text, text, uuid, text) from public, anon, authenticated;
