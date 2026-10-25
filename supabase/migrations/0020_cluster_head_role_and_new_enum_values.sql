-- =====================================================================
-- 0020  Cluster Head role + every new enum value
-- =====================================================================
-- WHY THIS FILE CONTAINS NOTHING BUT ENUM CHANGES
-- ---------------------------------------------------------------------
-- Postgres refuses to USE a newly added enum value inside the same
-- transaction that added it ("unsafe use of new value ... of enum type").
-- `supabase db push` may wrap a single migration file in one transaction,
-- so a file that both adds 'cluster_head' to user_role and then writes a
-- policy referencing it would fail on a fresh push while succeeding under
-- psql. Keeping the ALTER TYPE statements alone in their own migration
-- removes the ordering hazard entirely: 0021 onwards may use them freely.
--
-- See §11.5 of the engineering context — same rule, applied to the role
-- enum rather than only to notification_type.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The new role
-- ---------------------------------------------------------------------
-- A Cluster Head does exactly two things: upload attendance (every 15
-- days) and upload backlog/GPA data (every 6 months). They get their own
-- portal and deliberately have NO access to tickets, and no access to
-- student profiles beyond the narrow projection needed to match an
-- uploaded row to the right student (see resolve_students_for_upload()
-- in migration 0021).
alter type public.user_role add value if not exists 'cluster_head';


-- ---------------------------------------------------------------------
-- 2. Notification types for the at-risk and survey workflows
-- ---------------------------------------------------------------------
alter type public.notification_type add value if not exists 'student_at_risk';
alter type public.notification_type add value if not exists 'at_risk_meeting_required';
alter type public.notification_type add value if not exists 'at_risk_cleared';
alter type public.notification_type add value if not exists 'survey_published';
alter type public.notification_type add value if not exists 'survey_reminder';
alter type public.notification_type add value if not exists 'academic_data_uploaded';


-- ---------------------------------------------------------------------
-- 3. Brand-new enum types
-- ---------------------------------------------------------------------
-- CREATE TYPE has none of the transaction hazard above, but these live
-- here so that every enum in the feature lands in one reviewable place.

-- What kind of file a Cluster Head just uploaded.
do $$ begin
  create type public.academic_upload_type as enum ('attendance', 'gpa', 'backlog');
exception when duplicate_object then null; end $$;

-- Lifecycle of the meeting that gets scheduled for a flagged student.
-- 'awaiting_link' is the state the row sits in while the Teams-vs-Meet
-- decision is still open: everything else about the meeting exists, only
-- the joinable URL is missing. See create_at_risk_meeting_link() in 0022.
do $$ begin
  create type public.at_risk_meeting_status as enum (
    'awaiting_link', 'scheduled', 'completed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- The recurring jobs that normally fire on the 15-day cycle.
do $$ begin
  create type public.cycle_job_type as enum (
    'survey_cycle',              -- open the next 15-day student survey
    'survey_reminder_sweep',     -- nudge whoever has not answered the open survey
    'at_risk_sweep',             -- re-evaluate every student's risk flags
    'at_risk_meeting_dispatch'   -- raise meetings + notify mentors for flagged students
  );
exception when duplicate_object then null; end $$;

-- Did this run come from the schedule, or did a human press the button?
do $$ begin
  create type public.cycle_job_trigger as enum ('scheduled', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.cycle_job_status as enum ('running', 'succeeded', 'failed');
exception when duplicate_object then null; end $$;

-- Where a GPA row came from. Students still self-report GPA (Feature 2);
-- the Cluster Head upload is the authoritative source and must not be
-- silently overwritten by a student edit.
do $$ begin
  create type public.gpa_source as enum ('student', 'cluster_head');
exception when duplicate_object then null; end $$;
