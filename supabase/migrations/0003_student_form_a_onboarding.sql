-- =====================================================================
-- 0003  Feature 1 — Student onboarding (Mentor-Mentee Scheme, Form A)
--       Feature 2 — GPA sharing preference lives here too
-- =====================================================================
-- Digitised from "Form A_ Devendra.docx" (Dept. of IoT & IS).
-- One row per student. Locked read-only once submitted.
-- =====================================================================

create table if not exists public.student_form_a_profiles (
  id                                 uuid primary key default extensions.gen_random_uuid(),
  student_id                         uuid not null unique
                                       references public.user_profiles (id) on delete cascade,

  -- ── Student Details ────────────────────────────────────────────────
  full_name                          text not null,
  registration_no                    text not null,
  section                            text,
  roll_no                            text,
  branch                             text,
  mobile_no                          text not null,
  email                              text not null,
  hostel_block                       text,
  room_no                            text,
  blood_group                        text,
  date_of_birth                      date,
  is_day_scholar                     boolean not null default false,

  -- ── Any MUJ alumni in your family? ─────────────────────────────────
  has_muj_alumni_in_family           boolean not null default false,
  alumni_name                        text,
  alumni_branch                      text,
  alumni_batch                       text,
  alumni_institution                 text,
  alumni_relationship                text,

  -- ── Details of the Parents: Father ─────────────────────────────────
  father_name                        text not null,
  father_occupation                  public.parent_occupation,
  father_organization                text,
  father_designation                 text,
  father_mobile                      text,
  father_email                       text,

  -- ── Details of the Parents: Mother ─────────────────────────────────
  mother_name                        text not null,
  mother_occupation                  public.parent_occupation,
  mother_organization                text,
  mother_designation                 text,
  mother_mobile                      text,
  mother_email                       text,

  -- ── Addresses ──────────────────────────────────────────────────────
  communication_address              text not null,
  communication_pin_code             text not null,
  permanent_same_as_communication    boolean not null default false,
  permanent_address                  text not null,
  permanent_pin_code                 text not null,

  -- ── Optional uploads (Supabase Storage object paths, never public URLs)
  parent_business_card_path          text,
  student_signature_path             text,

  -- ── Feature 2: student-controlled GPA visibility ───────────────────
  gpa_sharing_enabled                boolean not null default true,

  -- ── Submission state ───────────────────────────────────────────────
  is_submitted                       boolean not null default false,
  submitted_at                       timestamptz,
  is_locked                          boolean not null default false,
  unlock_requested                   boolean not null default false,
  unlock_requested_at                timestamptz,
  unlocked_by                        uuid references public.user_profiles (id) on delete set null,

  created_at                         timestamptz not null default now(),
  updated_at                         timestamptz not null default now(),

  -- ── Validation the database enforces itself ────────────────────────
  constraint form_a_mobile_is_10_digits
    check (mobile_no ~ '^[0-9]{10}$'),
  constraint form_a_father_mobile_shape
    check (father_mobile is null or father_mobile ~ '^[0-9]{10}$'),
  constraint form_a_mother_mobile_shape
    check (mother_mobile is null or mother_mobile ~ '^[0-9]{10}$'),
  constraint form_a_email_shape
    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint form_a_father_email_shape
    check (father_email is null or father_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint form_a_mother_email_shape
    check (mother_email is null or mother_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint form_a_pin_codes_are_6_digits
    check (communication_pin_code ~ '^[0-9]{6}$' and permanent_pin_code ~ '^[0-9]{6}$'),
  constraint form_a_blood_group_valid
    check (blood_group is null or blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  constraint form_a_dob_is_plausible
    check (date_of_birth is null or (date_of_birth > date '1950-01-01' and date_of_birth < current_date)),
  -- if the student ticked "yes" to alumni, at least a name is required
  constraint form_a_alumni_details_required_when_yes
    check (has_muj_alumni_in_family = false or public.is_non_blank(alumni_name)),
  -- hostel details required unless day scholar
  constraint form_a_hostel_required_unless_day_scholar
    check (is_day_scholar = true or public.is_non_blank(hostel_block)),
  constraint form_a_submitted_has_timestamp
    check (is_submitted = false or submitted_at is not null)
);

comment on table public.student_form_a_profiles is
  'Feature 1 — digitised Mentor-Mentee Scheme Form A. One-time institutional form; read-only after submission until an HOD unlocks it.';

create index if not exists form_a_student_idx           on public.student_form_a_profiles (student_id);
create index if not exists form_a_submitted_idx         on public.student_form_a_profiles (is_submitted);
create index if not exists form_a_unlock_requested_idx  on public.student_form_a_profiles (unlock_requested) where unlock_requested = true;

drop trigger if exists trg_form_a_updated_at on public.student_form_a_profiles;
create trigger trg_form_a_updated_at
  before update on public.student_form_a_profiles
  for each row execute function public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------
-- Feature 2 — semester-wise GPA entries (1 through 8)
-- Entry is ALWAYS available to the student. gpa_sharing_enabled above
-- only controls whether faculty/HOD can read these rows.
-- ---------------------------------------------------------------------
create table if not exists public.student_semester_gpas (
  id               uuid primary key default extensions.gen_random_uuid(),
  student_id       uuid not null references public.user_profiles (id) on delete cascade,
  semester_number  smallint not null,
  gpa              numeric(4,2) not null,
  recorded_at      timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint semester_gpa_range check (semester_number between 1 and 8),
  constraint gpa_value_range     check (gpa >= 0 and gpa <= 10),
  constraint one_gpa_per_semester unique (student_id, semester_number)
);

comment on table public.student_semester_gpas is
  'Feature 2 — semester GPA history. Visible to faculty/HOD only when the student has gpa_sharing_enabled.';

create index if not exists semester_gpas_student_idx on public.student_semester_gpas (student_id, semester_number);

drop trigger if exists trg_semester_gpas_updated_at on public.student_semester_gpas;
create trigger trg_semester_gpas_updated_at
  before update on public.student_semester_gpas
  for each row execute function public.set_updated_at_timestamp();
