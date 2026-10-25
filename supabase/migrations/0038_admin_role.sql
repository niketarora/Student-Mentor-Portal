-- =====================================================================
-- 0038  The administrator role
-- =====================================================================
-- Adds 'admin' to user_role. The administrator sees the whole department
-- (what the single HOD used to see) and is the only account that can
-- upload the mentor-HOD mapping; migration 0039 builds on it.
--
-- This file holds nothing else on purpose. Postgres will not let a
-- transaction use an enum value that the same transaction added, and
-- 0039 compares roles against 'admin' throughout. Apply this file on
-- its own (supabase db push does: one transaction per file), then 0039.
-- =====================================================================

alter type public.user_role add value if not exists 'admin';
