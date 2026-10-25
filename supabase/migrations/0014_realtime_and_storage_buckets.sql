-- =====================================================================
-- 0014  Realtime publication + private Storage buckets
-- =====================================================================

-- ── Realtime ──────────────────────────────────────────────────────────
-- Realtime respects RLS: a subscriber only receives rows their SELECT
-- policy already allows. This is what makes a ticket raised in the
-- student portal pop up in the faculty portal with no refresh.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Adding a table twice raises an error, so re-running this migration has
-- to be safe.
do $$
declare
  t text;
begin
  foreach t in array array[
    'support_tickets', 'ticket_messages', 'notifications',
    'user_profiles', 'student_achievements'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- REPLICA IDENTITY FULL so UPDATE events carry the old row too, which the
-- client needs to tell "status changed" from "someone typed a message".
alter table public.support_tickets      replica identity full;
alter table public.ticket_messages      replica identity full;
alter table public.notifications        replica identity full;
alter table public.student_achievements replica identity full;

-- ── Storage buckets ───────────────────────────────────────────────────
-- All private. Files are served through short-lived signed URLs, never
-- public links, because Form A uploads contain personal data.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('form-a-uploads',    'form-a-uploads',    false, 5242880,
   array['image/png','image/jpeg','image/jpg','image/webp','application/pdf']),
  ('achievement-proofs','achievement-proofs',false, 5242880,
   array['image/png','image/jpeg','image/jpg','image/webp','application/pdf']),
  ('roster-imports',    'roster-imports',    false, 10485760,
   array['text/csv','application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Convention: every object path starts with the owning student's uuid,
-- e.g.  form-a-uploads/<student_uuid>/signature-1712345678.png
-- so ownership is derivable from the path itself.

drop policy if exists form_a_uploads_insert_own   on storage.objects;
drop policy if exists form_a_uploads_update_own   on storage.objects;
drop policy if exists form_a_uploads_select_scope on storage.objects;
drop policy if exists form_a_uploads_delete_own   on storage.objects;

create policy form_a_uploads_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'form-a-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy form_a_uploads_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'form-a-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy form_a_uploads_select_scope on storage.objects
  for select to authenticated
  using (
    bucket_id = 'form-a-uploads'
    and public.can_access_student(((storage.foldername(name))[1])::uuid)
  );

create policy form_a_uploads_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'form-a-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists achievement_proofs_insert_own   on storage.objects;
drop policy if exists achievement_proofs_select_scope on storage.objects;
drop policy if exists achievement_proofs_delete_own   on storage.objects;

create policy achievement_proofs_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'achievement-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy achievement_proofs_select_scope on storage.objects
  for select to authenticated
  using (
    bucket_id = 'achievement-proofs'
    and public.can_access_student(((storage.foldername(name))[1])::uuid)
  );

create policy achievement_proofs_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'achievement-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

-- Roster spreadsheets: HOD only.
drop policy if exists roster_imports_hod_all on storage.objects;
create policy roster_imports_hod_all on storage.objects
  for all to authenticated
  using (bucket_id = 'roster-imports' and public.is_hod())
  with check (bucket_id = 'roster-imports' and public.is_hod());
