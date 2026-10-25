-- =====================================================================
-- 0034  'black_dot' upload type
-- =====================================================================
-- The Cluster Head portal gains a fourth academic upload: the Proctorial
-- Board notice listing the students given a black dot. Like attendance,
-- GPA and backlogs, every such upload is recorded in
-- academic_upload_batches, so the enum needs the value.
--
-- Alone in its own file for the reason given at the top of 0020: Postgres
-- will not let a new enum value be used inside the transaction that added
-- it, and 0035 uses this one straight away.
-- =====================================================================

alter type public.academic_upload_type add value if not exists 'black_dot';
