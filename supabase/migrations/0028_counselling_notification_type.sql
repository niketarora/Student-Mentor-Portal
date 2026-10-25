-- =====================================================================
-- 0028  Counselling notification type
-- =====================================================================
-- Enum values get a file to themselves: Postgres refuses to USE a value
-- in the transaction that added it, and `supabase db push` may wrap one
-- migration file in a single transaction. Same rule as 0020 and 0026.
--
-- One value, not two. It only picks the bell icon, and a student being
-- answered and a mentor being asked are the same kind of event from the
-- notification table's point of view — the title says which.
-- =====================================================================

alter type public.notification_type add value if not exists 'counselling_request';
