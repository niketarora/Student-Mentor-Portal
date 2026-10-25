-- =====================================================================
-- 0009  Ticket workflow RPCs
-- =====================================================================
-- All ticket state transitions live here rather than in client code, so
-- authorisation and side effects (notifications, timestamps, system
-- messages) can never be skipped by calling PostgREST directly.
--
-- Each function re-implements the original Express guards explicitly:
--   isStudentOwner / isAssignedMentor / isHod
-- =====================================================================

-- ---------------------------------------------------------------------
-- Raise a ticket (student only, against their own assigned mentor)
-- ---------------------------------------------------------------------
create or replace function public.create_support_ticket(
  p_subject     text,
  p_category    public.ticket_category,
  p_description text,
  p_priority    public.ticket_priority default 'Medium'
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller  public.user_profiles;
  v_ticket  public.support_tickets;
  v_open_count integer;
begin
  select * into v_caller from public.user_profiles where id = auth.uid();

  if v_caller.id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_caller.role <> 'student' then
    raise exception 'Only students can raise support tickets' using errcode = '42501';
  end if;
  if not v_caller.is_active then
    raise exception 'This account is deactivated' using errcode = '42501';
  end if;
  if v_caller.assigned_mentor_id is null then
    raise exception 'No faculty mentor assigned. Please contact the HOD.' using errcode = '22023';
  end if;
  if not public.is_non_blank(p_subject) or not public.is_non_blank(p_description) then
    raise exception 'Subject and description are required' using errcode = '22023';
  end if;
  if char_length(p_subject) > 200 then
    raise exception 'Subject must be 200 characters or fewer' using errcode = '22023';
  end if;
  if char_length(p_description) > 5000 then
    raise exception 'Description must be 5000 characters or fewer' using errcode = '22023';
  end if;

  -- Abuse guard: cap simultaneously unresolved tickets per student.
  select count(*) into v_open_count
    from public.support_tickets
   where student_id = v_caller.id and status <> 'Resolved';
  if v_open_count >= 20 then
    raise exception 'You already have 20 unresolved tickets. Please close some before raising another.'
      using errcode = '22023';
  end if;

  insert into public.support_tickets (student_id, mentor_id, subject, category, priority)
  values (v_caller.id, v_caller.assigned_mentor_id, btrim(p_subject), p_category, p_priority)
  returning * into v_ticket;

  insert into public.ticket_messages (ticket_id, sender_id, body)
  values (v_ticket.id, v_caller.id, btrim(p_description));

  return v_ticket;
end;
$$;

-- ---------------------------------------------------------------------
-- Post a message on a ticket (owner, assigned mentor or HOD)
-- ---------------------------------------------------------------------
create or replace function public.post_ticket_message(
  p_ticket_id uuid,
  p_body      text
)
returns public.ticket_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket   public.support_tickets;
  v_role     public.user_role;
  v_message  public.ticket_messages;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_non_blank(p_body) then
    raise exception 'Message cannot be empty' using errcode = '22023';
  end if;
  if char_length(p_body) > 5000 then
    raise exception 'Message must be 5000 characters or fewer' using errcode = '22023';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if v_ticket.id is null then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  -- isStudentOwner / isAssignedMentor / isHod
  if not (v_ticket.student_id = auth.uid()
          or v_ticket.mentor_id = auth.uid()
          or public.is_hod()) then
    raise exception 'Unauthorized to post on this ticket' using errcode = '42501';
  end if;

  select role into v_role from public.user_profiles where id = auth.uid();

  insert into public.ticket_messages (ticket_id, sender_id, body)
  values (p_ticket_id, auth.uid(), btrim(p_body))
  returning * into v_message;

  update public.support_tickets
     set last_message_at   = now(),
         first_response_at = case
                               when first_response_at is null and v_role in ('faculty','hod')
                               then now() else first_response_at
                             end,
         status            = case
                               when v_role in ('faculty','hod') and status = 'Open'
                               then 'In Progress'::public.ticket_status else status
                             end
   where id = p_ticket_id;

  return v_message;
end;
$$;

-- ---------------------------------------------------------------------
-- Feature 3 — faculty marks resolved; ticket enters pending_confirmation
-- ---------------------------------------------------------------------
create or replace function public.resolve_support_ticket(
  p_ticket_id uuid,
  p_note      text default null
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.support_tickets;
  v_name   text;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if v_ticket.id is null then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  -- isAssignedMentor OR isHod (students may not resolve their own ticket;
  -- they answer the confirmation prompt instead)
  if not (v_ticket.mentor_id = auth.uid() or public.is_hod()) then
    raise exception 'Only the assigned mentor or the HOD can resolve this ticket'
      using errcode = '42501';
  end if;
  if v_ticket.status = 'Resolved' and v_ticket.resolution_status = 'confirmed' then
    raise exception 'This ticket is already closed and confirmed' using errcode = '22023';
  end if;

  select full_name into v_name from public.user_profiles where id = auth.uid();

  update public.support_tickets
     set status            = 'Resolved',
         resolution_status = 'pending_confirmation',
         resolved_by       = auth.uid(),
         resolved_at       = now(),
         last_message_at   = now()
   where id = p_ticket_id
   returning * into v_ticket;

  insert into public.ticket_messages (ticket_id, sender_id, body, is_system_message)
  values (
    p_ticket_id, auth.uid(),
    coalesce(nullif(btrim(p_note), ''),
             format('Marked as resolved by %s. Awaiting student confirmation.', v_name)),
    true
  );

  return v_ticket;
end;
$$;

-- ---------------------------------------------------------------------
-- Feature 3 — student answers "was your issue fixed?"  yes | no
-- ---------------------------------------------------------------------
create or replace function public.confirm_ticket_resolution(
  p_ticket_id uuid,
  p_response  public.confirmation_response,
  p_comment   text default null
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.support_tickets;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if v_ticket.id is null then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;

  -- isStudentOwner only — the whole point of this feature is that the
  -- student, not the faculty, has the final word.
  if v_ticket.student_id <> auth.uid() then
    raise exception 'Only the student who raised this ticket can confirm its resolution'
      using errcode = '42501';
  end if;
  if v_ticket.resolution_status <> 'pending_confirmation' then
    raise exception 'This ticket is not awaiting your confirmation' using errcode = '22023';
  end if;
  if p_comment is not null and char_length(p_comment) > 1000 then
    raise exception 'Comment must be 1000 characters or fewer' using errcode = '22023';
  end if;

  if p_response = 'yes' then
    update public.support_tickets
       set resolution_status            = 'confirmed',
           status                       = 'Resolved',
           student_confirmation         = 'yes',
           student_confirmation_at      = now(),
           student_confirmation_comment = nullif(btrim(p_comment), ''),
           last_message_at              = now()
     where id = p_ticket_id
     returning * into v_ticket;

    insert into public.ticket_messages (ticket_id, sender_id, body, is_system_message)
    values (p_ticket_id, auth.uid(), 'Student confirmed the issue is resolved. Ticket closed.', true);
  else
    update public.support_tickets
       set resolution_status            = 'reopened',
           status                       = 'In Progress',
           student_confirmation         = 'no',
           student_confirmation_at      = now(),
           student_confirmation_comment = nullif(btrim(p_comment), ''),
           reopen_count                 = reopen_count + 1,
           resolved_at                  = null,
           last_message_at              = now()
     where id = p_ticket_id
     returning * into v_ticket;

    insert into public.ticket_messages (ticket_id, sender_id, body, is_system_message)
    values (
      p_ticket_id, auth.uid(),
      coalesce(
        nullif('Student reported the issue is NOT resolved: ' || btrim(p_comment), 'Student reported the issue is NOT resolved: '),
        'Student reported the issue is NOT resolved. Ticket reopened.'),
      true
    );
  end if;

  return v_ticket;
end;
$$;

-- ---------------------------------------------------------------------
-- Post-resolution satisfaction rating (student owner, once)
-- ---------------------------------------------------------------------
create or replace function public.rate_support_ticket(
  p_ticket_id uuid,
  p_rating    smallint
)
returns public.support_tickets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.support_tickets;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if v_ticket.id is null then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  if v_ticket.student_id <> auth.uid() then
    raise exception 'You are not authorized to rate this ticket' using errcode = '42501';
  end if;
  if v_ticket.status <> 'Resolved' then
    raise exception 'Only a resolved ticket can be rated' using errcode = '22023';
  end if;
  if v_ticket.satisfaction_rating is not null then
    raise exception 'This ticket has already been rated' using errcode = '22023';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;

  update public.support_tickets
     set satisfaction_rating = p_rating
   where id = p_ticket_id
   returning * into v_ticket;

  return v_ticket;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants — authenticated sessions only, never anon
-- ---------------------------------------------------------------------
revoke all on function public.create_support_ticket(text, public.ticket_category, text, public.ticket_priority) from public, anon;
revoke all on function public.post_ticket_message(uuid, text) from public, anon;
revoke all on function public.resolve_support_ticket(uuid, text) from public, anon;
revoke all on function public.confirm_ticket_resolution(uuid, public.confirmation_response, text) from public, anon;
revoke all on function public.rate_support_ticket(uuid, smallint) from public, anon;

grant execute on function public.create_support_ticket(text, public.ticket_category, text, public.ticket_priority) to authenticated;
grant execute on function public.post_ticket_message(uuid, text) to authenticated;
grant execute on function public.resolve_support_ticket(uuid, text) to authenticated;
grant execute on function public.confirm_ticket_resolution(uuid, public.confirmation_response, text) to authenticated;
grant execute on function public.rate_support_ticket(uuid, smallint) to authenticated;
