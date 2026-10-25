-- =====================================================================
-- 0026  New ticket categories
-- =====================================================================
-- The student-facing category list becomes:
--     Academics · Examination · Behavioural · Administrative · Others
--
-- ENUM VALUES ONLY IN THIS FILE
-- ---------------------------------------------------------------------
-- Postgres refuses to USE a newly added enum value inside the transaction
-- that added it, and `supabase db push` may wrap one migration file in a
-- single transaction. Same rule as migration 0020: the ALTER TYPE
-- statements get a file to themselves so nothing can reference them too
-- early. §11.5.
--
-- WHY THE OLD THREE STAY IN THE TYPE
-- ---------------------------------------------------------------------
-- Postgres has no DROP VALUE for an enum, and support_tickets rows
-- already carry 'Academic', 'ERP/Tech' and 'Infrastructure'. Removing
-- them is therefore impossible without rewriting the column and rewriting
-- history with it. They remain valid values in the database and simply
-- stop being offered in the UI — frontend/src/lib/constants.js now lists
-- only the five above, so nothing new can be filed under them while every
-- existing ticket keeps the category it was raised with.
--
-- Note 'Academics' (plural) is a DISTINCT value from the legacy
-- 'Academic'. That is deliberate rather than an oversight: renaming the
-- old one would silently relabel historical tickets.
-- =====================================================================

alter type public.ticket_category add value if not exists 'Academics';
alter type public.ticket_category add value if not exists 'Examination';
alter type public.ticket_category add value if not exists 'Behavioural';
alter type public.ticket_category add value if not exists 'Administrative';
alter type public.ticket_category add value if not exists 'Others';
