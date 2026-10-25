-- =====================================================================
-- 0037  Students no longer record their own GPA
-- =====================================================================
-- The "Record your GPA" panel is gone from the student's Academics page:
-- a GPA now comes only from the department, through the cluster head's
-- ERP upload (record_gpa_batch). This migration closes the two ways a
-- student could still write one without the panel:
--
--   * upsert_semester_gpa(), the function the panel called. It is no
--     longer executable by signed-in users. It is kept rather than
--     dropped, so the feature could come back with a single GRANT.
--
--   * the direct-write policies gpas_insert_own, gpas_update_own and
--     gpas_delete_own. They never looked at `source`, so they also let a
--     student change or delete a GPA the department had published (known
--     gap S1 in the master documentation). With them gone, and the table
--     grant narrowed to SELECT, only the SECURITY DEFINER upload functions
--     write this table.
--
-- Reading is unchanged: gpas_select_permitted still lets the student, the
-- HOD and the mentor (while GPA sharing is on, the default) read. GPAs
-- students recorded before this migration are kept, with source =
-- 'student'; a department upload for the same semester replaces them, as
-- it always did.
-- =====================================================================

drop policy if exists gpas_insert_own on public.student_semester_gpas;
drop policy if exists gpas_update_own on public.student_semester_gpas;
drop policy if exists gpas_delete_own on public.student_semester_gpas;

revoke all on public.student_semester_gpas from anon, authenticated;
grant select on public.student_semester_gpas to authenticated;

revoke execute on function public.upsert_semester_gpa(smallint, numeric) from public, anon, authenticated;

comment on function public.upsert_semester_gpa(smallint, numeric) is
  'Retired by 0037: students no longer record their own GPA. Not executable by signed-in users; kept so the feature could be restored with a grant.';
