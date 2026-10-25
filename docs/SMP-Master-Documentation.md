# SMP — Student Mentorship Portal

## Master technical documentation (single source of truth)

| | |
|---|---|
| **Describes** | The code in this repository at commit `2526b1f` on branch `main` (2026-09-11, "optimize bulk upload student lookups across all imports"), plus the black dot upload and the ERP GPA and backlog formats added on 2026-09-27 (migrations `0034`–`0035`, §4.12), and from the same day the Academic Performance Overview and the HOD Students paging fix (frontend only, §4.9, §4.18, §4.20). On 2026-09-28: academic cycles, black dots in the at-risk rule, and the end of student GPA entry (migrations `0036`–`0037`, §4.24, §4.14, §4.9). On 2026-10-07: the **administrator** portal, the mentor–HOD mapping upload, each HOD seeing only the faculty mapped to them, and the cluster head's upload screens inside the HOD portal (migrations `0038`–`0039`, §4.25). On 2026-10-08: the student chooses a **type of counselling** before describing the issue (migration `0040`, §4.8), and the "by category" charts count the current query categories (migration `0041`, §4.17, known issue B1). On 2026-10-22: **senior mentors**, a second mentor for every student, with Peer Queries, Ask HOD / Escalate, the Raised to HOD and Raised to Me pages, section assignment by the HOD and the senior list script (migration `0042`, §4.26). That is SQL migrations `0001`–`0042`. |
| **Supersedes** | `docs/SSMP-Platform-Context.docx` (August 2026, which covered migrations 0001–0019). Where `README.md`, `SETUP_GUIDE.md`, `docs/SECURITY.md` or `docs/CLUSTER-HEAD-AND-CYCLE-JOBS.md` disagree with this document, this document is correct. Those files contain stale statements; see §15.5. |
| **How it was produced** | Every statement was checked against the source files. SQL behaviour was checked against the live definitions produced by replaying all 42 migrations on Postgres. Items marked *(tested)* were also exercised inside rolled-back transactions. Code comments, UI copy and the older documents were **not** treated as evidence. Where they contradict the code, this document says so. |
| **Secrets** | None appear here. Environment variables, the temporary password, the seed password and keys are documented by **name and purpose only**. |

### How to use this document

- **If you are an engineer or an AI starting on this codebase:** read §1 and §2 first, then the feature you are touching in §4. After that, the matching reference: §6 for the API, §7 for the database, §9 for the frontend. Read Appendix A (invariants) before changing anything.
- **Status words used throughout:**

  | Status | Meaning |
  |---|---|
  | **Implemented** | Works end to end in the current code. |
  | **Partial** | Works, but with a documented gap. |
  | **Placeholder** | The code path exists but deliberately does nothing real yet. |
  | **Dead** | Present in the repository but unreachable or unused. |
  | **Removed** | Existed in the old document or the code history, gone now. |
  | **Not implemented** | Requested or planned, with no code at all. |

- **Known issue** callouts mark verified bugs and gaps. They are collected in §15.
- **Naming.**
  - "**SMP**" is the product's current name.
  - "**SSMP**" (Student Support & Mentorship Portal) is the former name. It still appears in identifiers: `ssmp.trusted_operation`, `SSMP_TEMPORARY_PASSWORD`, the npm package `ssmp-platform`, the browser storage key `ssmp.auth.session`, the header `x-application-name: ssmp-portal`, the `/api/health` message "SSMP API is running", and PDF metadata.
  - A **query** is what older code and documents call a **ticket**. Migration `0031` renamed tables, enums, functions, notification types and routes.
- **Paths** are relative to the repository root. `file.js:120` means line 120 of that file at the commit above.

### Contents

1. [What SMP is](#1-what-smp-is)
2. [Architecture](#2-architecture)
3. [Codebase structure](#3-codebase-structure)
4. [Features](#4-features)
5. [Functions and logic](#5-functions-and-logic)
6. [API reference](#6-api-reference)
7. [Database reference](#7-database-reference)
8. [Authentication and security](#8-authentication-and-security)
9. [Frontend](#9-frontend)
10. [Backend](#10-backend)
11. [Integrations](#11-integrations)
12. [Configuration and environment](#12-configuration-and-environment)
13. [Running, testing and deploying](#13-running-testing-and-deploying)
14. [Error handling and edge cases](#14-error-handling-and-edge-cases)
15. [Current status and limitations](#15-current-status-and-limitations)
16. [Change history against the old document](#16-change-history-against-the-old-document)
- [Appendix A — Invariants](#appendix-a--invariants-rules-that-must-keep-holding)
- [Appendix B — Change recipes](#appendix-b--change-recipes)
- [Appendix C — Limits and constants](#appendix-c--limits-and-constants-quick-reference)
- [Appendix D — Demo and seed data](#appendix-d--demo-and-seed-data)
- [Appendix E — Glossary](#appendix-e--glossary)

---

## 1. What SMP is

### 1.1 Purpose and the problem it solves

SMP is a web portal that digitises a university department's **mentor–mentee scheme**. The code's defaults point to the Department of IoT & Intelligent Systems at Manipal University Jaipur:

- `department` defaults to `'IoT & IS'`.
- The login page defaults to "Department of IoT & Intelligent Systems" and "Manipal University Jaipur".
- The PDFs carry the MUJ logo.

Every student has exactly one faculty **mentor**. The portal replaces paper, e-mail and chat with a single system of record, and it makes the mentoring relationship **accountable and measurable**:

- **Student queries** (support requests) go to the student's own mentor. A query can only be closed when the **student confirms** it is fixed. A student can reject a resolution at most 3 times. The mentor can **refer a query to the HOD**. Every query has timestamps (first response, resolution) and a 1–5 satisfaction rating.
- **Form A** is the department's onboarding record: student, parents, address, alumni links. It is compulsory before the portal opens, as is a profile photo.
- **Academic monitoring.** Cluster heads and HODs upload attendance (the ERP export), semester GPAs, backlogs and the Proctorial Board's black dots. Every upload re-evaluates each affected student against the **at-risk rule**, and the mentor is notified. See §4.14.
- **Academic cycles.** Each academic year is one **cycle** ("2026–27") with an odd and an even semester. Everything uploaded is filed under the cycle it belongs to, so the next year never overwrites the last. See §4.24.
- **Pastoral channels:**
  - private **counselling** requests to one's mentor;
  - a class representative ("**star mentee**") who files **CR reports** (meeting minutes), whose action items become queries;
  - a recurring department-wide **feedback survey** about mentoring.
- **Oversight.** Each HOD gets, for the faculty mapped to them (§4.25):
  - dashboards;
  - per-faculty performance metrics;
  - activity reports and student dossiers, on screen and as PDFs;
  - a faculty roster in which a departing mentor's mentees (and their open queries) can be reassigned in one step.

  The **administrator** gets the same screens for the whole department, and uploads the mentor–HOD mapping that decides which faculty each HOD sees.

### 1.2 Users and roles

Roles are the Postgres enum `user_role`. A user has exactly one role, stored in `user_profiles.role`. Users cannot change their own role: it is a protected column that only the administrator, a HOD for the people they oversee (by a direct update; there is no UI for it), trusted functions or SQL can change. Only the administrator can grant or remove the `hod` or `admin` role (§4.25).

| Role | Who | Portal root | What they do |
|---|---|---|---|
| `student` | Enrolled student | `/student` | Fill Form A and upload a photo (both compulsory). Raise and track queries, sending each to their faculty mentor or, when they have one, their senior mentor (§4.26); confirm or reject resolutions; rate. See their academic record (attendance, GPA, backlogs, black dots) as the department recorded it. Maintain achievements. Answer the feedback survey. Request counselling. |
| `faculty` | Faculty **mentor** | `/faculty` | Answer and resolve mentees' queries and refer them to the HOD. Answer the queries a senior mentor raises to them (Raised to Me, §4.26). Set their department and HOD e-mail. View mentees and their dossiers; verify achievements. Choose one star mentee. Handle counselling. Act on CR-report items. Follow at-risk mentees. Produce their own activity report. |
| `admin` | Administrator (one account; `npm run db:admin` creates it) | `/admin` | Everything the HOD portal did before migration `0039`, for the **whole department**: every query, faculty member and student, the department report, employment status and reassignment, single accounts (including HOD accounts), the periodic jobs. Plus **Upload**: the mentor–HOD mapping (§4.25). Sees faculty no HOD has been given and students without a mentor. |
| `hod` | Head of Department (several since `0039`) | `/hod` | The same department screens, limited to the **faculty mapped to them** and those faculty's mentees: queries, students, at-risk lists, reports, roster, reassignment within their faculty, single accounts (not HOD accounts). Run the periodic jobs. **Uploads**: the cluster head's upload screens (overview, academic cycles, attendance, GPA, backlogs, black dots, rosters and mentors), without the subject setup or My Subjects (§4.25). |
| `cluster_head` | Staff member responsible for academic data | `/cluster-head` | One-time subject setup. Run the **academic cycles**: start each year's cycle, bring students into it, download the cycle report (§4.24). Upload attendance, GPA, backlogs and black dots. Upload student and faculty rosters and the mentor–mentee mapping. Through RLS and the UI, cluster heads have **no** access to queries, Form A, GPA or risk data (but see §8.9 S2). They can read back only the backlog and black dot rows they uploaded, and cycle-wide counts with no student named. |

There are three further **flags** that are not roles:

- **Star mentee (student representative):** `user_profiles.is_star_mentee`. At most one per mentor group, set by the mentor (or their HOD, or the administrator). It unlocks three student pages: Group Queries, Survey Tracking and CR Report.
- **Senior mentor:** `user_profiles.is_senior_mentor` (0042). A student who also mentors juniors: the HOD gives them sections, and the students of those sections can send them queries. It adds Peer Queries and Assigned Mentees to their student portal. Only the senior list script (`npm run db:seniors`) and the administrator set it (§4.26).
- **Faculty employment status:** `user_profiles.employment_status` is `active`, `on_leave` or `departed`. Together with `available_for_reassignment` and `mentee_capacity` it defines the **reserve pool** used for reassignment.

**Nobody signs up.** Self sign-up is disabled (`supabase/config.toml`: `enable_signup = false`). Accounts are created in six ways:

1. by a cluster head's (or a HOD's, or the administrator's) roster upload;
2. by the single-account form (HOD or administrator);
3. automatically, for mentors named in a mentor–mentee mapping upload who have no account yet;
4. automatically, for HODs and mentors named in the administrator's mentor–HOD mapping upload who have no account yet (§4.25);
5. by the seed scripts, and `npm run db:admin` for the administrator;
6. by the senior list, `npm run db:seniors`, for senior mentors who have no account yet (§4.26).

Every account the portal creates starts on a shared temporary password (§4.1) and must choose a new password at first sign-in. Seeded demo accounts are the exception (Appendix D).

### 1.3 End-to-end workflow

The normal life of an academic year, in order. Section numbers point to the detailed description.

0. **The administrator and the HODs.** The administrator (`npm run db:admin`) uploads the department's **mentor–HOD mapping** sheet: one row per mentor or class coordinator, with their section and the HOD they report to. It creates any HOD or mentor account the sheet names, and decides which faculty (and so which students) each HOD sees (§4.25).
1. **The academic cycle.** Each academic year is one cycle, such as 2026–27, with an odd semester (July to December) and an even semester (January to June). Migration `0036` creates the first one. When the next year begins, a cluster head or a HOD starts the next cycle from Academic Cycles; the old one is closed and kept exactly as it was (§4.24).
2. **Cluster head onboarding.** The cluster head signs in with the temporary password and sets a new one. They then complete the one-time **setup form**: the subjects they own, as course name and course code. Their portal opens only after that (§4.11). A HOD uploading from Uploads has no setup form and no subject list: the subject is read from each attendance file (§4.25).
3. **Accounts.** The cluster head uploads the **student roster**, which creates student accounts keyed by e-mail, with the registration number stored as `login_id`. Then they upload the **faculty roster** (optional) and the **mentor–mentee mapping**, which links each registration number to a mentor e-mail and creates any missing mentor accounts (§4.13).
4. **Student onboarding.** A student signs in, changes the temporary password, then fills **Form A**, then uploads a **profile photo**. Only then does the student portal open (§4.3).
5. **Mentor set-up.** From My Mentees the mentor records their **department**, and their **HOD e-mail** if the mapping has not already set it (then it is shown read-only). The HOD decides who sees their mentees and who receives their referrals (§4.5, §4.25). They also choose a **star mentee** (§4.6).
   - **Senior mentors.** The administrator lists the senior (or alumni) mentors' e-mails and runs `npm run db:seniors`, which creates or flags their student accounts. A HOD then stars each senior on **Senior Mentors** and picks their sections (A3 … T4); the students of those sections get them as their senior mentor (§4.26).
6. **Day-to-day mentoring:**
   - The student raises a **query**. The mentor replies (the first reply moves it to *In Progress*) and resolves it. The student confirms (closed) or rejects (reopened; at most 3 times), and can rate 1–5. At any point the mentor may **raise the query to the HOD** (§4.4, §4.5).
   - A student with a **senior mentor** may send the query to the senior instead. The senior answers it under Peer Queries and, when they need help, raises it to the student's faculty mentor or escalates it to the HOD with a reason (§4.26).
   - Students can send **counselling** requests that only their mentor sees (§4.8).
   - The star mentee files **CR reports**. Every action item becomes a query assigned to the mentor, who works through them from CR Reports (§4.7).
7. **Academic data.** Whenever it is available, the cluster head (or a HOD, from Uploads) uploads the ERP **attendance** export, the ERP **CGPA / GPA & Credits** export, the ERP **Defaulter Grade** result (backlogs) and the Proctorial Board's **black dot** notice. There is no date window. Students are matched on registration number only.
   - Every upload is filed under the active cycle and writes the data. Each one then re-evaluates the affected students' **at-risk** flags: attendance below 75% in this cycle, latest GPA below 6, an uncleared backlog, or a black dot in this cycle.
   - The mentor is notified when a student becomes (or stops being) at risk.
   - Students see their own attendance, GPA, backlogs and black dots. They no longer record GPA themselves; migration `0037` removed that (§4.9, §4.12, §4.14).
8. **Periodic jobs.** These are nominally every 15 days (reminders every 7), but **they only run when triggered**, normally by a HOD or the administrator from Scheduled Jobs (§4.16). The jobs:
   - re-sweep every student's risk;
   - raise a **mentor meeting** record for each flagged student (no video link is generated yet; that step is a placeholder);
   - open a new **feedback survey** cycle and notify every student;
   - remind students who have not answered.
9. **Survey.** Every student answers 10 questions on a 1–5 scale. The star mentee sees who in the group has not answered, and the mentor sees per-mentee status (§4.15).
10. **Oversight and reports.**
   - Dashboards for each role (§4.17).
   - The faculty performance table (each HOD: their faculty; the administrator: everyone).
   - Faculty activity, all-faculty and student-dossier reports, on screen and as PDFs (§4.18).
   - When a faculty member leaves, their HOD (or the administrator) marks them *departed* and reassigns their mentees. Unresolved queries move to the new mentor, and everyone involved is notified (§4.19).

---

## 2. Architecture

### 2.1 System diagram

```
                ┌───────────────────────────────────────────────────────────────┐
                │ Browser: React 19 SPA (Vite build in frontend/dist, served    │
                │ by Vercel as static files; every non-/api path → index.html)  │
                └───────┬───────────────────────────────────────┬───────────────┘
   supabase-js with the │ anon key + the user's JWT             │ fetch('/api/…') with
   (reads, RPCs, some   │ (PKCE sign-in, session in             │ Authorization: Bearer <user JWT>
   direct writes,       │ localStorage)                         │
   Realtime, Storage)   ▼                                       ▼
┌──────────────────────────────────────────────┐   ┌───────────────────────────────────────────┐
│ Supabase                                     │   │ Vercel Serverless Functions (Node ≥20,    │
│  • Auth: e-mail + password, sign-up disabled │   │ ESM, 1024 MB, 30 s)                       │
│  • PostgREST → Postgres 15                   │   │  api/health.js                            │
│     – 34 tables, RLS enabled on every one    │◄──┤  api/admin/{provision-user-accounts,      │
│     – 10 views, all security_invoker         │   │     import-roster-spreadsheet,            │
│     – 116 functions: SECURITY DEFINER RPCs,  │   │     manage-faculty-roster, run-cycle-job} │
│       helpers, trigger functions             │   │  api/cluster-head/upload-academic-data    │
│     – triggers write every notification      │   │  api/reports/{faculty-activity-report,    │
│  • Realtime (5 tables, filtered by RLS)      │   │     student-dossier-report}               │
│  • Storage (4 private buckets)               │   │ Each request: verify JWT → load profile → │
└──────────────────────────────────────────────┘   │ role → rate limit → validate → work →     │
                                                   │ audit → JSON envelope (or a PDF)          │
                                                   │ Two clients: service role (bypasses RLS)  │
                                                   │ and "as user" (anon key + caller's JWT)   │
                                                   └───────────────────────────────────────────┘
```

There is no other server. There is no application database outside Supabase, no queue and no cache.

### 2.2 Design principles

1. **The database is the security boundary.**
   - Row Level Security is enabled on all 34 tables.
   - Every state change that has rules or side effects is a `SECURITY DEFINER` function that re-checks the caller itself. These functions run with `set search_path = public, pg_temp`.
   - The browser can call these RPCs directly. Route guards and API role checks are there for early rejection and user experience only.
2. **The browser talks to Supabase directly** for almost everything, under the user's own JWT. The API exists only for work that:
   - needs the **service role** (creating Auth users, moving another mentor's queries, writing the audit log, the rate-limit counter);
   - needs **file parsing** (spreadsheets) or **PDF generation**;
   - benefits from a **server-side rate limit and an audit entry**.
3. **Even in the API, work runs as the user where possible.** Uploads, reports and cycle jobs call their RPCs through `context.asUser`: the anon key plus the caller's JWT. The database's own checks therefore still apply. The service-role client is used only for the operations listed above.
4. **Notifications are only created by the database.** Triggers and definer RPCs call `enqueue_notification`. The frontend never inserts a notification; it only reads them and marks them read.
5. **One number, one source.** A report's on-screen charts and its PDF call the same SQL function, so they cannot disagree.

### 2.3 Which path each kind of operation takes

| Operation | Path | Examples |
|---|---|---|
| Reading lists, dashboards and detail pages | Browser → PostgREST (tables/views under RLS) or a read RPC | `support_queries`, `student_query_summary`, `get_dashboard_metrics`, `get_student_dossier` |
| State transitions with rules or side effects | Browser → `supabase.rpc()` (SECURITY DEFINER) | `create_support_query`, `resolve_support_query`, `confirm_query_resolution`, `escalate_query_to_hod`, `set_star_mentee`, `submit_student_form_a`, `request_counselling`, `submit_mom_report`, `submit_survey_response`, `submit_cluster_head_setup`, `create_academic_cycle`, `carry_over_cycle_students`, `reevaluate_students_batch`, `set_mentor_department_and_hod` |
| Simple self-edits allowed by RLS | Browser → direct `insert/update/delete` | own `phone` and `avatar_url`; own achievements; marking own notifications read; a mentor/HOD changing a query's `priority`; clearing `must_change_password` |
| Creating accounts | API → Supabase Auth Admin (service role) | provision-user-accounts, import-roster-spreadsheet, mentor-map upload |
| Parsing uploaded spreadsheets | API → parser → RPC as the user | upload-academic-data (attendance, GPA, backlog, black dot, mentor map) |
| Faculty status and reassignment | API → RPC as the user, then a service-role update of `support_queries` | manage-faculty-roster |
| PDFs | API → report RPC as the user → pdf-lib | faculty-activity-report, student-dossier-report |
| Excel reports | API → report RPC as the user → ExcelJS | academic-cycle-report |
| Periodic jobs | API → RPC as the user | run-cycle-job |
| Rate limiting and audit | API → `consume_rate_limit`, `write_audit_entry` | every privileged endpoint |

### 2.4 Realtime

The `supabase_realtime` publication contains `notifications`, `query_messages`, `student_achievements`, `support_queries` and `user_profiles` (migration 0014; members renamed in 0031). Realtime applies the subscriber's RLS, so a client only receives rows it could `SELECT`. The client is configured for 8 events/second.

| Channel | Table / event / filter | Subscriber | Effect |
|---|---|---|---|
| `profile-watch-<uid>` | `user_profiles` UPDATE, `id=eq.<uid>` | `AuthProvider` | Reloads the signed-in profile. A mentor change, star flag or Form A status appears without a reload. |
| `notifications-<uid>` | `notifications` INSERT and UPDATE, `recipient_id=eq.<uid>` | `NotificationProvider` | INSERT adds the row to the top of the bell (kept at 30) and shows a toast with the title. UPDATE replaces the row. |
| `queries-stream` | `support_queries` `*`, no filter | `useRealtimeQueries` (query lists, dashboards) | Re-runs the list query. |
| `query-<id>` | `query_messages` `*` with `query_id=eq.<id>`; `support_queries` UPDATE with `id=eq.<id>` | `useQueryThread` (query detail pages) | Reloads the thread and the query. |
| `group-queries` | `support_queries` `*`, no filter | `StudentGroupQueriesPage` | Reloads the page's RPC. Because of RLS the representative only receives events for **their own** queries, so classmates' new queries do not arrive live. |
| `peer-queries` | `support_queries` `*`, no filter | `SeniorPeerQueriesPage` (0042) | Reloads `get_peer_queries`. RLS delivers the events of queries sent to the senior (and their own). |
| `raised-faculty` / `raised-hod` | `support_queries` `*`, no filter | `RaisedQueriesPage` (0042) | Reloads `get_raised_queries`. |

Nothing subscribes to `student_achievements`, although the table is in the publication.

### 2.5 Storage

There are four **private** buckets. Object paths always begin with the uploader's user id (`<uid>/…`), and the storage policies key off that first folder.

| Bucket | Limit and types | Written by | Read by |
|---|---|---|---|
| `form-a-uploads` | 5 MB; png, jpeg, jpg, webp, pdf | Student (Form A business card and signature) | Anyone for whom `can_access_student(<uid>)` holds: self, mentor, the mentor's HOD, the administrator |
| `achievement-proofs` | 5 MB; same types | Student | `can_access_student(<uid>)` |
| `profile-photos` | 3 MB; png, jpeg, jpg, webp | Owner (onboarding photo step) | **Any authenticated user** |
| `roster-imports` | 10 MB; csv, xls, xlsx | HOD or administrator (policy, `is_hod()`) | HOD or administrator. **No code uses this bucket.** Spreadsheets are posted to the API as base64 instead. |

Files are served through signed URLs: 300 s in `createSignedUrl`, 3,600 s for avatars.

### 2.6 Key request flows

**A student raises a query**

1. `CreateQueryModal` calls `supabase.rpc('create_support_query', {p_subject, p_category, p_description, p_priority: 'Medium'})`.
2. The function checks that the caller is an active student with a mentor and fewer than 20 unresolved queries. It inserts the `support_queries` row (the `assign_query_code` trigger sets `AN-<n>`) and the first `query_messages` row.
3. The triggers `trg_notify_query_created` and `trg_notify_query_message` insert notifications for the mentor.
4. Realtime delivers the new query to every open list the mentor can see, and the notification to the mentor's bell.

**A cluster head (or a HOD) uploads attendance**

1. `AcademicUploadPanel` reads the file as base64 and posts `{action: 'attendance', filename, file_base64}` to `/api/cluster-head/upload-academic-data`.
2. The endpoint:
   - authenticates the caller and checks the role (`cluster_head`, `hod` or `admin`);
   - applies the rate limit;
   - validates the body with zod;
   - checks that the cluster head's setup is done (a HOD has none);
   - decodes the file and parses it with `parseAttendanceExport`, which reads the course code, name, section and dates from the header block, one row per student.
3. It calls `record_attendance_batch` **as the user**. In one transaction the function:
   - finds the subject by course code in the active cycle; for a HOD with no subject of that code it creates one from the file's header (§4.25), while a cluster head's unknown code is refused;
   - resolves all registration numbers at once (`resolve_student_ids`);
   - upserts `student_course_sections` and `student_attendance_records`;
   - writes an `academic_upload_batches` row;
   - calls `evaluate_student_risk` for each matched student. Risk-flag triggers notify mentors.
4. The endpoint writes an audit entry and returns counts and row errors. The panel shows them.

**A roster import larger than one function invocation**

1. The panel posts the whole file.
2. The server parses it, then creates accounts in waves of 25 (5 at a time), and stops after about 20 s. It returns `next_offset` and `batch_id`.
3. The panel re-posts the same file with `offset` and `batch_id` until `next_offset` is `null`. It shows "*n* of *total* rows done" as it goes (§4.13).

**A PDF download**

1. `apiClient.downloadFile('/reports/…', params)` sends a GET with a Bearer token.
2. The endpoint:
   - authenticates the caller and checks the role;
   - applies the rate limit;
   - calls the same RPC the page uses, as the user (so the database decides access);
   - renders the PDF with pdf-lib, audits the download and streams the file as an attachment.
3. The browser saves it under the server's `Content-Disposition` filename.

### 2.7 What the system does not contain

These absences are deliberate or simply not built. Do not assume any of them exist:

- **No e-mail or SMS sending by the application.**
  - The only e-mail is Supabase Auth's own password-reset mail.
  - `send_invite_email` in the provisioning schema is accepted and ignored.
- **No scheduler.** There is no `pg_cron`, no Vercel `crons` entry and no other timer. The "15-day" jobs run only when someone triggers them (§4.16).
- **No meeting provider integration.** At-risk meetings are created with status `awaiting_link`. The link-creation function `create_at_risk_meeting_link` is a stub: after its permission check it returns the meeting row unchanged, with no link (§4.14).
- **No ERP API.** ERP data arrives only as exported files uploaded by a cluster head or a HOD.
- **No AI or ML, and no analytics beyond SQL aggregates.**
- **No server-side sessions.** Authentication is the Supabase JWT on every request.

---

## 3. Codebase structure

### 3.1 Top level

```
ssmp-platform/                      (npm package "ssmp-platform" 2.0.0 — root = serverless API dependencies)
├── api/                            Vercel serverless functions (one file = one endpoint)
│   ├── _lib/                       shared server code (underscore = not deployed as an endpoint)
│   ├── admin/                      provisioning, roster import, faculty roster, cycle jobs
│   ├── cluster-head/               academic-data upload
│   ├── reports/                    faculty activity / department report, student dossier, academic cycle report
│   └── health.js
├── frontend/                       the React SPA (npm package "ssmp-frontend")
│   ├── index.html, vite.config.js, tailwind.config.cjs, postcss.config.cjs, package.json, .env.example
│   ├── public/favicon.svg
│   ├── src/{main.jsx, App.jsx, index.css, assets/, components/, context/, hooks/, lib/, pages/, routes/}
│   └── test/ui-regression.test.jsx
├── supabase/
│   ├── config.toml                 local Supabase stack configuration
│   ├── migrations/0001…0042        the whole schema, in order
│   ├── seed.sql                    local-only seed (supabase db reset)
│   ├── senior-mentors.example.txt  the format of the senior list (the real list, senior-mentors.txt, is gitignored)
│   └── scripts/{seed-demo-accounts.mjs, create-admin-account.mjs, make-administrator.mjs, sync-senior-mentors.mjs, ci-supabase-stubs.sql}
├── sample-data/                    demo rosters, cluster-head sample generator, generated upload files
├── design-reference/               static HTML mock-ups used when designing the UI (not built or imported)
├── docs/                           older documentation (see §15.5)
├── .github/workflows/ci.yml        CI
├── vercel.json                     build, functions, rewrites, headers
├── package.json / package-lock.json
├── .env.example                    server variable names
├── README.md, SETUP_GUIDE.md       older, partly stale guides
└── .gitignore
```

### 3.2 Entry points

| Runtime | Entry point | Chain |
|---|---|---|
| Browser | `frontend/index.html` | `src/main.jsx` (StrictMode, `index.css`) → `src/App.jsx` → `src/routes/AppRouter.jsx` |
| API | each non-underscore file under `api/` | default export `withApiDefaults([...methods], handler)` from `api/_lib/http-response.js`. Vercel routes `/api/<path>` to `api/<path>.js`. |
| Database | `supabase/migrations/*.sql` | applied in filename order by `supabase db push` (hosted) or `supabase db reset` (local, which also runs `supabase/seed.sql`) |
| Seed (hosted) | `supabase/scripts/seed-demo-accounts.mjs` | `npm run db:seed`; uses the Auth Admin API and the same upload RPCs as the portal |
| Sample files | `sample-data/cluster-head-sample-data.mjs` | `npm run sample:files` writes upload-ready files to `sample-data/generated/` |

### 3.3 `api/`: serverless functions

| File | Responsibility |
|---|---|
| `api/health.js` | `GET /api/health`. Liveness plus which required variables are set (never their values). |
| `api/admin/provision-user-accounts.js` | `POST`, HOD or administrator. Creates 1–500 Auth accounts with the shared temporary password and optionally sets a student's mentor. A HOD cannot create HOD accounts, a faculty account a HOD creates reports to them (`hod_id`), and a student's mentor must be one of theirs; nobody creates an administrator here (§4.25). Used by the "Add account" modal. |
| `api/admin/import-roster-spreadsheet.js` | `POST`, cluster head, HOD or administrator. Faculty a HOD imports report to that HOD. Parses a student, faculty or combined roster and creates accounts in time-boxed chunks. Links mentors and parent contacts, and records one `roster_import_batches` row per upload. Students who already have an account are **activated** in the current academic cycle through `activate_roster_students` rather than skipped (§4.13). |
| `api/admin/manage-faculty-roster.js` | `GET` (roster, mentees, reserve pool) and `POST` (set status, reassign), HOD or administrator; reads go through the caller's token, so a HOD gets their own faculty. On reassignment it also moves unresolved queries with the service role, once the old mentor is confirmed visible to the caller. |
| `api/admin/run-cycle-job.js` | `GET` job status, `POST` run one job or all. HOD or administrator. |
| `api/cluster-head/upload-academic-data.js` | `POST`, cluster head, HOD or administrator. `action` = `attendance`, `gpa`, `backlog`, `black-dot`, `mentor-map` or `hod-map` (administrator only). Parses the file and calls the matching RPC as the user. `mentor-map` first creates missing mentor accounts (a HOD's report to them); `hod-map` first creates missing HOD and mentor accounts, then calls `map_faculty_to_hods` (§4.25). Everything else is filed under the active academic cycle by the database (§4.24). |
| `api/reports/faculty-activity-report.js` | `GET`, faculty, HOD or administrator. The faculty activity report (JSON or PDF). `faculty_id=all` gives the all-faculty report: a HOD's faculty, or the whole department for the administrator. |
| `api/reports/student-dossier-report.js` | `GET`, any signed-in user; the database decides access. Student dossier as JSON or PDF. |
| `api/reports/academic-cycle-report.js` | `GET`, cluster head, HOD or administrator. The Excel report of one academic cycle, or one of its semesters, built from `get_cycle_overview` (§4.24, §6.10). Exports `buildCycleWorkbook` for testing. |
| `api/_lib/http-response.js` | `withApiDefaults`, CORS, security headers, JSON envelope (`sendSuccess`, `sendError`, `sendJson`, `applyBaseHeaders`), `ApiError` |
| `api/_lib/request-guards.js` | `requireAuthenticatedUser`, `requireRole`, `clientIp`, `enforceRateLimit`, `recordAuditEntry` |
| `api/_lib/supabase-clients.js` | `createAdminClient()` (service role), `createUserClient(jwt)` (anon key plus the caller's JWT) |
| `api/_lib/environment.js` | Reads and validates server variables once (`env` getters) and `describeConfigHealth()` |
| `api/_lib/input-validation.js` | zod schemas for every request (including `cycleReportQuerySchema`), `parseOrThrow`, `assertBodySize`, `sanitizeSingleLine`, `emailSchema` |
| `api/_lib/spreadsheet-parser.js` | CSV / XLSX / ERP-HTML-`.xls` / `.docx` reading, and parsers for rosters, attendance, the mentor map, the CGPA / GPA & Credits export, the Defaulter Grade result and the PB black dot notice. `REGISTRATION_ALIASES` is the one list of registration-number headings |
| `api/_lib/table-readers.js` | `readHtmlGrid` (HTML tables with rowspan/colspan filled in), `readDocxGrid` (Word tables, unzipped with `node:zlib`, with `gridSpan`/`vMerge` filled in), `decodeEntities` |
| `api/_lib/spreadsheet-parser.check.mjs` | Self-check script for the parsers (17 checks: attendance, mentor map, GPA, backlogs, black dots), run by `npm test` |
| `api/_lib/concurrency.js` | `runPool(items, limit, worker)`, a bounded-concurrency helper |
| `api/_lib/pdf-chart-primitives.js` | Vector charts and tables drawn with pdf-lib |
| `api/_lib/report-document-builder.js` | `buildFacultyActivityPdf`, `buildStudentDossierPdf`, `buildDepartmentReportPdf` |
| `api/_lib/university-logo-asset.js` | The MUJ logo as base64 (`UNIVERSITY_LOGO_PNG_BASE64`, `UNIVERSITY_LOGO_ASPECT`), so PDFs need no file access |

### 3.4 `frontend/src/`: the SPA

| Path | Contents |
|---|---|
| `main.jsx`, `App.jsx` | Bootstrap. The provider order is `ErrorBoundary › BrowserRouter › ToastProvider › AuthProvider › NotificationProvider › AppRouter`. |
| `index.css` | Tailwind layers plus component classes (§9.9) |
| `assets/manipal-university-jaipur-logo.png` | Brand logo |
| `routes/AppRouter.jsx` | The single route table (78 routes, §9.3). The department screens are mounted twice, under `/hod` and `/admin`, by `departmentRoutes(base, role)`; the cluster head's upload screens are mounted again under `/hod/uploads`. Most pages are `React.lazy` inside one `Suspense` with a `PageLoader` fallback. |
| `routes/RouteGuards.jsx` | `RequireAuth`, `RequirePasswordChange`, `RequireRole`, `RequireOnboarding`, `RequireClusterHeadSetup`, `RequireSeniorMentor` (0042) |
| `context/AuthProvider.jsx` | Session, the signed-in `user_profiles` row with the mentor embedded (and, for a student, `senior_mentor` from `get_my_senior_mentor`, 0042), sign-in and out, password change and reset, live profile updates |
| `context/NotificationProvider.jsx` | Bell data, realtime inserts, mark read / mark all read |
| `context/ToastProvider.jsx` | `useToast()`: success, error, info, warning toasts |
| `hooks/useRealtimeQueries.js` | `useRealtimeQueries` (paged, filtered, live query list; `studentId`, `mentorId` and `excludeEscalated` narrow it, 0042) and `useQueryThread` (one query and its messages, live, with the people from `get_query_people` and the `query_escalations` rows) |
| `hooks/useDashboardMetrics.js` | Calls `get_dashboard_metrics` |
| `hooks/useAsyncAction.js` | `run(fn, {successMessage, onSuccess})` with toast handling |
| `hooks/useActiveCycle.js` | `useActiveCycle()` → `{ cycle, loading, error, reload }`: the active `academic_cycles` row, cached for the whole page session. `refreshActiveCycle()` re-reads it after a cycle is started, edited or removed (§4.24). |
| `hooks/usePortalPaths.js` | `usePortalPaths()` → `{ role, departmentBase, uploadsBase, isHodUploads, isAdmin }` for the signed-in user, so a screen mounted in two portals links within the one it was opened from (§4.25) |
| `lib/supabaseClient.js` | The single browser Supabase client and `getAccessToken()`. Shows a configuration-error page if the `VITE_SUPABASE_*` variables are missing. |
| `lib/apiClient.js` | `apiClient.get`, `.post`, `.downloadFile` for `/api/*` |
| `lib/fileUpload.js` | Client-side file validation, private uploads, signed URLs, `BUCKETS` |
| `lib/constants.js` | Enum mirrors, option lists, navigation per role, `HOME_PATH` (§9.10) |
| `lib/queryCategoryChart.js` | The bars of every "queries by category" chart: the five current categories, then any legacy one that still has queries, each in its own colour (`queryCategoryChartData`, `countQueriesByCategory`, `QUERY_CATEGORY_COLORS`, §4.17) |
| `lib/formatters.js` | Date, number and duration formatting, `describeError` |
| `lib/portalPaths.js` | `departmentBase(role)` (`/hod` or `/admin`) and `uploadsBase(role)` (`/cluster-head` or `/hod/uploads`) (§4.25) |
| `lib/uploadedSubjects.js` | `fetchUploadedSubjects(uploaderId, cycleId)`: a HOD's subjects, i.e. the subjects their attendance uploads in the cycle were filed under (§4.25) |
| `lib/fetchAllRows.js` | Reads a whole list in pages of 1,000 with `.range()`, because PostgREST returns at most `max_rows` rows per request (§4.20) |
| `lib/academicRecord.js` | The arithmetic behind the Academic Performance Overview: semester labels, the semester picker, the attendance mean, GPA change and trend points, backlog order (§4.9) |
| `lib/academicCycles.js` | Naming and date arithmetic for academic cycles: `cycleLabel` ("2026–27"), `semesterTitle` ("Odd semester 2026"), `semesterRange`, `semesterOn`, `todayInIndia`, `defaultCycleDates`, `nextCycleYear`, `validateCycleDates` (the same checks as the database), `uploadScope` (§4.24) |
| `components/layout/` | `PortalShell`, `SidebarNavigation`, `TopBar`, `NotificationBell`. `PortalShell`'s `activeNav` marks a menu item when the URL alone would mark the wrong one (a query opened from Raised to HOD or Raised to Me) |
| `components/ui/` | `Avatar`, `DataTable`, `EmptyState`, `ErrorBoundary`, `FormControls`, `Modal`, `PageHeader`, `Panel`, `ProfilePhotoUploader`, `Skeleton`, `StatCard`, `StatusBadge` (with `MentorKindBadge`, `EscalationBadges` and `RaisedByBadge` since 0042) |
| `components/charts/Charts.jsx` | Recharts wrappers: `CategoryBarChart` (with `allLabels`, every bar keeps its name, tilted when the panel is narrow; layout in `charts/categoryAxis.js`), `GroupedBarChart`, `TrendLineChart`, `AreaTrendChart`, `DonutChart`, `GaugeChart`, `Sparkline` |
| `components/academics/AcademicOverview.jsx` | The Academic Performance Overview (tiles, subject-wise attendance, GPA trend, backlogs, black dots), shared by the student's Academics page and the mentor's / HOD's student page (§4.9) |
| `components/queries/` | `CreateQueryModal` (with the Send to choice, 0042), `QueryConversation`, `ResolutionConfirmation`, `SatisfactionRating`, `EscalationHistory` (the "Raised for help" panel, 0042) (shared by all portals) |
| `components/student/FormAFields.jsx` | The Form A field set, its state and its validation (`EMPTY_FORM_A`, `validateFormA`, `useFormAState`, `FormAFields`) |
| `components/hod/AddAccountModal.jsx` | Single-account creation. Offers the HOD role only to the administrator. |
| `components/hod/SectionMultiSelect.jsx` | The section dropdown of the Senior Mentors page: A3 … T4 as ticks, sections another senior has disabled with their name (0042) |
| `components/clusterHead/AcademicUploadPanel.jsx` | The shared upload block, including the chunk loop. Says which academic cycle an upload goes into (`showCycle`, off for the faculty roster and the mentor–HOD mapping). `identifierLabel` and `idleNote` adjust its copy for the mapping. |
| `components/clusterHead/cycles/CycleModules.jsx` | The Academic Cycles page's module tabs: students, attendance, GPA, backlogs, black dots, uploads (§4.24) |
| `components/clusterHead/cycles/CycleDialogs.jsx` | `StartCycleModal` and `EditCycleDatesModal` |
| `components/tickets/` | **Dead.** Pre-rename copies that nothing imports. They call RPCs dropped in 0031, and one imports a constant that no longer exists (§15.4). |
| `pages/auth/` | `LoginPage`, `ChangePasswordPage` (also serves `/reset-password`) |
| `pages/student/` | 16 pages (§9.6), three of them for senior mentors only |
| `pages/faculty/` | 11 pages. Seven are reused by the HOD and the administrator with `isHodView` (`RaisedQueriesPage` is Raised to Me for faculty and Raised to HOD with `isHodView`). |
| `pages/hod/` | 7 pages, served under `/hod` and `/admin`. `HodProfilePage` re-exports `FacultyProfilePage`. |
| `pages/admin/` | `AdminHodMappingPage`: the administrator's Upload page (§4.25) |
| `pages/clusterHead/` | 10 pages. Seven are also served to a HOD under `/hod/uploads` (all but setup, My Subjects and profile). `ClusterHeadProfilePage` re-exports `FacultyProfilePage`. |
| `pages/NotFoundPage.jsx` | Catch-all 404 |

Other files in `frontend/`:

- `test/ui-regression.test.jsx` is a jsdom regression test for past bugs (Panel padding, Modal focus theft, the HOD Students 1,000-row cap, a CGPA of 0 with nothing uploaded), for the overview's arithmetic and its header-less student version, for the academic-cycle helpers, for the administrator and HOD menus and link prefixes, and for the senior mentor menus, sections and senior list parser (§13.4).
- `vite.config.js` sets dev port 5173 and manual chunks `react-vendor`, `supabase-vendor`, `charts-vendor`.
- `package.json` depends on `"ssmp-platform": "file:.."` to share the root package.

### 3.5 `supabase/`

| Path | Contents |
|---|---|
| `config.toml` | Local stack settings: API 54321, DB 54322 (Postgres 15), Studio 54323; auth settings (§12.3) |
| `migrations/` | 42 ordered files (list below) |
| `seed.sql` | **Local only.** Creates demo users directly in `auth.users`/`auth.identities` (including the administrator and two HODs), sets mentors, maps the mentors to their HODs through `map_faculty_to_hods`, inserts sample queries and messages, and inserts the 4 global canned replies ("Acknowledged", "Need more detail", "Escalated to IT", "Meet in person"). The seed script inserts the same four; no migration does. |
| `scripts/seed-demo-accounts.mjs` | Hosted-safe seed through the Auth Admin API. It creates the demo accounts (administrator, two HODs, faculty, students, cluster heads), mentors, the mentor–HOD mapping (`map_faculty_to_hods`), sample queries, the cluster heads' subjects (in the active academic cycle), uploads sample attendance, GPA, backlogs and black dots through the `record_*_batch` RPCs, and runs cycle jobs. See Appendix D. |
| `scripts/create-admin-account.mjs` | `npm run db:admin`. Creates the administrator account and nothing else, on the shared temporary password with a forced change at first sign-in; safe on a real project and safe to re-run (it finishes an account an earlier run left as a student). `SSMP_ADMIN_EMAIL` overrides the default address (§4.25, §13.5). |
| `scripts/make-administrator.mjs` | Not run on its own. `makeAdministrator(db, id)`, shared by the two scripts above: sets the profile's role to `admin` with the service role, clears the mapping columns, removes the academic-cycle enrolment and sets `app_metadata.role`. Needed because the Auth Admin API writes `app_metadata` after the insert that creates the profile (§4.1). |
| `scripts/sync-senior-mentors.mjs` | `npm run db:seniors` (`-- --dry-run` to preview). Makes Supabase match the senior list: creates an account for a new e-mail (a student on the shared temporary password, forced change at first sign-in) or flags an existing student, and for an e-mail taken off the list moves that senior's queries to each student's faculty mentor, removes their sections and deletes the account if the list created it (otherwise only unflags it). Safe to re-run (§4.26). |
| `senior-mentors.example.txt` | The format of the senior list: one `email` or `email, Full Name` per line, `#` for comments. Copy it to `senior-mentors.txt` (gitignored: it holds real e-mails), or point `SSMP_SENIOR_LIST` at another file. |
| `scripts/ci-supabase-stubs.sql` | Minimal `auth` and `storage` schema stubs (roles, `auth.uid()`, `auth.users`, storage tables) so CI can apply the migrations to plain Postgres |
| `scripts/verify-security-policies.mjs` | **Missing.** `npm run verify:security` references it, so that script fails. |

**Migrations.** Never edit an applied migration; add a new one. Several later migrations replace functions and views defined earlier, and the "current body" column says where each object's live definition lives.

| # | File | What it does |
|---|---|---|
| 0001 | `extensions_enums_and_shared_helpers` | Extensions (`citext`, `pg_trgm`, `pgcrypto`), the original enums, `set_updated_at_timestamp`, `is_non_blank` |
| 0002 | `user_profiles_table` | `user_profiles`; `handle_new_auth_user` and e-mail-sync triggers on `auth.users` |
| 0003 | `student_form_a_onboarding` | `student_form_a_profiles` (Form A), `student_semester_gpas`, GPA-sharing flag |
| 0004 | `support_tickets_and_messages` | The tickets and messages tables (renamed in 0031), code sequence starting at `AN-1001` |
| 0005 | `notifications_and_achievements` | `notifications`, `student_achievements` |
| 0006 | `semester_setup_roster_and_audit` | `semester_cycles`, `roster_import_batches`, `mentor_reassignment_log`, `canned_replies`, `audit_log` |
| 0007 | `authorization_helper_functions` | `is_hod`, `is_faculty`, `is_student`, `is_mentor_of`, `my_mentor_id`, `can_access_student`, `can_view_student_gpa`, the query access helper, the protected-column guard |
| 0008 | `row_level_security_policies` | RLS on every table (ENABLE, not FORCE; the file's first comment line saying "FORCE'd" is wrong, and its own explanation a few lines later is right) |
| 0009 | `ticket_workflow_functions` | Create, post, resolve, confirm and rate RPCs (current bodies in 0031) |
| 0010 | `student_and_mentor_functions` | Form A submit, GPA, achievement verification, star mentee, reassignment, employment status |
| 0011 | `cross_portal_notification_triggers` | Notification triggers (current bodies in 0031) |
| 0012 | `analytics_views` | Performance, summary and trend views, reserve pool (renamed and rebuilt in 0031) |
| 0013 | `report_and_dashboard_functions` | Dashboard metrics, activity report, dossier (current bodies in 0030/0031) |
| 0014 | `realtime_and_storage_buckets` | Realtime publication; the `form-a-uploads`, `achievement-proofs` and `roster-imports` buckets and their policies (`profile-photos` comes in 0019) |
| 0015 | `rate_limiting_and_audit_helpers` | `api_rate_limits`, `consume_rate_limit`, `write_audit_entry` |
| 0016 | `fix_user_profiles_policy_recursion` | Fixes the recursive `user_profiles` SELECT policies (HTTP 500 on every profile read) |
| 0017 | `form_a_editable_and_star_mentee_group_view` | Form A editable after submission; star mentee's group query view |
| 0018 | `reopen_limit_and_hod_escalation` | Reopen cap of 3 (`max_resolution_rejections`); escalation to the HOD (gate removed in 0030) |
| 0019 | `profile_photos_combined_roster_and_department_report` | `avatar_url` and the photos bucket; combined roster type; department report |
| 0020 | `cluster_head_role_and_new_enum_values` | Enum values only: `cluster_head`, the upload, meeting and job enums, the new notification types. Values need their own migration file. |
| 0021 | `cluster_head_portal_and_academic_data` | Cluster head setup, `cluster_head_courses`, sections, attendance, GPA source, backlogs, upload batches, upload RPCs |
| 0022 | `at_risk_detection_and_mentor_meetings` | `student_risk_flags`, `at_risk_meetings`, risk evaluation and meeting dispatch, `at_risk_student_overview` |
| 0023 | `student_survey_cycles_and_completion_tracking` | Survey tables and RPCs, 10 seeded questions, completion views |
| 0024 | `cycle_job_schedule_and_manual_triggers` | `cycle_job_schedule` (4 jobs), `cycle_job_runs`, `run_cycle_job`, `run_all_cycle_jobs_now`, `run_due_cycle_jobs`, `get_cycle_job_status` |
| 0025 | `attendance_from_erp_export_and_gpa_semester` | Attendance keyed to the ERP export and registration number; GPA rows carry their own semester; `student_attendance_overview` |
| 0026 | `new_ticket_categories` | Enum values only: Academics, Examination, Behavioural, Administrative, Others |
| 0027 | `cr_reports_rosters_and_section_fix` | `mom_records` and `submit_mom_report`; `set_query_in_progress`; roster uploads move to the cluster head; `map_students_to_mentors`; parent contact columns; wider section labels |
| 0028 | `counselling_notification_type` | Enum value only: `counselling_request` |
| 0029 | `counselling_requests` | `counselling_requests` table, RPCs, notification trigger |
| 0030 | `mentor_department_and_hod_routing` | `user_profiles.hod_email`; `set_mentor_department_and_hod`; escalation routed to the named HOD and ungated; `escalated_queries` in the activity report |
| 0031 | `rename_tickets_to_queries` | Pure rename, ticket → query: tables, columns, enums, functions, triggers, policies, views, notification types and stored link paths. Holds the current body of most workflow, report and view definitions. |
| 0032 | `drop_course_section_count` | Drops `cluster_head_courses.section_count`; setup takes only name and code |
| 0033 | `resolve_students_per_upload` | `resolve_student_ids`; the four upload RPCs resolve identifiers once per file (fixes statement timeouts on ~2,300-row files) |
| 0034 | `black_dot_upload_type` | Enum value `academic_upload_type.black_dot`, alone in its own file |
| 0035 | `black_dots_and_erp_result_exports` | `student_black_dots`, `student_cgpas`; credits on `student_semester_gpas`; grade and credits on `student_backlogs`; `academic_upload_batches.scope_label`; `try_numeric`, `is_blank_mark`; rewritten `record_gpa_batch`, `record_backlog_batch` (new `p_subject_codes`), new `record_black_dot_batch`; `resolve_student_ids` registration-number-only with a caller check (S3); `login_id` protected (S5); `get_student_dossier` returns CGPA, backlogs and black dots |
| 0036 | `academic_cycles_and_black_dot_risk` | `academic_cycles` (one per academic year, exactly one active) and `academic_cycle_students`, reusing the enum `semester_term` (0001) for the odd and even semesters; `cycle_id` on uploads, roster imports, subjects, attendance, backlogs, black dots and at-risk meetings, set by triggers and backfilled into the first cycle; subjects per cycle (`current_cycle_courses`); `student_attendance_overview` limited to the active cycle; `academic_upload_history`; black dots join the at-risk rule (`has_black_dot`, `black_dot_count`); `reevaluate_students_batch`; `activate_roster_students`, `carry_over_cycle_students`; `create_academic_cycle`, `update_academic_cycle_dates`, `delete_academic_cycle`, `list_academic_cycles`, `get_cycle_overview`; current bodies of `submit_cluster_head_setup`, `record_attendance_batch`, `map_students_to_mentors`, `evaluate_student_risk`, `notify_on_risk_flag_change`, `dispatch_at_risk_meetings`, `record_black_dot_batch`, `at_risk_student_overview` (§4.24) |
| 0037 | `retire_student_gpa_entry` | Students no longer record GPA: `upsert_semester_gpa` is no longer executable by signed-in users, and the direct-write policies on `student_semester_gpas` are dropped (closes S1) (§4.9) |
| 0038 | `admin_role` | Enum value `user_role.admin`, alone in its own file |
| 0039 | `admin_portal_and_hod_scoping` | `user_profiles.hod_id`, `mentor_section`, `mentor_designation` (backfilled from `hod_email`); `is_admin`; `is_hod` now true for the administrator too; `my_overseen_faculty`, `oversees_faculty`, `oversees_student`; HOD-scoped `can_access_student`, `can_access_query`, `can_view_student_gpa` and policies on `user_profiles`, `support_queries`, `at_risk_meetings`, `mom_records`, `mentor_reassignment_log`, `student_form_a_profiles`; `audit_log` readable by the administrator only; `map_faculty_to_hods`; current bodies of `guard_protected_profile_columns`, `handle_new_auth_user`, `get_dashboard_metrics`, `get_department_faculty_report`, `escalate_query_to_hod`, `set_mentor_department_and_hod`, `record_attendance_batch` (a HOD's subject is created from the file) and the scope checks of eleven workflow functions (§4.25) |
| 0040 | `counselling_type` | `counselling_requests.counselling_type` (12 values; NULL on older requests), `counselling_type_label`; `request_counselling(p_concern, p_counselling_type)` replaces the one-argument version and requires the type; the mentor's notification names it |
| 0041 | `dashboard_query_categories` | `get_dashboard_metrics` also returns `queries_by_category` (category → count, current and legacy) for every role; nothing else changes |
| 0042 | `senior_mentors` | Senior mentors (§4.26): `user_profiles.is_senior_mentor` (guarded; only the service role or the administrator change it); `senior_mentor_sections` (A 3 … T 4, one senior each); `normalise_section`, `student_section_code`, `senior_mentor_of`, `is_senior_mentor`; `support_queries.mentor_kind`, `referred_to_faculty`, `referred_at`, `escalation_source` (backfilled `'faculty'`); `query_escalations` (every referral and escalation with its reason, hidden from the student; backfilled from earlier escalations); `can_handle_query`, `query_link_for`; current bodies of `guard_protected_profile_columns`, `can_access_query`, the policy `queries_select_participants`, the three query notification triggers, `create_support_query` (new `p_recipient`; the four-argument version dropped), `post_query_message`, `resolve_support_query`, `escalate_query_to_hod`; new `escalate_peer_query`, `get_my_senior_mentor`, `get_query_people`, `get_peer_queries`, `get_my_senior_mentees`, `get_raised_queries`, `list_senior_mentors`, `set_senior_mentor_sections`; direct `UPDATE` on `support_queries` limited to `priority` and direct `INSERT` revoked (closes S6 and S15) |

### 3.6 Other folders

- **`sample-data/`**
  - `student-roster-sample.csv`, `faculty-roster-sample.csv` and `combined-roster-sample.csv` are demo rosters.
  - `cluster-head-sample-data.mjs` is the single source of the demo academic data, and of the demo mentor–HOD mapping (`SAMPLE_HODS`, `SAMPLE_HOD_MAPPING`, `sampleHodMappingRows`, `buildHodMappingCsv`). The seed script and the parser self-check import it; run as a CLI it writes `generated/` in the real layouts: `mentor-hod-mapping-sample.csv` (for the administrator's Upload page), 6 attendance CSVs, the CGPA / GPA & Credits export and two Defaulter Grade results (HTML saved as `.xls`, like the ERP), and a PB notice (`.docx`, built by `buildMinimalDocx` without a dependency). Each demo student trips a different at-risk condition. The three older CSVs in `generated/` (`gpa-semester-2/3-sample.csv`, `backlogs-semester-2-sample.csv`) are no longer written and can be deleted; they still upload through the flat fallbacks.
- **`design-reference/`** holds six static HTML mock-ups (`code.html`) and a `DESIGN.md` (`academic_nexus`), in seven folders. Nothing in the build imports them.
- **`docs/`**
  - `SSMP-Platform-Context.docx` is the old context document.
  - `~$MP-Platform-Context.docx` is a Microsoft Word lock file committed by accident.
  - `SECURITY.md` and `CLUSTER-HEAD-AND-CYCLE-JOBS.md` are partly stale (§15.5).

---

## 4. Features

Each feature below covers:

- **Status**;
- **Where**: the files involved;
- **Flow**: input → processing → output;
- **Data**: tables, RPCs and notifications;
- **Rules**: validation and limits;
- **Edge cases and known issues**.

Error text quoted in "double quotes" is the exact string the code raises or shows.

**"The HOD" since migration 0039.** Where a feature below says the HOD may see or act on a person (a student, a faculty member, a query, a meeting, a report), it means **the HOD that person's mentor is mapped to, or the administrator**. Where it says the HOD may do something department-wide (uploads, academic cycles, cycle jobs, roster imports), it means **any HOD or the administrator** (`is_hod()`). §4.25 has the rule and the exceptions.

### 4.1 Accounts, provisioning and the temporary password

**Status:** Implemented. Known issues are listed at the end.

**Where:**

- API: `api/admin/import-roster-spreadsheet.js`, `api/admin/provision-user-accounts.js`, `api/cluster-head/upload-academic-data.js` (`createMissingMentors`), `api/_lib/environment.js` (`env.TEMPORARY_PASSWORD`).
- SQL: `handle_new_auth_user` (0002/0021) and `handle_auth_user_email_change`.
- UI: `ClusterHeadRosterPage`, `AddAccountModal`.

**How accounts are created.** There are six paths. The four portal paths call `supabase.auth.admin.createUser` with the service role and `email_confirm: true`; the scripts work differently (Appendix D):

| Path | Who triggers it | Roles created | Section |
|---|---|---|---|
| Student / faculty / combined roster upload | Cluster head, HOD (Uploads → Rosters & Mentors) or administrator | student, faculty (a HOD's faculty report to them) | §4.13 |
| "Add account" modal | HOD or administrator (Students page) | student, faculty, cluster head; HOD for the administrator only | §4.20 |
| Mentor–mentee mapping upload | Cluster head or HOD | faculty, for mentor e-mails with no account (a HOD's report to them) | §4.13 |
| Mentor–HOD mapping upload | Administrator (Upload) | hod and faculty, for e-mails with no account | §4.25 |
| `npm run db:admin` | Developer / operator | the administrator | §4.25, §13.5 |
| `npm run db:seed` / `seed.sql` | Developer | demo accounts | Appendix D |

Nothing in the portal creates an administrator: the API's role list has no `admin`. `handle_new_auth_user` grants `admin` only when the inserted auth row already has `raw_app_meta_data.role = 'admin'`, which only the service role can set, so a sign-up asking for `admin` in `user_metadata` alone becomes a student.

**The administrator and the Auth Admin API.** Only a direct insert into `auth.users`, as `seed.sql` does, has that `app_metadata` when the trigger runs. `auth.admin.createUser` inserts the user with `app_metadata` holding only `{provider, providers}` and writes the requested `app_metadata` in a second statement of the same transaction, after `handle_new_auth_user` has run. So an administrator created through the API (`npm run db:admin`, `npm run db:seed`) starts as a **student**, enrolled in the active academic cycle. The scripts then call `makeAdministrator` (`supabase/scripts/make-administrator.mjs`), which with the service role:

- sets the profile's role to `admin` and clears `hod_id`, `mentor_section` and `mentor_designation`;
- deletes the account's `academic_cycle_students` rows (changing the role does not remove them);
- sets `app_metadata.role` to `admin`.

The other roles are unaffected, because they come from `user_metadata`, which is in the inserted row.

**What each path sends:**

- **`user_metadata`:** `role`, `full_name`, `login_id`, `branch`, `section`, `semester_label`, `phone`, `department`, and `must_change_password: true`.
  - `department` is always `'IoT & IS'` from roster, mapping and modal imports (hard-coded).
  - The roster keeps `phone` only if it is exactly 10 digits.
  - The mentor-map path sends only `role` (`faculty`), `full_name`, `department` and `must_change_password`.
- **`app_metadata`:** `{role}`.

**What `handle_new_auth_user` does.** It runs AFTER INSERT on `auth.users` and inserts the `user_profiles` row from `raw_user_meta_data`:

- the role, if it is `student`, `faculty`, `hod` or `cluster_head`; `admin` only when the inserted row's `raw_app_meta_data.role` is also `admin` (0039; true for `seed.sql`, never for `auth.admin.createUser`, see above); else `student`;
- `full_name`, defaulting to the e-mail's local part;
- `department`, defaulting to `'IoT & IS'`;
- `must_change_password`, defaulting to `true`;
- `login_id`, `phone`, `branch`, `section` and `semester_label`, each blank → `NULL`;
- `ON CONFLICT (id) DO NOTHING`.

`handle_auth_user_email_change` keeps `user_profiles.email` in sync when an Auth e-mail changes.

**The temporary password:**

- Every account created by the API gets the same password: `env.TEMPORARY_PASSWORD`, read from the **`SSMP_TEMPORARY_PASSWORD`** environment variable.
- If that variable is unset, `api/_lib/environment.js` falls back to a **built-in default written in the source**. Set the variable in every deployment.
- A roster row may carry its own password in a *Password* column (aliases in §10.4). It must be at least 8 characters, otherwise: "The Password column must be at least 8 characters (leave it blank to set the shared one)".
- The password is shown to the uploader:
  - the HOD modal displays name, e-mail and password with a "Copy credentials" button;
  - the roster page shows a **Credentials** panel with a CSV download (`smp-credentials-YYYY-MM-DD.csv`: `Name,Email,Login ID,Temporary Password`). When all created accounts share one password, the panel prints it on screen.
- Accounts created by the mentor-map upload always get the shared password. They are not shown anywhere.

**First sign-in.** `must_change_password` is `true`, so `RequirePasswordChange` sends the user to `/change-password` until they set a new password (§4.2). Seeded demo accounts are created with `must_change_password = false`.

**Rules:**

- An e-mail that already exists is **skipped, never updated**. The roster checks `user_profiles.email` in pages of 1,000. The HOD modal does an `ilike` lookup. In the roster import, Auth errors matching "already been registered", "already exists" or "duplicate key" also count as skipped. In the HOD modal every Auth error is reported as failed, and in the mentor-map path it goes to `mentor_errors`. Re-uploading a roster is therefore safe, but it cannot correct existing accounts' data.
- A duplicate `login_id` (registration number or staff id) fails the row, because `user_profiles` has a unique index on `lower(login_id)`.

**Deactivation.**

- `user_profiles.is_active = false` blocks sign-in in the UI and every API request. RPCs that check it, such as `create_support_query` and `request_counselling`, also refuse.
- There is **no UI or endpoint that deactivates an account**. `is_active` is a protected column: only the administrator, a HOD for a profile they can update (by a direct table update; the guard exempts them), or SQL can change it.
- Deactivation does not revoke an existing session (§8.9).

**Known issues:**

- A shared password with a public fallback.
- `must_change_password` can be cleared by the user with a direct table update. The page does this legitimately, but so can anyone (§8.9).
- `send_invite_email` is ignored.
- Failures while creating mentor accounts during a mentor-map upload (`mentor_errors`) are returned but never displayed.

### 4.2 Sign-in, sessions, password change and reset

**Status:** Implemented.

**Where:** `pages/auth/LoginPage.jsx`, `pages/auth/ChangePasswordPage.jsx`, `context/AuthProvider.jsx`, `lib/supabaseClient.js`, `routes/RouteGuards.jsx`.

**Sign-in (`/login`).** The user enters the university e-mail (there is no domain check on this page) and a password with a show/hide toggle.

1. `signInWithPassword({email: email.trim().toLowerCase(), password})`.
2. Load `user_profiles` (`select('*')`), then separately the mentor (`id, full_name, email, phone, login_id`).
3. If `is_active` is false: sign out again and show "This account has been deactivated. Please contact your HOD."
4. Fire-and-forget `update({last_login_at})`.
5. Toast "Welcome back, <name>." and navigate to `HOME_PATH[role]`: `/student`, `/faculty`, `/hod`, `/cluster-head` or `/admin`.

An already signed-in visitor is redirected to `location.state.from` or their home. A bad password gives "Incorrect email or password." (via `describeError`).

**Sessions:**

- Supabase JS client options: `persistSession` (localStorage key `ssmp.auth.session`), `autoRefreshToken`, `detectSessionInUrl`, `flowType: 'pkce'`, and the header `x-application-name: ssmp-portal`.
- Access tokens last 3,600 s and are refreshed silently. Refresh-token rotation is on.
- `config.toml` sets `[auth.sessions] inactivity_timeout = "720h"` (30 days). A hosted project must set the same value in its dashboard (§12.3).

**Password change (`/change-password`).** This route is wrapped in `RequireAuth` only.

- The new password must be at least 10 characters and contain an uppercase letter, a lowercase letter, a digit and a symbol. A live checklist shows progress, and the button is disabled until all rules pass and both fields match ("The two passwords do not match.").
- These rules are **client-side only**. `config.toml` sets no server password policy, although a page comment claims it mirrors one.
- On submit:
  1. `auth.updateUser({password})`.
  2. `user_profiles.update({must_change_password: false})`. Its error is not checked.
  3. Reload the profile, toast "Password updated.", go home.
- The page title is "Set your password" while `must_change_password` is true, otherwise "Change password". There is a "Sign out instead" link.

**Forgot password.**

- On the login page, an empty e-mail field gives "Enter your university email first, then choose "Forgot password"."
- Otherwise the page calls `resetPasswordForEmail(email, {redirectTo: <origin>/reset-password})` and toasts "If that email exists, a reset link is on its way."
- `/reset-password` renders the same `ChangePasswordPage` with **no guard**. It relies on the recovery session that `detectSessionInUrl` creates from the link.
- Because the flow is PKCE, **the link only works in the browser that requested it**. Without a session, `updateUser` fails with an error toast.
- The Supabase project's Site URL and redirect list must include `/reset-password` (§12.3).

**Known issues:**

- `is_active` is checked only at sign-in, not on session restore.
- If the profile fails to load after a successful sign-in, the user sees "Welcome back, there." and lands back on `/login` with a live session.

### 4.3 Student onboarding: Form A and profile photo

**Status:** Implemented.

**Where:**

- UI: `pages/student/StudentOnboardingFormPage.jsx`, `pages/student/StudentProfilePhotoPage.jsx`, `components/student/FormAFields.jsx`, `components/ui/ProfilePhotoUploader.jsx`, `routes/RouteGuards.jsx` (`RequireOnboarding`), `pages/student/StudentProfilePage.jsx` (later edits).
- SQL: `submit_student_form_a`; table `student_form_a_profiles`.

**Gate.** Every student route except `/student/onboarding` and `/student/profile-photo` is wrapped in `RequireOnboarding`, which checks two `user_profiles` columns in order:

1. `form_a_completed` false → redirect to `/student/onboarding`.
2. `form_a_completed` true and `avatar_url` empty → redirect to `/student/profile-photo`.

Both onboarding pages render **without** the portal shell: no sidebar, no bell. A student who has completed Form A and opens `/student/onboarding` is sent to `/student/profile`.

**Form A fields** (`useFormAState` / `FormAFields`):

- Each field maps to the same-named column of `student_form_a_profiles`. `*` marks a field the client requires.
- The form is pre-filled from the profile when no record exists: name, `registration_no` ← `login_id`, e-mail, branch, section, `mobile_no` ← `phone`.

| Group | Fields |
|---|---|
| Student | `full_name`\*, `registration_no`\*, `roll_no`, `section`, `branch`, `mobile_no`\* (10 digits), `email`\*, `date_of_birth` (must be in the past), `blood_group` (A+ … O-), `is_day_scholar`, `hostel_block`\* (unless day scholar), `room_no` |
| Alumni | `has_muj_alumni_in_family` (Yes/No) → `alumni_name`\* when Yes; also `alumni_branch`, `alumni_batch`, `alumni_institution`, `alumni_relationship` |
| Father / Mother | `father_name`\*, `mother_name`\*, and for each parent: `_occupation` (enum `parent_occupation`), `_organization`, `_designation`, `_mobile` (10 digits if given), `_email` (valid if given) |
| Address | `communication_address`\*, `communication_pin_code`\* (6 digits), `permanent_same_as_communication`; `permanent_address`\* and `permanent_pin_code`\* unless "same" is ticked |
| Files (optional) | Parent business card and student signature. They go to bucket `form-a-uploads` at `<uid>/parent-business-card-…` and `<uid>/student-signature-…`, at most 5 MB, PNG/JPG/WEBP/PDF, uploaded as soon as they are chosen. |

**Validation and submit:**

- Client messages include "Your full name is required.", "Enter a 10-digit mobile number.", "Enter a valid email address.", "Enter a 6-digit pin code.", "Hostel block is required (or tick "I am a day scholar")." and "Date of birth must be in the past."
- On failure: toast "Please fix the highlighted fields before saving." and scroll to the first invalid field.
- On submit:
  1. A confirmation dialog: "Submit Form A?"
  2. `rpc('submit_student_form_a', {p_payload})`.
  3. Toast "Form A submitted. Welcome to the portal!", reload the profile, go to `/student/profile-photo`.

**What `submit_student_form_a` does** (SECURITY DEFINER):

- Checks: "Not authenticated"; "Only students fill Form A". It does not check `is_active`.
- Upserts on `student_id`:
  - trims text and lower-cases e-mails;
  - turns blank optional fields into NULL and casts the occupation enums;
  - keeps stored file paths when a blank path is sent (`coalesce`).
- Sets `is_submitted = true`, keeps the first `submitted_at`, and resets `is_locked = false` and `unlock_requested = false`.
- Then, under the trusted-operation flag, sets `user_profiles.form_a_completed = true`, `form_a_completed_at` (first time only), and copies `phone`, `section` and `branch` from the payload when they are non-blank.

**Server-side format rules** are CHECK constraints:

- 10-digit mobiles, 6-digit PIN codes;
- e-mail shape for the student and both parents;
- the blood-group list;
- hostel block unless day scholar;
- alumni name when Yes;
- DOB after 1950-01-01 and before today.

A violation surfaces as the generic "Some of the values entered are not valid. Please review the highlighted fields."

**Editing later.**

- My Profile shows Form A read-only until "Edit my details". Saving calls the same RPC and toasts "Your Form A record has been updated."
- Nothing is locked: the `form_a_update_own` policy ignores `is_locked`, and the RPC clears it on every save.
- `unlock_student_form_a` and `request_form_a_unlock` exist but are **Dead**: nothing calls them.
- Saving Form A overwrites `user_profiles.phone` with the Form A mobile number. Editing the contact phone does not update Form A.

**Profile photo (`/student/profile-photo`).**

- `ProfilePhotoUploader` checks the file on the client: at most 3 MB ("The photo must be 3 MB or smaller."), PNG/JPEG/WEBP ("Use a PNG, JPG or WEBP image.").
- It uploads to `profile-photos/<uid>/avatar-<slug>-<ts>.<ext>`, sets `user_profiles.avatar_url` to that path, and removes the previous object best-effort. Toast: "Profile photo updated." Then it navigates to `/student`.
- A student cannot replace the photo later: their profile page shows it read-only ("Contact the HOD office if it needs to be replaced.").
- Faculty, HOD, administrator and cluster-head profile pages have **no** photo control.

**Known issues:**

- The "locked" photo and the non-Form-A profile fields are locked only in the UI. RLS lets a student update their own `avatar_url`, `full_name`, `login_id`, `section`, `semester_label` and `department` directly (§8.9).
- Replaced Form A files are never deleted from storage.

### 4.4 Queries: raising, conversation, resolution, confirmation, rating

**Status:** Implemented. Known issues are listed at the end.

**Where:**

- UI:
  - `components/queries/*`;
  - `hooks/useRealtimeQueries.js`;
  - student: `pages/student/StudentQueriesPage.jsx`, `pages/student/StudentQueryDetailPage.jsx`, `pages/student/StudentDashboardPage.jsx`;
  - faculty (and HOD or administrator with `isHodView`): `pages/faculty/FacultyQueryQueuePage.jsx`, `pages/faculty/FacultyQueryDetailPage.jsx`, `pages/faculty/RaisedQueriesPage.jsx` (0042);
  - senior mentor: `pages/student/SeniorPeerQueriesPage.jsx`, `pages/student/SeniorPeerQueryDetailPage.jsx` (0042, §4.26).
- SQL: `create_support_query`, `post_query_message`, `resolve_support_query`, `confirm_query_resolution`, `rate_support_query`, `set_query_in_progress`, `escalate_query_to_hod`, `escalate_peer_query`, `max_resolution_rejections`, `assign_query_code`, `can_access_query`, `can_handle_query`, `get_query_people`, and the notification triggers.
- Tables: `support_queries`, `query_messages`, `query_escalations` (0042), `canned_replies`.

**Model.**

- A query belongs to one student (`student_id`) and is assigned, **at creation**, to whom the student sent it (`mentor_id`): their current faculty mentor, or since 0042 their senior mentor (§4.26). `mentor_kind` says which (`'faculty'` or `'senior'`; every query before 0042 is `'faculty'`).
- `query_code` is `AN-<n>` from `query_code_seq`, starting at 1001 and set by trigger.
- Three columns describe its state:

| Column | Values |
|---|---|
| `status` | `Open`, `In Progress`, `Resolved` |
| `resolution_status` | `none`, `pending_confirmation`, `confirmed`, `reopened` |
| `priority` | `Low`, `Medium`, `High`, `Urgent` |

- Other columns record the timeline and outcome: `first_response_at`, `resolved_at`, `resolved_by`, `reopen_count`, `student_confirmation` / `student_confirmation_at` / `student_confirmation_comment`, `satisfaction_rating`, the `escalated_*` columns and `escalation_source` (who escalated it: `'faculty'` or `'senior'`, 0042), `referred_to_faculty` / `referred_at` (a senior raised it to the student's faculty mentor, 0042), `mom_id` (set for CR-report items), `last_message_at`.
- Messages are rows of `query_messages`. `is_system_message` marks system messages (these never trigger the new-reply notification).

**Categories.** The enum `query_category` holds eight values:

| Values | Status |
|---|---|
| `Academics`, `Examination`, `Behavioural`, `Administrative`, `Others` | Offered by the UI (`QUERY_CATEGORIES`) since 0026 |
| `Academic`, `ERP/Tech`, `Infrastructure` | Legacy. Still valid in the database and on old queries. The "by category" charts show them after the current five, only when they have queries (0041). A few unused SQL columns still count only these (see Known issues). |

**State machine:**

```
                 create_support_query
                        │
                        ▼
                     Open ──(first reply by mentor/HOD: post_query_message)──► In Progress
                        │                                                           │
                        └──────────────(resolve_support_query: mentor or HOD)───────┤
                                                                                    ▼
                                                        Resolved + pending_confirmation
                                          student "Yes" │                         │ student "No" (reopen_count < 3)
                                                        ▼                         ▼
                                           Resolved + confirmed        In Progress + reopened
                                           (closed; composer hidden)   (reopen_count+1, resolved_at cleared)
                                                                                  │
                                                                                  └─(resolve again)─► Resolved + pending_confirmation
  CR-report items may also be set explicitly:  set_query_in_progress → In Progress + none
```

**Raising a query** (student; `CreateQueryModal`, opened from the dashboard or My Queries):

- **Input:**
  - **Send to** (0042): two cards, **Faculty Mentor** (the default, with their name) and **Senior Mentor** (with the senior's name). A student without a senior mentor sees that card disabled with "No senior mentor is assigned to you yet, so this option is not available." The modal's description names the chosen person ("This will go to your senior mentor, <name>.").
  - Category: one of the five current categories, default Academics.
  - Subject: at least 5 characters on the client, at most 200.
  - Description: required, at most 5,000.
  - Priority is not asked; `'Medium'` is always sent.
- **Processing:** `create_support_query(p_subject, p_category, p_description, p_priority, p_recipient)` (`p_recipient` `'faculty'` or `'senior'`, default `'faculty'`, since 0042) requires:
  - an authenticated student ("Only students can raise support queries");
  - an active account ("This account is deactivated");
  - for `'faculty'`, a mentor ("No faculty mentor assigned. Please contact the HOD."); for `'senior'`, a senior mentor (`senior_mentor_of`, "No senior mentor is assigned to you yet. Send this to your faculty mentor instead."); anything else: "Choose your faculty mentor or your senior mentor";
  - non-blank subject and description;
  - the length limits above;
  - **fewer than 20 queries with status ≠ Resolved** ("You already have 20 unresolved queries. Please close some before raising another.").

  It inserts the query (`mentor_id` the chosen person, `mentor_kind` the choice) and the description as the first message. The cap of 20 counts queries to both mentors.
- **Output:** toast "Query raised. <name> has been notified." The person it went to receives `query_created` ("New <category> query from <name>") and `query_message` notifications; a senior's links open `/student/peer-queries/<id>` (`query_link_for`, 0042).

**Lists.** `useRealtimeQueries({status, category, search, studentId, mentorId, excludeEscalated, pageSize = 25})` runs:

```
supabase.from('support_queries')
  .select('*, student:student_id(id, full_name, email, login_id, section, branch, semester_label),
              mentor:mentor_id(id, full_name, email, login_id)', {count: 'exact'})
  .order('last_message_at', {ascending: false})
  .range(...)
```

- Optional `.eq('status')` and `.eq('category')` filters.
- Since 0042 the pages also narrow by person, because a senior mentor is a student who can read queries sent to them, and a faculty member can read queries a senior raised to them: the student pages pass `studentId` (`.eq('student_id', me)`), the faculty queue and dashboard pass `mentorId` (`.eq('mentor_id', me)`), and the HOD / administrator All Queries passes `excludeEscalated` (`.eq('escalated_to_hod', false)`; escalated queries are on Raised to HOD instead).
- The top-bar search (debounced 320 ms) becomes `.or('subject.ilike.%t%,query_code.ilike.%t%')`, with `%` and `,` stripped.
- **RLS decides the scope:** own queries for a student (and, for a senior, the queries sent to them), `mentor_id = me` or `referred_to_faculty = me` for faculty, the queries of the faculty mapped to them and the escalated queries of their students for a HOD, everything for the administrator (§4.25, §4.26).
- The list re-runs on any `support_queries` change (channel `queries-stream`).
- The category filter offers only the five current categories. Legacy-category queries appear only under "All".

| Page | Columns |
|---|---|
| Student list | Ref, Subject, **Sent to** (Faculty Mentor or Senior Mentor, 0042), Category, Priority, Status + resolution badge + "Raised to faculty mentor" / "Escalated to HOD" badges (0042), Last update |
| Faculty queue | Ref, Subject, Student, Category, Priority, Status, **Raise to HOD**, Last update. Only the queries sent to the faculty member; queries a senior raised to them are on Raised to Me (§4.26) |
| HOD / administrator queue ("All queries") | Adds Mentor (a senior is marked Senior Mentor); drops Raise to HOD. **Excludes escalated queries** since 0042: they are on Raised to HOD (§4.5) |

**Conversation** (`QueryConversation`, `useQueryThread`):

- Loads the query plus `query_messages` with `sender:sender_id(id, full_name, role, avatar_url)`, live on channel `query-<id>`. Since 0042 it also calls `get_query_people` (names, e-mails, role, senior flag, and a student's registration number and section, for everyone on the query) and reads the query's `query_escalations` rows (empty for the student, whom RLS does not let read them). The people fill in embeds RLS leaves empty: a senior and a junior cannot read each other's profiles.
- Composer: at most 5,000 characters with a counter. Ctrl/Cmd+Enter sends. The draft is restored if sending fails.
- `post_query_message` checks `can_access_query` ("Unauthorized to post on this query"): since 0042 the student, the mentor it went to (faculty or senior), the faculty mentor's HOD or the administrator, the faculty mentor a senior raised it to, and the HOD of the student once it is escalated. It also checks for a non-empty message. The first message by anyone other than the student sets `first_response_at` and moves an `Open` query to `In Progress` (before 0042: the first faculty, HOD or administrator message).
- The composer is hidden once `resolution_status = 'confirmed'`. That is UI only; the RPC still accepts messages *(tested)*.
- Faculty and HOD get **Quick replies**: chips from `canned_replies` that append text to the draft.
  - No migration creates any. The four global replies ("Acknowledged", "Need more detail", "Escalated to IT", "Meet in person") are inserted only by the seeds (`supabase/seed.sql` and `npm run db:seed`), so an unseeded production project has none unless someone adds them.
  - There is no UI to create or edit them. RLS would allow a faculty member to manage their own.

**Resolving** (mentor or HOD; `FacultyQueryDetailPage` "Mark resolved", shown while not resolved or when reopened):

- A confirmation dialog, then `resolve_support_query(p_query_id, p_note)`.
- Checks: `can_handle_query`, everyone who can open the query except its student ("Only the mentor it was sent to, or whoever it was raised to, can resolve this query", 0042; before, "Only the assigned mentor or the HOD can resolve this query"); "This query is already closed and confirmed". A senior resolves from Peer Queries, a faculty member a senior raised it to from Raised to Me, the HOD from Raised to HOD.
- Sets `Resolved` + `pending_confirmation`, `resolved_by`, `resolved_at`, and adds a system message ("Marked as resolved by <name>. Awaiting student confirmation.", or the note).
- The student is notified `query_resolution_pending` ("Was your issue fixed?").

**Confirming** (student; `ResolutionConfirmation`, visible while `pending_confirmation`):

- **"Yes, it is fixed"** takes an optional comment (at most 1,000 characters).
  - Result: `confirmed` and a system message "Student confirmed the issue is resolved. Query closed."
  - The mentor gets `query_confirmed`. Toast: "Thank you — this query is now closed."
- **"No, still an issue"** requires a comment in the UI. The server does not require one.
  - Result: `reopened`, `In Progress`, `reopen_count + 1`, `resolved_at` cleared, and a system message "Student reported the issue is NOT resolved (rejection n of 3)… Comment: …".
  - The mentor gets `query_reopened`.
- **Reopen cap:** `max_resolution_rejections()` = 3.
  - At the cap the "No" button disappears, and the UI says "You have already reopened this query 3 times, which is the maximum…".
  - The server refuses with a similar message.
- Other server checks: "Only the student who raised this query can confirm its resolution"; "This query is not awaiting your confirmation".

**Rating** (student; `SatisfactionRating`, visible whenever `status = Resolved`):

- `rate_support_query(p_query_id, p_rating 1–5)`, once only ("This query has already been rated"). The mentor gets `query_rated` ("Query <code> rated n/5").
- A student can rate **before** confirming, because resolving sets `Resolved` immediately. The rating stays if the query is later reopened *(tested)*.

**Priority** (mentor, their HOD or the administrator, detail page): a direct `update({priority})` under the `queries_update_mentor` or `queries_update_hod` RLS policy. Toast: "Priority set to <p>." Since 0042 `priority` is the **only** column signed-in users may update directly (a column grant), and they cannot insert queries directly at all. On a query sent to a senior the faculty and HOD detail page shows the priority read-only.

**Detail pages show:**

- **Student view:** Sent to (0042), mentor, raised on, last update, resolved on, times reopened. A banner says when the query was raised to their faculty mentor or escalated to the HOD (without the reason), and the badges show it on the lists.
- **Faculty/HOD view:**
  - the student's identity;
  - priority, first response and time to first response, resolved on, reopen count, rating;
  - banners for reopened, 3+ rejections, referred to HOD, and awaiting confirmation;
  - since 0042, for a senior's query: "Raised to you by <senior> (senior mentor)" or "Escalated to the Head of Department by <senior> (senior mentor)", with the Raised by tag and the reason; a Senior mentor panel; and the **Raised for help** panel (`EscalationHistory`) listing every referral and escalation with who, to whom, when and why.

**Known issues:**

- **Legacy categories in counters (fixed 2026-10-08, 0041).** The "by category" charts used to count only `Academic`, `ERP/Tech` and `Infrastructure`, so they stayed empty for queries in the current categories. Every chart now shows the five current categories and then any legacy one that still has queries (`lib/queryCategoryChart.js`; in the PDFs, `categoryBars` in `report-document-builder.js`):
  - the student, faculty and HOD/administrator Home pages, from `get_dashboard_metrics().queries_by_category` (every query the page covers, not the recent few);
  - the mentee page and the dossier PDF, from the dossier's full query list;
  - the activity report page and PDF, and the department report PDF, from their `by_category` rows;
  - the student representative's Group queries page, from its query list.

  Still counting only the legacy categories, and read by nothing: `get_dashboard_metrics`' `academic_queries`, `erp_tech_queries` and `infrastructure_queries` (kept for an older frontend), `get_student_dossier`'s `query_summary.academic` / `erp_tech` / `infrastructure`, and the same columns of the views `faculty_performance_summary`, `student_query_summary` and `query_daily_trend`. Do not build on them.
- **Query ownership after a mentor change.** `mentor_id` is fixed at creation.
  - Only the HOD reassignment endpoint moves **unresolved** queries (§4.19).
  - A mentor change made by a **mentor-map upload** moves no queries, so the old mentor keeps them.
  - Students cannot read a former mentor's profile, so such messages show "Unknown".
- The student's confirmation banner counts only the 5 most recent queries.
- The composer is hidden, but posting is not blocked, after confirmation.
- **`set_query_in_progress` accepts any query**, not only CR items. Called on a query awaiting confirmation, it moves it back to In Progress without a student decision and without counting a reopen.
- **Every new query notifies the mentor twice**: `query_created` from the query, and `query_message` ("New reply from <student>") from its first message, which is not a system message.
- **Fixed in 0042.** The RLS `UPDATE` policies let the mentor, their HOD and the administrator change **any column** of their queries directly, including `status`, which bypassed the RPC rules (§8.9 S6). The column grant now allows only `priority`; everything else goes through the RPCs. A student's direct `INSERT` (S15) is revoked too.

### 4.5 Raise to HOD, and the mentor's department and HOD

**Status:** Implemented.

**Where:**

- UI: `FacultyQueryQueuePage.jsx` (the "Raise to HOD" column), `FacultyQueryDetailPage.jsx`, `FacultyMenteesPage.jsx` ("Department & HOD"), `RaisedQueriesPage.jsx` with `isHodView` (Raised to HOD, 0042).
- SQL: `escalate_query_to_hod` (current body in 0042), `set_mentor_department_and_hod` (current body in 0039), `get_raised_queries` (0042); `user_profiles.hod_email`, `user_profiles.hod_id`; `query_escalations` (0042).
- A senior mentor escalates with `escalate_peer_query` instead (§4.26); both land on the same Raised to HOD page.

**Setting the department and HOD** (mentor, from My Mentees):

- The modal calls `set_mentor_department_and_hod(p_department, p_hod_email)`.
- Since 0039 the HOD is normally set by the administrator's **mentor–HOD mapping** (`hod_id`, §4.25). When the mentor is mapped, the HOD e-mail field is **read-only** ("Set by the administrator's mentor–HOD mapping") and only the department is saved.
- Checks:
  - "Only a faculty mentor can set this";
  - "Enter a department" (at most 120 characters);
  - mapped mentor: an e-mail other than the mapped HOD's is refused ("Your HOD is <name> (<e-mail>), from the department's mentor-HOD mapping. Ask the administrator if that is wrong."); a blank e-mail keeps the mapped HOD;
  - unmapped mentor: "Enter your HOD's email address", and the e-mail must belong to an **active HOD account** ("No active HOD account has the email …").
- Effect:
  - sets the mentor's `department`, `hod_email` (stored as that HOD's own e-mail) and `hod_id`. An unmapped mentor naming their HOD is therefore **mapped to that HOD** (the same rule migration 0039 used for existing data); after that only the administrator changes it;
  - sets `department` on **all** of the mentor's mentees whose value differs;
  - returns the number of rows changed. Toast: "Saved. N mentee(s) updated."

**Raising a query** (mentor; since 0042 also the faculty mentor a senior raised the query to; the mentor's HOD or the administrator may also call the RPC):

1. **Input.** A "Raise" button on each not-yet-escalated row of the queue, or on the detail page. Both open a modal with an optional note (at most 1,000 characters).
2. **Processing.** `escalate_query_to_hod(p_query_id, p_note)`:
   - checks "Query not found"; a senior mentor calling it on a query sent to them is told "Use Ask HOD / Escalate on the query and give your reason" (0042); the caller is the query's faculty mentor, the faculty mentor a senior raised it to (0042), the mentor's HOD or the administrator ("Only the assigned mentor can refer this query to the HOD"); not already escalated ("This query has already been referred to the HOD"); and the note length;
   - there is **no** status or reopen-count condition (the old "after 3 rejections" gate was removed in 0030);
   - sets `escalated_to_hod`, `escalated_at`, `escalated_by`, `escalation_note` and `escalation_source = 'faculty'` (0042), bumps `last_message_at`, records a `query_escalations` row (raised by `faculty`, to `hod`, the note as the reason, 0042), and adds the system message "<mentor> referred this query to the HOD.", followed by " Note: <note>" when a note was given.
3. **Routing** (0039). It notifies (`query_escalated`, link `/hod/queries/<id>`) the **active HOD the query's mentor is mapped to** (`hod_id`); for a senior's query raised to a faculty member, the HOD that faculty member is mapped to (0042). If the mentor is not mapped, or that HOD is inactive, it notifies **every active administrator** instead (link `/admin/queries/<id>`). It no longer falls back to every HOD: a HOD cannot open a query outside their own faculty. `enqueue_notification` skips the caller, as before.
4. **Output.** The student is always notified ("<code> has been referred to the HOD", link `/student/queries/<id>`). The queue row shows "Sent". Toasts: "<code> sent to your HOD." (queue) or "Referred to the HOD. The student has been told too." (detail).

**HOD side** (0042). Escalated queries have their own sidebar item, **Raised to HOD** (`/hod/raised`, `/admin/raised`), and are **not** in All Queries any more.

- **Data:** `get_raised_queries()`: for a HOD, every escalated query of a faculty member mapped to them or of a student they oversee; for the administrator, every escalated query. Each row has the latest escalation's reason, who raised it (`raised_by`, `raised_by_kind`) and when, the student (name, registration number, section) and the mentor.
- **Page:** filters Needs action / Resolved / All and Everyone / **Raised by faculty** / **Raised by senior** (with counts); the top-bar search covers subject, reference, student, who raised it and the reason. Columns: Ref, Subject with the Faculty Mentor or Senior Mentor tag, Student, **Raised by** (tag, name, time), **Reason**, Status. A row opens the usual detail page (`/hod/queries/<id>`), where the banner names who escalated it with the tag and the reason; the HOD replies in the same conversation (the student, the mentor and anyone it was raised to are notified) and can resolve it.
- Before 0042 every escalation was a mentor's; the migration marks them `escalation_source = 'faculty'` and copies them into `query_escalations` with the note as the reason, so they show as Raised by faculty.

**Known issues:**

- The hints in both modals say "The student is told the query was referred, but is not shown this note." **It is shown.** The note is part of the system message, which the student reads. (A senior's reason, §4.26, is not: it is only in `query_escalations`, which the student cannot read.)
- A query can be referred in any status, including closed.
- **When a HOD calls the RPC** (there is no button for it), routing still follows the query's mentor, so the HOD is the recipient and is skipped as the actor: nobody is notified. The system message names the HOD as the referrer.

### 4.6 Star mentee (student representative)

**Status:** Implemented.

**Where:**

- SQL: `set_star_mentee`, `notify_on_star_mentee_change`, `get_mentor_group_queries`, `get_mentor_group_survey_status`, `submit_mom_report`.
- UI: `FacultyMenteesPage` (star toggle), `FacultyMenteeDetailPage`, `StudentGroupQueriesPage`, `StudentSurveyTrackingPage`, `StudentCrReportPage`, and `NAVIGATION.student` (items with `when: is_star_mentee`).

**Setting the star.**

- The mentor (or their HOD, or the administrator) calls `set_star_mentee(p_student_id, p_is_star)`, with a confirmation dialog on My Mentees.
- The function locks the mentor's row, clears any other star in that mentor's group, and sets the flag under the trusted-operation flag. **At most one star per mentor**, as far as this function is concerned. There is no unique index, and un-starring leaves the group with none.
- The student gets `star_mentee_assigned` (link `/student/group-queries`).
- Toasts: "<name> is now your student representative." / "<name> is no longer the student representative."

**What the star unlocks.** Three sidebar items appear only when `profile.is_star_mentee`. Each page also redirects non-stars to `/student`, and each RPC refuses them:

- **Group Queries** (`/student/group-queries`):
  - `get_mentor_group_queries()` returns every query of the mentor's group, most recently active first (`last_message_at`), with a narrow projection: `query_code, subject, category, priority, status, resolution_status, created_at, last_message_at, student_name, section, is_mine`. No ids, message text, e-mails or registration numbers.
  - The page shows client-side KPIs (total, open, in progress, resolved), a category bar, a status donut and a filterable table. Rows have no links.
  - Errors: "Not permitted" / "Only the student representative can view the group query list".
- **Survey Tracking** (§4.15).
- **CR Report** (§4.7).

**Known issue.** Neither `reassign_mentees` nor a mentor-map upload (`map_students_to_mentors`) clears `is_star_mentee`. After a mentor change the target group can have two representatives.

### 4.7 CR reports (class-representative meeting minutes)

**Status:** Implemented.

**Where:**

- UI: `pages/student/StudentCrReportPage.jsx`, `pages/faculty/FacultyCrReportsPage.jsx` (also `/hod/cr-reports` and `/admin/cr-reports`).
- SQL: `submit_mom_report`, `set_query_in_progress`, `resolve_support_query`, `notify_on_query_created` (skips items); table `mom_records`, and `support_queries.mom_id`.

**Design.** A report is one `mom_records` row: the meeting. Each raised issue ("action item") is **a normal query** authored by the representative, linked by `mom_id`, so items get the whole query workflow (conversation, confirmation, rating).

**Filing** (star mentee):

- **Section A, the meeting:** date (default today, no future dates), students present and students in the group (digits), general discussion (required, at most 5,000).
- **Section B, issues:** repeatable blocks with Issue title (at most 200), Category (current categories) and Description (at most 5,000). Blank blocks are ignored; a half-filled block is an error ("Give this issue a title." / "Describe the issue.").
- **Call:** `rpc('submit_mom_report', {p_meeting_date, p_notes, p_items: [{title, category, description}], p_students_present, p_students_total})`.
- **Server checks:**
  - must be a student, the star mentee, and have a mentor;
  - notes non-blank;
  - at most **12** items ("File at most 12 action items per meeting");
  - each item needs a title and a description; a missing category becomes `Others`;
  - CHECK constraints: meeting date not in the future, present ≤ total.
- **Effect:**
  - inserts the report;
  - creates one `support_queries` row (with `mom_id`) and a first message per item;
  - sends the mentor one summary notification: "CR report from <rep> — n item(s) to action", link `/faculty/cr-reports`. The per-item "new query" notification is skipped for `mom_id` rows, **but each item's first message still triggers a `query_message`** ("New reply from <rep>"). The mentor therefore receives 1 + n notifications.
- **Toast:** "Report filed. n item(s) sent to your mentor." (singular or plural)

**After filing (student).**

- KPIs: Reports filed, Issues raised, Still open, Waiting on you (items pending confirmation).
- A panel per meeting with its notes and items. Item links are plain `<a href>` links, which reload the page.
- A filed report cannot be edited: `mom_records` has only a SELECT policy, so it is append-only.

**Acting on items** (mentor, or their HOD at `/hod/cr-reports`, or the administrator at `/admin/cr-reports`):

- The page loads the last 20 reports plus all `support_queries` with a `mom_id`, grouped by report. KPIs: Reports, Issues raised, Needing action, Reopened.
- Each item has "Update status":
  - **In Progress** calls `set_query_in_progress`, which sets `In Progress` + `none` and `first_response_at` if empty, and adds the system message "Picked up — marked as In Progress."
  - **Resolved** requires remarks ("Add the resolution remarks before marking this resolved.") and calls `resolve_support_query` with the remarks as the system message.
- The representative then confirms or reopens the item like any query.

**Rules and edge cases:**

- `submit_mom_report` does not check the 20-unresolved cap, **but the items count toward it afterwards**: they are the representative's own unresolved queries. Filing a large report can therefore block the representative from raising normal queries until items are resolved *(tested)*. The items also appear in the representative's own My Queries and dashboard.
- The client has no 12-item cap, although the hint mentions one; the server enforces it.
- `mom_records.mentor_id` is not updated on reassignment.

### 4.8 Counselling

**Status:** Implemented.

**Where:**

- UI: `pages/student/StudentCounsellingPage.jsx`, `pages/faculty/FacultyCounsellingPage.jsx`.
- SQL: `request_counselling`, `respond_to_counselling`, `notify_on_counselling_request`, `counselling_type_label`; table `counselling_requests` (0029; the type since 0040).
- Constants: `COUNSELLING_TYPES`, `counsellingTypeLabel`, `COUNSELLING_STATUS` (`lib/constants.js`).

**Privacy.** Only the student and **their assigned mentor** can read a request. RLS has **no HOD or administrator policy**, and there is no HOD route (`/faculty/counselling` is faculty-only). The page's promise "This goes only to them." is accurate.

**Student flow:**

- The form is shown only when a mentor is assigned; otherwise "No mentor assigned yet".
- **Type of counselling** (required dropdown, 0040), starting on "Choose the type of counselling":

  | Shown | Stored (`counselling_type`) |
  |---|---|
  | Academic Counselling | `academic` |
  | Personal Counselling | `personal` |
  | Career Counselling | `career` |
  | Placement Counselling | `placement` |
  | Financial Counselling | `financial` |
  | Technical Counselling | `technical` |
  | Health & Wellness Counselling | `health_wellness` |
  | Behavioural Counselling | `behavioural` |
  | Professional Development Counselling | `professional_development` |
  | Higher Education Counselling | `higher_education` |
  | General Guidance & Mentorship | `general_guidance` |
  | Other | `other` |

  The list is `COUNSELLING_TYPES`; the database holds the same twelve in the CHECK `counselling_type_valid` and `counselling_type_label()`. Adding a type means changing all three (a new migration and the constant).
- **The issue you are facing:** at most 3,000 characters. The hint asks for it in the student's own words; with "Other" it asks them to say what it is about first.
- "Send to my mentor" stays disabled until both are filled ("Choose the type of counselling." / "Write down the issue you are facing." if submitted anyway). It calls `request_counselling(p_concern, p_counselling_type)`, and both fields are cleared after sending.
- The server checks: an active student with a mentor; a type ("Choose the type of counselling"), one of the twelve ("Choose one of the listed types of counselling"; read case- and space-insensitively); non-blank text; at most 3,000 characters. It enforces a **cap of 5 requests with status ≠ closed** ("You already have 5 open counselling requests. Your mentor has been notified — please wait for them to reach out.").
- The mentor gets `counselling_request`, link `/faculty/counselling`: "<name> has asked for <type>" (for example "has asked for Career Counselling"), or "<name> has asked to talk" for Other. Toast: "Sent to <mentor>."
- **What you have sent:** each request is headed by its type ("Counselling request" for one sent before 0040), then "Sent <date>", the issue and the mentor's reply.

**Mentor flow:**

- **List:** `counselling_requests` with the student embedded, newest first. Each request shows its type as a chip beside the status (none for requests sent before 0040), and the reply modal shows it above the student's text.
- **Filters:** "Needs a reply" (status ≠ closed), Everyone, Closed.
- **KPIs:** Waiting on you (open), In conversation (acknowledged), Closed, Students.
- **Reply modal** (at most 3,000 characters) calls `respond_to_counselling(p_request_id, p_note, p_close)`:
  - checks "Request not found", "Only the assigned mentor can respond to this request", and the length;
  - sets `mentor_note` and `responded_at`, and status `closed` (when "Reply and close") or `acknowledged`;
  - when `mentor_note` changes, the student is notified "Your mentor has replied".
- Toasts: "Reply sent to the student." / "Replied and closed."

**Statuses:**

| Status | Student label | Mentor label |
|---|---|---|
| `open` | Sent | Needs a reply |
| `acknowledged` | Mentor replied | In conversation |
| `closed` | Closed | Closed |

**Edge cases:**

- `mentor_note` is **overwritten** by each reply: there is no thread.
- The student sees the latest note labelled with their *current* mentor's name.
- No realtime (the table is not in the publication).
- Requests stay with the mentor who received them. A reassignment does not move them.
- The policy `counselling_update_mentor` lets the mentor update **any column** of their requests directly, including the student's `concern` text and `counselling_type` (S18).
- Requests sent before 0040 keep `counselling_type` NULL; nothing guesses a type for them.
- Before the new frontend is deployed, the old page (which sends the concern alone) is refused with "Choose the type of counselling" (§13.5).
- `respond_to_counselling` without "close" sets `acknowledged` from any state, so replying to a closed request reopens it.

### 4.9 Academics (student side): the academic performance overview

**Status:** Implemented. Students no longer record GPA themselves (removed 2026-09-28, migration `0037`).

**Where:**

- UI: `pages/student/StudentAcademicsPage.jsx`. The overview is `components/academics/AcademicOverview.jsx`, the same block the mentor and the HOD see on the student's page (§4.18); its arithmetic is in `lib/academicRecord.js`.
- SQL: `can_view_student_gpa`, `can_access_student`; `upsert_semester_gpa` (retired in 0037) and `set_gpa_sharing` (dead).
- Tables and views, all read directly and RLS-scoped to the student: `student_semester_gpas`, `student_cgpas`, `student_attendance_overview` (the active academic cycle's attendance, §4.24), `student_backlogs`, `student_black_dots`.

**The page** is the overview and nothing else. Its heading, "Academic performance overview", is the page title, with "Attendance per subject, GPA, backlogs with their subjects, and black dots." under it. The page passes `showHeader={false}`, so the overview's own heading, description and **semester picker are not shown to the student**: the student always sees the current view. The mentor's and the HOD's student page keep the header and the picker.

**The academic performance overview** (2026-09-27):

- **Semester picker** (staff pages only). It opens on "Sem N (Current)". N is read from the profile's `semester_label` ("3rd Semester", "Semester III", "V Sem"); a label that names a year, or no number beside "sem", gives nothing, and then N is the semester after the last graded one. Earlier semesters are always offered, and any later one that has data.
  - **Current view:** attendance from the latest uploads, the latest graded semester's GPA, every backlog (open first) and every black dot.
  - **An earlier semester:** that semester's GPA and the backlogs recorded against it. Attendance carries no programme semester in the portal (the view keeps the latest period per course), so its card says "No attendance for Sem n"; black dots are always the whole record. A banner says this, with "Back to Sem N".
- **Four tiles:**
  - **Average attendance:** the mean of the per-course percentages, the at-risk rule's own figure. One decimal, but a value below 75 is never rounded up to "75%". Note: "Below the 75% target overall", "Below 75% in n subjects" or "75% or more in all n subjects"; footnote: the subject count and the latest `period_end`.
  - **Current GPA** ("GPA · Sem n" for an earlier semester): the GPA, and its change from the previous graded semester ("Up 0.40 from Sem 1", "Down …", "Same as …", "First graded semester"). Footnote: "Sem n result · CGPA x", where the CGPA is the official one once uploaded and otherwise the mean of the semesters, marked "(average)". With no GPA the tile shows "—" and "No GPA recorded yet", never 0.
  - **Open backlogs** ("Backlogs · Sem n"): the open count, with "Open from Sem 1 and 2", "None open · n cleared" or "None on record".
  - **Black dots:** the count and the latest incident date. This is the student's whole record; only the active cycle's black dots count towards the at-risk rule (§4.14).
- **Subject-wise attendance:** one bar per subject, blue at or above 75% and red below, the percentage printed on each bar, a dashed 75% target line and a legend; the tooltip gives the subject name and "a of h classes". Below it, a table: Subject (code, name, teaching section), Attendance (with a small meter), Attended, Total classes. Empty: "No attendance uploaded yet".
- **GPA trend:** semesters 1 up to the current or last graded one, a point only where there is a GPA (the line breaks at a gap), a dashed at-risk line at 6 and a label on each point. Below it, Semester | GPA | Credits | Recorded by ("Department", or "You" / "Self-reported" for a GPA a student recorded before `0037`), and a strip with the CGPA ("Official" or "Average of semesters"), the credits earned and the highest semester. Empty: "Your GPA appears here once the department publishes it." (student) or "No GPA has been published for this student yet." (staff).
- **Backlogs (open count):** # | Code | Subject name | Sem | Grade | Status ("Backlog" or "Cleared"), up to 5 rows. "View all" opens every backlog with credits, exam and the date it was cleared.
- **Black dots (count):** # | Date | Reason / incident (with the case number) | Block (and room) | Previous record, up to 5 rows. "View all" lists every case with course/branch and the date it was recorded.

**GPA comes only from the department.** Until 2026-09-28 a "Record your GPA" panel under the overview let a student enter the GPA of any semester the department had not published, through `upsert_semester_gpa`. The panel is gone, and migration `0037` closes the database paths too:

- `upsert_semester_gpa` is no longer executable by `authenticated` (it is kept, so the feature could return with one `GRANT`);
- the policies `gpas_insert_own`, `gpas_update_own` and `gpas_delete_own` are dropped and the table grant is `SELECT` only. They never checked `source`, so they had also let a student change or delete a department-published GPA (S1, now closed).

GPAs students recorded before `0037` are kept with `source = 'student'`. They still show (marked as the student's own) and still count as the latest GPA in the at-risk rule until the department uploads that semester, which replaces them as it always did. Nothing in the portal deletes them; if the department wants department figures only, that is `delete from public.student_semester_gpas where source = 'student'` in SQL.

**Not shown to students:** anything about their own at-risk status. No student page reads `student_risk_flags` or meetings. Backlogs and black dots have been on this page since 2026-09-27; RLS already let a student read their own rows.

**GPA sharing.**

- `student_form_a_profiles.gpa_sharing_enabled` (default `true`) still gates the **mentor's** read of GPAs through `can_view_student_gpa`, which returns:
  - `true` for the student themself, for the HOD of the student's mentor and for the administrator (`oversees_student`, 0039);
  - for the mentor, `coalesce(gpa_sharing_enabled, true)`.
- The **toggle was removed from the UI**, so sharing stays on unless it is changed outside the UI. Two routes remain: `set_gpa_sharing(false)` is still executable by any student through the API, and a student can update `gpa_sharing_enabled` on their own Form A row directly *(tested)*. Nothing in the code calls `set_gpa_sharing` (S20).

### 4.10 Achievements

**Status:** Implemented.

**Where:**

- UI: `pages/student/StudentAchievementsPage.jsx` (student), `pages/faculty/FacultyMenteeDetailPage.jsx` (verification).
- SQL: `set_achievement_verification`, `notify_on_achievement_verified`; table `student_achievements`; bucket `achievement-proofs`.

**Student.**

- **Fields:**
  - title: required, 3–200 characters ("Give the achievement a title of at least 3 characters.");
  - category: `achievement_category` = sports, cultural, technical, volunteering, certification, leadership or other; default technical;
  - `achieved_on`: a date, not in the future;
  - description: at most 2,000;
  - proof file: optional; PNG/JPG/WEBP/PDF; at most 5 MB; uploaded immediately to `achievement-proofs/<uid>/proof-…`.
- **Writes:** direct table `insert` / `update` / `delete` under RLS. Toasts: "Achievement added.", "Achievement updated.", "Achievement removed."
- **Page extras:** filter pills, a category donut, and "x of n verified by your mentor". "View proof" opens a 300 s signed URL.

**Mentor or HOD.** On the mentee detail page, "Verify" toggles `set_achievement_verification(p_achievement_id, p_verified)`.

- Check: "Only the assigned mentor or the HOD can verify this achievement".
- When the flag changes from false to true, the student gets `achievement_verified`.
- Toasts: "Achievement verified." / "Verification removed."

**Rule.** A **verified entry is locked for the student.** The UI hides Edit and Delete ("Verified entries are locked. Ask your mentor if a change is needed."), and RLS enforces it: update and delete require `verified_by_faculty = false`, and inserts must have `false`. The page's header comment saying verification "never hides or blocks anything" is wrong.

**Edge case.** Replaced or deleted proof files are never removed from storage.

### 4.11 Cluster head setup and subjects

**Status:** Implemented. There is one data-loss trap.

**Where:**

- UI: `pages/clusterHead/ClusterHeadSetupPage.jsx` (`/cluster-head/setup`, no shell), `pages/clusterHead/ClusterHeadCoursesPage.jsx` ("My subjects · 2026–27"), `routes/RouteGuards.jsx` (`RequireClusterHeadSetup`).
- SQL: `submit_cluster_head_setup`; table `cluster_head_courses`; view `current_cycle_courses`, which every cluster-head screen reads.

**Subjects belong to an academic cycle** (since 0036). The same code appears once per cycle (unique on `(cluster_head_id, cycle_id, lower(course_code))`). Starting a new cycle copies every cluster head's list into it (§4.24), so editing next year's subjects never touches last year's, or the attendance recorded against them.

**Gate.**

- Every cluster-head route except `/cluster-head/setup` is wrapped in `RequireClusterHeadSetup`, which redirects to the setup page until `user_profiles.cluster_head_setup_completed` is true.
- The **academic upload endpoint enforces the same flag** for cluster heads: 403 "Complete the cluster head setup form before uploading data.". HODs and the administrator are exempt.
- **A HOD has no setup and no subject list** (0039). Their Uploads screens are not wrapped in `RequireClusterHeadSetup`, there is no My Subjects entry, and an attendance file's subject is created from the file the first time its code is uploaded in the cycle (§4.25).
- The **roster import endpoint does not** check it.

**Setup and My Subjects** (same RPC, same rules):

- **Input:** blocks of *Course name* (a select of 27 `COURSE_CATALOGUE` entries including "Other", with a free-text name when Other) and *Course code* (at most 40). The form starts with 5 blank blocks (`CLUSTER_HEAD_DEFAULT_SUBJECT_ROWS`), or pre-fills the saved list. Blank blocks are ignored.
- **Client validation:**
  - "Add at least one subject before continuing." (setup) or "Keep at least one subject." (My Subjects);
  - "Pick or type a course name";
  - "Course code is required";
  - "This course code is already used above" (case-insensitive).
- **Processing:** `submit_cluster_head_setup(p_courses)`, confined to the **active cycle**.
  - **Checks:**
    - caller is a cluster head: "Only a cluster head can submit the cluster head setup form";
    - there is an active cycle: "There is no active academic cycle. Start one under Academic Cycles, then add your subjects.";
    - at least one subject: "Add at least one subject before submitting";
    - at most 60: "That is more subjects than one cluster head can handle (limit 60)";
    - name and code non-blank: "Every subject needs both a course name and a course code";
    - no duplicate codes: 'Course code "%" appears more than once'.
  - **Writes:**
    1. Delete the caller's courses **in the active cycle** whose `lower(course_code)` is not in the new list.
    2. Insert the rest into the active cycle, `ON CONFLICT (cluster_head_id, cycle_id, lower(course_code))`, updating name, `display_order` and `updated_at`.
    3. Under the trusted-operation flag, set `cluster_head_setup_completed = true` and `cluster_head_setup_completed_at` (first time).
- **Output:**
  - Setup: toast "Setup saved. Your portal is ready." and navigate to `/cluster-head`.
  - My Subjects: "Subjects updated."

**Known issues:**

- **Changing a course code in place is a delete plus an insert.** `student_attendance_records.course_id` and `student_course_sections.course_id` are `ON DELETE CASCADE`, so **that subject's attendance in the current cycle is deleted** (earlier cycles have their own copy of the subject and are safe). `academic_upload_batches.course_id` is `SET NULL`. No risk re-evaluation follows.
  - The page's subtitle ("correct a code rather than deleting and re-adding it") suggests the opposite.
  - A case-only change to a code is silently not saved: the conflict key is case-insensitive, and the stored code is never updated.
- The RLS policy `ch_courses_write_own` (FOR ALL) also lets a cluster head write their `cluster_head_courses` rows directly, bypassing the RPC's validation.
- The setup route stays reachable after setup, and re-submitting replaces the list.

### 4.12 Academic data uploads: attendance, GPA, backlogs, black dots

**Status:** Implemented. Known issues are listed at the end.

**Where:**

- UI: `pages/clusterHead/ClusterHeadAttendancePage.jsx`, `ClusterHeadGpaPage.jsx`, `ClusterHeadBacklogPage.jsx`, `ClusterHeadBlackDotPage.jsx`, and `components/clusterHead/AcademicUploadPanel.jsx`. The same pages are a HOD's Uploads screens under `/hod/uploads/*` (§4.25); on the attendance page a HOD sees "Subjects you have uploaded this cycle" instead of their subject list, and no "No subjects set up" gate.
- API: `api/cluster-head/upload-academic-data.js`.
- Parsers: `api/_lib/spreadsheet-parser.js` and `api/_lib/table-readers.js` (formats in §10.4).
- SQL: `record_attendance_batch`, `record_gpa_batch`, `record_backlog_batch`, `record_black_dot_batch`, `resolve_student_ids`, `evaluate_student_risk`, and the helpers `try_numeric` and `is_blank_mark` (0035); the cycle triggers of 0036.
- Tables: `student_course_sections`, `student_attendance_records`, `student_semester_gpas`, `student_cgpas`, `student_backlogs`, `student_black_dots`, `academic_upload_batches`, `student_risk_flags`.

**Every upload is filed under the active academic cycle** (0036, §4.24). A `BEFORE INSERT` trigger sets `cycle_id` on the batch and on the rows it writes: attendance takes its subject's cycle, a black dot the cycle its incident date falls in (the active one when the notice has no date or no cycle covers it), and everything else the active cycle. With no active cycle the upload is refused ("There is no active academic cycle..."). Each upload panel says where it is going: "Goes into the 2026–27 cycle · now: Odd semester 2026". Which **semester** an upload is filed under is worked out when it is read, not stored: attendance by its period's end date, backlogs by the programme semester's parity (3 → odd, 4 → even), black dots by incident date, everything else by upload date.

**Every upload takes the file exactly as its source produces it.** Attendance, GPA and backlogs are the ERP's own exports (HTML tables saved as `.xls`); black dots are the Proctorial Board's Word notice. Each may also be re-saved as `.xlsx` or `.csv` with the same layout. Nothing on the screens has to be chosen, except two optional backlog fallbacks.

**Students are matched on registration number only** (`user_profiles.login_id`), never on e-mail or roll number. An identifier containing `@` gets its own row error: "This is an email address. Rows are matched on registration number only".

**Common pipeline.**

- **UI.** The panel reads the file as base64 (there is no client-side size or type check; `accept` only filters the file picker). It posts to `/api/cluster-head/upload-academic-data`, then shows summary tiles (each page chooses its own) and a table headed "Rows that need attention" (Row, Registration no., Reason). For a Word notice, which has no row numbers, the Row column shows the case and S/No instead. Pages that read metadata from the file show it in a "Read from the file" panel.
- **Effective file-size limit.** zod caps `file_base64` at 8,000,000 characters, about 6 MB of file. Vercel's own request-body limit for functions is 4.5 MB (a platform limit, not in the code), so in practice files above roughly 3.3 MB are rejected with a 413 before the handler runs.
- **API steps, in order:**
  1. POST only.
  2. Body at most 10 MiB (413).
  3. Authenticate.
  4. Role `cluster_head`, `hod` or `admin`; the `hod-map` action is the administrator's only (403 "Only the administrator can upload the mentor-HOD mapping.").
  5. Rate limit: **30 uploads per 300 s** per user, across all six actions.
  6. zod validation.
  7. Setup gate (cluster heads).
  8. Decode base64.
  9. Parse.
  10. RPC **as the user**.
  11. Audit `cluster_head.upload_<action>`, with `{action, filename, total_rows, matched, failed, mentor_accounts_created}`, plus `semester` and `cleared` for backlogs and the case numbers for black dots. The mapping upload audits `admin.upload_hod_map` instead (§4.25).
  12. Respond with the RPC's JSON plus `file_meta`, what the parser read out of the file (semesters, exam, programme, subjects, cases).
- **In SQL, each RPC:**
  - allows `is_cluster_head() or is_hod()` (a HOD or, since 0039, the administrator), or no JWT (for scripts);
  - resolves all identifiers once with `resolve_student_ids`: **active students only, registration number only** (since 0035; it also refuses any other caller, closing S3);
  - inserts an `academic_upload_batches` row, and at the end writes its counts and `scope_label` (what the file covered, shown in Recent uploads);
  - loops over the rows, collecting per-row errors;
  - calls `evaluate_student_risk` for every distinct student it changed (black dots too, since 0036: they are part of the rule);
  - returns `{batch_id, total_rows, matched, failed, row_errors, ...}` with upload-specific extras below.
- **Row numbers in errors.** GPA, backlog and black dot errors carry the spreadsheet's own line number (the parser sends `row`); black dot errors also carry `where` ("Case 034/Even Sem/2026 · S/No 2"). Attendance and the mentor map still report the row's 1-based position in the parsed list; for attendance, among de-duplicated students.
- **Transactions.** Each upload is **one transaction**. A per-row problem is reported and skipped. Values are validated before they are cast (`try_numeric`), so a stray word in a numeric cell is a row error; a constraint violation that slips past validation still **aborts the whole upload**. CHECK violations are rewritten by `describeError` into the generic "Some of the values entered are not valid. Please review the highlighted fields.", which is confusing on an upload page that has no highlighted fields.

**Attendance** (`action: 'attendance'`; body `{filename, file_base64}` only):

- **Input:** the ERP "Class Attendance" export, normally `.xls` (really an HTML table), or `.csv` or `.xlsx`.
  - The **header block** gives Course Code, Course Name, Section and From/To dates.
  - The **table** gives a registration number, an optional Section per row, Total Class, Present and %.
  - Accepted formats and aliases are in §10.4.
- **Processing:** `record_attendance_batch(p_course_code, p_course_name, p_section, p_period_start, p_period_end, p_filename, p_rows)`.
  - **Aborts the whole upload for:**
    - an unknown course, for a cluster head: 'Course code "%" is not in your subject list for 2026–27. Add it under My Subjects, then upload this file again.' The match is case-insensitive against the caller's own subjects **in the active cycle**. A HOD (or the administrator) matches any account's subject of that code, preferring their own, and **when there is none the subject is created** from the file's Course Code and Course Name, owned by the HOD; the result's `course_created` says so (0039, §4.25).
    - reversed dates: "The From/To dates in the file header are missing or out of order". Missing dates never reach SQL: the parser substitutes today, so an undated file (or one with dates in another format) is recorded as a one-day period ending today;
    - constraint violations: attended ≤ held, held ≤ 2000, section label pattern `^[A-Za-z0-9][A-Za-z0-9 .-]{0,11}$`.
  - **Per-row errors:**
    - "The % column is missing or outside 0-100";
    - "No section on this row and none in the file header";
    - "No student matches this registration number".
  - **Writes:**
    - `student_course_sections`: upsert on `(student_id, course_id)`, replacing the section;
    - `student_attendance_records`: upsert on `(student_id, course_id, period_start)`, replacing the row. It stores the course code as saved in My Subjects, the file's course name, `round(%, 2)`, and the held and attended counts.
- **Output** adds `course_code, course_name, section, sections, period_start, period_end`. The page shows them in a "Read from the file" panel. The "Rows in file" tile counts de-duplicated students, not file lines.
- **Rules:**
  - The per-row Section column wins over the header's section.
  - A student listed twice is merged: counts are summed and % recomputed, or the two percentages are averaged when counts are missing.
  - A re-upload of the same period replaces it. A new From date adds a new period, and the overview shows the latest.

**GPA** (`action: 'gpa'`; body `{filename, file_base64}`; the API still accepts an optional `semester_number` fallback for a flat file, but the page no longer sends one):

- **Input:** the ERP "Student's CGPA / GPA & Credits" export. Its header is two rows built from rowspan/colspan: S. No., Registration No., Student Name, CGPA, Total Earned Credits, Total Required Credits, then a "Semester I", "Semester II" ... group per semester, each with GPA / Earned Credits / Req Credits underneath. The number of semester groups depends on the batch.
  - The semester of every GPA is read from the group heading above it (Roman or Arabic numerals). A GPA of "-" is a semester not graded yet and is left out, so the semester in progress never lands as a value.
  - Groups outside 1–8 are reported in `file_meta.ignored_semesters` and not sent.
  - A flat one-semester sheet (Registration No, GPA, Semester) is still accepted.
- **Processing:** `record_gpa_batch(p_semester_number, p_filename, p_rows)`. Each row is one student: `{row, identifier, cgpa, total_earned_credits, total_required_credits, semesters: [{semester_number, gpa, earned_credits, required_credits}]}`. The flat shape `{identifier, gpa, semester_number}` is one semester of it, with `p_semester_number` as its fallback. **A row is recorded completely or not at all.**
  - **Per-row errors:** "No registration number in this row"; the e-mail message above; 'CGPA "x" is not a number between 0 and 10'; the same for each credit value (totals 0–400, per semester 0–100) and each semester GPA (0–10); "Semester n is outside 1-8"; "No semester on this row, and none chosen for the upload"; "No student matches this registration number".
  - A row with no graded semester and no CGPA (a row of dashes) is **skipped**, not failed, and counted in `skipped_rows`.
- **Writes:**
  - `student_semester_gpas` upsert on `(student_id, semester_number)`, **always overwriting** the GPA, with `source = 'cluster_head'`, `round(gpa, 2)`, `recorded_by` and `batch_id`. Credits are kept when the new file has none. A department value replaces any GPA a student recorded before `0037`.
  - `student_cgpas` upsert on `student_id` when the row has a CGPA, replacing CGPA and both totals.
- **Output** adds `skipped, semester_gpas_recorded, semesters, cgpa_recorded`. `scope_label` is e.g. "Semesters 1, 2 + CGPA". The page shows the semesters in the file, the ones recorded and the ones not graded yet.
- **Where the CGPA shows:** the mentor's and HOD's student page and the student report PDF (`gpa_stats.cgpa` is the official CGPA when there is one, `cgpa_official` says so), and the student's Academics page. Until one is uploaded they show the mean of the semester GPAs, as before.

**Backlogs** (`action: 'backlog'`; optional `semester_number` 1–8 and `exam_session` of at most 60 characters, both fallbacks):

- **Input:** the ERP "Defaulter Grade" result export, three HTML tables:
  - title lines: "RESULT OF END TERM EXAMNINATION -24-25 ()" and "BTECH-031 : … (IOT AND INTELLIGENT SYSTEM)- III SEMESTER". The semester (Roman or Arabic) and the exam ("END TERM EXAMNINATION 24-25") are read from them;
  - the student grid: S.No., Registration No, Student Name, then **one column per subject code** holding the grade (F, UFM, DT ...) where the student failed. Only defaulters are listed;
  - the subject table: Subject Code, Subject Description, Credit. It supplies names and credits; the "OE" column is matched to "OPEN ELECTIVE" by initials.
  - A hand-made list (Registration No, Subject Code, optional Subject Name, Grade, Cleared) is still accepted.
- **Semester and exam precedence:** the file's semester wins over the dropdown; the dropdown is used only when the title names none (otherwise the API returns 400 "The file does not say which semester it is for..."). A typed exam label wins over the title's.
- **Processing:** `record_backlog_batch(p_semester_number, p_exam_session, p_filename, p_rows, p_subject_codes)` (0035 dropped the old four-argument version). Each row is one student: `{row, identifier, grades: [{subject_code, subject_name, credits, grade}]}`; the hand-made shape is one subject per row.
  - **Fail grades:** F, FA, FAIL, FAILED, UFM, DT, DB, DX, AB, ABS, ABSENT, I, X, NC, DETAINED, DEBARRED (case-insensitive). Any other value in a subject cell is listed back as '… "RL" is not a fail grade, so nothing was changed for this subject' and that subject is left alone.
  - **Per-row errors:** "No registration number in this row"; the e-mail message; "Each row needs a registration number and a subject code" (hand-made list); "No student matches this registration number".
  - **Writes:** `student_backlogs`, matched on student, semester and **upper(subject_code)** (case-insensitive; codes are stored upper-case): grade, credits, name and exam session are updated when given; a fail grade makes it open (`is_cleared = false`, `cleared_at` null).
  - **The clearing pass.** `p_subject_codes` is every subject column in the file. The Defaulter Grade list is the whole truth for those subjects in that semester, so every open backlog in them that the file no longer marks is cleared (`cleared_at` set once): a student listed with a blank cell, and a student not listed at all. Subjects the file does not name, and other semesters, are never touched. A hand-made list sends no subject codes and gets no clearing pass.
  - **Hand-made Cleared values** are case-insensitive: `yes`, `y`, `true`, `cleared`, `pass`, `passed`, `1` clear; `no`, `n`, `false`, `not cleared`, `fail`, `failed`, `0` reopen; a blank cell or no Cleared column leaves an existing backlog's state alone (new rows start open).
- **Output** adds `semester_number, exam_session, backlogs_recorded, backlogs_cleared`. `scope_label` is "Semester 3 · END TERM EXAMNINATION 24-25". The page shows semester, exam, programme and the subject table.
- **Where backlogs show:** the student's own Academics page (§4.9), the mentor's and HOD's student page (subject, semester, grade, open/cleared with date, exam), the at-risk pages' counts, and the cycle overview (§4.24). A backlog keeps the cycle it was first recorded in; it stays open, and counts towards the at-risk rule, across cycles until a later result clears it.

**Black dots** (`action: 'black-dot'`; body `{filename, file_base64}` only):

- **Input:** the Proctorial Board's "Notice of PB meeting" as `.docx` (read without a dependency: `table-readers.js` unzips `word/document.xml` with `node:zlib`), or the same table as `.xlsx`/`.csv`. One table per case:
  - a **case line** spanning the table: "Case No: 034/Even Sem/ 2026.  The undermentioned students were involved in possession of banned items." The case number ends at the first full stop, comma or " - "; the rest is kept as what the case is about. Case numbers are normalised ("034/Even Sem/2026");
  - a header: S/No, Regn No, Name, Date of Incidence, Block, Room No, Course/Branch, Mob No, Previous Record;
  - one row per student. A date merged down (Word `vMerge`) or written only on the first row applies to every student in the case. Course/Branch on two lines becomes "B Tech ECE, Sec- F1".
  - A flat sheet with a Case No column on every row also works.
  - **Dates** are read day-first ("10/09/26" is 10 September 2026) and only when complete; "14TH August" keeps its text and no date.
- **Processing:** `record_black_dot_batch(p_filename, p_rows)`. Each row: `{row, where, identifier, name, case_number, case_details, incident_date, incident_date_text, hostel_block, room_no, course_branch, mobile_no, previous_record}`.
  - **Per-row errors:** "No registration number in this row"; the e-mail message; 'No case number for this row. The notice needs a "Case No: ..." line above each table, or a Case No column'; "No student in the portal has this registration number (they may be from another department)" (a PB notice covers the whole university, so this is expected for most rows); and the **name check**: when the notice gives a name it must share a word (two letters or more) with the account's name, otherwise 'The name in the notice ("…") does not match the student with this registration number. Check the registration number'. The account's name is not revealed.
  - **Writes:** `student_black_dots` upsert on `(student_id, lower(case_number))`, so a corrected notice re-uploaded updates rather than duplicates (blank cells keep the stored values). `previous_black_dots` is read from Previous Record ("NIL" → 0, "8 black dot" → 8).
- **Output** adds `cases, case_numbers, students`. `scope_label` is "Case 034/Even Sem/2026" or "2 cases". The page lists the cases read from the notice.
- **Where black dots show:** the student's own Academics page (§4.9), the mentor's and HOD's student page, `get_student_dossier`, the at-risk pages and the cycle overview.
- **At-risk (since 0036):** one black dot **in the active cycle** flags the student (§4.14). The upload re-checks every student it names and returns `students_reevaluated`; the page shows "Students re-checked" and the success message ends "N student(s) re-checked against the at-risk rule." A newly flagged student's mentor gets the usual at-risk notification.

**Known issues:**

- **Upload order matters for backlogs.** The clearing pass trusts the latest file: uploading an older Defaulter Grade list after a newer one reopens what the newer one cleared.
- **A mistyped registration number clears.** In a Defaulter Grade list, a student whose registration number is wrong is "not listed", so their open backlogs in those subjects are cleared until the corrected file is uploaded. ERP exports make this unlikely; hand-edited copies do not.
- **No way to remove a black dot** from the UI; a wrongly recorded one needs SQL.
- **Misleading page copy:** the attendance page says the section is "taken from the file header". The per-row Section wins.
- **Dashboard gap:** mentor-map uploads and roster imports never appear in the dashboard's Recent uploads (they are not `academic_upload_batches`). The Academic Cycles page counts roster imports separately.
- **Dead code:** the notification type `academic_data_uploaded` is never sent; `skipped_rows` is written only by the GPA upload.

### 4.13 Rosters and mentor–mentee mapping

**Status:** Implemented.

**Where:**

- UI: `pages/clusterHead/ClusterHeadRosterPage.jsx` ("Rosters & Mentors", also a HOD's `/hod/uploads/rosters`) and `components/clusterHead/AcademicUploadPanel.jsx`. For a HOD the faculty-roster and mapping hints add that the accounts they create report to them.
- API: `api/admin/import-roster-spreadsheet.js` (rosters), `api/cluster-head/upload-academic-data.js` (`action: 'mentor-map'`). A mentor account a HOD's mapping upload creates gets that HOD's `hod_id`.
- SQL: `map_students_to_mentors`, `resolve_student_ids`, `notify_on_mentor_reassignment`; `activate_roster_students` and the cycle enrolment trigger (0036).
- Tables: `roster_import_batches`, `user_profiles`, `mentor_reassignment_log`, `academic_cycle_students`.

The page is steps 2 and 3 of an academic cycle (§4.24), and its subtitle says so ("Steps 2 and 3 of 2026–27: bring this year's students into the cycle, then map each one to their allotted mentor"), with an "Academic cycle" button back to the cycle page. It has three upload panels plus an import-history table (the caller's last 15 `roster_import_batches`, with a Cycle column). The intended order:

1. **Student roster**, posted with `{import_type: 'student', create_accounts: true, filename, file_base64}`. It creates student accounts, with the registration number as `login_id`, and **activates** students who already have one (below).
2. **Faculty roster** (optional), with `import_type: 'faculty'`. It creates faculty accounts.
3. **Mentor–mentee mapping**. The students must already exist: the mapping matches them by registration number and cannot create them.

**Roster import in detail.**

- **Access:** roles `cluster_head`, `hod` or `admin`. Rate limit: 200 requests per 300 s per user. No setup gate. Faculty accounts a HOD's import creates get `hod_id` (and `hod_email`) set to that HOD, so they appear in the HOD's portal at once (0039).
- **Body:** `import_type` (`faculty`, `student` or `combined`), `filename`, `file_base64` (at most 8,000,000 characters), `create_accounts` (default true; `false` is a dry run), `offset`, `batch_id`, `default_mentor_id`, `semester_cycle_id`. The UI never sends `combined`, `default_mentor_id` or `semester_cycle_id`.
- **Every chunk re-parses the whole file.**
  - A `combined` file needs a Role cell on every row ("A combined import needs a "Role" column saying Faculty or Student on every row…"), and faculty rows are processed first.
  - Parser limits: at most 5,000 data rows; header aliases in §10.4.
- **Per row (`planRow`), in order:**
  1. The e-mail must pass `emailSchema`, which includes the `ALLOWED_EMAIL_DOMAINS` allow-list.
  2. The name must have at least 2 characters ("Missing or too-short Name").
  3. An e-mail that already exists, **including earlier in the same file**, gets no new account. For a **student** who already has an account, the row is instead **activated in the current cycle** (reported as skipped with "Already has an account — activated in this cycle", and listed in `activated`); any other existing account is skipped ("Account already exists").
  4. For a student with a Mentor Email, that mentor must be an existing faculty account ('Mentor "X" is not a registered faculty member. Import the faculty roster first.') and must be active. Otherwise **the row fails and no account is created**.
  5. A Password cell, if present, must be at least 8 characters.
  6. `createUser` (§4.1). A rate-limit error from Auth is retried once after 1.5 s.
  7. A follow-up profile update sets `assigned_mentor_id` and, for students, `parent_name`, `parent_mobile` (10 digits only) and `parent_email`.
- **Activation of existing students** (since 0036). After the chunk's accounts are created, the API calls `activate_roster_students(p_rows)` with the service role, one row per existing student in the chunk: `{student_id, semester_label, section, branch, parent_name, parent_mobile, parent_email}`. It enrols each student in the active cycle (`activated_via = 'roster'`), then makes the file's **Semester, Section and Program** their current ones (a blank cell changes nothing) and fills parent contacts only where the profile has none. It returns `{activated, updated, cycle}`; the response carries `activated[]`, `students_updated` and `cycle`, and the panel adds an "Existing students activated" tile. This is how next year's roster moves everyone into the new cycle with their new semester and section. A failure is reported in `failed[]` and does not undo the accounts created.
- **Chunking.**
  - Accounts are created in **waves of 25, 5 concurrently** (`runPool`).
  - After each wave the server checks a **20 s time budget**, measured from after parsing. When the budget is spent it returns `next_offset`, the first row not processed.
  - The panel re-posts the same file with `offset` and the returned `batch_id` until `next_offset` is `null`. Progress reads "{done} of {total} rows done — keep this tab open."
- **History.**
  - The first chunk inserts a `roster_import_batches` row.
  - Later chunks find it by `batch_id` **and** `uploaded_by = caller`, then add their counts and append row errors (capped at 200).
  - The audit entry `admin.import_<type>_roster` is written only by the **last** chunk.
- **Response (201):** `batch_id, total_rows, offset, next_offset, processed_through, faculty_created, student_created, created[], skipped[], failed[], activated[], students_updated, cycle`.
  - `created` entries include `temporary_password` and `password_from_file`.
  - The panel merges the chunks: `failed` and `row_errors` are capped at 200 in the UI.
  - Tiles: Rows in file, Accounts created, Existing students activated (student roster), Already existed, Problems.
  - The faculty roster panel does not show the cycle line: faculty accounts belong to no cycle, though the import is still logged against it.
  - Then the **credentials panel** (§4.1).

**Mentor–mentee mapping in detail.**

- **Input:** the departmental "Mentor Mentee List", with registration number, mentor e-mail and (optional) mentor name. Other columns, such as the mentor's phone, are ignored.
- **Step 1, `createMissingMentors`** (API, service role):
  - Every mentor e-mail that passes `emailSchema` and is not an existing faculty e-mail becomes a **new faculty account**: shared temporary password, the name from the file (or the e-mail's local part), department `'IoT & IS'`, `must_change_password`.
  - Accounts are created 5 at a time. Invalid or off-domain e-mails are skipped silently. Failures go to `mentor_errors`, which the UI does not display.
- **Step 2, `map_students_to_mentors(p_rows)`** (as the user). For each row:
  1. "Each row needs a registration number and a mentor email".
  2. "No student matches this registration number. Import the student roster first." Students are resolved by `resolve_student_ids`: registration number only (since 0035; e-mail used to be accepted), active students only.
  3. 'No faculty account for "%s". Import the faculty roster first.'
  4. 'Mentor "%s" is marked %s' when the mentor is not active.
  5. If the mentor is unchanged, the row is counted as `unchanged`.
  6. Otherwise `assigned_mentor_id` is updated under the trusted-operation flag.
  7. Either way the student is enrolled in the active cycle (`activated_via = 'mentor_map'` if they were not in it yet), and the cycle's snapshot records the mentor.

  If a student appears twice, the last row wins.
- **Side effects of each real change:** the trigger `notify_on_mentor_reassignment` writes `mentor_reassignment_log` and sends `mentor_reassigned` notifications to the student ("Your faculty mentor has changed"), the new mentor ("New mentee assigned") and the old mentor, if any ("Mentee reassigned").
- **Output:** `{total_rows, matched, unchanged, failed, row_errors, mentors_created, mentor_errors}`. Tiles: Rows in file, Mapped, Mentor accounts created, Already correct, Problems.

**Edge cases:**

- **A failed mentor link during a roster import is silent.** The follow-up profile update (mentor link, parent fields) is not checked for errors, so the row is still reported as created.

- **A chunk failure loses the progress display.** When a chunk fails (a 429, a network error or a timeout), the loop stops. Results collected so far, including created credentials, are **not displayed**, and re-uploading starts again from offset 0. Already-created accounts are then skipped as existing, but their credentials are not shown again. They all share the temporary password anyway, unless the file supplied per-row passwords.
- **Mapping does not re-evaluate risk or move queries.**
- **Unaudited accounts.** Mentor accounts created by the mapping stay even if the mapping RPC then fails, and they are not audited separately. The count is in the upload's audit metadata only when the RPC succeeds.

### 4.14 At-risk detection and mentor meetings

**Status:**

- Detection: Implemented.
- Meetings: Partial. They are created, but the meeting link is a **Placeholder**.

**Where:**

- SQL: `evaluate_student_risk`, `evaluate_all_students_risk`, `dispatch_at_risk_meetings`, `create_at_risk_meeting_link`, `set_at_risk_meeting_status`, `notify_on_risk_flag_change`, `notify_on_at_risk_meeting`; the view `at_risk_student_overview`; tables `student_risk_flags` and `at_risk_meetings`.
- UI: `pages/faculty/FacultyAtRiskPage.jsx` (also `/hod/at-risk`) and `HodOperationsPage`.

**The rule** (`evaluate_student_risk`, current body in 0036, verbatim conditions). A student is **at risk if ANY one** of these holds:

| Condition | How it is computed | Test |
|---|---|---|
| Low attendance | Mean of the **latest** `attendance_percent` per course **in the active academic cycle**. The latest is by `period_start desc, created_at desc`; only courses with records count. | `v_attendance < 75` |
| Low GPA | The GPA of the **highest-numbered semester** on record, from any source (department, or a GPA a student recorded before `0037`) | `v_gpa < 6` |
| Backlog | Count of `student_backlogs` rows with `is_cleared = false`, whatever cycle they were recorded in | `v_backlogs >= 1` |
| Black dot (since 0036) | Count of `student_black_dots` rows **in the active academic cycle** | `v_black_dots >= 1` |

Attendance and black dots are per cycle; GPA and backlogs are not. A black dot cannot be cleared the way a backlog can, so counting the whole history would flag a student for the rest of their degree: it is the new cycle that lifts the flag. The reason reads "1 black dot in 2026–27".

- The function upserts `student_risk_flags`: the booleans (`has_black_dot` since 0036), the metrics (`black_dot_count`), human-readable `reasons[]` (for example "Attendance 64.00% (below 75%)"), `first_flagged_at` (never reset), `last_flagged_at`, `cleared_at` and `last_evaluated_at`.
- It runs in three places:
  1. inside the attendance, GPA, backlog and black dot upload RPCs, for every student they changed (including backlogs cleared because a Defaulter Grade list no longer marks them);
  2. in the `at_risk_sweep` job (`evaluate_all_students_risk`, HOD or no JWT; **active** students only);
  3. in `reevaluate_students_batch(p_after, p_limit)` (cluster head, HOD or no JWT), which re-checks every active student in slices of `p_limit` (default 300, at most 1,000) ordered by id and returns `{evaluated, done, total, next_after}`. The Academic Cycles page calls it in a loop right after a cycle starts, and from "Re-check now" (§4.24).

  It does **not** run on a mentor-map upload, and migration 0036 does not run it: flags evaluated before 0036 know nothing about black dots or cycles until the next upload, sweep or re-check. The Academic Cycles page counts such flags (`stale_risk_flags`, evaluated before the active cycle started) and offers "Re-check now".

**Notifications** (`notify_on_risk_flag_change`, AFTER INSERT/UPDATE on `student_risk_flags`, current body in 0036). These go **only to the mentor**; the student and the HOD are not notified.

- On a change to at-risk: `student_at_risk`, "<name> is now flagged as at-risk", with the reasons.
- On a change to not-at-risk: `at_risk_cleared`, "<name> is no longer at-risk".
- The first-ever evaluation of a student who is **not** at risk sends nothing (this was bug B2; fixed in 0036).
- While `ssmp.quiet_risk_notifications` is `on` (set by `reevaluate_students_batch` for its own transaction), "no longer at-risk" notices are **suppressed**, so starting a new cycle, which lifts every attendance and black-dot flag at once, does not send mentors hundreds of them. Newly flagged students are still notified.

**Meetings** (`at_risk_meeting_dispatch` job → `dispatch_at_risk_meetings`, HOD or no JWT):

1. For every flagged student who has a mentor and **no open meeting** (`awaiting_link` or `scheduled`), the job inserts an `at_risk_meetings` row with status `awaiting_link`, a snapshot of the reasons and metrics, and `job_run_id`.
2. It calls `create_at_risk_meeting_link`, which **does nothing yet**: a `TODO(provider)` stub that returns the row unchanged.
3. The trigger `notify_on_at_risk_meeting` sends the mentor `at_risk_meeting_required` ("Schedule a meeting with <name>") and stamps `mentor_notified_at`.
4. The job returns `{meetings_created, already_open, without_mentor}`.

**At-risk page** (mentor: own mentees; HOD: their faculty's mentees, with a Mentor column; administrator: everyone):

- **Data:** `at_risk_student_overview` where `is_at_risk`, ordered by attendance (then `student_id`), read in pages of 1,000 with `fetchAllRows` so a department-wide list is never cut at PostgREST's `max_rows` (§4.20).
- **KPIs:** Flagged, Low attendance, Low GPA, With backlogs, With black dots ("One in 2026–27 is enough to flag").
- **Columns:** Student (link to the dossier page), Registration no., Backlogs, Black dots (`black_dot_count`, this cycle's), "Flagged for" chips (Attendance, GPA, Backlog, Black dot), Parent contact, Meeting status, Actions.
  - Parent contact is `primary_parent_mobile`: the Form A father's, then the mother's, then the roster `parent_mobile`, shown as a `tel:` link.
- **Expanding a row** shows the courses below 75% (`student_attendance_overview`), the semester GPAs (`student_semester_gpas`, which RLS gates by GPA sharing) and, when there are any, "Black dots in 2026–27": the case, what it was about and the incident date, from `student_black_dots` for the active cycle.
- A banner appears when open meetings have no link.
- The only action is **"Mark done"**: `set_at_risk_meeting_status(open_meeting_id, 'completed')`, toast "Meeting with <name> marked as done." After that the row reads "Not raised yet", because the view only joins open meetings.

**Known issues:**

- **Anyone can re-evaluate anyone.** `evaluate_student_risk` has no caller check and is executable by any authenticated user, including students and cluster heads *(tested)*. It also writes: it upserts the flag row and can trigger notifications. A student could call it for any student id; the function returns that student's metrics (attendance mean, latest GPA, backlog count, reasons). See §8.9.
- **No status validation.** `set_at_risk_meeting_status` accepts any enum value, including moving backwards. The UI only offers "completed".
- **The view leaks GPA past the sharing setting.** It exposes `latest_gpa` from `student_risk_flags`, whose RLS is `can_access_student`, not `can_view_student_gpa`.
- **Stale header comment.** `FacultyAtRiskPage`'s header comment promises attendance and GPA columns that the page does not render.
- **Meetings are stranded after a mentor change.** Visibility and `set_at_risk_meeting_status` depend on the meeting's own `mentor_id`, not the student's current mentor. After a reassignment the new mentor sees "Not raised yet" and cannot mark the old meeting done, while dispatch counts it as `already_open` and never raises a new one *(tested)*.

### 4.15 Feedback survey

**Status:** Implemented.

**Where:**

- UI: `pages/student/StudentSurveyPage.jsx`, `pages/student/StudentSurveyTrackingPage.jsx`, and `pages/faculty/FacultyMenteesPage.jsx` (Survey column and KPI).
- SQL: `open_survey_cycle`, `send_survey_reminders`, `get_active_survey_for_student`, `submit_survey_response`, `get_mentor_group_survey_status`.
- Tables: `survey_questions`, `survey_cycles`, `survey_responses`, `survey_response_answers`. Views: `survey_mentee_status`, `survey_group_completion`.

**Questions.** Ten are seeded by 0023, all active, each rated **1–5** (Poor, Fair, Satisfactory, Good, Excellent):

1. How would you rate your mentor's responsiveness when you raise an academic query?
2. How effectively does your mentor resolve the academic problems or doubts you bring to them?
3. How comfortable are you in approaching your mentor with personal or non-academic concerns?
4. How would you rate your mentor's availability and accessibility whenever you need support?
5. How beneficial is the regular tracking of your academic performance by your assigned mentor?
6. How would you rate the usefulness of the guidance provided during scheduled mentor check-ins?
7. How helpful has your mentor been in guiding your academic or career-related decisions?
8. How well does the portal help you recognize measurable improvement in your own performance over time?
9. How confident are you that having an assigned mentor through the portal has positively impacted your academic journey?
10. How would you rate your overall experience using the Student Mentor Portal?

**Opening a cycle** (`survey_cycle` job → `open_survey_cycle`, HOD or no JWT):

1. Deactivate any active cycle. Only **one** cycle is active at a time.
2. Insert cycle *n+1* with `opens_on = today` and `closes_on = today + (interval_days − 1)` (15 days inclusive).
3. Notify every **active** student: `survey_published`, "Mentor feedback survey #n is open".

**Answering** (student, `/student/survey`):

- `get_active_survey_for_student()` returns `{cycle, has_submitted, submitted_at, questions}`. The page shows "No survey is open right now", "You have already filled this one in", or the form. Every question must be answered ("Please answer every question before submitting.").
- `submit_survey_response(p_cycle_id, p_answers)` checks:
  - "Survey not found";
  - "That survey cycle has closed" (the cycle is no longer active);
  - "You have already submitted this survey" (also `UNIQUE(cycle_id, student_id)`);
  - the answer count equals the number of active questions;
  - valid question numbers and ratings from 1 to 5.

  It stores the student's **current mentor id** with the response. Answers cannot be changed. Toast: "Thank you — your feedback has been recorded."

**Tracking:**

- **Star mentee (Survey Tracking).** `get_mentor_group_survey_status()` returns the group's active students with `has_submitted` and `is_me`, pending first. KPIs: Students in group, Filled in, Still pending, Completion %. The table is filterable and defaults to "Not yet filled".
- **Mentor (My Mentees).** A "Survey #N filled in x/y" KPI and a per-mentee Filled in / Pending column, from `survey_mentee_status` where `cycle_is_active`.

**Reminders** (`survey_reminder_sweep` job → `send_survey_reminders`). Only active students **without** a response in the active cycle get `survey_reminder`.

**Known issues:**

- **`closes_on` is not enforced.** A cycle stays answerable until the next cycle opens.
- **No page or report reads the answers**, and there is no HOD results or completion view.
- **The answers are not anonymous.** RLS (`survey_responses_select_scope`, `survey_answers_select_scope`, both on `can_access_student`) lets the mentor, and the HOD, read each mentee's individual ratings. Feedback about a mentor is readable by that mentor at the database level *(tested)*.
- **Unused view.** `survey_group_completion` is **Dead**.

### 4.16 Periodic jobs and the HOD Operations page

**Status:**

- Manual triggering: Implemented.
- Automatic scheduling: **Not implemented**.

**Where:**

- UI: `pages/hod/HodOperationsPage.jsx` ("Scheduled Jobs", `/hod/operations` and `/admin/operations`). The jobs are department-wide whoever runs them.
- API: `api/admin/run-cycle-job.js`.
- SQL: `run_cycle_job`, `run_all_cycle_jobs_now`, `run_due_cycle_jobs` (dead), `get_cycle_job_status`; tables `cycle_job_schedule` and `cycle_job_runs`.

**The four jobs** (`cycle_job_schedule`, seeded by 0024):

| `job_type` | Interval | What it runs |
|---|---|---|
| `survey_cycle` | 15 days | `open_survey_cycle`: closes the old cycle, opens a new one, notifies all students |
| `survey_reminder_sweep` | 7 days | `send_survey_reminders`: reminds non-responders |
| `at_risk_sweep` | 15 days | `evaluate_all_students_risk`: re-evaluates every active student |
| `at_risk_meeting_dispatch` | 15 days | `dispatch_at_risk_meetings`: raises a meeting for every flagged student without one |

**How a run works** (`run_cycle_job(p_job_type, p_trigger, p_note)`, HOD or no JWT):

1. Insert a `cycle_job_runs` row (`running`).
2. Run the job.
3. Mark the row `succeeded`, with `result` JSON and `duration_ms`.
4. Update the schedule:
   - For a **`manual`** run, set `last_run_at`, `last_run_status` and `last_manual_run_at`. **`next_run_due_on` is left alone**, so testing does not disturb the cadence.
   - For a **`scheduled`** run, set `next_run_due_on = greatest(today, next_run_due_on) + interval_days`.
5. Return `{job_type, trigger_source, run_id, status, result, schedule_advanced}`.

`is_enabled` is **ignored** by `run_cycle_job`.

**"Run all"** (`run_all_cycle_jobs_now(p_note)`) runs `at_risk_sweep`, then `at_risk_meeting_dispatch`, then `survey_cycle`, always as `manual`. It does **not** run the reminder sweep.

**UI:**

- **KPIs:** at risk, open meetings, active survey, runs logged (the last 25).
- **Four job cards,** each with interval, next due, last run, and "Run now". There is also a "Run all" button.
- **A table of the last 25 runs:** Job, Trigger, Status, What it did, Took, When.
- **Calls:**
  - GET `/api/admin/run-cycle-job` → `get_cycle_job_status()`, which returns `{jobs[], recent_runs[], active_survey_cycle, at_risk_count, open_meeting_count}`.
  - POST `{job_type, trigger_source: 'manual', note: 'Fired from the HOD operations panel'}`.
- **Toast:** "Job finished. The 15-day schedule was left unchanged."

**Known issues:**

- **Nothing runs on its own.** There is **no scheduler**: no `pg_cron`, no Vercel cron, and `run_due_cycle_jobs()` has no caller. A cron could not call the endpoint as it stands anyway, because it requires a HOD's JWT. The claims in `docs/CLUSTER-HEAD-AND-CYCLE-JOBS.md` about automatic runs are aspirational.
- **A failed run leaves no trace.** `run_cycle_job` writes `failed` and then re-raises, so the whole transaction (including the failure row) rolls back. "Run all" is all-or-nothing.
- **Stale wording.** Some copy says "15-day" for all jobs; the reminder interval is 7 days. `run-cycle-job.js` says "Three things"; there are four job types.

### 4.17 Dashboards and analytics

**Status:** Implemented. The category charts count the current categories since 0041 (§4.4).

**Where:**

- Pages: `StudentDashboardPage`, `FacultyDashboardPage`, `HodDashboardPage`, `HodFacultyPerformancePage`, `ClusterHeadDashboardPage`.
- Hook: `hooks/useDashboardMetrics.js`.
- SQL: `get_dashboard_metrics`, and the views `faculty_performance_summary`, `query_daily_trend` and `student_query_summary`.
- Charts: every "by category" chart is a `CategoryBarChart` with `allLabels`, fed by `lib/queryCategoryChart.js`: upright bars with rounded tops over dashed gridlines; the five current categories (zero bars included) and then any legacy one with queries; each category in its own colour on every page (`QUERY_CATEGORY_COLORS`: `CHART_COLORS.series` in category order, then #b45309 and #78716c for ERP/Tech and Infrastructure). Every bar keeps its name: in a panel too narrow for level names they are tilted 40° (`components/charts/categoryAxis.js`). All zero shows "No data to display yet".

**`get_dashboard_metrics()`** (SECURITY DEFINER; the only check is "Not authenticated") branches on the caller's role. All counts cover **all time**.

| Branch | Scope | Keys |
|---|---|---|
| `student` | the caller's own queries | `role`, `total_queries`, `open_queries`, `in_progress_queries`, `resolved_queries`, `awaiting_confirmation`, `unrated_resolved`, `avg_resolution_hours`, `form_a_completed`, `is_star_mentee`, `achievements_count`, `unread_notifications`; `queries_by_category` (0041, every branch: category → count over the branch's queries, current and legacy) |
| `faculty` | queries with `mentor_id = me` | the student keys that apply, plus `reopened_queries`, `avg_first_response_hours`, `avg_satisfaction`, `resolved_this_week`, `resolved_last_week` (both use `date_trunc('week', now())`), `mentee_count`, `onboarding_pending`, `star_mentee {id, name}`, `unread_notifications` |
| everything else (`else` = HOD, administrator, cluster head) | a HOD: the queries, faculty and students of the faculty mapped to them; the administrator and a cluster head: everything | `role` (`'admin'` for the administrator, otherwise `'hod'`, even for a cluster head); `coverage` (`'hod'` or `'department'`, since 0039); the faculty query keys **except** `resolved_this_week` / `resolved_last_week`; plus `academic_queries`, `erp_tech_queries`, `infrastructure_queries` (**legacy categories only**; no page reads them since 0041), `total_students`, `total_faculty`, `active_faculty`, `departed_faculty`, `unassigned_students` (always 0 for a HOD: every student in their scope has a mentor), `onboarding_pending`, `unread_notifications` |

Averages are rounded but not coalesced, so they may be `null`. **A `cluster_head` caller falls into the department branch** and receives department-wide numbers. No cluster-head page calls it, but the RPC is callable (§8.9).

**Student dashboard (`/student`):**

- Mentor card: name, e-mail, phone, faculty id; or "No mentor has been assigned to you yet…".
- A "Raise a query" button.
- A banner for queries awaiting confirmation. It counts only the **5 most recent** queries.
- KPIs: Total, Open, In progress, Avg resolution time.
- A status donut.
- "Queries by category" (was "Recent activity by category"): every one of the student's queries by category, from `queries_by_category`, so it adds up to the donut's total.
- "My recent queries": 5 rows, live.

**Faculty dashboard (`/faculty`):**

- KPIs:
  - Assigned mentees, captioned with onboarding pending;
  - Open;
  - In progress;
  - Resolved, captioned with resolved this week, plus a trend of this week minus last week.
- "My impact": average first response, average resolution, satisfaction, awaiting confirmation, reopened, star mentee.
- A resolution gauge and a status donut.
- "Load by category" (was "Recent load by category"): every query assigned to the mentor, from `queries_by_category`.
- "Needs your attention": open or reopened queries among those 8, at most 6 shown.

**HOD and administrator dashboard (`/hod`, `/admin`):**

- The same page. The administrator's figures cover the department; a HOD's cover the faculty mapped to them ("…for the faculty who report to you" in the subtitle). A HOD with nobody mapped sees an empty leaderboard reading "No faculty mapped to you yet".
- KPIs: Students (captioned with unassigned for the administrator, "Mentees of your faculty" for a HOD), Faculty mentors (active · departed), Total queries, Onboarding pending.
- An attention banner when students are unassigned or faculty have departed.
- A status donut.
- "Category load": the scope's queries by category, from `queries_by_category`.
- A resolution gauge and a service-quality list.
- A 30-day "raised" area chart from `query_daily_trend`. The chart computes "resolved" but does not draw it.
- A top-10 leaderboard from `faculty_performance_summary`, ordered by resolved. Columns: Faculty, Mentees, Queries, Resolved, Avg first response, Resolution rate, Rating.
- **Known issue.** The trend query orders by day **ascending** with `limit 400`. Once there are more than 400 (mentor, day) rows, the chart shows the **oldest** days, not the last 30. It also plots the last 30 days *that had a query*; empty days are skipped rather than shown as zero. The subtitle says "Live picture", but the page does not subscribe to changes.

**Faculty performance (`/hod/performance`, `/admin/performance`):**

- Data: `faculty_performance_summary` (all time), which RLS limits to a HOD's own faculty. Search by name.
- Sort options: resolved, total, mentees, fastest first response (a `null` is treated as 0, so faculty with no responses rank "fastest"), resolution rate, rating.
- Charts: resolved vs still active, and average first response (top 8).
- Table columns: Faculty, Branch, Status, Mentees, Queries, Resolved, Reopened, Avg first response, Avg resolution, Rate, Rating, and Report ("View" links to `<portal>/reports?faculty_id=…`; "PDF" uses the default 90-day window).

**Cluster-head dashboard (`/cluster-head`),** everything for the active academic cycle (§4.24):

- Greeting: "Welcome, Dr. Iyer" (an honorific keeps the surname; otherwise the first name).
- KPIs: Academic cycle ("2026–27", "Now: Odd semester 2026"), Subjects this cycle, Uploads this cycle (an exact count; "Uploads, Odd semester 2026" when a semester is picked), Last upload.
- Shortcuts to the four academic upload pages (attendance, GPA, backlogs, black dots).
- "My subjects · 2026–27" (`current_cycle_courses`).
- "Recent uploads": the last 10 rows of `academic_upload_history` for the cycle, narrowed by the pills Whole cycle / Odd semester 2026 / Even semester 2027, with a "Whole cycle" link to Academic Cycles. Columns: Upload (type, and what it covered: the batch's `scope_label` such as "Semesters 1, 2 + CGPA" or "2 cases", or "IT2101 · Section A" for attendance), Semester, Recorded (with "n not matched" under it), When.

**A HOD's Uploads → Overview (`/hod/uploads`)** is the same page (0039): titled "Uploads overview" instead of the greeting; "Subjects uploaded" and "Subjects uploaded · 2026–27" list the subjects the HOD's own attendance uploads in the cycle were filed under (`fetchUploadedSubjects`), with "No attendance uploaded in this cycle yet" when there are none; "Recent uploads" is filtered to the HOD's own (`uploaded_by`), since a HOD may read the department's; the shortcuts and links stay under `/hod/uploads`.

### 4.18 Reports and PDFs

**Status:** Implemented. Known issues are listed at the end.

**Where:**

- UI: `pages/faculty/FacultyActivityReportPage.jsx` (`/faculty/report`, and `/hod/reports` with `isHodView`), `pages/faculty/FacultyMenteeDetailPage.jsx` (dossier), `FacultyMenteesPage` (PDF button per mentee).
- API: `api/reports/faculty-activity-report.js`, `api/reports/student-dossier-report.js`, `api/_lib/report-document-builder.js`, `api/_lib/pdf-chart-primitives.js`; the academic cycle report is `api/reports/academic-cycle-report.js` (Excel, §4.24, §6.10).
- SQL: `get_faculty_activity_report`, `get_department_faculty_report`, `get_student_dossier`, `get_cycle_overview`.

**Faculty activity report.**

- **Range.** The last 90 days by default. Presets: 30, 90, 182, 365 days. From/To inputs are constrained so that From ≤ To ≤ today.
- **SQL:** `get_faculty_activity_report(p_faculty_id, p_from, p_to)`.
  - `p_faculty_id` defaults to the caller. Anyone but that faculty member's HOD or the administrator may only ask for themself ("You can only generate a report for your own activity").
  - The period defaults to 90 days, and `to` is inclusive.
  - **Keys:** `faculty`, `period`, `generated_at`, `summary` (includes `escalated_queries`, `rated_queries`, `resolution_rate_percent`), `by_category` (`{category, total, resolved, open}`, dynamic), `by_status`, `resolution_confirmation`, `weekly_trend`, `rating_distribution`, `mentees`.
  - Metrics are filtered by `created_at` within the period, except each mentee's `query_count`, which is all time.
- **Page:**
  - KPIs: handled, resolution rate, average first response, average resolution.
  - A category bar, a confirmation donut (Confirmed fixed / Reopened / Awaiting reply / Unresolved), and gauges for rating and for the Form A share of mentees.
  - Tables: category breakdown, and mentees (Student, Reg. no., Sec, Form A, Queries).
- **PDF (`buildFacultyActivityPdf`):**
  1. Title block.
  2. 8 KPI cards.
  3. "Query mix and resolution quality": a category bar (from `by_category`: the five current categories, then legacy ones with queries) and a confirmation donut.
  4. Weekly raised vs resolved (last 12 weeks).
  5. Satisfaction ratings.
  6. Category breakdown table.
  7. Assigned mentees, at most 60.

  Filename: `faculty-activity-report-<slug>-<from>-to-<to>.pdf`.

**All-faculty report** (HOD or administrator; the faculty picker's default, "All faculty members (consolidated)", i.e. `faculty_id=all`). Called the department report in code and file names.

- **SQL:** `get_department_faculty_report(p_from, p_to)`.
  - Check: "Only the HOD can generate a department-wide report" (any HOD, or the administrator).
  - **Coverage (0039).** The administrator's report covers the department. A HOD's covers only the faculty mapped to them, their mentees and the queries those faculty handle; `unassigned_students` is 0.
  - The department label is the caller's `department`, falling back to `'IoT & IS'`.
  - **Keys:** `scope` (always `'department'`, which is how the page tells this report from a single faculty member's), `coverage` (`'department'` or `'hod'`), `hod_name` (the HOD, for a HOD's report), `department`, `period`, `generated_at`, `summary`, `by_category`, `by_status`, `monthly_trend`, `faculty[]` (sorted by resolved).
- **Page:**
  - Subtitle "All faculty · <department>", or "Faculty reporting to you · <department>" for a HOD.
  - 8 KPIs, including Faculty, Students (captioned with unassigned, or "Mentees of your faculty" for a HOD), Satisfaction and "Referred to HOD".
  - A category bar, a status donut, monthly raised vs resolved, and load by faculty (top 8).
  - A faculty table: Faculty, Branch, Status, Mentees, Queries, Resolved, Reopened, Avg first response, Avg resolution, Rate, Rating.
- **PDF (`buildDepartmentReportPdf`):**
  1. Title block.
  2. 8 KPIs.
  3. Department query mix: a category bar (from `by_category`, as above) and a status donut.
  4. Monthly volume, last 12 months.
  5. Load by faculty.
  6. Fastest first response.
  7. All-faculty table, at most 80 rows.

  Filename: `department-activity-report-all-faculty-<from>-to-<to>.pdf`.

**Student dossier** (mentor for their mentee; the mentor's HOD; the administrator for anyone; also the student for themself at the database level).

- **SQL:** `get_student_dossier(p_student_id)`.
  - Checks: "Student not found"; "You are not this student's mentor".
  - **Keys:**
    - `student`, `mentor`, `generated_at`;
    - `form_a` (only when submitted);
    - `gpa_shared`, `semester_gpas` (with `earned_credits`, `required_credits`, `source`), `cgpa_record` (the official CGPA and totals, or null), `gpa_stats`. `gpa_stats.cgpa` is the official CGPA when one has been uploaded (`cgpa_official` true), otherwise the mean of the semester GPAs; `trend` compares the last two semesters.
    - `backlogs` (open first: subject, semester, grade, credits, exam, cleared and when) and `black_dots` (case, details, dates, block, room, course/branch, previous record), since 0035;
    - `achievements`, `achievements_by_category`;
    - `query_summary`, whose `academic`, `erp_tech` and `infrastructure` count only the legacy categories (nothing reads them; the charts count the `queries` list);
    - `queries`, `monthly_query_trend` (YYYY-MM).
- **Page** (`/faculty/mentees/:studentId`, `/hod/students/:studentId`, `/admin/students/:studentId`):
  - Header: the name; registration number, branch, section and semester label.
  - The **Academic Performance Overview** (§4.9), fed from the dossier plus a direct read of `student_attendance_overview` for the student (RLS: the mentor, their HOD or the administrator). With no GPA on record the CGPA is "—", not the dossier's `gpa_stats.cgpa` of 0. When sharing is off the GPA tile reads "Not shared" and the GPA card "GPA not shared".
  - "Mentoring record": Queries raised, Achievements, Avg resolution; "Queries by category" (bars from the dossier's query list; a donut before 0041) beside the Query history; Form A; Achievements (with Verify and Proof).
  - A star toggle for the mentor, with no confirmation dialog on this page. Verifying or starring reloads the page quietly, keeping the semester picked.
  - PDF download.
- **PDF (`buildStudentDossierPdf`):**
  1. Title block.
  2. 8 KPIs (CGPA captioned "official" when it is).
  3. Semester GPA line chart. Backlogs and black dots are **not** in the PDF.
  4. Support activity: a category bar (from the query list), a status donut and a monthly line.
  5. Query history, at most 30.
  6. Achievements, at most 25.
  7. Form A summary.

**Endpoint behaviour** (§6).

- Both endpoints: rate limit 30 per 60 s per user; the RPC runs **as the caller**. A Postgres permission error (42501) becomes 403; other errors become 400.
- The activity report requires the `faculty`, `hod` or `admin` role. The dossier has no role check; the database decides.
- The all-faculty PDF's title block reads "Faculty reporting to <HOD>" for a HOD's report, and its "Unassigned students" card becomes "Students".
- PDFs are audited (`report.faculty_activity_pdf`, `report.department_pdf`, `report.student_dossier_pdf`). JSON requests are not.
- The browser saves the file under the server's `Content-Disposition` name.

**Known issues:**

- **"Active" column always empty.** On the activity page (and "Still open" in its PDF), the category table's column reads `open_count`, but the RPC returns `open`, so the column always shows "—".
- **Months out of order.** The department report's `monthly_trend` is ordered by its "Mon YY" text, i.e. **alphabetically** (for example Aug, Jul, Oct, Sep).
- **Old name in PDFs.** PDF metadata still says "SSMP".
- **Missing-screen hints.** Hints on the reports and roster pages still say "Import the faculty roster from Semester setup". That screen no longer exists.

### 4.19 HOD faculty roster and reassignment

**Status:** Implemented. Known issues are listed at the end.

**Where:**

- UI: `pages/hod/HodFacultyRosterPage.jsx` (`/hod/roster`, `/admin/roster`). A HOD's roster is the faculty mapped to them (RLS on `faculty_reserve_pool`); the administrator's is everyone.
- API: `api/admin/manage-faculty-roster.js`.
- SQL: `set_faculty_employment_status`, `reassign_mentees`, `notify_on_mentor_reassignment`; the view `faculty_reserve_pool`; the table `mentor_reassignment_log`.

**Flow.**

1. **Roster.** GET `?action=roster` returns `faculty_reserve_pool`: each faculty member's status, availability, capacity, current mentees and remaining capacity.
   - KPIs: Faculty, Reserve pool, Departed, Mentees needing a new mentor.
   - Columns: Faculty, Faculty ID, Branch, Status, Mentees current/capacity, Accepting, Actions.
2. **Change status.** POST `{action: 'set-status', faculty_id, employment_status}` calls `set_faculty_employment_status`.
   - Check: "Only this faculty member's HOD can change their employment status" (that HOD or the administrator, 0039).
   - When `available_for_reassignment` is not sent, a non-active status forces it to `false`. When it is sent, the value is stored as given (even `departed` with `true`).
   - The response carries `mentee_count` and `needs_reassignment` (departed with mentees). The page then warns "<name> still has N mentees. Reassign them now." and opens the reassignment modal.
3. **Reassign.**
   - GET `?action=mentees&faculty_id=…` lists the mentees plus their unresolved-query counts. All are preselected.
   - The HOD picks a target from the pool, which the client computes from the roster.
   - POST `{action: 'reassign', student_ids (1–500), from_faculty_id, to_faculty_id, reason (≤500)}`:
     - **`reassign_mentees`** (as the user) runs its checks: "Only the HOD can reassign mentees"; a non-empty list of at most 500; "Target mentor not found"; "Cannot reassign students to a mentor whose status is %"; since 0039, for a HOD, "You can only move students to a faculty member who reports to you" and "Some of these students are not mentored by a faculty member who reports to you". It then updates `assigned_mentor_id`.
     - The trigger logs each change and notifies the student, the new mentor and the old mentor. The reason is written onto the log rows.
     - The API then uses the **service role** to move the students' **unresolved** queries (`status ≠ 'Resolved'`, `mentor_id = from`) to the new mentor, once it has confirmed through the caller's own token that the caller can see `from`. Resolved queries, whether awaiting confirmation or confirmed, stay with the old mentor.
     - The audit entry is `hod.reassign_mentees`, with `{student_count, moved, from, reason}`.
   - Toast: "Mentees reassigned. Everyone involved has been notified."

**Known issues:**

- **Returning faculty stay out of the pool.** Re-activating a faculty member leaves `available_for_reassignment = false`, because the UI never sends `available_for_reassignment`.
- **`reassign_mentees` checks too little.** It does not check capacity, `available_for_reassignment`, or that the students really belong to `from`, and it does not clear `is_star_mentee`.
- **A failed query handover is silent.** It is only logged to the server console; the client still sees success.
- **Unused action.** GET `?action=reserve-pool` exists but the UI never calls it.
- **Open at-risk meetings stay with the old mentor** (§4.14). A reassignment does not move them.
- **The API is not the only way in.** `reassign_mentees` is executable by the HOD directly through PostgREST, which skips the rate limit, the audit entry and the query handover (§8.9 S17).

### 4.20 HOD students directory and single-account creation

**Status:** Implemented.

**Where:** `pages/hod/HodStudentsPage.jsx` (`/hod/students`, `/admin/students`), `components/hod/AddAccountModal.jsx`, `api/admin/provision-user-accounts.js`. A HOD's directory lists the mentees of the faculty mapped to them; the administrator's lists everyone, including students without a mentor.

**Directory.**

- **Data:** every row of `student_query_summary`, read in pages of 1,000 with `lib/fetchAllRows.js` (ordered by name, then `student_id`, so no student lands on two pages; the first request asks for an exact count), plus faculty names from `user_profiles`. The table shows 50 students per page; changing a filter or the search goes back to page 1.
- **Filters:** All, No mentor, Form A pending, Active queries. Search by name, registration number or e-mail. The KPIs mirror the filters.
- **Columns:** Student (links to `<portal>/students/:id`, the dossier page in HOD mode), Reg. no., Branch, Sec, Mentor ("Unassigned" chip), Form A, Queries.

**Add account** (modal):

- **Roles:** student, faculty, cluster_head; hod for the administrator only. A HOD adding a faculty member is told "They will report to you".
- **Fields:** name, e-mail, registration number or staff id, branch, mobile (10 digits). Students also get section, semester and a mentor chosen from **active** faculty (for a HOD, their own).
- **Call:** POST `/api/admin/provision-user-accounts` with `{accounts: [one]}`, carrying `department: 'IoT & IS'` (hard-coded).
- **Output:** a credentials view with name, e-mail and the temporary password, "Copy credentials", and the note that a password change is required. If nothing was created, the first skipped or failed reason is shown as an error.

**Endpoint behaviour.**

- **Access:** HOD or administrator. Body at most 2 MB. 20 requests per 60 s.
- **Scope (0039).** A HOD's `hod` rows fail with "Only the administrator can create HOD accounts"; a student whose mentor does not report to the HOD fails with "That mentor does not report to you"; a faculty account a HOD creates gets their `hod_id` and `hod_email`. The schema does not accept `admin`.
- **Validation:** 1–500 accounts, each checked by `provisionUserSchema` (§6).
- **Existing accounts:** an existing e-mail (case-insensitive) is skipped with "An account with this email already exists".
- **Mentor:** a separate service-role update sets the mentor, which fires the reassignment notifications. If that update fails, the account is reported under `failed` but **still exists**.
- **Audit and response:** audit `admin.provision_accounts`. Response 201 `{created[], skipped[], failed[]}`. If every account failed, the response is 400 "No accounts could be created. First error: …".

**Known issue.** The duplicate-e-mail check uses `ilike`, so `_` and `%` in an address act as wildcards and can produce a false "already exists". If several rows match, `maybeSingle` errors and the check falls through to `createUser`.

**Fixed 2026-09-27: the 1,000-row cap (B11).** PostgREST returns at most `max_rows` rows per request (1,000 in `supabase/config.toml`, and Supabase's hosted default), and it does so without an error. The directory used to ask for every student in one request, so a department of 1,949 showed 1,000 students and 296 without a mentor here while the dashboard, which counts in SQL, showed 1,949 and 597. It now pages through with `fetchAllRows`, and so does the HOD's at-risk list (§4.14).

### 4.21 Notifications

**Status:** Implemented.

**Where:**

- SQL: `enqueue_notification`, the trigger functions `notify_on_*`, and the RPCs that notify directly: `escalate_query_to_hod`, `escalate_peer_query` and `set_senior_mentor_sections` (0042), `submit_mom_report`, `open_survey_cycle`, `send_survey_reminders`. The senior list script inserts one kind directly with the service role (below).
- UI: `context/NotificationProvider.jsx`, `components/layout/NotificationBell.jsx`.
- Table: `notifications`.

**Mechanism.**

- Every notification is inserted by `enqueue_notification(recipient, actor, type, title, body, query_id, link_path)`. Only definer functions can execute it.
- It **silently skips** a `NULL` recipient and a recipient who is also the actor.
- The browser only selects its own rows (RLS) and marks them read:
  - a direct `update({is_read: true, read_at})`;
  - `mark_all_notifications_read()` for all of them.
- **Bell:**
  - The last **30** notifications load on mount, and new ones arrive over realtime as toasts.
  - The unread badge counts only those 30 and shows "9+" above 9.
  - Clicking a notification marks it read and navigates to `link_path`.
  - "Mark all read" appears only when something is unread.
  - There is no delete button, although RLS allows deleting one's own notifications.

**Every notification the system sends.** Since 0042 the query triggers build their links with `query_link_for(query, recipient)`, so each link opens the recipient's own portal: `/student/queries/<id>` for the student, `/student/peer-queries/<id>` for the senior mentor a query was sent to, and `/faculty/…`, `/hod/…` or `/admin/…` by the recipient's role. "Mentor" below means the person the query was sent to, faculty or senior.

| Type | Sent by | Recipient | Title | Link |
|---|---|---|---|---|
| `query_created` | trigger on `support_queries` INSERT (skipped when `mom_id` is set) | mentor | "New <category> query from <student>" | `/faculty/queries/<id>` |
| `query_created` | `submit_mom_report` | mentor | "CR report from <rep> — n item(s) to action" | `/faculty/cr-reports` |
| `query_message` | trigger on `query_messages` INSERT (not system messages), **including the first message of every new query and of every CR-report item** | since 0042 everyone in the conversation except the sender: the student, the mentor and the faculty mentor a senior raised it to (before: a student's message went to the mentor, anyone else's to the student) | "New reply from <sender>" | the recipient's portal |
| `query_resolution_pending` | trigger on resolution change | student | "Was your issue fixed?" | `/student/queries/<id>` |
| `query_confirmed` | same trigger | mentor | "<code> confirmed as resolved" | `/faculty/queries/<id>` |
| `query_reopened` | same trigger | mentor | "<code> reopened by the student" | `/faculty/queries/<id>` |
| `query_rated` | same trigger (rating set) | mentor | "Query <code> rated n/5" | `/faculty/queries/<id>` |
| `query_escalated` | `escalate_query_to_hod` | the active HOD the query's mentor is mapped to (`hod_id`); else every active administrator. Never the caller. | "<mentor> referred <code> to you" | `/hod/queries/<id>`, or `/admin/queries/<id>` for the administrator |
| `query_escalated` | `escalate_query_to_hod` | student | "<code> has been referred to the HOD" | `/student/queries/<id>` |
| `query_escalated` | `escalate_peer_query` to the faculty mentor (0042) | the student's faculty mentor; the student | "<senior> (senior mentor) raised <code> to you" (body: the student and the reason) / "<code> has been raised to your faculty mentor" | `/faculty/queries/<id>`, `/student/queries/<id>` |
| `query_escalated` | `escalate_peer_query` to the HOD (0042) | the active HOD the student's faculty mentor is mapped to, else every active administrator; the student | "<senior> (senior mentor) escalated <code>" (body: the student and the reason) / "<code> has been escalated to the HOD" | `/hod/queries/<id>` or `/admin/queries/<id>`, `/student/queries/<id>` |
| `mentor_reassigned` | trigger on `user_profiles.assigned_mentor_id` change (also writes `mentor_reassignment_log`) | student; new mentor; old mentor | "Your faculty mentor has changed" / "New mentee assigned" / "Mentee reassigned" | `/student/profile`, `/faculty/mentees` |
| `star_mentee_assigned` | trigger on `is_star_mentee` false → true | student | "You are now the student representative" | `/student/group-queries` |
| `star_mentee_assigned` | `set_senior_mentor_sections`, when sections are added (0042) | the senior mentor | "You are a senior mentor" ("You now look after section(s) …") | `/student/senior-mentees` |
| `mentor_reassigned` | `npm run db:seniors`, when a removed senior's query moves (0042; a direct insert with the service role) | the student's faculty mentor | "<code> moved to you" | `/faculty/queries/<id>` |
| `achievement_verified` | trigger on verification false → true | student | "Achievement verified" | `/student/achievements` |
| `student_at_risk` | trigger on `student_risk_flags` | mentor | "<name> is now flagged as at-risk" | `/faculty/at-risk` |
| `at_risk_cleared` | same trigger | mentor | "<name> is no longer at-risk" (not on a first evaluation, and not during a bulk re-check; §4.14) | `/faculty/at-risk` |
| `at_risk_meeting_required` | trigger on `at_risk_meetings` INSERT | mentor | "Schedule a meeting with <name>" | `/faculty/at-risk` |
| `survey_published` | `open_survey_cycle` | every active student | "Mentor feedback survey #n is open" | `/student/survey` |
| `survey_reminder` | `send_survey_reminders` | active students who have not responded | "Reminder: survey #n is still open" | `/student/survey` |
| `counselling_request` | trigger on `counselling_requests` INSERT | mentor | "<name> has asked for <type>" ("<name> has asked to talk" for Other or no type, 0040) | `/faculty/counselling` |
| `counselling_request` | same trigger when `mentor_note` changes | student | "Your mentor has replied" | `/student/counselling` |

`onboarding_reminder`, `account_provisioned` and `academic_data_uploaded` exist in the enum and have bell icons, but **nothing sends them** (Dead).

### 4.22 Profiles and photos

**Status:** Implemented.

**Where:** `pages/student/StudentProfilePage.jsx`, `pages/faculty/FacultyProfilePage.jsx` (re-exported as `HodProfilePage` and `ClusterHeadProfilePage`), `components/ui/Avatar.jsx`, `components/ui/ProfilePhotoUploader.jsx`.

- **Student profile:**
  - Identity: name, e-mail, a "Student representative" chip, registration number, branch, section, semester, department, joined date.
  - A "My mentor" panel.
  - Contact: the e-mail is read-only; the mobile number (10 digits) is saved with a direct `user_profiles.update({phone})`, toast "Contact details updated."
  - A "Change password" link.
  - The Form A view/edit panel (§4.3).
  - The photo, read-only.
- **Faculty, HOD, administrator and cluster-head profile:**
  - Read-only identity: staff id, branch, department, joined date; faculty also see capacity and availability.
  - An editable phone.
  - A "Change password" link.
  - The avatar is shown but there is **no upload control**. Staff can only have a photo if one is set outside the UI.
- **Avatars** are private objects shown through signed URLs (1 hour), cached per path. With no photo, a neutral silhouette is shown (never initials). Any signed-in user may read any profile photo (bucket policy `profile_photos_select_any`).

### 4.23 Audit log and rate limiting

**Status:** Implemented.

**Where:** `api/_lib/request-guards.js`; SQL `consume_rate_limit`, `write_audit_entry`; tables `api_rate_limits`, `audit_log`.

**Rate limiting.**

- Rate limiting is **fixed-window** and backed by Postgres, so it holds across serverless instances.
- `enforceRateLimit(ctx, {key, max, windowSeconds})` calls `consume_rate_limit('<key>:<profileId>', max, window)` with the service role.
- The function upserts a counter for the window starting at `floor(epoch / window) * window` and returns `count <= max`.
- With 1% probability it also deletes rows older than a day.
- When the limit is exceeded the API returns 429 "Too many requests. Please wait N seconds and try again."
- If the limiter itself errors, the request is **allowed** (fail open).

**Limits:**

| Bucket | Limit |
|---|---|
| `provision-accounts` | 20 / 60 s |
| `roster-import` | 200 / 300 s |
| `faculty-roster:<action>` (POST only) | 60 / 60 s |
| `cycle-job` (POST only) | 40 / 300 s |
| `academic-upload` | 30 / 300 s |
| `faculty-report` | 30 / 60 s |
| `student-report` | 30 / 60 s |
| `cycle-report` | 20 / 60 s |

**Audit.**

- `recordAuditEntry` calls `write_audit_entry(actor, action, entity_type, entity_id, metadata, ip, user_agent)`.
- It is executable **only by `service_role`**, so clients cannot forge entries.
- It never blocks the request: a failure is logged and ignored.
- `audit_log` is append-only, and since 0039 only the administrator can read it (RLS `audit_log_admin_select`). It used to be every HOD.
- There is **no UI** that shows the audit log.

**Actions written:**

- `admin.provision_accounts`
- `admin.import_<type>_roster`
- `admin.upload_hod_map` (the mentor–HOD mapping, §4.25)
- `hod.set_faculty_status`
- `hod.reassign_mentees`
- `hod.run_cycle_job`
- `cluster_head.upload_<action>`
- `report.faculty_activity_pdf`, `report.department_pdf`, `report.student_dossier_pdf`, `report.academic_cycle_xlsx`
- From SQL (written by the definer functions themselves): `academic_cycle.create`, `academic_cycle.update_dates`, `academic_cycle.delete`

### 4.24 Academic cycles

**Status:** Implemented (2026-09-28, migration `0036`).

**Where:**

- UI: `pages/clusterHead/ClusterHeadCyclesPage.jsx` ("Academic Cycles", `/cluster-head/cycles`, second in the cluster-head sidebar), `components/clusterHead/cycles/CycleModules.jsx` and `CycleDialogs.jsx`, `hooks/useActiveCycle.js`, `lib/academicCycles.js`. The dashboard, My Subjects, the four upload pages and Rosters & Mentors all read the active cycle.
- API: `api/reports/academic-cycle-report.js` (§6.10).
- SQL: tables `academic_cycles` and `academic_cycle_students`; enum `semester_term` (`Odd`, `Even`); views `current_cycle_courses` and `academic_upload_history`; functions `active_cycle_id`, `cycle_semester_on`, `semester_term_of_number`, `cycle_containing`, `create_academic_cycle`, `update_academic_cycle_dates`, `delete_academic_cycle`, `list_academic_cycles`, `get_cycle_overview`, `carry_over_cycle_students`, `activate_roster_students`, `enroll_student_in_cycle`, `reevaluate_students_batch`; the `cycle_id` triggers.

**The model.**

```
Cycle 2026–27                          one academic year; exactly one cycle is active
├── Odd semester 2026    1 Jul 2026 – 31 Dec 2026
└── Even semester 2027   1 Jan 2027 – 30 Jun 2027

Programme semester 1–8                 a student's own semester ("3rd Semester"), on the profile
```

- **A cycle is not a semester.** Its two semesters are date ranges inside it: odd from `starts_on`, even from `even_starts_on` to `ends_on`. They are called "Odd semester 2026" and "Even semester 2027" so they can never be mistaken for a student's programme semester.
- `academic_cycles` holds one row per year: `start_year`, a generated `label` ("2026-27", shown as "2026–27"), the three dates, `is_active` (a partial unique index allows exactly one), `activated_at`, `closed_at`, `created_by`. The dates must be in order (odd start < even start ≤ end) and fall within a year either side of the label. Every signed-in user can read the table; only the cycle functions write it.
- **The first cycle** is created by the migration from the date it runs (July starts an academic year, so applying it in September 2026 makes 2026–27) with the default dates 1 July, 1 January and 30 June, and **everything already in the database is filed under it**.
- **What carries a cycle.** `cycle_id` is set by `BEFORE INSERT` triggers and was backfilled by the migration:

  | Table | Its cycle |
  |---|---|
  | `academic_upload_batches`, `cluster_head_courses` | the active cycle (required) |
  | `roster_import_batches`, `at_risk_meetings` | the active cycle (optional) |
  | `student_attendance_records` | its subject's cycle |
  | `student_backlogs` | the cycle it was first recorded in |
  | `student_black_dots` | the cycle its incident date falls in; the active one when the notice has no date or no cycle covers it |

- **Which semester** a row is in is never stored. It is worked out from the row's own date against the cycle's `even_starts_on` each time it is read, so correcting a cycle's dates re-files everything at once:

  | Row | Filed by |
  |---|---|
  | Attendance | its period's end date |
  | Backlogs | the programme semester's parity: 1, 3, 5, 7 → odd; 2, 4, 6, 8 → even |
  | Black dots | the incident date, or the upload date when the notice gives none |
  | GPA uploads, roster imports, anything else | the upload date, in India time |

- **Per cycle, and what carries on:**
  - **Subjects** are copied into each new cycle (§4.11), so next year's edits never touch last year's list or the attendance recorded against it.
  - **Attendance** on every screen, and in the at-risk rule, is the active cycle's (`student_attendance_overview` is filtered to it). Last year's stays in the database and in that cycle's report.
  - **Students.** `academic_cycle_students` is each cycle's own list, with a snapshot of the semester, section, branch and mentor the student had in it, and how they joined (`activated_via`: `existing` from the migration, `account`, `roster`, `mentor_map`, `carried_over` or `profile`). The trigger `sync_student_cycle_enrollment` on `user_profiles` enrols new students and keeps the **active** cycle's snapshot in step with profile changes; a closed cycle's rows are never touched. RLS: `can_access_student` (the student, their mentor, the mentor's HOD, the administrator); cluster heads see counts only.
  - **Black dots** count towards the at-risk rule only in their own cycle (§4.14).
  - **GPA and open backlogs** are not per cycle: a GPA belongs to a programme semester, and an uncleared backlog from last year is still owed this year.

**The Academic Cycles page** (cluster head at `/cluster-head/cycles`; a HOD at `/hod/uploads/cycles` since 0039, with the same department-wide view; the administrator can call every function but has no screen for it):

- **Header:** "Academic cycles", with **Download report** and **Start next cycle**.
- **What is shown:** a cycle select (every cycle, marked "(active)" or "(closed)") and the semester pills Whole cycle / Odd semester 2026 / Even semester 2027. The semester narrows every module except Students, which belongs to the whole cycle.
- **The cycle card:** the label with Active or Closed, its dates, when it started or closed, **Edit dates**, and the two semester cards with a "Now" chip on the one today falls in. A closed cycle adds "A closed cycle is kept exactly as it was. Uploads go into 2027–28."
- **Stale flags:** when at-risk flags were last evaluated before the active cycle started, a banner ("At-risk flags for n students were last checked before 2026–27 started, so they may still count last year's attendance or black dots.") offers **Re-check now**.
- **The year's workflow** (active cycle only). Five steps, each marked done, needs attention or to do:
  1. **Create the cycle.**
  2. **Import or activate students:** "Import roster", and "Carry over n from 2025–26" while the previous cycle has students this one lacks.
  3. **Assign mentors:** "n of m have a mentor; k still need one", "Upload mapping".
  4. **Track data:** the upload count, with links to the four upload pages.
  5. **Generate the report:** "Download .xlsx".
- **Module tabs**, each with a count:
  - **Students:** in the cycle, with and without a mentor, mentors; how they joined; by semester, section and branch; mentor workload.
  - **Attendance:** per semester, the average, students below 75%, subjects and sections; then by subject.
  - **GPA:** uploads, rows recorded, the last upload and what the files covered. No values.
  - **Backlogs:** recorded, open, cleared, students with one open; by programme semester (with the semester it is filed under); the subjects with the most open backlogs.
  - **Black dots:** count, students, cases; the case list with incident date and semester.
  - **Uploads:** counts by type, roster imports, and the list (Upload, Semester, File, Recorded, When and who).
  - Long lists show 10 rows and "Show all".
- **All cycles:** every cycle with its dates, students, uploads and roster imports; **View**, and **Remove** while a cycle has nothing uploaded into it.
- **Privacy.** Everything comes from `get_cycle_overview`: counts and averages, mentor names, case numbers and subject codes, but **no student is named**, and there are no GPA values or at-risk flags, which a cluster head cannot read.

**Starting the next cycle.** The dialog offers the year after the latest cycle and the one after that, with the default dates (each can be changed), explains what happens, and needs the box "I understand that uploads will go into 2027–28 from now on" ticked. `create_academic_cycle(p_start_year, p_starts_on, p_even_starts_on, p_ends_on)`:

- **Checks:** "Only a cluster head or the HOD can start an academic cycle"; "The 2027-28 cycle already exists"; "A new cycle has to come after the latest one (2027-28)"; the date checks ("The dates are out of order: the odd semester starts, then the even semester, then the cycle ends", "The dates have to fall around 2027-28"). The page runs the same date checks first (`validateCycleDates`).
- **Writes:** closes the active cycle (`closed_at`), creates and activates the new one, copies every cluster head's subjects into it, and writes the audit entry `academic_cycle.create`.
- **Returns** `{cycle, previous, subjects_copied}`.
- The page then re-checks every student's at-risk flags with `reevaluate_students_batch` in slices of 300, showing "Re-checking at-risk flags: n of m students...". Last year's attendance and black dots stop counting, and those flags lift without a "no longer at-risk" notice to every mentor (§4.14). Toast: "2027–28 has started. 6 subject(s) copied across. Next: import the student roster or carry students over."

**Bringing students in.** A new cycle starts with no students, apart from accounts created after it started and students whose semester, section, branch or mentor is changed after it started (`profile`). Three ways fill it, in any combination:

- **The student roster** (§4.13): new accounts are enrolled as they are created (`account`), and students who already have one are **activated** (`roster`), with the file's semester, section and programme becoming their current ones.
- **Carry over:** `carry_over_cycle_students(p_from_cycle_id)` enrols every active student of the earlier cycle with their current profile values (`carried_over`) and returns `{carried_over}`. It changes no profile, so semesters stay as they were until a roster or a profile edit moves them.
- **The mentor mapping** enrols anyone it matches (`mentor_map`) and records their mentor for the cycle.

**Correcting and undoing.**

- **Edit dates:** `update_academic_cycle_dates(p_cycle_id, p_starts_on, p_even_starts_on, p_ends_on)`, the same date checks, audit `academic_cycle.update_dates`. It moves nothing: which semester each row is in is recomputed on read. Toast: "Dates saved. Uploads are re-filed under the semesters the new dates give them."
- **Remove:** `delete_academic_cycle(p_cycle_id)`, only while the cycle has no uploads, roster imports, attendance, backlogs or black dots ("2027–28 already has uploads or roster imports in it, so it cannot be removed"), and never the only cycle ("This is the only cycle. The portal always needs one"). Its copied subjects and its student list go with it. Removing the active cycle re-activates the latest remaining one, and the page re-checks the at-risk flags. Audit `academic_cycle.delete`. This is the undo for a cycle started by mistake.

**Reading.**

- `list_academic_cycles()`: every cycle, newest first, with `students`, `uploads`, `roster_imports`, `can_delete` and `current_semester`.
- `get_cycle_overview(p_cycle_id default null, p_semester default null)`: one cycle (the active one by default), whole or one semester, as `{cycle (with current_semester), previous_cycle, semester, students, mentors, uploads, roster_imports, attendance, gpa, backlogs, black_dots, stale_risk_flags, generated_at}`. Cluster head, HOD or no JWT.
- `current_cycle_courses` (the active cycle's subjects) and `academic_upload_history` (`academic_upload_batches` with the cycle label, the semester each upload is filed under, and the subject code) are `security_invoker` views.
- `useActiveCycle()` reads the active cycle once per page session; `refreshActiveCycle()` re-reads it after a change.

**The cycle report** (`GET /api/reports/academic-cycle-report?cycle_id=&semester=`, §6.10): an Excel workbook with the sheets Summary, Students, Mentors, Attendance, Backlogs, Black dots and Uploads, for the whole cycle or one semester. It has the same numbers as the page, because both come from `get_cycle_overview`. File name `cycle-report-2026-27.xlsx` or `cycle-report-2026-27-odd-semester.xlsx`.

**Performance** (measured on Postgres 16 with 1,949 students, 60 mentors, 11,694 attendance rows and 52 uploads): `get_cycle_overview` about 130 ms for a whole cycle; `reevaluate_students_batch` under 30 ms per slice of 300 (7 calls for everyone); `create_academic_cycle` 6 ms; `carry_over_cycle_students` 40 ms; `activate_roster_students` with 1,949 rows 0.8 s. All are far inside Supabase's 8-second statement timeout for signed-in users.

**Known issues and limits:**

- **Any cluster head can start the next cycle for everyone.** A cycle is department-wide. The dialog's tick box, and Remove while nothing has been uploaded, are the safety net.
- **A backlog is filed under the cycle it was first recorded in**, which is when the result was uploaded, not the year of the exam. Last year's results uploaded after the new cycle starts land in the new cycle (as an odd or even semester by parity). They still count towards the at-risk rule either way, because backlogs are not per cycle.
- **Legacy `semester_cycles`** (0006, the retired semester-setup wizard) is unrelated and unused; `roster_import_batches.semester_cycle_id` is no longer written. "Cycle" in `cycle_job_*` and `survey_cycles` means the 15-day job cycle and the survey round, not an academic cycle (Appendix E).

### 4.25 The administrator portal, the mentor–HOD mapping and HOD scope

**Status:** Implemented (migrations `0038`–`0039`, 2026-10-07).

**Where:**

- SQL: `0038_admin_role.sql` (the enum value), `0039_admin_portal_and_hod_scoping.sql` (everything else).
- API: `api/cluster-head/upload-academic-data.js` (`action: 'hod-map'`), and the role checks of every `api/admin/*` and `api/reports/*` endpoint.
- Parser: `parseHodMappingFile`, `normaliseMappingSection` in `api/_lib/spreadsheet-parser.js` (§10.4).
- UI: `pages/admin/AdminHodMappingPage.jsx` (`/admin/upload`); the department screens under `/admin/*`; the HOD's Uploads group (`/hod/uploads/*`); `lib/portalPaths.js`, `hooks/usePortalPaths.js`, `lib/uploadedSubjects.js`; `SidebarNavigation` groups.
- Scripts: `supabase/scripts/create-admin-account.mjs` (`npm run db:admin`), `supabase/scripts/make-administrator.mjs`.

**Why.** The department has several HODs, and each oversees a set of mentors and class coordinators. Before 0039 the one `hod` role saw everyone. Now:

| | Administrator (`admin`) | HOD (`hod`) | Cluster head |
|---|---|---|---|
| Portal | `/admin`: the department screens of the old HOD portal, unchanged, plus **Upload** | `/hod`: the same department screens, plus **Uploads** (a dropdown group) | `/cluster-head`, unchanged |
| Faculty and students seen | everyone, including unmapped faculty and students without a mentor | the faculty mapped to them (`hod_id`) and those faculty's mentees | none (as before) |
| Queries, MoMs, at-risk meetings, reassignment log | all | those of their faculty (`mentor_id`) | none |
| Reports, dashboard, performance | department-wide | their faculty (`coverage: 'hod'`) | — |
| Uploads, academic cycles, cycle jobs, roster imports, upload history | through the API and Scheduled Jobs (no upload screens) | yes, department-wide, from Uploads | yes |
| Mentor–HOD mapping upload | **yes, only them** | no | no |
| Audit log (RLS) | yes | no | no |
| Create HOD accounts | yes | no | no |

**The mapping (data).** Three columns on `user_profiles`, all protected:

- `hod_id` (FK to `user_profiles`, `ON DELETE SET NULL`, indexed): the HOD this faculty member reports to. It decides everything a HOD sees.
- `mentor_section` ("A 3") and `mentor_designation` ("Mentor" or "Class Coordinator (fallback)"), shown on the Upload page.
- Constraints: only a `faculty` row may carry them (`user_profiles_hod_mapping_faculty_only`); `hod_id <> id`; lengths 40 and 80.
- `hod_email` (0030) is kept in step: the mapping writes the HOD's own address there.
- **Existing data:** migration 0039 maps every faculty member whose `hod_email` matches a HOD to that HOD, so a department with one HOD keeps working before the first upload.
- `hod_id` is also set when a HOD creates a faculty account (Add account, faculty roster, or a mentor created by their mentor–mentee mapping upload), and once by an unmapped mentor naming their HOD (§4.5). After that only the administrator changes it, by uploading the sheet again or by a direct update.

**Scope helpers** (SECURITY DEFINER, `search_path = public, pg_temp`):

| Function | Returns |
|---|---|
| `is_admin()` | the caller is an active administrator |
| `is_hod()` | the caller is an active HOD **or the administrator** (redefined). Used for department-level permissions only. |
| `my_overseen_faculty()` | `uuid[]` of the faculty whose `hod_id` is the caller, if the caller is an active HOD; empty otherwise (the administrator gets through by `is_admin()`) |
| `oversees_faculty(id)` | the administrator, or the active HOD that faculty member is mapped to |
| `oversees_student(id)` | the administrator, or the active HOD of that student's mentor |

`can_access_student` is now self, mentor or `oversees_student`; `can_access_query` is student, mentor or `oversees_faculty(mentor_id)`; `can_view_student_gpa` lets `oversees_student` through before the sharing flag. Every table whose policy calls them (attendance, sections, GPA, CGPA, backlogs, black dots, risk flags, Form A, achievements, surveys, cycle students, query messages) is scoped with no policy of its own changing.

**Policies replaced** (the department-level ones on upload batches, subjects, cycles, job runs, roster imports, semester cycles, canned replies and the `roster-imports` bucket keep `is_hod()`):

- `user_profiles`: `profiles_select_hod_all` → `profiles_select_hod_scope` (administrator; or the row is one of the caller's faculty, or their mentee); new `profiles_select_staff_directory` (HOD-level callers see every HOD, cluster head and administrator: names on upload history); `profiles_select_faculty_roster` now faculty or administrator; `profiles_update_hod` scoped like the select, in both `USING` and `WITH CHECK`.
- `support_queries` (`queries_select_participants`, `queries_update_hod`), `at_risk_meetings` (`meetings_select_visible`, `meetings_update_mentor`), `mom_records` (`mom_select_participants`): the HOD part is now "administrator, or `mentor_id` is one of my faculty".
- `mentor_reassignment_log` (`reassignment_log_hod_select`): either end of the move is one of my faculty.
- `student_form_a_profiles` (`form_a_update_hod`): `oversees_student(student_id)`.
- `audit_log`: `audit_log_hod_select` → `audit_log_admin_select` (administrator only).
- The array is read as `(select my_overseen_faculty())::uuid[]`, which Postgres evaluates once per statement.

**Functions whose checks changed** (bodies otherwise unchanged): `get_student_dossier`, `get_faculty_activity_report`, `post_query_message` (the administrator also counts as staff for the first response), `resolve_support_query`, `set_query_in_progress`, `set_achievement_verification`, `set_at_risk_meeting_status`, `create_at_risk_meeting_link`, `set_star_mentee`, `unlock_student_form_a` ("Only this student's HOD can unlock a submitted Form A"), `set_faculty_employment_status`, `reassign_mentees` (both ends in scope), `escalate_query_to_hod` (routing, §4.5), `get_dashboard_metrics` and `get_department_faculty_report` (`coverage`, §4.17, §4.18), `set_mentor_department_and_hod` (§4.5).

**Protected columns** (`guard_protected_profile_columns`). The administrator, the service role and trusted functions may change anything. Nobody else may change `hod_id`, `mentor_section`, `mentor_designation`, or the `hod_email` of a mapped mentor ("Not permitted: the mentor-HOD mapping is managed by the administrator"). A HOD may still change the other protected columns of the people they can update, but not grant or remove the `hod` or `admin` role, their own included ("Not permitted: only the administrator can grant or remove the HOD or administrator role").

**The Upload page** (`/admin/upload`, "Upload" in the administrator's sidebar):

1. **Input.** The department's *Mentor – Section – Email* sheet (`.xlsx` or `.csv`): Section, Mentor / Class Coordinator Name, Role, Official Email, and the HOD's name and Official Email. The real sheet heads the HOD columns "Cluster Head"; "HOD" and "Head of Department" work too (§10.4).
2. **API** (`upload-academic-data`, `action: 'hod-map'`, administrator only, else 403):
   - parses the sheet (`parseHodMappingFile`): headers recognised by meaning, sections normalised ("O3" → "O 3"), names tidied, e-mails lower-cased, blank rows skipped;
   - creates every account the sheet names that does not exist yet: HOD e-mails as `hod`, mentor e-mails as `faculty`, on the temporary password, with `must_change_password` (a person named as a HOD anywhere in the sheet is created as a HOD). An address outside the allowed domains is reported, not created;
   - calls `map_faculty_to_hods(p_rows)` **as the administrator**;
   - audits `admin.upload_hod_map` with the counts and the accounts created;
   - answers "N mentor(s) mapped across H HOD(s). … were already correct. … account(s) created — they sign in with the temporary password. … existing account(s) became HOD. … row(s) could not be mapped." with the RPC's result plus `hod_accounts_created`, `faculty_accounts_created` and `account_errors`.
3. **`map_faculty_to_hods(p_rows)`** (administrator or no JWT; at most 5,000 rows), per row:
   - "No mentor email in this row", "No HOD email in this row", "The mentor and the HOD are the same person";
   - the HOD account: missing → "No account has this HOD email"; a **cluster head**, or a **faculty member with no mentees**, becomes a HOD (counted in `promoted_to_hod`; their uploads and subjects stay theirs); a faculty member with mentees → "This HOD is a faculty mentor with N mentee(s). Move them to another mentor first."; any other role → "This HOD email belongs to an account with the <role> role"; deactivated → "This HOD's account is deactivated";
   - the mentor account: missing → "No account has this mentor email"; not faculty → "This mentor email belongs to an account with the <role> role, not a faculty member";
   - otherwise sets `hod_id`, `hod_email`, `mentor_section`, `mentor_designation` (counted as `mapped`, or `unchanged` when nothing differs). A mentor named twice ends on the last row. **Mentors the sheet does not mention keep their mapping**, so a sheet for a few sections can be uploaded on its own.
   - Returns `{total_rows, mapped, unchanged, failed, hods, promoted_to_hod, row_errors[{row, identifier, reason}]}`.
4. **Page.** The upload panel (no cycle line; tiles Rows in file, Mapped, Already correct, HODs, Not mapped; the row problems table), "Accounts that could not be created" when there are any, "How the mapping works", three KPIs (HODs, Faculty mapped, Not mapped "Seen only by you"), and **Current mapping**: every faculty member with section, name and e-mail, role and HOD, sorted by HOD then section, 25 per page, with a pill per HOD (and "Not mapped") and the top-bar search.

**The HOD's Uploads** (sidebar group before My Profile, open while on one of its pages):

| Entry | Route | Page |
|---|---|---|
| Overview | `/hod/uploads` | `ClusterHeadDashboardPage`: "Uploads overview"; "Subjects uploaded" (the subjects their attendance uploads in the active cycle were filed under, `fetchUploadedSubjects`); their own recent uploads |
| Academic Cycles | `/hod/uploads/cycles` | `ClusterHeadCyclesPage`, unchanged and department-wide |
| Upload Attendance | `/hod/uploads/attendance` | no subject gate; "Subjects you have uploaded this cycle"; "(new subject)" after an upload that created one; the matching help says the subject comes from the file |
| Upload GPA / Backlogs / Black dot | `/hod/uploads/gpa`, `/backlogs`, `/black-dots` | unchanged |
| Rosters & Mentors | `/hod/uploads/rosters` | unchanged, except that the accounts a HOD creates report to them |

There is no setup form, no My Subjects and no second My Profile. The cluster head portal itself is unchanged. Links inside these pages follow the portal they were opened from (`usePortalPaths`), and a cluster head never reaches `/hod/uploads` (or a HOD `/cluster-head`): `RequireRole` sends each to their own home.

**The administrator account.** `npm run db:admin` creates `smp.admin@jaipur.manipal.edu` ("SMP Admin", override with `SSMP_ADMIN_EMAIL`) on the shared temporary password (`SSMP_TEMPORARY_PASSWORD`), forced to change at first sign-in. Supabase Auth files the new account as a student (§4.1), so the script then makes it the administrator itself (`makeAdministrator`). If the address already has an account:

| Existing account | What `db:admin` does |
|---|---|
| The administrator | Nothing ("already the administrator") |
| A student whose auth `user_metadata.role` is `admin` (one this script or the seed made, left as a student by an earlier version or an interrupted run) | Finishes it: "Finished setting up the administrator" |
| Faculty, a HOD or a cluster head with no mentees | Makes it the administrator; its mapping columns are cleared |
| Faculty with mentees | Refuses: "… mentors N student(s). Move them to another mentor first." |
| Any other student | Refuses: "… belongs to a student. Set SSMP_ADMIN_EMAIL to another address." |

The demo seeds create the same account on the seed password (Appendix D); `db:seed` makes it the administrator the same way.

**Deployment order.** Apply `0038` and `0039` as separate transactions (`supabase db push` does), run `npm run db:admin`, sign in as the administrator and upload the mapping. Until then each HOD sees only the faculty whose `hod_email` already named them.

**Known limitations:**

- **Unmapping is not in the sheet.** Removing a mentor from the sheet leaves them with their HOD; move them by uploading a row with the new HOD, or clear `hod_id` by SQL.
- **Students without a mentor, and faculty nobody has mapped, are the administrator's alone.** A HOD's dashboard therefore always shows 0 unassigned students.
- **A HOD's uploads and academic cycles are department-wide**, the same as a cluster head's: a HOD's upload can touch students outside their faculty, and the cycle overview and report name every student.
- **Changing a HOD's role away from `hod`** leaves their faculty's `hod_id` pointing at them; those faculty are then seen only by the administrator until remapped.
- The `admin` role has no upload screens of its own (the API accepts its uploads); the department's uploads are made by HODs and cluster heads.


### 4.26 Senior mentors (migration 0042)

**Status:** Implemented 2026-10-22.

Every student can have two mentors: their **faculty mentor**, as before, and a **senior (or alumni) mentor**. A senior mentor is an ordinary student account with a flag: they keep the whole student portal (their own Form A, photo, queries, academics, survey and counselling, with their own mentors), and the portal adds the pages they need to mentor their juniors.

**Where:**

- SQL (0042): `user_profiles.is_senior_mentor`; tables `senior_mentor_sections` and `query_escalations`; `support_queries.mentor_kind`, `referred_to_faculty`, `referred_at`, `escalation_source`; functions `normalise_section`, `student_section_code`, `senior_mentor_of`, `is_senior_mentor`, `can_handle_query`, `query_link_for`, `create_support_query`, `escalate_peer_query`, `escalate_query_to_hod`, `get_my_senior_mentor`, `get_query_people`, `get_peer_queries`, `get_my_senior_mentees`, `get_raised_queries`, `list_senior_mentors`, `set_senior_mentor_sections`.
- Script: `supabase/scripts/sync-senior-mentors.mjs` (`npm run db:seniors`), the list `supabase/senior-mentors.txt` (gitignored; format in `senior-mentors.example.txt`).
- UI:
  - student: `CreateQueryModal` (Send to), `StudentDashboardPage` (My Senior Mentor), `StudentQueriesPage`, `StudentQueryDetailPage`;
  - senior: `SeniorPeerQueriesPage`, `SeniorPeerQueryDetailPage`, `SeniorMenteesPage`, guarded by `RequireSeniorMentor`;
  - faculty: `RaisedQueriesPage` (Raised to Me), `FacultyQueryDetailPage`;
  - HOD and administrator: `RaisedQueriesPage isHodView` (Raised to HOD), `HodSeniorMentorsPage` with `SectionMultiSelect`;
  - shared: `MentorKindBadge`, `EscalationBadges`, `RaisedByBadge` (`StatusBadge.jsx`), `EscalationHistory`; `MENTOR_KIND_LABELS`, `RAISED_BY_LABELS`, `SENIOR_SECTIONS` (`constants.js`).

**Who is a senior: the senior list.** The administrator keeps one e-mail per line in `supabase/senior-mentors.txt` (optionally `email, Full Name`; `#` starts a comment) and runs `npm run db:seniors` (`npm run db:seniors -- --dry-run` shows the changes without making them; `-- --allow-empty` lets an empty list remove every senior). The script needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, reads `SSMP_SENIOR_LIST` instead of the default file when set, and makes Supabase match the list:

| Situation | What the script does |
|---|---|
| A listed e-mail has no account | Creates it with the Auth Admin API: a **student** on the shared temporary password (`env.TEMPORARY_PASSWORD`, §4.1) with `must_change_password`, the name from the list (else the part of the e-mail before the @), `app_metadata.created_by = 'senior-list'`; then sets `is_senior_mentor`. They complete Form A and the photo like any student. |
| A listed e-mail is an existing student | Sets `is_senior_mentor`; nothing else changes. |
| A listed e-mail is a staff account | Refused: "<e-mail>: is a <role> account; a senior mentor must be a student account. Skipped." |
| A senior is no longer listed | Moves **all** their peer queries to each student's faculty mentor (`mentor_kind = 'faculty'`, a system message "<senior> is no longer a senior mentor, so this query has moved to the faculty mentor, <name>.", a `mentor_reassigned` notification to that faculty member), deletes their sections, then **deletes the account if the list created it**; an account that existed before (a student already in the portal) is kept and only loses the flag. |
| A removed senior has a query from a student with no faculty mentor | Nothing moves and the senior stays a senior; the script reports it ("! …: 1 of their queries is from students with no faculty mentor, so it cannot move. Kept as a senior; …"). |
| Bad lines | Reported by line number ("\"not-an-email\" is not an e-mail address", "listed twice; the first one is used") and skipped. While any line is not an e-mail address **nobody is removed** ("… so nobody is removed this time. Fix the lines marked ! and run this again."), since a mistyped line may be a senior who should stay. |
| The list is empty but seniors exist | Nobody is removed ("The list is empty, which would remove all N senior mentors. …") unless the run has `-- --allow-empty`. |

It is safe to re-run; it prints one line per change and a summary ("1 created, 1 made senior, … 1 deleted, …"). On a database without 0042 it stops with "Apply migration 0042 first". A missing list file stops it with instructions to copy the example.

The flag is a protected column (`guard_protected_profile_columns`): only the service role (the script), a trusted function or the administrator can change it ("Not permitted: senior mentors are set from the senior mentor list by the administrator"); a HOD cannot. The constraint `user_profiles_senior_is_student` keeps it on student accounts only.

**Sections: whose senior they are.**

- The department's sections are **A3, A4, B3, B4, … T3, T4** (40; `SENIOR_SECTIONS`). They are stored as the mentor–HOD mapping writes sections, `"A 3"` (`normalise_section` turns "A3", "a 3" or "A-3" into that).
- The HOD (or the administrator) assigns them on **Senior Mentors** (`/hod/seniors`, `/admin/seniors`): every senior is listed with their e-mail, assigned sections, number of mentees, open peer queries and how often they asked for help. The **star** opens a modal with a dropdown of the 40 sections as ticks (one or several); a section another senior already has is disabled and shows their name. "Save sections" calls `set_senior_mentor_sections(p_senior_id, p_sections)`, which replaces the senior's whole set. The star is filled when the senior has sections.
- **One senior per section** (the section is the table's primary key): "A3 already has a senior mentor (<name>). Remove it there first." Other refusals: "U 3 is not one of the sections A3 to T4", "That account is not a senior mentor", "Only a HOD or the administrator can assign senior mentors".
- A senior given new sections is notified ("You are a senior mentor", "You now look after sections A3, B3. Their queries to you appear under Peer Queries.", type `star_mentee_assigned`, link `/student/senior-mentees`).
- **A student's section** (`student_section_code`) is their **faculty mentor's section from the mentor–HOD mapping** (`mentor_section`, §4.25), else their own roster section when it is written the same way ("C4"). A student's senior (`senior_mentor_of`) is the active senior of that section, never the student themselves. No section, or no senior for it: the student has no senior mentor.
- Any HOD sees and assigns every senior: the seniors and sections are department-wide, like uploads (§4.25).

**Student side.**

- **My Senior Mentor** on Home shows the senior's name, e-mail, registration number and section, or "No senior mentor is assigned to you yet." (`get_my_senior_mentor`, loaded into `profile.senior_mentor` by `AuthProvider`).
- **Raise a query** asks whom to send it to (§4.4). Without a senior the Senior Mentor card is disabled with the notice, and the server refuses it too.
- My Queries and Home show **Sent to** (Faculty Mentor / Senior Mentor), and the badges **Raised to faculty mentor** and **Escalated to HOD** once those happen. The query page adds a banner ("Raised to your faculty mentor …" / "Escalated to the HOD …") and "Sent to" in its details. The student never sees the senior's reason: it is in `query_escalations`, which RLS does not let them read, and the system messages say only that it happened.

**Senior portal.** Two extra sidebar items appear when `profile.is_senior_mentor` (after My Queries); their pages also redirect anyone else to `/student`.

- **Peer Queries** (`/student/peer-queries`, `get_peer_queries`): the queries juniors sent them, with tiles (Waiting for you: no reply yet; Raised for help; Resolved), filters Needs you / Raised for help / Resolved / All, search, and columns Ref, Subject, Student (name, registration number, section), Category, Status with the escalation badges, Last update. It refreshes live.
- **A peer query** (`/student/peer-queries/<id>`): the **live chat** (the same conversation component; replies reach the student at once and notify them), the student panel (name, registration number, section, e-mail, faculty mentor), **Mark resolved** (the student then confirms, as with any query) and **Ask HOD / Escalate**:
  - a modal with **Send to**: "The student's faculty mentor" (named; disabled once done, or when the student has no faculty mentor) or "The HOD" (disabled once escalated), and a required **Reason** (at most 1,000 characters; "Your concern or doubt. They see it; the student only sees that you asked for help.");
  - `escalate_peer_query(p_query_id, p_to, p_reason)`, allowed only to the senior the query was sent to ("Only the senior mentor this query was sent to can escalate it here"), with "Say why you are escalating it: what is the concern or doubt?", "The reason must be 1000 characters or fewer", "This query is already closed and confirmed", "This student has no faculty mentor yet. Escalate it to the HOD instead.", "This query has already been raised to the faculty mentor", "This query has already been escalated to the HOD";
  - toasts "Raised to <name>. They can reply here; the student has been told." / "Escalated to the HOD. They can reply here; the student has been told.";
  - the query stays the senior's: they keep replying and can still resolve it; the **Raised for help** panel lists what they raised, to whom and why. A senior can raise a query to the faculty mentor and later escalate it to the HOD.
- **Assigned Mentees** (`/student/senior-mentees`, `get_my_senior_mentees`): the students of their sections (themselves excluded), filterable by section, with registration number, section, faculty mentor and their queries to the senior ("2 open", "1, all resolved" or "None"). A senior with no sections sees "No sections yet".
- **Profile**: the student's own My Profile page.

**What escalating records.**

| | To the faculty mentor | To the HOD |
|---|---|---|
| Query | `referred_to_faculty` (the student's faculty mentor), `referred_at` | `escalated_to_hod`, `escalated_at`, `escalated_by`, `escalation_source = 'senior'` |
| `query_escalations` row | raised by `senior`, to `faculty`, `target_faculty`, the reason | raised by `senior`, to `hod`, the reason |
| System message in the conversation | "<senior> (senior mentor) raised this query to <faculty>, the student's faculty mentor." | "<senior> (senior mentor) escalated this query to the HOD." |
| Notified (`query_escalated`) | the faculty mentor ("<senior> (senior mentor) raised AN-1005 to you", the student and the reason, link `/faculty/queries/<id>`); the student ("… has been raised to your faculty mentor") | the HOD the student's faculty mentor is mapped to, or every active administrator when there is none ("<senior> (senior mentor) escalated AN-1002", link `/hod/queries/<id>` or `/admin/queries/<id>`); the student ("… has been escalated to the HOD") |
| Status shown | "Raised to faculty mentor" badge | "Escalated to HOD" badge |

**Faculty side: Raised to Me** (`/faculty/raised`, after Query Queue). `get_raised_queries()` returns the queries a senior raised to the faculty member, with the reason, who raised it and when; the page has the same layout as Raised to HOD (without the Raised by filter). They are **not** in the Query Queue. Opening one shows "Raised to you by <senior> (senior mentor)" with the reason, the Senior mentor panel and the Raised for help panel. The faculty member replies in the same conversation (the student and the senior are notified), can **Mark resolved**, and can **Raise to HOD** (`escalate_query_to_hod`, recorded as raised by faculty and routed to their own HOD). The priority is shown read-only.

**HOD side.** **Raised to HOD** (§4.5) lists the escalated queries of the HOD's people with the tag **Raised by faculty** or **Raised by senior**, who raised it and the reason; they are not in All Queries. The detail page names who escalated it, shows the reason, and lets the HOD reply in the existing conversation or resolve the query. **Senior Mentors** assigns the sections (above).

**Access rules** (all in the database):

- `can_access_query` and the `support_queries` SELECT policy: the student; the mentor it was sent to (faculty or senior); the faculty mentor's HOD or the administrator; the faculty mentor a senior raised it to; and, once escalated, the HOD who oversees the student (§4.25). A faculty member or HOD therefore **cannot** read a query sent to a senior until it is raised to them; the administrator can.
- `can_handle_query` is the same without the student. It decides who may resolve, and who may read `query_escalations`.
- A senior and a junior cannot read each other's `user_profiles` rows; `get_query_people` gives everyone who can open a query the names (and a student's registration number and section) of the people on it, and `get_peer_queries` / `get_my_senior_mentees` carry the juniors' details the senior needs.
- `senior_mentor_sections` is readable by the senior themselves and by HODs and the administrator, and written only by `set_senior_mentor_sections`.

**Notification links follow the recipient** (`query_link_for`): the student gets `/student/queries/<id>`, a senior `/student/peer-queries/<id>`, faculty `/faculty/queries/<id>`, a HOD `/hod/queries/<id>`, the administrator `/admin/queries/<id>`. A reply notifies everyone in the conversation except its sender: the student, the mentor it went to and the faculty mentor a senior raised it to.

**Edge cases and known limitations:**

- **A section change moves the student, not their queries.** A new faculty mentor (and so a new section), or a section the HOD gives to another senior, changes the student's senior from then on; queries already sent stay with the senior who has them. Only removing a senior from the list moves queries.
- **A deactivated senior** stops being anyone's senior (`senior_mentor_of` needs an active account) but keeps their queries.
- **The mentee's dossier lists every query of the student**, including those sent to the senior (subject, category, status, rating; no messages). The mentor sees them in the mentee's query history and the dossier PDF but cannot open them until a senior raises them.
- **Reassignment** (§4.19) moves the queries a departing faculty member mentors, not those a senior raised to them (`referred_to_faculty`): those stay with the departed member, though the student's HOD can still reach them once escalated.
- A senior's peer queries are not counted in the faculty performance numbers or activity reports (their `mentor_id` is a student); the administrator's department totals include them.
- A senior can change a peer query's priority by a direct update (the column grant and the mentor policy allow it), but no page offers it; the student's choice is always Medium.
- The section notification reuses the `star_mentee_assigned` type and the handover the `mentor_reassigned` type; no enum value was added.
- The senior list holds real e-mails and is gitignored. Every account it creates starts on the shared temporary password, so run it only with that variable set (§8.9 S9).

---

## 5. Functions and logic

This section documents every exported function and every SQL function. The behaviour of features is in §4, and HTTP contracts are in §6.

### 5.1 Server library (`api/_lib`)

**`http-response.js`**

| Export | Behaviour |
|---|---|
| `withApiDefaults(allowedMethods, handler)` | Wraps every endpoint. Steps, in order: (1) `applyBaseHeaders`; (2) `OPTIONS` → 204, empty; (3) a method not in the list → 405 "Method X not allowed on this endpoint" with an `Allow` header; (4) run the handler; (5) catch any throw. An error with `statusCode < 500` is sent as `{success:false, message}` with that status. Anything else is logged with its stack and sent with its own status (500 when it has none) and the fixed message "Something went wrong on our side. Please try again.", so **no 5xx detail reaches the client**. |
| `applyBaseHeaders(req, res)` | Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, `Cache-Control: no-store, no-cache, must-revalidate, private`. CORS rules are listed below the table. It always sends `Access-Control-Allow-Methods: GET,POST,PATCH,OPTIONS` and `Access-Control-Allow-Headers: Content-Type, Authorization`. |
| `sendSuccess(res, message, data = {}, status = 200)` | `{success: true, message, data}` |
| `sendError(res, message, status = 400, details?)` | `{success: false, message[, details]}` |
| `sendJson(res, status, payload)` | Raw JSON writer |
| `ApiError(message, statusCode = 400)` | Error class the wrapper understands |

CORS rules in `applyBaseHeaders`:

- The request `Origin` is echoed back with `Access-Control-Allow-Credentials: true` and `Vary: Origin` **only** if one of these holds:
  1. it is in `ALLOWED_ORIGINS`;
  2. outside production, it is `http(s)://localhost:<port>` or `127.0.0.1:<port>`;
  3. it matches `https://<name>.vercel.app` **and** some `ALLOWED_ORIGINS` entry ends in `.vercel.app`.
- A request **without** an `Origin` header gets no CORS headers but is still served. Server-to-server calls are therefore not blocked by CORS.

**`request-guards.js`**

| Export | Behaviour |
|---|---|
| `requireAuthenticatedUser(req)` | Reads `Authorization: Bearer <jwt>` and verifies the token. Returns `{token, authUser, profile, admin, asUser}`: `admin` is a service-role client, `asUser` is `createUserClient(token)`. Details below the table. |
| `requireRole(ctx, ...roles)` | 403 "Forbidden — this action requires the role: a or b." |
| `clientIp(req)` | First `x-forwarded-for` entry, else the socket address |
| `enforceRateLimit(ctx, {key, max, windowSeconds})` | Calls `consume_rate_limit('<key>:<profileId>', max, window)` with the service role. `false` → 429 "Too many requests. Please wait N seconds and try again." A limiter error is logged and the request is **allowed**. |
| `recordAuditEntry(ctx, req, action, {type, id, metadata})` | Calls `write_audit_entry` with the actor, the IP and the user agent (truncated to 400 characters). A failure is logged, never thrown. |

`requireAuthenticatedUser` in detail:

- No token → 401 "Not authenticated — sign in and try again."
- It then calls `admin.auth.getUser(jwt)`. A bad or expired token → 401 "Your session has expired. Please sign in again."
- It loads `user_profiles` with the service role. No row → 403 "No profile found for this account."; `is_active = false` → 403 "This account has been deactivated."

**`supabase-clients.js`**

- `createAdminClient()` builds a client with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. It bypasses RLS, and it is never sent to the browser.
- `createUserClient(jwt)` builds a client with `SUPABASE_URL`, `SUPABASE_ANON_KEY` and a global `Authorization: Bearer <jwt>` header, so RLS applies exactly as in the browser.

**`environment.js`**

`env` is an object of lazy getters, validated on first read:

| Getter | Source and validation |
|---|---|
| `SUPABASE_URL` | Required. All whitespace is stripped; it must look like `http(s)://host`; trailing slashes are removed. |
| `SUPABASE_SERVICE_ROLE_KEY` | Required. Whitespace is stripped; it must have the three-part JWT shape `a.b.c`. |
| `SUPABASE_ANON_KEY` | Same rules as the service-role key |
| `ALLOWED_ORIGINS` | Optional comma-separated list; entries are trimmed and trailing slashes removed |
| `IS_PRODUCTION` | `VERCEL_ENV` (or `NODE_ENV`) equals `production` |
| `TEMPORARY_PASSWORD` | `SSMP_TEMPORARY_PASSWORD`, **with a hard-coded fallback** |

- A missing required variable throws "FATAL: required environment variable X is not set…". A malformed one throws a "does not look like…" / "must be your Supabase project URL…" error.
- `describeConfigHealth()` returns `ok`, `missing` or `malformed` for the three Supabase variables. It never returns values.
- `ALLOWED_EMAIL_DOMAINS` is **not** read here. `input-validation.js` reads it directly from `process.env` at module load.

**`input-validation.js`**

- The schemas are listed with their endpoints in §6.
- `emailSchema`: trim, lower-case, valid e-mail, at most 255 characters. If `ALLOWED_EMAIL_DOMAINS` (comma-separated) is set, the e-mail must end in `@<domain>` for one of them ("Email must belong to one of: …").
- `parseOrThrow(schema, payload)`: on failure, 400 "Invalid request — path: message; …".
- `assertBodySize(req, max = 10 MiB)`: 413 "Request body is too large" when `Content-Length` exceeds the limit.
- `sanitizeSingleLine(value, max = 200)`: collapses CR, LF, tabs and repeated whitespace, then truncates.
- `clusterHeadSetupSchema` is exported but **unused** (the setup goes straight to the RPC).

**`spreadsheet-parser.js`** (formats and aliases in §10.4)

| Export | Returns |
|---|---|
| `parseRosterFile(buffer, filename)` | A plain array of sparse records, `[{rowNumber, …fields}]`. Each record holds only the non-empty fields among `email, full_name, login_id, branch, section, semester_label, phone, mentor_email, parent_name, parent_mobile, parent_email, password, role`; the prototype-less object means a `__proto__` header cannot pollute anything. |
| `parseAttendanceExport(buffer, filename)` | `{meta: {course_code, course_name, section, sections, period_start, period_end, faculty_name, academic_year, academic_session}, records: [{rowNumber, identifier, section, classes_held, classes_attended, attendance_percent}]}` |
| `parseGpaExport(buffer, filename)` | `{meta: {layout, semesters_in_file, graded_semesters, ignored_semesters, has_cgpa}, records}`. ERP records are `{row, identifier, name, cgpa, total_earned_credits, total_required_credits, semesters: [{semester_number, gpa, earned_credits, required_credits}]}`; flat records carry `gpa, semester_number` instead of `semesters`. All values are strings. |
| `parseBacklogExport(buffer, filename)` | `{meta: {semester, exam_session, programme, layout, subject_codes, subjects}, records}`. ERP records are `{row, identifier, name, grades: [{subject_code, subject_name, credits, grade}]}`; hand-made records are `{row, identifier, subject_code, subject_name, grade, credits, is_cleared}`. |
| `parseBlackDotNotice(buffer, filename)` | `{meta: {cases: [{case_number, case_details, students}]}, records: [{row, where, identifier, name, case_number, case_details, incident_date, incident_date_text, hostel_block, room_no, course_branch, mobile_no, previous_record}]}` |
| `parseNoticeDate(text)` | `'YYYY-MM-DD'` for a complete day-first date, otherwise `null` |
| `REGISTRATION_ALIASES` | The accepted registration-number headings (§10.4) |
| `parseMentorMappingFile(buffer, filename)` | A plain array `[{rowNumber, identifier, mentor_email, mentor_name}]` |
| `parseHodMappingFile(buffer, filename)` | The administrator's mentor–HOD sheet → `[{row, section, mentor_name, designation, mentor_email, hod_name, hod_email}]`; headers recognised by meaning, "Cluster Head" accepted for HOD (§10.4) |
| `normaliseMappingSection(value)` | "O3", "o 3", "O-3" → "O 3"; anything else upper-cased and trimmed |
| `classifyRole(value)` | `'faculty'`, `'student'` or `null` (substring match, §10.4) |
| `parseSemesterLabel(value)` | The first digit run (or a standalone Roman numeral) as a number if it is 1–8, otherwise `null` |

**`concurrency.js`.** `runPool(items, limit, worker)` runs `worker(item, index)` with at most `limit` in flight and resolves to the results **in input order**. It is used for Auth account creation (pool size 5).

**`pdf-chart-primitives.js`.**

- `PALETTE` (brand colours), `SERIES_COLORS`, `truncate`.
- Drawing helpers: `drawSectionHeading`, `drawStatCards` (4 per row), `drawBarChart` (counts: four whole-number steps, 0–4 at least, room above the bars for their values, rounded bar tops and dashed gridlines like the portal's charts; each bar in its own colour, the category charts using the portal's category colours), `drawGroupedBarChart`, `drawLineChart`, `drawDonutChart`, `drawLegend`, `drawHorizontalBars`, `drawTable` (`maxRows`, `emptyMessage`).

Everything is drawn with vector primitives: no images except the logo, and no HTML rendering.

**`report-document-builder.js`.** `buildFacultyActivityPdf(report)`, `buildStudentDossierPdf(report)` and `buildDepartmentReportPdf(report)` take the JSON of the matching SQL function and return PDF bytes. They are A4, with the logo, a title block, KPI cards, charts and tables, and footers with page numbers. The sections are listed in §4.18.

**Endpoint-private helpers**

| Helper | File | Behaviour |
|---|---|---|
| `fetchExistingEmails(admin)` | `import-roster-spreadsheet.js` | Every `user_profiles.email`, lower-cased, read in pages of 1,000. A page error ends the read silently. |
| `planRow(...)` | `import-roster-spreadsheet.js` | Per-row validation and classification into create, skip or fail (§4.13) |
| `createAccount(...)` | `import-roster-spreadsheet.js` | `auth.admin.createUser` with one retry on a rate-limit error (1.5 s); then the profile update for mentor and parent fields |
| `createMissingMentors(admin, rows)` | `upload-academic-data.js` | Creates faculty accounts for unknown mentor e-mails (pool 5). Returns `{created, errors}`. |
| `toClientError(error, fallback)` | `upload-academic-data.js`, `manage-faculty-roster.js`, `run-cycle-job.js` (three copies) | Turns a Supabase error into an `ApiError`. A transport failure (`fetch failed`, `ENOTFOUND`, `ECONNREFUSED`, invalid header) becomes 502 with a configuration hint. **Anything else becomes 400 with the raw database message.** Because the wrapper hides the message of every status ≥ 500, the hint never reaches the client: the client receives HTTP 502 with the generic "Something went wrong on our side…" text. |

### 5.2 Frontend library, hooks and contexts

| Module | Export | Behaviour |
|---|---|---|
| `lib/supabaseClient.js` | `supabase` | `createClient(url, anonKey, {auth: {persistSession, autoRefreshToken, detectSessionInUrl, flowType: 'pkce', storageKey: 'ssmp.auth.session'}, realtime: {params: {eventsPerSecond: 8}}, global: {headers: {'x-application-name': 'ssmp-portal'}}})`. The env values are whitespace-cleaned. If `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing, the module **replaces the page with a configuration-error message and throws** at boot. |
| | `getAccessToken()` | The current session's access token, or `null` |
| `lib/apiClient.js` | `apiClient.get(path, query)`, `.post(path, body)` | Details below the table. |
| | `apiClient.downloadFile(path, query, fallbackName)` | GET, then saves the blob under the `Content-Disposition` filename (or the fallback). A non-2xx response throws the JSON `message` or "Download failed with status N". |
| `lib/fileUpload.js` | `validateUpload(file)` | Maximum 5 MB; PNG, JPEG, JPG, WEBP or PDF. Returns an error string or `null`. |
| | `validateProfilePhoto(file)` | Maximum 3 MB; PNG, JPEG, JPG or WEBP |
| | `uploadPrivateFile(bucket, userId, file, prefix)` | Uploads to `<userId>/<prefix>-<safe-name>-<timestamp>.<ext>` (`upsert: false`) and returns the object path |
| | `createSignedUrl(bucket, path, seconds = 300)` | Signed download URL |
| | `BUCKETS` | `FORM_A`, `ACHIEVEMENTS`, `PROFILE_PHOTOS`, `ROSTERS`. `ROSTERS` is unused. |
| `lib/formatters.js` | `formatDate`, `formatDateTime`, `formatRelativeTime`, `formatHours` ("—" for 0 or null), `formatNumber`, `initialsOf`, `percentage` | Pure presentation helpers |
| | `describeError(err, fallback)` | Maps errors to readable text; the mapping is listed below the table. |
| `hooks/useAsyncAction.js` | `useAsyncAction()` → `{run, pending}` | `run(fn, {successMessage, onSuccess})`. `successMessage` may be a function of the result. Errors become `toast.error(describeError(err))`. |
| `hooks/useActiveCycle.js` | `useActiveCycle()` → `{cycle, loading, error, reload}` | The active `academic_cycles` row, read once and shared by every component on the page session (a module-level cache) |
| | `refreshActiveCycle()` | Re-reads it and updates every mounted `useActiveCycle`; called after a cycle is started, edited or removed |
| `hooks/usePortalPaths.js` | `usePortalPaths()` → `{role, departmentBase, uploadsBase, isHodUploads, isAdmin}` | The link prefixes for screens mounted in two portals: `/hod` or `/admin`, and `/cluster-head` or `/hod/uploads`. `isHodUploads` switches the cluster head's upload screens into their HOD form (§4.25). |
| `lib/portalPaths.js` | `departmentBase(role)`, `uploadsBase(role)` | The same prefixes as plain functions |
| `lib/uploadedSubjects.js` | `fetchUploadedSubjects(uploaderId, cycleId)` | A HOD's subjects: the `current_cycle_courses` rows their attendance batches in the cycle were filed under |
| `lib/academicCycles.js` | `cycleLabel`, `semesterTitle`, `semesterYear`, `semesterRange`, `semesterOn`, `todayInIndia`, `academicYearOf`, `defaultCycleDates`, `labelForYear`, `nextCycleYear`, `validateCycleDates`, `uploadScope`, `SEMESTERS`, `SEMESTER_NAMES` | Cycle naming ("2026–27", "Odd semester 2026") and date arithmetic that never lets a time zone move a day; `validateCycleDates` runs the database's own date checks before the RPC does (§4.24) |
| `hooks/useDashboardMetrics.js` | `useDashboardMetrics()` → `{metrics, loading, error, reload}` | `rpc('get_dashboard_metrics')` |
| `hooks/useRealtimeQueries.js` | `useRealtimeQueries({status, category, search, pageSize = 25})` → `{queries, loading, error, page, setPage, pageCount, total, reload}` | The paged, filtered, live list (§4.4) |
| | `useQueryThread(queryId)` → `{query, messages, loading, error, reload, appendMessage}` | One query and its messages, live |
| `context/AuthProvider.jsx` | `useAuth()` → `{session, profile, user, role, loading, isAuthenticated, signIn, signOut, changePassword, sendPasswordReset, refreshProfile}` | Details below the table. |
| `context/NotificationProvider.jsx` | `useNotifications()` → `{notifications, unreadCount, loading, markRead, markAllRead, reload}` | 30 most recent, live; details in §4.21 |
| `context/ToastProvider.jsx` | `useToast()` → `{show, dismiss, success, error, warning, info}` | Transient toasts; errors stay for 6.5 s |

More detail on three of the entries above:

- **`apiClient.get` / `.post`.**
  - The base URL is `VITE_API_BASE_URL`, normalised so that it ends in `/api`; the default is `/api`.
  - Every call sends `Authorization: Bearer <token>`. With no token it throws "Your session has expired. Please sign in again."
  - A network failure gives "Could not reach the API at <base>. Check that VITE_API_BASE_URL is set to "/api" and that the serverless functions are deployed."
  - A JSON response is unwrapped to `payload.data`. When `success === false` or the status is not 2xx, the call throws `payload.message`, so **the server's `message` is never shown on success**.
- **`describeError` mapping:**
  - "violates check constraint" → "Some of the values entered are not valid. Please review the highlighted fields."
  - "duplicate key value" → "That record already exists."
  - "invalid login credentials" → "Incorrect email or password."
  - "email not confirmed" → "This account has not been confirmed yet. Please contact your HOD."
  - Anything else is shown as the raw message; an error with no message gives the fallback.
- **`AuthProvider`.** It loads the profile and the mentor, and reloads the profile on `SIGNED_IN` / `USER_UPDATED` and on realtime `user_profiles` updates.
  - `signIn` lower-cases the e-mail and refuses inactive accounts.
  - `changePassword` calls `updateUser` and then clears `must_change_password`.
  - `sendPasswordReset` uses the redirect `/reset-password`.

### 5.3 SQL function catalogue

All functions live in schema `public`. Read the table this way:

- **Security:**
  - `definer` means SECURITY DEFINER: the function runs as its owner, bypasses RLS, and must check the caller itself.
  - `invoker` means the function runs with the caller's rights.
  - Every definer function pins `search_path` to `public, pg_temp`.
- **Execute:** the roles that hold EXECUTE. `authenticated` means any signed-in browser can call it with `supabase.rpc()`, whether or not a page does.
- **Used by** is generated mechanically from the repository and the catalogue. It lists:
  - code files that name the function (dead `components/tickets/*` excluded);
  - other SQL functions that call it;
  - triggers bound to it;
  - the number of RLS or storage policies that use it.

  A function with nothing in this column is unused.
- **Purpose** is written against the current function body.

116 functions (0036 added 17; 0039 added `is_admin`, `my_overseen_faculty`, `oversees_faculty`, `oversees_student` and `map_faculty_to_hods`; 0042 added 14 for senior mentors, §4.26).

| Function | Returns | Security | Execute | Migrations | Used by | Purpose |
|---|---|---|---|---|---|---|
| `activate_roster_students(p_rows jsonb)` | `jsonb` | definer, volatile | authenticated, service_role | 0036 | `import-roster-spreadsheet.js` | Cluster head/HOD/no JWT. For each existing student on a roster: enrol in the active cycle (`roster`), make the file's non-blank semester, section and branch current (trusted operation), fill parent contacts only where empty. Returns `{activated, updated, cycle}`. |
| `active_cycle_id()` | `uuid` | definer, stable | authenticated, service_role | 0036 | SQL: 8 functions; views `current_cycle_courses`, `student_attendance_overview` | The id of the active academic cycle (null when there is none). |
| `assign_query_code()` | `trigger` | invoker, volatile | owner only | 0004, 0031 | trigger `trg_assign_query_code` on `support_queries` | BEFORE INSERT trigger on `support_queries`: sets `query_code = 'AN-' \|\| nextval(query_code_seq)` (AN-1001 onwards). |
| `can_access_query(p_query_id uuid)` | `boolean` | definer, stable | authenticated, service_role | 0007, 0031, 0039, 0042 | 1 RLS/storage policy; `post_query_message`, `can_handle_query`, `get_query_people` | True when the caller is the query's student, the mentor it was sent to (faculty or senior), `oversees_faculty(mentor_id)` (that mentor's HOD, or the administrator), the faculty mentor a senior raised it to (`referred_to_faculty`), or, once escalated, a HOD who `oversees_student` (0042). Used by the `query_messages` SELECT policy. |
| `can_access_student(p_student_id uuid)` | `boolean` | definer, stable | authenticated, service_role | 0007, 0039 | 12 RLS/storage policies | True for the student themself, their assigned mentor, or `oversees_student` (the mentor's HOD, or the administrator). The main read-scope helper in RLS and storage policies. |
| `can_handle_query(p_query_id uuid)` | `boolean` | definer, stable | authenticated | 0042 | 1 RLS policy (`query_escalations`); `resolve_support_query` | `can_access_query` for anyone but the query's own student: who may resolve a query and read its escalation reasons. |
| `can_view_student_gpa(p_student_id uuid)` | `boolean` | definer, stable | authenticated, service_role | 0007, 0039 | SQL: `get_student_dossier`; 1 RLS/storage policy | True for the student and `oversees_student` (their mentor's HOD, the administrator); for the mentor, `coalesce(gpa_sharing_enabled, true)`. Gates `student_semester_gpas` reads and the dossier GPA. |
| `carry_over_cycle_students(p_from_cycle_id uuid)` | `jsonb` | definer, volatile | authenticated, service_role | 0036 | `ClusterHeadCyclesPage.jsx` | Cluster head/HOD/no JWT. Enrols every active student of an earlier cycle in the active one (`carried_over`) with their current profile values; changes no profile. Returns `{carried_over}`. |
| `confirm_query_resolution(p_query_id uuid, p_response confirmation_response, p_comment text)` | `support_queries` | definer, volatile | authenticated | 0009, 0018, 0031 | `ResolutionConfirmation.jsx` | Student answers "was it fixed?". `yes` → confirmed (closed). `no` → reopened, In Progress, `reopen_count+1`; refused at the cap of 3. Comment ≤ 1000. Writes a system message. |
| `consume_rate_limit(p_bucket_key text, p_max_requests integer, p_window_seconds integer)` | `boolean` | definer, volatile | service_role | 0015 | `request-guards.js` | Fixed-window counter for the API: upserts `(bucket_key, window_start)`, 1% chance to purge rows > 1 day old, returns `count <= max`. Service role only. |
| `counselling_type_label(p_type text)` | `text` | invoker, immutable | authenticated | 0040 | SQL: `request_counselling`, `notify_on_counselling_request` | Display name of a counselling type ("Career Counselling"); NULL for anything else. Same twelve as `COUNSELLING_TYPES`. |
| `create_academic_cycle(p_start_year integer, p_starts_on date default null, p_even_starts_on date default null, p_ends_on date default null)` | `jsonb` | definer, volatile | authenticated, service_role | 0036 | `ClusterHeadCyclesPage.jsx` | Cluster head/HOD/no JWT. Starts the next cycle: after the latest one, dates checked (defaults 1 Jul / 1 Jan / 30 Jun); closes the active cycle, activates the new one, copies every cluster head's subjects, audits `academic_cycle.create`. Returns `{cycle, previous, subjects_copied}`. |
| `create_at_risk_meeting_link(p_meeting_id uuid)` | `at_risk_meetings` | definer, volatile | authenticated, service_role | 0022, 0039 | SQL: `dispatch_at_risk_meetings` | **Placeholder.** Checks the mentor, `oversees_faculty(mentor_id)` or no JWT, then returns the meeting unchanged (`TODO(provider)`: Teams/Meet link creation is not implemented). |
| `create_support_query(p_subject text, p_category query_category, p_description text, p_priority query_priority default 'Medium', p_recipient text default 'faculty')` | `support_queries` | definer, volatile | authenticated | 0009, 0031, 0042 | `CreateQueryModal.jsx` | Student raises a query to their faculty mentor (`p_recipient = 'faculty'`) or their senior mentor (`'senior'`, `senior_mentor_of`; 0042): active student, that mentor exists, subject ≤ 200, description ≤ 5000, fewer than 20 unresolved. Inserts the query (`mentor_id`, `mentor_kind`) and its first message. The four-argument version was dropped in 0042. |
| `current_user_role()` | `user_role` | definer, stable | authenticated, service_role | 0007 | — (unused) | Returns the caller's `user_profiles.role`. **Unused.** |
| `cycle_containing(p_date date)` | `uuid` | definer, stable | authenticated, service_role | 0036 | SQL: `tag_black_dot_with_cycle` | The cycle whose dates contain the date (the active one first if two overlap), or null. |
| `cycle_semester_on(p_cycle_id uuid, p_date date)` | `semester_term` | definer, stable | authenticated, service_role | 0036 | SQL: `get_cycle_overview`, `list_academic_cycles`, `record_attendance_batch` | `Even` on or after the cycle's `even_starts_on`, otherwise `Odd`. |
| `delete_academic_cycle(p_cycle_id uuid)` | `jsonb` | definer, volatile | authenticated, service_role | 0036 | `ClusterHeadCyclesPage.jsx` | Cluster head/HOD/no JWT. Removes a cycle with no uploads, roster imports, attendance, backlogs or black dots, never the only one; its subjects and student list go with it; removing the active one re-activates the latest remaining. Audits `academic_cycle.delete`. Returns `{deleted, active}`. |
| `dispatch_at_risk_meetings(p_job_run_id uuid)` | `jsonb` | definer, volatile | authenticated, service_role | 0022, 0036 | SQL: `run_cycle_job` | HOD/no JWT. For every flagged student with a mentor and no open meeting, inserts an `awaiting_link` meeting (with the black dot count in its snapshot, filed under the active cycle) and calls the link stub. Returns `{meetings_created, already_open, without_mentor}`. |
| `enqueue_notification(p_recipient uuid, p_actor uuid, p_type notification_type, p_title text, p_body text, p_query uuid, p_link text)` | `void` | definer, volatile | owner only | 0011, 0031 | SQL: 13 functions | The only notification writer. Skips a NULL recipient and recipient = actor. Not executable by clients. |
| `enroll_student_in_cycle(p_cycle_id uuid, p_student_id uuid, p_via text)` | `void` | definer, volatile | owner only | 0036 | SQL: `activate_roster_students`, `map_students_to_mentors`, `sync_student_cycle_enrollment` | Internal. Upserts the student's `academic_cycle_students` row with their current semester, section, branch and mentor; keeps the first `activated_via`. |
| `escalate_peer_query(p_query_id uuid, p_to text, p_reason text)` | `support_queries` | definer, volatile | authenticated | 0042 | `SeniorPeerQueryDetailPage.jsx` | The senior a query was sent to asks for help (§4.26): `p_to = 'faculty'` sets `referred_to_faculty` to the student's faculty mentor; `'hod'` sets the `escalated_*` columns with `escalation_source = 'senior'`. Reason required (≤ 1000), each once, not on a confirmed query. Adds a `query_escalations` row and a system message; notifies the faculty mentor, or the HOD the student's faculty mentor is mapped to (else every active administrator), and the student. |
| `escalate_query_to_hod(p_query_id uuid, p_note text)` | `support_queries` | definer, volatile | authenticated | 0018, 0030, 0031, 0039, 0042 | `FacultyQueryDetailPage.jsx`, `FacultyQueryQueuePage.jsx` | Faculty mentor (or the faculty mentor a senior raised it to, 0042; or their HOD, or the administrator) refers a query to the HOD: any status, once, note ≤ 1000. A senior on their own peer query is sent to `escalate_peer_query`. Sets `escalation_source = 'faculty'` and adds a `query_escalations` row (0042). Notifies the active HOD the **query's mentor** (for a senior's query, the referring faculty member) is mapped to (`hod_id`), else every active administrator, and the student; writes a system message. |
| `evaluate_all_students_risk()` | `jsonb` | definer, volatile | authenticated, service_role | 0022 | SQL: `run_cycle_job` | HOD/no JWT. Runs `evaluate_student_risk` for every active student. Returns `{evaluated, at_risk}`. |
| `evaluate_student_risk(p_student_id uuid)` | `student_risk_flags` | definer, volatile | authenticated, service_role | 0022, 0025, 0036 | SQL: `evaluate_all_students_risk`, `record_attendance_batch`, `record_backlog_batch`, `record_black_dot_batch`, `record_gpa_batch`, `reevaluate_students_batch` | Recomputes one student's flags: mean latest attendance in the active cycle < 75, GPA of the latest semester < 6, uncleared backlogs ≥ 1, black dots in the active cycle ≥ 1. Upserts `student_risk_flags`. **No caller check** (see §8.9). |
| `get_active_survey_for_student()` | `jsonb` | definer, stable | authenticated | 0023 | `StudentSurveyPage.jsx` | Student only. Returns the active cycle, whether the caller has submitted, and the active questions. |
| `get_cycle_job_status()` | `jsonb` | definer, stable | authenticated | 0024 | `run-cycle-job.js` | HOD only. Job schedule rows, the last 25 runs, active survey cycle, at-risk count, open meeting count. |
| `get_cycle_overview(p_cycle_id uuid default null, p_semester semester_term default null)` | `jsonb` | definer, stable | authenticated, service_role | 0036 | `ClusterHeadCyclesPage.jsx`, `academic-cycle-report.js` | Cluster head/HOD/no JWT. One cycle (default the active one), whole or one semester: students, mentors, uploads, roster imports, attendance, GPA upload counts, backlogs, black dots, stale risk flags. Counts and averages only, no student named (§4.24). |
| `get_dashboard_metrics()` | `jsonb` | definer, stable | authenticated | 0013, 0031, 0039, 0041 | `useDashboardMetrics.js` | Role-aware dashboard numbers: student / faculty / everyone else (a HOD: their mapped faculty and mentees; the administrator and cluster heads: the department; `coverage` says which). `queries_by_category` counts every category (0041); the older `academic_queries` etc. are legacy-only and unread. |
| `get_department_faculty_report(p_from date, p_to date)` | `jsonb` | definer, stable | authenticated | 0019, 0031, 0039 | `FacultyActivityReportPage.jsx`, `faculty-activity-report.js` | HOD or administrator. All-faculty report JSON for a period (summary, by category/status, monthly trend, per-faculty rows): a HOD's covers their mapped faculty (`coverage: 'hod'`, `hod_name`), the administrator's the department. `scope` stays `'department'`. |
| `get_faculty_activity_report(p_faculty_id uuid, p_from date, p_to date)` | `jsonb` | definer, stable | authenticated | 0013, 0030, 0031, 0039 | `FacultyActivityReportPage.jsx`, `faculty-activity-report.js` | Faculty (self only), their HOD or the administrator. Activity report JSON for a period; defaults to the last 90 days. |
| `get_mentor_group_queries()` | `jsonb` | definer, stable | authenticated | 0017, 0031 | `StudentGroupQueriesPage.jsx` | Star mentee only. Every query of the mentor group, narrow projection (no ids, bodies, e-mails or registration numbers). |
| `get_mentor_group_survey_status()` | `TABLE(cycle_id uuid, cycle_number integer, opens_on date, closes_on date, student_name text, registration_no text, section text, has_submitted boolean, is_me boolean)` | definer, stable | authenticated | 0023 | `StudentSurveyTrackingPage.jsx` | Star mentee only. The group's active students with has-submitted status for the active cycle. |
| `get_my_senior_mentees()` | `jsonb` | definer, stable | authenticated | 0042 | `SeniorMenteesPage.jsx` | A senior's Assigned Mentees: the students of their sections (not themselves), with registration number, branch, semester, section, faculty mentor and their queries to the senior (total, open). Empty for anyone else. |
| `get_my_senior_mentor()` | `jsonb` | definer, stable | authenticated | 0042 | `AuthProvider.jsx` | The caller's senior mentor (`senior_mentor_of`): id, name, e-mail, registration number, and the caller's section; NULL when there is none. |
| `get_peer_queries()` | `jsonb` | definer, stable | authenticated | 0042 | `SeniorPeerQueriesPage.jsx`, `SeniorPeerQueryDetailPage.jsx` | The queries sent to the caller as a senior mentor, newest activity first, with the student (name, registration number, section), the student's faculty mentor (whom "raise to faculty mentor" reaches) and the name of the faculty member it was raised to. |
| `get_query_people(p_query_id uuid)` | `jsonb` | definer, stable | authenticated | 0042 | `useRealtimeQueries.js` | For anyone `can_access_query` allows: id → name, e-mail, role, senior flag (and a student's registration number and section) of everyone on the query: student, mentor, the faculty member it was raised to, whoever escalated or resolved it, every sender and everyone who raised it. "Query not found" otherwise. |
| `get_raised_queries()` | `jsonb` | definer, stable | authenticated | 0042 | `RaisedQueriesPage.jsx` | Raised to Me for a faculty member (queries a senior raised to them) and Raised to HOD for a HOD (escalated queries of their faculty or their students) or the administrator (every escalated query): each with `raised_to`, `raised_at`, `raised_by_kind`, `raised_by`, the latest `reason`, the student and the mentor. |
| `get_student_dossier(p_student_id uuid)` | `jsonb` | definer, stable | authenticated | 0013, 0031, 0035, 0039 | `FacultyMenteeDetailPage.jsx`, `student-dossier-report.js` | Student themself, mentor, the mentor's HOD or the administrator. Everything about one student: profile, mentor, Form A, GPAs with credits and the official `cgpa_record` (if visible; `gpa_stats.cgpa` is the official CGPA when there is one, flagged by `cgpa_official`), backlogs (open first), black dots, achievements, query summary and history. |
| `guard_protected_profile_columns()` | `trigger` | invoker, volatile | PUBLIC | 0007, 0021, 0035, 0039, 0042 | trigger `trg_guard_protected_profile_columns` on `user_profiles` | BEFORE UPDATE trigger on `user_profiles`: blocks changes to protected columns unless no JWT, `ssmp.trusted_operation = on` or the administrator. The mentor–HOD mapping columns are the administrator's alone; so is `is_senior_mentor` (0042, otherwise set by `npm run db:seniors`); a HOD may change the rest but not grant or remove `hod` / `admin` (§4.25). |
| `handle_auth_user_email_change()` | `trigger` | definer, volatile | PUBLIC | 0002 | trigger `trg_on_auth_user_email_changed` on `users` | AFTER UPDATE trigger on `auth.users`: copies a changed e-mail to `user_profiles.email`. |
| `handle_new_auth_user()` | `trigger` | definer, volatile | PUBLIC | 0002, 0021, 0039 | trigger `trg_on_auth_user_created` on `users` | AFTER INSERT trigger on `auth.users`: creates the `user_profiles` row from `raw_user_meta_data` (student, faculty, hod or cluster_head as asked, else student; `admin` only when the inserted row's `raw_app_meta_data.role` is also `admin`, which `auth.admin.createUser` never provides because it writes `app_metadata` after the insert, so the account scripts set the role themselves, §4.1; department default 'IoT & IS'; `must_change_password` default true). |
| `is_admin()` | `boolean` | definer, stable | authenticated, service_role | 0039 | SQL: `oversees_faculty`, `oversees_student`, `guard_protected_profile_columns`, `map_faculty_to_hods`, `get_department_faculty_report`, `reassign_mentees`; 10 RLS/storage policies | Caller is an active administrator. |
| `is_blank_mark(p_value text)` | `boolean` | invoker, immutable | authenticated, service_role | 0035 | SQL: `record_gpa_batch`, `record_backlog_batch` | True for an empty cell or an ERP placeholder (`-`, `--`, `NA`, `N/A`): "nothing here". |
| `is_cluster_head()` | `boolean` | definer, stable | authenticated, service_role | 0021 | SQL: 16 functions; 3 RLS/storage policies | Caller is an active cluster head. |
| `is_faculty()` | `boolean` | definer, stable | authenticated, service_role | 0007 | 3 RLS/storage policies | Caller is an active faculty member. |
| `is_hod()` | `boolean` | definer, stable | authenticated, service_role | 0007, 0039 | SQL: 26 functions; 10 RLS/storage policies | Caller is an active HOD **or the administrator** (since 0039). Department-level permission only (uploads, cycles, jobs, roster imports); who a HOD sees is `oversees_*`. |
| `is_mentor_of(p_student_id uuid)` | `boolean` | definer, stable | authenticated, service_role | 0007 | SQL: `can_access_student`, `can_view_student_gpa`, `get_student_dossier`, `set_achievement_verification`, `set_star_mentee` | Caller is the assigned mentor of the given student. |
| `is_non_blank(value text)` | `boolean` | invoker, immutable | PUBLIC | 0001 | SQL: 6 functions | `value is not null and length(btrim(value)) > 0`. Used in CHECK constraints and RPC validation. |
| `is_senior_mentor()` | `boolean` | definer, stable | authenticated | 0042 | `get_my_senior_mentees` | True for an active student with the senior flag. |
| `is_student()` | `boolean` | definer, stable | authenticated, service_role | 0007 | SQL: `get_active_survey_for_student`, `set_gpa_sharing`, `submit_survey_response`, `upsert_semester_gpa`; 3 RLS/storage policies | Caller is an active student. |
| `list_academic_cycles()` | `jsonb` | definer, stable | authenticated, service_role | 0036 | `ClusterHeadCyclesPage.jsx` | Cluster head/HOD/no JWT. Every cycle, newest first, with students, uploads, roster imports, `can_delete` and `current_semester`. |
| `list_senior_mentors()` | `jsonb` | definer, stable | authenticated | 0042 | `HodSeniorMentorsPage.jsx` | HOD or administrator ("Only a HOD or the administrator can see the senior mentors"): every senior with e-mail, registration number, activity, sections, number of mentees, open peer queries and escalations raised. |
| `map_students_to_mentors(p_rows jsonb)` | `jsonb` | definer, volatile | authenticated, service_role | 0027, 0033, 0036 | `upload-academic-data.js` | Cluster head/HOD/no JWT. Sets `assigned_mentor_id` per row (registration no. → mentor e-mail), skipping unchanged; per-row errors. Enrols every matched student in the active cycle (`mentor_map`). Triggers reassignment notifications and log. |
| `map_faculty_to_hods(p_rows jsonb)` | `jsonb` | definer, volatile | authenticated, service_role | 0039 | `upload-academic-data.js`, `seed-demo-accounts.mjs`, `seed.sql` | Administrator/no JWT. Applies the mentor–HOD mapping sheet (≤ 5000 rows): per row, matches the HOD and the mentor by e-mail, makes a cluster head (or a faculty member with no mentees) named as HOD a HOD, and sets the mentor's `hod_id`, `hod_email`, `mentor_section`, `mentor_designation`. Returns `{total_rows, mapped, unchanged, failed, hods, promoted_to_hod, row_errors}` (§4.25). |
| `mark_all_notifications_read()` | `integer` | definer, volatile | authenticated | 0010 | `NotificationProvider.jsx` | Marks all of the caller's unread notifications read; returns the count. |
| `max_resolution_rejections()` | `integer` | invoker, immutable | authenticated, service_role | 0018 | SQL: `confirm_query_resolution` | Returns 3: how many times a student may reject a resolution. |
| `my_overseen_faculty()` | `uuid[]` | definer, stable | authenticated, service_role | 0039 | SQL: `get_dashboard_metrics`, `get_department_faculty_report`; 8 RLS/storage policies | The faculty mapped to the calling active HOD (`hod_id`); empty for everyone else. Read in policies as `(select my_overseen_faculty())::uuid[]`, once per statement. |
| `my_mentor_id()` | `uuid` | definer, stable | authenticated, service_role | 0007, 0016 | 2 RLS/storage policies | The caller's `assigned_mentor_id`. SECURITY DEFINER so policies can use it without recursion (0016). |
| `normalise_section(p_section text)` | `text` | invoker, immutable | owner only | 0042 | `student_section_code`, `get_my_senior_mentees`, `list_senior_mentors`, `set_senior_mentor_sections` | "A3", "a 3", "A-3" → "A 3" (the form the mentor–HOD mapping stores); anything else → NULL. |
| `notify_on_achievement_verified()` | `trigger` | definer, volatile | PUBLIC (default) | 0011 | trigger `trg_notify_achievement_verified` on `student_achievements` | Trigger: verification false → true notifies the student. |
| `notify_on_at_risk_meeting()` | `trigger` | definer, volatile | PUBLIC (default) | 0022 | trigger `trg_notify_at_risk_meeting` on `at_risk_meetings` | Trigger: a new at-risk meeting notifies the mentor and stamps `mentor_notified_at`. |
| `notify_on_counselling_request()` | `trigger` | definer, volatile | PUBLIC (default) | 0029, 0040 | trigger `trg_notify_counselling` on `counselling_requests` | Trigger: a new request notifies the mentor ("<name> has asked for <type>", or "has asked to talk" for Other or no type); a changed `mentor_note` notifies the student. |
| `notify_on_mentor_reassignment()` | `trigger` | definer, volatile | PUBLIC (default) | 0011 | trigger `trg_notify_mentor_reassignment` on `user_profiles` | Trigger: a changed `assigned_mentor_id` writes `mentor_reassignment_log` and notifies the student, the new mentor and the old mentor. |
| `notify_on_query_created()` | `trigger` | definer, volatile | PUBLIC (default) | 0011, 0027, 0031, 0042 | trigger `trg_notify_query_created` on `support_queries` | Trigger: a new query notifies the mentor it was sent to, faculty or senior, with `query_link_for` (skipped for CR-report items with `mom_id`). |
| `notify_on_query_message()` | `trigger` | definer, volatile | PUBLIC (default) | 0011, 0031, 0042 | trigger `trg_notify_query_message` on `query_messages` | Trigger: a non-system message notifies everyone in the conversation but the sender: the student, the mentor and the faculty mentor a senior raised it to (0042; before, student → mentor and anyone else → student). Links by `query_link_for`. |
| `notify_on_query_resolution_change()` | `trigger` | definer, volatile | PUBLIC (default) | 0011, 0031, 0042 | trigger `trg_notify_query_resolution` on `support_queries` | Trigger: resolution changes notify (pending → student; confirmed / reopened / rated → mentor, faculty or senior). Links by `query_link_for` (0042). |
| `notify_on_risk_flag_change()` | `trigger` | definer, volatile | PUBLIC (default) | 0022, 0036 | trigger `trg_notify_risk_flag_change` on `student_risk_flags` | Trigger: at-risk state changes notify the mentor. A first evaluation that is not at risk sends nothing (B2 fixed in 0036); "no longer at-risk" is suppressed while `ssmp.quiet_risk_notifications` is on. |
| `notify_on_star_mentee_change()` | `trigger` | definer, volatile | PUBLIC (default) | 0011, 0017, 0031 | trigger `trg_notify_star_mentee` on `user_profiles` | Trigger: becoming the star mentee notifies the student. |
| `open_survey_cycle(p_trigger cycle_job_trigger, p_job_run_id uuid, p_window_days integer)` | `survey_cycles` | definer, volatile | authenticated, service_role | 0023 | SQL: `run_cycle_job` | HOD/no JWT. Deactivates the active cycle, opens cycle n+1 for `interval_days` (inclusive), notifies every active student. |
| `oversees_faculty(p_faculty_id uuid)` | `boolean` | definer, stable | authenticated, service_role | 0039 | SQL: `can_access_query` and 9 workflow and report functions | The administrator, or the active HOD this faculty member is mapped to. |
| `oversees_student(p_student_id uuid)` | `boolean` | definer, stable | authenticated, service_role | 0039 | SQL: `can_access_student`, `can_view_student_gpa` and 5 workflow functions; 1 RLS/storage policy | The administrator, or the active HOD of the student's mentor. |
| `post_query_message(p_query_id uuid, p_body text)` | `query_messages` | definer, volatile | authenticated | 0009, 0031, 0039, 0042 | `QueryConversation.jsx` | Anyone `can_access_query` allows posts a message (≤ 5000): the student, the mentor (faculty or senior), the mentor's HOD or the administrator, the faculty mentor a senior raised it to, the HOD it was escalated to (0042). The first reply by anyone but the student sets `first_response_at` and moves Open → In Progress. |
| `query_link_for(p_query support_queries, p_recipient uuid)` | `text` | definer, stable | owner only | 0042 | the three `notify_on_query_*` triggers | The link a query notification carries for that recipient: `/student/queries/`, `/student/peer-queries/` for the senior it was sent to, or `/faculty/`, `/hod/`, `/admin/queries/` by role. |
| `rate_support_query(p_query_id uuid, p_rating smallint)` | `support_queries` | definer, volatile | authenticated | 0009, 0031 | `SatisfactionRating.jsx` | Query owner rates a Resolved query 1–5, once. |
| `reassign_mentees(p_student_ids uuid[], p_to_mentor_id uuid, p_reason text)` | `integer` | definer, volatile | authenticated, service_role | 0015, 0039 | `manage-faculty-roster.js` | HOD or administrator. Moves up to 500 students to an active mentor (no capacity or ownership check); for a HOD, the target and every student must be in their scope. Log rows get the reason. Queries are moved by the API, not here. |
| `record_attendance_batch(p_course_code text, p_course_name text, p_section text, p_period_start date, p_period_end date, p_filename text, p_rows jsonb)` | `jsonb` | definer, volatile | authenticated, service_role | 0022, 0025, 0027, 0033, 0036, 0039 | `seed-demo-accounts.mjs`, `upload-academic-data.js` | Cluster head/HOD/administrator/no JWT. One attendance upload into the active cycle: course by code among the caller's subjects **in the active cycle** (a HOD: any account's, own first, **created from the file when there is none**), per-row sections, upsert per (student, course, period start), risk re-evaluation. Returns the counts plus `cycle`, `semester` and `course_created`. |
| `record_backlog_batch(p_semester_number smallint, p_exam_session text, p_filename text, p_rows jsonb, p_subject_codes text[] default null)` | `jsonb` | definer, volatile | authenticated, service_role | 0022, 0033, 0035 | `seed-demo-accounts.mjs`, `upload-academic-data.js` | Cluster head/HOD/no JWT. One backlog upload for a semester: Defaulter Grade rows (a grade list per student) or one subject per row; matches subject codes case-insensitively; with `p_subject_codes`, clears every open backlog in those subjects the file no longer marks. Re-evaluates risk. (0035 dropped the four-argument version.) |
| `record_black_dot_batch(p_filename text, p_rows jsonb)` | `jsonb` | definer, volatile | authenticated, service_role | 0035, 0036 | `seed-demo-accounts.mjs`, `upload-academic-data.js` | Cluster head/HOD/no JWT. One PB notice: a black dot per student per case, upsert on `(student, lower(case_number))`, with the notice's name checked against the account. Re-evaluates every student it names (`students_reevaluated`). |
| `record_gpa_batch(p_semester_number smallint, p_filename text, p_rows jsonb)` | `jsonb` | definer, volatile | authenticated, service_role | 0022, 0025, 0033, 0035 | `seed-demo-accounts.mjs`, `upload-academic-data.js` | Cluster head/HOD/no JWT. One GPA upload: every graded semester per student with credits, plus the official CGPA into `student_cgpas`; a row is all or nothing; values validated with `try_numeric`; rows of dashes skipped. The flat one-semester shape still works. Re-evaluates risk. |
| `reevaluate_students_batch(p_after uuid default null, p_limit integer default 300)` | `jsonb` | definer, volatile | authenticated, service_role | 0036 | `ClusterHeadCyclesPage.jsx` | Cluster head/HOD/no JWT. Runs `evaluate_student_risk` for the next `p_limit` (1–1,000) active students after `p_after`, by id, with "no longer at-risk" notices quiet. Returns `{evaluated, done, total, next_after}`. |
| `request_counselling(p_concern text, p_counselling_type text default null)` | `counselling_requests` | definer, volatile | authenticated | 0029, 0031, 0040 | `StudentCounsellingPage.jsx` | Student with a mentor sends a concern (≤ 3000) with one of the twelve counselling types (required; the default only turns a missing type into "Choose the type of counselling"); at most 5 not-closed requests. The one-argument version was dropped in 0040. |
| `request_form_a_unlock()` | `void` | definer, volatile | authenticated | 0010 | — (unused) | **Dead** (no caller; Form A has been editable since 0017). Sets `unlock_requested` on a locked form. |
| `resolve_student_ids(p_identifiers text[])` | `jsonb` | definer, stable | authenticated, service_role | 0033, 0035 | SQL: `map_students_to_mentors`, `record_attendance_batch`, `record_backlog_batch`, `record_black_dot_batch`, `record_gpa_batch` | Batch registration number → student id map for uploads (active students; **registration number only**). Cluster head, HOD or no JWT only (S3 closed in 0035). |
| `resolve_students_for_upload(p_identifiers text[])` | `TABLE(student_id uuid, registration_no text, full_name text, section text, matched_on text)` | definer, stable | authenticated, service_role | 0021 | — (unused) | **Dead** (no caller since 0033). Cluster head/HOD identifier lookup returning matched students. |
| `resolve_support_query(p_query_id uuid, p_note text)` | `support_queries` | definer, volatile | authenticated | 0009, 0031, 0039, 0042 | `FacultyCrReportsPage.jsx`, `FacultyQueryDetailPage.jsx`, `SeniorPeerQueryDetailPage.jsx` | Anyone handling the query (`can_handle_query`: the mentor it was sent to, faculty or senior, the mentor's HOD or the administrator, whoever it was raised to; 0042) resolves: Resolved + pending_confirmation, `resolved_by/at`, system message (optional note). |
| `respond_to_counselling(p_request_id uuid, p_note text, p_close boolean)` | `counselling_requests` | definer, volatile | authenticated | 0029 | `FacultyCounsellingPage.jsx` | Assigned mentor replies (≤ 3000): overwrites `mentor_note`, sets acknowledged or closed. |
| `run_all_cycle_jobs_now(p_note text)` | `jsonb` | definer, volatile | authenticated, service_role | 0024 | `run-cycle-job.js` | HOD/no JWT. Runs at_risk_sweep → at_risk_meeting_dispatch → survey_cycle as manual (not the reminder sweep). |
| `run_cycle_job(p_job_type cycle_job_type, p_trigger cycle_job_trigger, p_note text)` | `jsonb` | definer, volatile | authenticated, service_role | 0024 | `run-cycle-job.js`, `seed-demo-accounts.mjs`; SQL: `run_all_cycle_jobs_now`, `run_due_cycle_jobs` | HOD/no JWT. Runs one job with a `cycle_job_runs` row; manual runs leave `next_run_due_on`; scheduled runs advance it. A failure re-raises (rolls back the run row). |
| `run_due_cycle_jobs()` | `jsonb` | definer, volatile | authenticated, service_role | 0024 | — (unused) | **Dead** (no caller, no scheduler). Would run every enabled job due today as `scheduled`. |
| `semester_term_of_number(p_semester integer)` | `semester_term` | invoker, immutable | authenticated, service_role | 0036 | SQL: `get_cycle_overview`; view `academic_upload_history` | Programme semester parity: 1, 3, 5, 7 → `Odd`; 2, 4, 6, 8 → `Even`. Files backlogs under a semester. |
| `send_survey_reminders()` | `jsonb` | definer, volatile | authenticated, service_role | 0023 | SQL: `run_cycle_job` | HOD/no JWT. Notifies active students without a response in the active cycle. |
| `senior_mentor_of(p_student_id uuid)` | `uuid` | definer, stable | owner only | 0042 | `create_support_query`, `get_my_senior_mentor` | The active senior who has the student's section (`student_section_code`), never the student themselves; NULL when none. |
| `set_achievement_verification(p_achievement_id uuid, p_verified boolean)` | `student_achievements` | definer, volatile | authenticated | 0010, 0039 | `FacultyMenteeDetailPage.jsx` | Mentor, their HOD or the administrator sets `verified_by_faculty` on an achievement. |
| `set_at_risk_meeting_status(p_meeting_id uuid, p_status at_risk_meeting_status)` | `at_risk_meetings` | definer, volatile | authenticated | 0022, 0039 | `FacultyAtRiskPage.jsx` | Organising mentor, their HOD or the administrator sets any meeting status; stamps completed/cancelled time. No transition validation. |
| `set_faculty_employment_status(p_faculty_id uuid, p_status employment_status, p_available boolean)` | `user_profiles` | definer, volatile | authenticated, service_role | 0015, 0039 | `manage-faculty-roster.js` | That faculty member's HOD or the administrator. Sets employment status; a non-active status forces `available_for_reassignment = false` unless `p_available` is given. |
| `set_gpa_sharing(p_enabled boolean)` | `boolean` | definer, volatile | authenticated | 0010 | — (unused) | No caller in the code (the UI toggle was removed), but still executable by students: sets their own `gpa_sharing_enabled`. |
| `set_mentor_department_and_hod(p_department text, p_hod_email text)` | `integer` | definer, volatile | authenticated | 0030, 0031, 0039 | `FacultyMenteesPage.jsx` | Faculty only. Sets own `department`; a mapped mentor keeps the mapped HOD (another e-mail is refused), an unmapped one names an active HOD and is mapped to them (`hod_id`, `hod_email`). Copies the department to all mentees. |
| `set_query_in_progress(p_query_id uuid)` | `support_queries` | definer, volatile | authenticated | 0027, 0031, 0039 | `FacultyCrReportsPage.jsx` | Mentor, their HOD or the administrator marks a query In Progress (resolution none); system message. Used for CR-report items, but accepts any query not yet confirmed. |
| `set_senior_mentor_sections(p_senior_id uuid, p_sections text[])` | `jsonb` | definer, volatile | authenticated | 0042 | `HodSeniorMentorsPage.jsx` | HOD or administrator replaces a senior's sections: normalised, A 3 … T 4 only, one senior per section ("A3 already has a senior mentor (<name>). Remove it there first."). Notifies the senior of added sections (`star_mentee_assigned`). Returns the senior and their sections. |
| `set_star_mentee(p_student_id uuid, p_is_star boolean)` | `user_profiles` | definer, volatile | authenticated | 0010, 0039 | `FacultyMenteeDetailPage.jsx`, `FacultyMenteesPage.jsx` | Mentor, their HOD or the administrator sets/clears the star mentee; at most one per mentor (row lock, clears others; no unique index). |
| `set_updated_at_timestamp()` | `trigger` | invoker, volatile | PUBLIC | 0001 | 16 `updated_at` triggers | BEFORE UPDATE trigger: `new.updated_at = now()`. |
| `student_section_code(p_student_id uuid)` | `text` | definer, stable | owner only | 0042 | `senior_mentor_of`, `get_my_senior_mentor`, `get_query_people`, `get_peer_queries`, `get_raised_queries` | A student's section: their faculty mentor's `mentor_section` (the mentor–HOD mapping), else their own roster section when written like "C4"; normalised ("A 3"). |
| `submit_cluster_head_setup(p_courses jsonb)` | `SETOF cluster_head_courses` | definer, volatile | authenticated | 0021, 0032, 0036 | `ClusterHeadCoursesPage.jsx`, `ClusterHeadSetupPage.jsx` | Cluster head only. Replaces the subject list **of the active cycle** (1–60, unique codes); deletes removed codes (cascades that cycle's attendance); marks setup complete. |
| `submit_mom_report(p_meeting_date date, p_notes text, p_items jsonb, p_students_present integer, p_students_total integer)` | `mom_records` | definer, volatile | authenticated | 0027, 0031 | `StudentCrReportPage.jsx` | Star mentee files a CR report (≤ 12 items); each item becomes a query with `mom_id`; one summary notification to the mentor (each item's first message also notifies). |
| `submit_student_form_a(p_payload jsonb)` | `student_form_a_profiles` | definer, volatile | authenticated | 0010, 0017 | `StudentOnboardingFormPage.jsx`, `StudentProfilePage.jsx` | Student submits/updates Form A (upsert), marks onboarding complete, copies phone/section/branch to the profile. |
| `submit_survey_response(p_cycle_id uuid, p_answers jsonb)` | `survey_responses` | definer, volatile | authenticated | 0023 | `StudentSurveyPage.jsx` | Student answers the active cycle once; all active questions, ratings 1–5; stores the current mentor. |
| `sync_student_cycle_enrollment()` | `trigger` | definer, volatile | owner only | 0036 | trigger `trg_sync_student_cycle_enrollment` on `user_profiles` | AFTER INSERT or UPDATE of mentor, section, semester, branch or role: enrols the student in the active cycle (`account` or `profile`) and refreshes that cycle's snapshot. Closed cycles are never touched. |
| `tag_attendance_with_cycle()` | `trigger` | definer, volatile | owner only | 0036, 0039 | trigger `trg_attendance_cycle` on `student_attendance_records` | BEFORE INSERT: sets `cycle_id` to the subject's cycle. |
| `tag_black_dot_with_cycle()` | `trigger` | definer, volatile | owner only | 0036, 0039 | trigger `trg_black_dots_cycle` on `student_black_dots` | BEFORE INSERT: sets `cycle_id` to the cycle containing the incident date, else the active cycle. |
| `tag_row_with_active_cycle()` | `trigger` | definer, volatile | owner only | 0036, 0039 | 5 triggers: `academic_upload_batches`, `roster_import_batches`, `cluster_head_courses`, `student_backlogs`, `at_risk_meetings` | BEFORE INSERT: sets a missing `cycle_id` to the active cycle. With the argument `required`, refuses when there is none ("There is no active academic cycle..."). |
| `try_numeric(p_value text)` | `numeric` | invoker, immutable | authenticated, service_role | 0035 | SQL: `record_gpa_batch`, `record_backlog_batch`, `record_black_dot_batch` | A plain decimal, or NULL instead of an error, so a stray word in a numeric cell is a row error (B7). |
| `unlock_student_form_a(p_student_id uuid)` | `void` | definer, volatile | authenticated | 0010, 0039 | — (unused) | **Dead** (no caller). The student's HOD or the administrator; clears the lock **and sets `form_a_completed = false`**, which would send the student back through onboarding. |
| `update_academic_cycle_dates(p_cycle_id uuid, p_starts_on date, p_even_starts_on date, p_ends_on date)` | `academic_cycles` | definer, volatile | authenticated, service_role | 0036 | `ClusterHeadCyclesPage.jsx` | Cluster head/HOD/no JWT. Corrects a cycle's dates (same checks as creation); every row's semester is recomputed on read. Audits `academic_cycle.update_dates`. |
| `upsert_semester_gpa(p_semester_number smallint, p_gpa numeric)` | `student_semester_gpas` | definer, volatile | owner only | 0010, 0021, 0037 | — (unused) | **Retired in 0037.** Was the student's own GPA entry (1–8, 0–10; refused for department-published semesters). No longer executable by signed-in users; kept so it could be re-granted. |
| `write_audit_entry(p_actor_id uuid, p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb, p_ip_address text, p_user_agent text)` | `void` | definer, volatile | service_role | 0015 | `request-guards.js` | Inserts into `audit_log`. Executable by `service_role` only. |

---

## 6. API reference

### 6.1 Conventions (all endpoints)

- **Base path.** `/api`. Locally, `vercel dev` serves it; in production, Vercel does. The browser reaches it through `VITE_API_BASE_URL`, default `/api`.
- **Authentication.** `Authorization: Bearer <Supabase access token>` on every endpoint except `/api/health`. The token is verified with `auth.getUser`, then the caller's `user_profiles` row is loaded and must be active (§5.1).
- **Envelope.**
  - Success: `{"success": true, "message": "<human text>", "data": {…}}`.
  - Error: `{"success": false, "message": "<human text>"}`.
  - The browser client returns only `data` on success. On failure it throws the `message`.
  - PDFs are sent raw (`Content-Type: application/pdf`, `Content-Disposition: attachment; filename="…"`).
- **Status codes.**

  | Status | Meaning |
  |---|---|
  | 200 / 201 | Success |
  | 204 | `OPTIONS` |
  | 400 | Validation failure, or a database error with its message |
  | 401 | Missing or expired token |
  | 403 | No profile, inactive, wrong role, the setup gate, or (report endpoints only) a permission error `42501` from the database. Other endpoints return database errors as 400. |
  | 404 | No report data |
  | 405 | Wrong method |
  | 413 | Body too large |
  | 429 | Rate limited |
  | 500 / 502 | Anything unexpected (500), or a database transport failure caught by `toClientError` (502). The message is always generic; the detail goes only to the server log. |

- **Headers and CORS.** See §5.1. Vercel additionally adds `Cache-Control: no-store` for `/api/*`.
- **Handler anatomy**, in order:
  1. `withApiDefaults`: CORS, headers, method check.
  2. `assertBodySize`, for uploads.
  3. `requireAuthenticatedUser`.
  4. `requireRole`.
  5. `enforceRateLimit`.
  6. `parseOrThrow(zodSchema)`.
  7. Work, preferring `context.asUser` (RLS) and using `context.admin` only when necessary.
  8. `recordAuditEntry`.
  9. `sendSuccess`.
- **Runtime.** Node ≥ 20, ESM, 1,024 MB, **30 s maximum duration** (`vercel.json`). The two upload endpoints raise the body-parser limit to 10 MB (`export const config`). Vercel's own request-body limit for functions (4.5 MB, a platform limit) is lower than both that and the 8,000,000-character base64 cap, so in practice it is the effective upload limit: roughly 3.3 MB of file.

### 6.2 `GET /api/health`

| | |
|---|---|
| **Auth** | None |
| **Purpose** | Liveness and configuration readiness |
| **Response 200** | `data: {status: "ok", timestamp, environment: VERCEL_ENV ?? NODE_ENV ?? "development", configured: {supabase_url, supabase_service_role_key, supabase_anon_key}}` |
| **Notes** | Each `configured` value is `"ok"`, `"missing"` or `"malformed"`. Values are never returned. The message is "SSMP API is running". Not called by the frontend; it is for operators. |

### 6.3 `POST /api/admin/provision-user-accounts`

| | |
|---|---|
| **Roles** | `hod`, `admin` |
| **Rate limit** | `provision-accounts`: 20 per 60 s |
| **Body limit** | 2 MB (`assertBodySize`) |
| **Request** | `{"accounts": [ … 1–500 × provisionUserSchema ]}` |
| **Response 201** | `data: {created: [{id, email, full_name, role, login_id, temporary_password}], skipped: [{email, reason}], failed: [{email, reason}]}`. Message: "Created n account(s). s skipped, f failed." |
| **Errors** | 400 "No accounts could be created. First error: …" when every account failed and none were skipped; the usual 400/401/403/413/429 |
| **Audit** | `admin.provision_accounts`, with `{requested, created, skipped, failed}` |
| **Caller** | `components/hod/AddAccountModal.jsx` (sends one account). It shows the credentials view; an empty `created` produces an error toast with the first reason. |

`provisionUserSchema` fields:

| Field | Rule |
|---|---|
| `email` | `emailSchema` (domain allow-list applies) |
| `full_name` | 2–120 |
| `role` | `student`, `faculty`, `hod` or `cluster_head` |
| `login_id` | ≤ 40, optional |
| `branch` | ≤ 60 |
| `section` | ≤ 10 |
| `semester_label` | ≤ 40 |
| `department` | ≤ 80 |
| `phone` | exactly 10 digits, optional |
| `assigned_mentor_id` | uuid, optional |
| `send_invite_email` | boolean, **ignored** |

Processing, per account:

0. For a HOD caller (0039): a `hod` account → failed, "Only the administrator can create HOD accounts"; a student whose `assigned_mentor_id` is not one of the HOD's own faculty → failed, "That mentor does not report to you".
1. If `user_profiles.email` matches (case-insensitive) → skipped: "An account with this email already exists".
2. `auth.admin.createUser({email, password: TEMPORARY_PASSWORD, email_confirm: true, user_metadata: {role, full_name, login_id, branch, section, semester_label, department (default 'IoT & IS'), phone, must_change_password: true}, app_metadata: {role}})`. An error → failed.
3. A faculty account created by a HOD gets `hod_id` and `hod_email` set to that HOD (service role). Failure → failed, "Account created but not placed under you: …", but the account remains.
4. If `assigned_mentor_id` is given **and the role is `student`**, a service-role `update user_profiles set assigned_mentor_id`. For other roles the field is silently ignored. Failure → failed, "Account created but mentor assignment failed: …", but the account remains.

### 6.4 `POST /api/admin/import-roster-spreadsheet`

| | |
|---|---|
| **Roles** | `cluster_head`, `hod`, `admin` (no setup gate). Faculty a HOD's import creates get that HOD's `hod_id` and `hod_email`. |
| **Rate limit** | `roster-import`: 200 per 300 s |
| **Body limit** | 10 MB (body parser) plus `assertBodySize` |
| **Request** (`rosterImportSchema`) | See the table below. |
| **Response 201** | `data: {batch_id, total_rows, offset, next_offset, processed_through, faculty_created, student_created, created: [{row, id, email, full_name, role, login_id, temporary_password, password_from_file}], skipped: [{row, email, reason}], failed: [{row, email, reason}], activated: [{row, email}], students_updated, cycle}` (the last three since 0036) |
| **Errors** | 400 for parser errors (§10.4), a missing Role in a combined file, or validation |
| **Audit** | Only on the final chunk: `admin.import_<import_type>_roster`, with `{filename, total, created, failed, dry_run}` |
| **Caller** | `ClusterHeadRosterPage` → `AcademicUploadPanel` (chunk loop, merged results, credentials panel) |

Request fields:

| Field | Rule |
|---|---|
| `import_type` | `faculty`, `student` or `combined` |
| `filename` | 1–255 characters |
| `file_base64` | 1–8,000,000 characters |
| `create_accounts` | boolean, default `true`; `false` = dry run |
| `offset` | integer ≥ 0, default 0 |
| `batch_id` | uuid, optional |
| `default_mentor_id` | uuid, optional |
| `semester_cycle_id` | uuid, optional |

Processing (details in §4.13):

1. Parse the whole file.
2. Pre-load faculty and existing accounts (e-mail → id and role, paged).
3. Starting at `offset`, plan each row, and create accounts in waves of 25 with 5 at a time. A row for an existing **student** is set aside for activation instead of being skipped outright.
4. Stop when the 20 s budget is spent. `next_offset` = the index to resume from, or `null` when done.
5. With `create_accounts`, call `activate_roster_students` (service role) for the chunk's existing students: they join the active academic cycle, and the file's semester, section and programme become their current ones (§4.13).
6. Insert or accumulate the `roster_import_batches` row (filed under the active cycle by its trigger).
7. If `semester_cycle_id` is given, update that legacy cycle's counters. The current UI never sends it.

**Response message:** "Imported n row(s)… s already existed, f failed.", or for a dry run: "Validated … ready to import …".

### 6.5 `GET | POST /api/admin/manage-faculty-roster`

| | |
|---|---|
| **Roles** | `hod`, `admin` |
| **Rate limit** | POST only: `faculty-roster:<action>`, 60 per 60 s. GETs are not limited. |
| **Caller** | `pages/hod/HodFacultyRosterPage.jsx` |

| Request | Processing | Response `data` |
|---|---|---|
| `GET ?action=roster` (default) | `faculty_reserve_pool.select('*').order('full_name')` as the user | `{faculty: [...]}` |
| `GET ?action=mentees&faculty_id=<uuid>` | The mentor's students (`id, full_name, email, login_id, section, branch, semester_label, is_star_mentee, form_a_completed`), plus a count of non-Resolved queries per student | `{mentees: [{…, open_queries}]}`; 400 "A valid faculty_id is required" |
| `GET ?action=reserve-pool` | The same view filtered to `employment_status = 'active'` and `available_for_reassignment`, ordered by remaining capacity, descending. **Unused by the UI.** | `{faculty: [...]}` |
| `POST {action: 'set-status', faculty_id, employment_status: active\|on_leave\|departed, available_for_reassignment?}` | `set_faculty_employment_status(p_faculty_id, p_status, p_available)` as the user; count the faculty member's mentees | `{faculty, mentee_count, needs_reassignment}`; message `Status updated to "<status>".`; audit `hod.set_faculty_status` |
| `POST {action: 'reassign', student_ids: uuid[1..500], from_faculty_id?, to_faculty_id, reason? ≤500}` | `reassign_mentees(...)` as the user, then, if the caller can read `from` through their own token, a **service-role** `update support_queries set mentor_id = to` where the student is in the list, `mentor_id = from` and `status <> 'Resolved'` | `{reassigned: n}`; message "n student(s) reassigned successfully."; audit `hod.reassign_mentees` with `{student_count, moved, from, reason}` |
| any other action | — | 400 `Unknown action "<x>"` |

### 6.6 `GET | POST /api/admin/run-cycle-job`

| | |
|---|---|
| **Roles** | `hod`, `admin` |
| **Rate limit** | POST only: `cycle-job`, 40 per 300 s |
| **GET** | `get_cycle_job_status()` as the user. `data` = `{jobs: [{job_type, description, interval_days, is_enabled, next_run_due_on, last_run_at, last_run_status, last_manual_run_at}], recent_runs: [last 25], active_survey_cycle, at_risk_count, open_meeting_count}` |
| **POST request** (`cycleJobSchema`) | `{job_type: survey_cycle\|survey_reminder_sweep\|at_risk_sweep\|at_risk_meeting_dispatch\|all, trigger_source: manual (default)\|scheduled, note?: ≤300}` |
| **POST processing** | `all` calls `run_all_cycle_jobs_now(p_note)` (sweep → dispatch → survey; always `manual`). Any other value calls `run_cycle_job(p_job_type, p_trigger, p_note)`. |
| **POST response** | The RPC's JSON: `{job_type, trigger_source, run_id, status, result, schedule_advanced}` for one job. Message: "<Job> finished." plus " The 15-day schedule was left unchanged." when manual. |
| **Audit** | `hod.run_cycle_job`, with `{job_type, trigger_source}` |
| **Caller** | `pages/hod/HodOperationsPage.jsx` |

### 6.7 `POST /api/cluster-head/upload-academic-data`

| | |
|---|---|
| **Roles** | `cluster_head`, `hod`, `admin`; `hod-map` is `admin` only (403 "Only the administrator can upload the mentor-HOD mapping.") |
| **Gate** | Cluster heads must have `cluster_head_setup_completed`, else 403 "Complete the cluster head setup form before uploading data." |
| **Rate limit** | `academic-upload`: 30 per 300 s (shared by all actions) |
| **Body limit** | 10 MB |
| **Request** (`clusterHeadUploadSchema`, discriminated on `action`) | Every action also takes `filename` (1–255) and `file_base64` (≤ 8,000,000 characters). See the table below. |
| **Processing** | Decode (an empty result → 400 "The uploaded file is empty."), parse (§10.4), [mentor-map: `createMissingMentors`, whose accounts get the uploading HOD's `hod_id`; hod-map: `createMissingMappingAccounts`, which pages through every profile e-mail and creates the missing HODs and faculty], then the RPC as the user. Backlogs: 400 "The file does not say which semester it is for. Choose the semester, then upload it again." when neither the file nor the request names one. |
| **Response 200** | `data` = the RPC's JSON plus `file_meta` (what the parser read from the file; `null` for attendance and the mentor map): `{batch_id, total_rows, matched, failed, students_reevaluated, row_errors: [{row, identifier, reason}]}`. Attendance adds `course_code, course_name, section, sections, period_start, period_end`. GPA adds `skipped, semester_gpas_recorded, semesters, cgpa_recorded`. Backlogs add `semester_number, exam_session, backlogs_recorded, backlogs_cleared`. Black dots add `cases, case_numbers, students`, and each row error a `where`. Mentor-map returns `{total_rows, matched, unchanged, failed, row_errors, mentors_created, mentor_errors}`. Hod-map returns `{total_rows, mapped, unchanged, failed, hods, promoted_to_hod, row_errors, hod_accounts_created, faculty_accounts_created, account_errors}`. Attendance adds `course_created` (0039). |
| **Message** | "n row(s) recorded for <course> (section <s>), f could not be matched." / "n student(s) recorded (semester 1, 2 GPA and CGPA)." / "n backlog(s) recorded for semester s, c cleared." / "n black dot(s) recorded across c case(s). r student(s) re-checked against the at-risk rule." / "n student(s) mapped to their mentor. m mentor account(s) created …" / "n mentor(s) mapped across h HOD(s). u were already correct. … account(s) created … p existing account(s) became HOD. f row(s) could not be mapped." |
| **Academic cycle** | Every batch and row is filed under the active cycle by the database; with no active cycle the RPC refuses the upload (§4.24). Attendance also returns `cycle` and `semester`. |
| **Audit** | `cluster_head.upload_<action>`, with `{action, filename, total_rows, matched, failed, mentor_accounts_created}`, plus `{semester, cleared}` for backlogs and `{cases}` for black dots. Hod-map: `admin.upload_hod_map`, with `{filename, total_rows, mapped, unchanged, failed, hods, promoted_to_hod, hod_accounts_created, faculty_accounts_created}`. |
| **Callers** | `ClusterHeadAttendancePage`, `ClusterHeadGpaPage`, `ClusterHeadBacklogPage`, `ClusterHeadBlackDotPage`, `ClusterHeadRosterPage` (mentor map), all also under `/hod/uploads`; `AdminHodMappingPage` (hod-map); all through `AcademicUploadPanel` |

Per-action fields and RPCs:

| `action` | Extra fields | RPC |
|---|---|---|
| `attendance` | none | `record_attendance_batch` |
| `gpa` | `semester_number?` (1–8, a fallback for a flat file; the page does not send it) | `record_gpa_batch` |
| `backlog` | `semester_number?` (1–8, used only when the file's title names no semester), `exam_session?` (≤ 60; wins over the title's exam) | `record_backlog_batch`, with `p_subject_codes` from the file |
| `black-dot` | none | `record_black_dot_batch` |
| `mentor-map` | none | `map_students_to_mentors` |
| `hod-map` | none (administrator only) | `map_faculty_to_hods` |

### 6.8 `GET /api/reports/faculty-activity-report`

| | |
|---|---|
| **Roles** | `faculty`, `hod`, `admin` |
| **Rate limit** | `faculty-report`: 30 per 60 s |
| **Query** (`facultyReportQuerySchema`) | `faculty_id?` (uuid or `all`), `from?` / `to?` (`YYYY-MM-DD`), `format` (`json`, the default, or `pdf`) |
| **Processing** | `faculty_id=all` calls `get_department_faculty_report(p_from, p_to)` (the database requires a HOD or the administrator, and limits a HOD's to their faculty). Otherwise `get_faculty_activity_report(p_faculty_id, p_from, p_to)`. Both run as the user. |
| **Response** | `format=json` → `data: {report}`. `format=pdf` → the PDF, `faculty-activity-report-<name>-<from>-to-<to>.pdf` or `department-activity-report-all-faculty-<from>-to-<to>.pdf`. |
| **Errors** | database 42501 → 403; other database errors → 400; no data → 404 |
| **Audit** | PDF only: `report.faculty_activity_pdf` / `report.department_pdf` |
| **Callers** | `FacultyActivityReportPage` (the PDF button; on-screen data uses the RPC directly), `HodFacultyPerformancePage` (PDF per faculty member, default period) |

### 6.9 `GET /api/reports/student-dossier-report`

| | |
|---|---|
| **Roles** | Any authenticated user. The database's `get_student_dossier` decides: the student themself, their mentor, the mentor's HOD, or the administrator. |
| **Rate limit** | `student-report`: 30 per 60 s |
| **Query** | `student_id` (uuid, required), `format` (`json` or `pdf`) |
| **Response** | `format=json` → `data: {report}`. `format=pdf` → `student-report-<name>-<YYYY-MM-DD>.pdf`. |
| **Errors** | 42501 → 403 ("You are not this student's mentor"); other → 400; no data → 404 "No report data was returned" |
| **Audit** | PDF only: `report.student_dossier_pdf` |
| **Callers** | `FacultyMenteesPage` (PDF per mentee), `FacultyMenteeDetailPage` (PDF button; on-screen data uses the RPC directly) |

### 6.10 `GET /api/reports/academic-cycle-report`

| | |
|---|---|
| **Roles** | `cluster_head`, `hod`, `admin` (the database's `get_cycle_overview` checks again) |
| **Rate limit** | `cycle-report`: 20 per 60 s |
| **Query** (`cycleReportQuerySchema`) | `cycle_id?` (uuid; default the active cycle), `semester?` (`Odd` or `Even`; default the whole cycle) |
| **Processing** | `get_cycle_overview(p_cycle_id, p_semester)` as the user, then `buildCycleWorkbook(overview, {generatedBy})` with ExcelJS. |
| **Response 200** | An `.xlsx` attachment, `cycle-report-<label>.xlsx` or `cycle-report-<label>-odd-semester.xlsx`, with the sheets Summary (semesters and key figures), Students, Mentors, Attendance, Backlogs, Black dots and Uploads. Counts and averages only: no student is named, and there are no GPA values or at-risk flags. Times are India time. |
| **Errors** | database 42501 → 403; other database errors → 400; no cycle → 404 "No academic cycle was found" |
| **Audit** | `report.academic_cycle_xlsx`, with `{cycle, semester}` |
| **Caller** | `ClusterHeadCyclesPage` ("Download report", "Download .xlsx") through `apiClient.downloadFile` |

---

## 7. Database reference

### 7.1 Overview

The database is Postgres 15 on Supabase. There is a single application schema, `public`, which contains:

- **34 tables**, **10 views**, **18 enums**, **116 functions**, and **38 triggers** (36 on `public` tables and 2 on `auth.users`);
- 2 sequences (`query_code_seq`, `audit_log_id_seq`);
- the extensions `citext`, `pg_trgm` and `pgcrypto`.

Everything in §7.3–§7.8 was **generated from the live catalogue** after replaying all 33 migrations (and updated for 0034–0035 on 2026-09-27, for 0036–0037 on 2026-09-28, for 0038–0039 on 2026-10-07 and for 0042 on 2026-10-22), so column lists, constraints, indexes, policies and grants are exact. Where a table's own SQL comment has gone stale, a **Doc note** says so.

Conventions that hold across the schema:

- **Row Level Security.**
  - RLS is **enabled (not forced)** on every table. It is not forced so that SECURITY DEFINER functions running as the owner can do their work.
  - Nothing is granted to `anon`.
  - `authenticated` receives only the table privileges its policies need.
  - CI fails if any public table lacks RLS.
- **Writes with rules go through SECURITY DEFINER functions.** Each one:
  - checks the caller with the helper functions `is_hod()`, `is_admin()`, `is_faculty()`, `is_student()`, `is_cluster_head()`, `is_mentor_of()`, `oversees_faculty()` / `oversees_student()` (0039) and `can_access_student()` / `can_access_query()`;
  - pins `search_path = public, pg_temp`;
  - raises `42501` for permission errors and `P0002` for "not found", plus readable messages. The two report endpoints map 42501 to 403; the other endpoints return every database error as 400.
- **Protected profile columns.** The trigger `guard_protected_profile_columns` (BEFORE UPDATE on `user_profiles`) rejects a change to any of these unless the caller is the administrator, the call has no JWT (service role or scripts), or the transaction has set `ssmp.trusted_operation = 'on'`:
  - `role`, `assigned_mentor_id`, `is_star_mentee` / `star_mentee_assigned_by`, `employment_status` / `available_for_reassignment`, `is_active`, `form_a_completed`, `cluster_head_setup_completed`, `id`, `email`, and (since 0035) `login_id`, the registration number;
  - since 0039, the mentor–HOD mapping: `hod_id`, `mentor_section`, `mentor_designation`, and `hod_email` once `hod_id` is set;
  - since 0042, `is_senior_mentor` (set by `npm run db:seniors`, which runs with the service role).
  
  A HOD is exempt from the first list (for the rows RLS lets them update, §4.25) but not from the second or third, and cannot grant or remove the `hod` or `admin` role.

  Definer RPCs that legitimately change these set the flag with `set_config('ssmp.trusted_operation', 'on', true)`: `submit_student_form_a`, `set_star_mentee`, `set_faculty_employment_status`, `reassign_mentees`, `submit_cluster_head_setup`, `map_students_to_mentors`, `unlock_student_form_a`. Every other profile column is freely editable by its owner (§8.9).
- **Notifications** are inserted only through `enqueue_notification` (§4.21).
- **Timestamps.** `set_updated_at_timestamp` maintains `updated_at` on 17 tables.
- **Academic cycles** (0036). Seven tables carry a `cycle_id`, set by `BEFORE INSERT` triggers (§4.24); which semester a row is in is computed on read, never stored.
- **Enums.** Since 0020, new enum values get a migration of their own (0020, 0026, 0028, 0034). The earlier 0018 and 0019 added values inside larger files. Postgres refuses to use a value in the transaction that created it, and `supabase db push` may wrap a file in one transaction.
- **Views.** All 10 are `security_invoker = true`, so they run with the caller's rights and RLS still applies.

### 7.2 Relationships (foreign keys)

`user_profiles.id` references `auth.users(id)`. Every person in the system is a `user_profiles` row, and almost every table hangs off it.

- **`academic_cycle_students`**: `cycle_id` → `academic_cycles(id)` (on delete cascade); `mentor_id` → `user_profiles(id)` (on delete set null); `student_id` → `user_profiles(id)` (on delete cascade)
- **`academic_cycles`**: `created_by` → `user_profiles(id)` (on delete set null)
- **`academic_upload_batches`**: `course_id` → `cluster_head_courses(id)` (on delete set null); `cycle_id` → `academic_cycles(id)`; `uploaded_by` → `user_profiles(id)` (on delete cascade)
- **`at_risk_meetings`**: `cycle_id` → `academic_cycles(id)` (on delete set null); `mentor_id` → `user_profiles(id)` (on delete cascade); `student_id` → `user_profiles(id)` (on delete cascade)
- **`audit_log`**: `actor_id` → `user_profiles(id)` (on delete set null)
- **`canned_replies`**: `owner_id` → `user_profiles(id)` (on delete cascade)
- **`cluster_head_courses`**: `cluster_head_id` → `user_profiles(id)` (on delete cascade); `cycle_id` → `academic_cycles(id)` (on delete cascade)
- **`counselling_requests`**: `mentor_id` → `user_profiles(id)` (on delete cascade); `responded_by` → `user_profiles(id)` (on delete set null); `student_id` → `user_profiles(id)` (on delete cascade)
- **`cycle_job_runs`**: `triggered_by` → `user_profiles(id)` (on delete set null)
- **`mentor_reassignment_log`**: `from_mentor_id` → `user_profiles(id)` (on delete set null); `performed_by` → `user_profiles(id)` (on delete set null); `student_id` → `user_profiles(id)` (on delete cascade); `to_mentor_id` → `user_profiles(id)` (on delete cascade)
- **`mom_records`**: `mentor_id` → `user_profiles(id)` (on delete cascade); `reported_by` → `user_profiles(id)` (on delete cascade)
- **`notifications`**: `actor_id` → `user_profiles(id)` (on delete set null); `query_id` → `support_queries(id)` (on delete cascade); `recipient_id` → `user_profiles(id)` (on delete cascade)
- **`query_escalations`** (0042): `query_id` → `support_queries(id)` (on delete cascade); `raised_by` → `user_profiles(id)` (on delete set null); `target_faculty` → `user_profiles(id)` (on delete set null)
- **`query_messages`**: `query_id` → `support_queries(id)` (on delete cascade); `sender_id` → `user_profiles(id)` (on delete set null)
- **`roster_import_batches`**: `cycle_id` → `academic_cycles(id)`; `semester_cycle_id` → `semester_cycles(id)` (on delete set null); `uploaded_by` → `user_profiles(id)` (on delete set null)
- **`semester_cycles`**: `created_by` → `user_profiles(id)` (on delete set null)
- **`senior_mentor_sections`** (0042): `assigned_by` → `user_profiles(id)` (on delete set null); `senior_id` → `user_profiles(id)` (on delete cascade)
- **`student_achievements`**: `student_id` → `user_profiles(id)` (on delete cascade); `verified_by` → `user_profiles(id)` (on delete set null)
- **`student_attendance_records`**: `batch_id` → `academic_upload_batches(id)` (on delete set null); `course_id` → `cluster_head_courses(id)` (on delete cascade); `cycle_id` → `academic_cycles(id)`; `recorded_by` → `user_profiles(id)` (on delete set null); `student_id` → `user_profiles(id)` (on delete cascade)
- **`student_backlogs`**: `batch_id` → `academic_upload_batches(id)` (on delete set null); `cycle_id` → `academic_cycles(id)`; `recorded_by` → `user_profiles(id)` (on delete set null); `student_id` → `user_profiles(id)` (on delete cascade)
- **`student_black_dots`**: `batch_id` → `academic_upload_batches(id)` (on delete set null); `cycle_id` → `academic_cycles(id)`; `recorded_by` → `user_profiles(id)` (on delete set null); `student_id` → `user_profiles(id)` (on delete cascade)
- **`student_cgpas`**: `batch_id` → `academic_upload_batches(id)` (on delete set null); `recorded_by` → `user_profiles(id)` (on delete set null); `student_id` → `user_profiles(id)` (on delete cascade)
- **`student_course_sections`**: `course_id` → `cluster_head_courses(id)` (on delete cascade); `student_id` → `user_profiles(id)` (on delete cascade)
- **`student_form_a_profiles`**: `student_id` → `user_profiles(id)` (on delete cascade); `unlocked_by` → `user_profiles(id)` (on delete set null)
- **`student_risk_flags`**: `student_id` → `user_profiles(id)` (on delete cascade)
- **`student_semester_gpas`**: `batch_id` → `academic_upload_batches(id)` (on delete set null); `recorded_by` → `user_profiles(id)` (on delete set null); `student_id` → `user_profiles(id)` (on delete cascade)
- **`support_queries`**: `escalated_by` → `user_profiles(id)` (on delete set null); `mentor_id` → `user_profiles(id)` (on delete restrict: a senior's account can only be deleted once their queries have moved, which `npm run db:seniors` does); `mom_id` → `mom_records(id)` (on delete set null); `referred_to_faculty` → `user_profiles(id)` (on delete set null, 0042); `resolved_by` → `user_profiles(id)` (on delete set null); `student_id` → `user_profiles(id)` (on delete cascade)
- **`survey_cycles`**: `opened_by` → `user_profiles(id)` (on delete set null)
- **`survey_response_answers`**: `question_id` → `survey_questions(id)` (on delete cascade); `response_id` → `survey_responses(id)` (on delete cascade)
- **`survey_responses`**: `cycle_id` → `survey_cycles(id)` (on delete cascade); `mentor_id` → `user_profiles(id)` (on delete set null); `student_id` → `user_profiles(id)` (on delete cascade)
- **`user_profiles`**: `assigned_mentor_id` → `user_profiles(id)` (on delete set null); `hod_id` → `user_profiles(id)` (on delete set null, 0039); `id` → `auth.users(id)` (on delete cascade); `star_mentee_assigned_by` → `user_profiles(id)` (on delete set null)

### 7.3 Enum types

Real Postgres enums. Any value added in SQL must also be mirrored in `frontend/src/lib/constants.js` where the UI offers it.

| Enum | Values | Created in |
|---|---|---|
| `academic_upload_type` | attendance · gpa · backlog · black_dot | 0020, 0034 |
| `achievement_category` | sports · cultural · technical · volunteering · certification · leadership · other | 0001 |
| `at_risk_meeting_status` | awaiting_link · scheduled · completed · cancelled | 0020 |
| `confirmation_response` | yes · no | 0001 |
| `cycle_job_status` | running · succeeded · failed | 0020 |
| `cycle_job_trigger` | scheduled · manual | 0020 |
| `cycle_job_type` | survey_cycle · survey_reminder_sweep · at_risk_sweep · at_risk_meeting_dispatch | 0020 |
| `employment_status` | active · on_leave · departed | 0001 |
| `gpa_source` | student · cluster_head | 0020 |
| `notification_type` | query_created · query_message · query_resolution_pending · query_confirmed · query_reopened · query_rated · mentor_reassigned · star_mentee_assigned · achievement_verified · onboarding_reminder · account_provisioned · query_escalated · student_at_risk · at_risk_meeting_required · at_risk_cleared · survey_published · survey_reminder · academic_data_uploaded · counselling_request | 0001 |
| `parent_occupation` | Entrepreneur · Family Business · Public Sector · Professional · Govt. Employee · Pvt. Company · Home Maker | 0001 |
| `query_category` (was `ticket_category` before 0031) | Academic · ERP/Tech · Infrastructure · Academics · Examination · Behavioural · Administrative · Others | 0001 |
| `query_priority` (was `ticket_priority` before 0031) | Low · Medium · High · Urgent | 0001 |
| `query_status` (was `ticket_status` before 0031) | Open · In Progress · Resolved | 0001 |
| `resolution_status` | none · pending_confirmation · confirmed · reopened | 0001 |
| `roster_import_type` | faculty · student · combined | 0001 |
| `semester_term` | Odd · Even | 0001 (used by `semester_cycles`; since 0036 also the odd and even semesters of an academic cycle) |
| `user_role` | student · faculty · hod · cluster_head · admin | 0001, 0020, 0038 |

### 7.4 Tables

#### `academic_cycle_students`

Which students are active in which cycle, with the semester, section, branch and mentor they had in it. Filled by new accounts, the roster import, the mentor mapping and "carry over"; the active cycle's rows follow the profile as it changes.

*created in migration 0036 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `cycle_id` | uuid | not null |  | **PK** (with `student_id`); FK → `academic_cycles(id) on delete cascade` |
| `student_id` | uuid | not null |  | **PK**; FK → `user_profiles(id) on delete cascade` |
| `semester_label` | text |  |  | The student's semester in that cycle |
| `section` | text |  |  |  |
| `branch` | text |  |  |  |
| `mentor_id` | uuid |  |  | FK → `user_profiles(id) on delete set null`; the mentor in that cycle |
| `activated_via` | text | not null | `'roster'::text` | How the student joined the cycle; the first way is kept |
| `activated_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `academic_cycle_students_via` — `CHECK (activated_via = ANY (ARRAY['existing', 'account', 'roster', 'mentor_map', 'carried_over', 'profile']))`
- index `academic_cycle_students_mentor_idx` — `btree (cycle_id, mentor_id)`
- index `academic_cycle_students_student_idx` — `btree (student_id)`

RLS policies:

- `cycle_students_select_visible` — **SELECT** to authenticated; using `can_access_student(student_id)`

Grants: `authenticated`: SELECT. Written only by the cycle functions and the trigger `trg_sync_student_cycle_enrollment` on `user_profiles`.

#### `academic_cycles`

One academic year ("2026-27") with an odd and an even semester. Exactly one is active; uploads, rosters, subjects, attendance, backlogs and black dots are filed against it. Written only by create_academic_cycle / update_academic_cycle_dates / delete_academic_cycle.

*created in migration 0036 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `start_year` | smallint | not null |  | 2026 for 2026-27 |
| `label` | text |  | generated: `start_year \|\| '-' \|\| lpad(((start_year + 1) % 100)::text, 2, '0')` | "2026-27"; the UI shows "2026–27" |
| `starts_on` | date | not null |  | The odd semester starts |
| `even_starts_on` | date | not null |  | The even semester starts; a date before it is in the odd semester |
| `ends_on` | date | not null |  |  |
| `is_active` | boolean | not null | `false` |  |
| `activated_at` | timestamp with time zone |  |  |  |
| `closed_at` | timestamp with time zone |  |  | Set when the next cycle starts |
| `created_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `academic_cycles_one_per_year` — `UNIQUE (start_year)`
- `academic_cycles_year_range` — `CHECK (start_year BETWEEN 2000 AND 2098)`
- `academic_cycles_dates_ordered` — `CHECK ((starts_on < even_starts_on) AND (even_starts_on <= ends_on))`
- `academic_cycles_dates_near_year` — `CHECK ((starts_on >= make_date(start_year - 1, 1, 1)) AND (ends_on < make_date(start_year + 2, 1, 1)))`
- index `academic_cycles_one_active` — `unique btree ((true)) WHERE is_active`: at most one active cycle

RLS policies:

- `academic_cycles_select_all` — **SELECT** to authenticated; using `true`

Grants: `authenticated`: SELECT

Triggers:

- `trg_academic_cycles_updated_at` — before update → `set_updated_at_timestamp()`

#### `academic_upload_batches`

One row per Cluster Head upload (attendance / GPA / backlog / black dot), including the rows that could not be matched to a student.

*created in migration 0021 · RLS enabled*

> **Doc note:** `skipped_rows` is written only by the GPA upload (rows with nothing graded); it is 0 for the others. `scope_label` (0035) is written by the GPA, backlog and black dot uploads and is NULL on attendance and older rows.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `uploaded_by` | uuid |  |  | FK → `user_profiles(id) on delete cascade` |
| `upload_type` | academic_upload_type | not null |  |  |
| `course_id` | uuid |  |  | FK → `cluster_head_courses(id) on delete set null` |
| `section_label` | text |  |  |  |
| `period_start` | date |  |  |  |
| `period_end` | date |  |  |  |
| `semester_number` | smallint |  |  |  |
| `original_filename` | text | not null |  |  |
| `total_rows` | integer | not null | `0` |  |
| `matched_rows` | integer | not null | `0` |  |
| `skipped_rows` | integer | not null | `0` |  |
| `failed_rows` | integer | not null | `0` |  |
| `row_errors` | jsonb | not null | `'[]'::jsonb` |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `scope_label` | text |  |  | What the file covered: "Semesters 1, 2 + CGPA", "Semester 3 · END TERM …", "2 cases" |
| `cycle_id` | uuid | not null |  | FK → `academic_cycles(id)`; set by `trg_upload_batches_cycle` (0036) |

Constraints and indexes:

- `academic_upload_batches_semester_range` — `CHECK (((semester_number IS NULL) OR ((semester_number >= 1) AND (semester_number <= 8))))`
- index `academic_upload_batches_owner_idx` — `btree (uploaded_by, created_at DESC)`
- index `academic_upload_batches_cycle_idx` — `btree (cycle_id, created_at DESC)`

RLS policies:

- `academic_batches_select_hod` — **SELECT** to authenticated; using `is_hod()`
- `academic_batches_select_own` — **SELECT** to authenticated; using `(uploaded_by = auth.uid())`

Grants: `authenticated`: SELECT

Triggers:

- `trg_upload_batches_cycle` — before insert → `tag_row_with_active_cycle('required')`

#### `api_rate_limits`

Fixed-window counters for the privileged serverless endpoints. Written by the service role only.

*created in migration 0015 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `bucket_key` | text | not null |  | **PK** |
| `window_start` | timestamp with time zone | not null |  | **PK** |
| `request_count` | integer | not null | `0` |  |

Constraints and indexes:

- index `api_rate_limits_window_idx` — `btree (window_start)`

RLS policies: **none** — no client role can read or write this table directly; only SECURITY DEFINER functions and the service role reach it.

#### `at_risk_meetings`

*created in migration 0022 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `student_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `mentor_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `status` | at_risk_meeting_status | not null | `'awaiting_link'::at_risk_meeting_status` |  |
| `reasons` | text[] | not null | `ARRAY[]::text[]` |  |
| `attendance_percent` | numeric(5,2) |  |  |  |
| `latest_gpa` | numeric(4,2) |  |  |  |
| `backlog_count` | integer | not null | `0` |  |
| `scheduled_for` | timestamp with time zone |  |  |  |
| `meeting_provider` | text |  |  |  |
| `meeting_join_url` | text |  |  | STUB. Filled in by create_at_risk_meeting_link() once Teams vs Google Meet is decided. Null is the expected value today and the rest of the flow does not depend on it. |
| `meeting_external_id` | text |  |  |  |
| `mentor_notified_at` | timestamp with time zone |  |  |  |
| `completed_at` | timestamp with time zone |  |  |  |
| `cancelled_at` | timestamp with time zone |  |  |  |
| `job_run_id` | uuid |  |  |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |
| `cycle_id` | uuid |  |  | FK → `academic_cycles(id) on delete set null`; set by `trg_at_risk_meetings_cycle` (0036) |
| `black_dot_count` | integer | not null | `0` | Snapshot of the student's black dots in the cycle (0036) |

Constraints and indexes:

- `at_risk_meetings_mentor_is_not_student` — `CHECK ((mentor_id <> student_id))`
- index `at_risk_meetings_mentor_idx` — `btree (mentor_id, created_at DESC)`
- index `at_risk_meetings_one_open_per_student_idx` — `unique btree (student_id) WHERE (status = ANY (ARRAY['awaiting_link'::at_risk_meeting_status, 'scheduled'::at_risk_meeting_status]))`

RLS policies:

- `meetings_select_visible` — **SELECT** to authenticated; using `((student_id = auth.uid()) OR (mentor_id = auth.uid()) OR ( SELECT is_admin() AS is_admin) OR (mentor_id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])))`
- `meetings_update_mentor` — **UPDATE** to authenticated; using `((mentor_id = auth.uid()) OR ( SELECT is_admin() AS is_admin) OR (mentor_id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])))`; check `((mentor_id = auth.uid()) OR ( SELECT is_admin() AS is_admin) OR (mentor_id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])))`

Grants: `authenticated`: SELECT,UPDATE

Triggers:

- `trg_at_risk_meetings_updated_at` — before update → `set_updated_at_timestamp()`
- `trg_notify_at_risk_meeting` — after insert → `notify_on_at_risk_meeting()`
- `trg_at_risk_meetings_cycle` — before insert → `tag_row_with_active_cycle('optional')`

#### `audit_log`

Append-only. No UPDATE or DELETE policy exists for any client role, including HOD.

*created in migration 0006 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | not null |  | **PK** |
| `actor_id` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `actor_role` | user_role |  |  |  |
| `action` | text | not null |  |  |
| `entity_type` | text |  |  |  |
| `entity_id` | text |  |  |  |
| `metadata` | jsonb | not null | `'{}'::jsonb` |  |
| `ip_address` | text |  |  |  |
| `user_agent` | text |  |  |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- index `audit_log_action_idx` — `btree (action, created_at DESC)`
- index `audit_log_actor_idx` — `btree (actor_id, created_at DESC)`
- index `audit_log_entity_idx` — `btree (entity_type, entity_id)`

RLS policies:

- `audit_log_admin_select` — **SELECT** to authenticated; using `( SELECT is_admin() AS is_admin)`

Grants: `authenticated`: SELECT

#### `canned_replies`

*created in migration 0006 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `owner_id` | uuid |  |  | FK → `user_profiles(id) on delete cascade` |
| `title` | text | not null |  |  |
| `body` | text | not null |  |  |
| `is_global` | boolean | not null | `false` |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `canned_reply_body_max_length` — `CHECK ((char_length(body) <= 2000))`
- `canned_reply_owner_or_global` — `CHECK (((is_global = true) OR (owner_id IS NOT NULL)))`
- `canned_reply_title_not_blank` — `CHECK (is_non_blank(title))`

RLS policies:

- `canned_delete_own` — **DELETE** to authenticated; using `(owner_id = auth.uid())`
- `canned_insert_own` — **INSERT** to authenticated; check `((owner_id = auth.uid()) AND (is_global = false) AND (is_faculty() OR is_hod()))`
- `canned_select_visible` — **SELECT** to authenticated; using `((is_faculty() OR is_hod()) AND (is_global OR (owner_id = auth.uid())))`
- `canned_update_own` — **UPDATE** to authenticated; using `(owner_id = auth.uid())`; check `((owner_id = auth.uid()) AND (is_global = false))`

Grants: `authenticated`: DELETE,INSERT,SELECT,UPDATE

Triggers:

- `trg_canned_replies_updated_at` — before update → `set_updated_at_timestamp()`

#### `cluster_head_courses`

The subjects a Cluster Head handles: course name and course code. Sections are not declared here — they are learned from the attendance export, in student_course_sections.

*created in migration 0021 · RLS enabled*

> **Doc note:** the policy `ch_courses_write_own` (FOR ALL) lets a cluster head write these rows directly, bypassing `submit_cluster_head_setup`. Deleting a course — including changing its code in My Subjects — cascades to `student_attendance_records` and `student_course_sections` (§4.11). Since 0036 each row belongs to one academic cycle, and a new cycle gets a copy of the list; the screens read `current_cycle_courses`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `cluster_head_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `course_name` | text | not null |  |  |
| `course_code` | text | not null |  |  |
| `display_order` | smallint | not null | `0` |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |
| `cycle_id` | uuid | not null |  | FK → `academic_cycles(id) on delete cascade`; set by `trg_courses_cycle` (0036) |

Constraints and indexes:

- `cluster_head_courses_code_not_blank` — `CHECK (is_non_blank(course_code))`
- `cluster_head_courses_name_not_blank` — `CHECK (is_non_blank(course_name))`
- index `cluster_head_courses_owner_idx` — `btree (cluster_head_id, display_order)`
- index `cluster_head_courses_unique_code_idx` — `unique btree (cluster_head_id, cycle_id, lower(course_code))` (per cycle since 0036)
- index `cluster_head_courses_cycle_idx` — `btree (cycle_id, cluster_head_id, display_order)`

RLS policies:

- `ch_courses_write_own` — **ALL** to authenticated; using `((cluster_head_id = auth.uid()) AND is_cluster_head())`; check `((cluster_head_id = auth.uid()) AND is_cluster_head())`
- `ch_courses_select_hod` — **SELECT** to authenticated; using `is_hod()`
- `ch_courses_select_own` — **SELECT** to authenticated; using `(cluster_head_id = auth.uid())`

Grants: `authenticated`: DELETE,INSERT,SELECT,UPDATE

Triggers:

- `trg_cluster_head_courses_updated_at` — before update → `set_updated_at_timestamp()`
- `trg_courses_cycle` — before insert → `tag_row_with_active_cycle('required')`

#### `counselling_requests`

Personal counselling requests. Readable by the student who wrote it and the mentor it was sent to — NOT by the HOD, unlike support_tickets. See the header of this migration before widening that.

*created in migration 0029 · RLS enabled*

> **Doc note:** "support_tickets" in the comment is now `support_queries`. The assigned mentor may also UPDATE these rows directly (`counselling_update_mentor`).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `student_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `mentor_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `concern` | text | not null |  |  |
| `status` | text | not null | `'open'::text` |  |
| `counselling_type` | text |  |  | 0040. One of the twelve types (§4.8); NULL only on requests sent before 0040 |
| `mentor_note` | text |  |  |  |
| `responded_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `responded_at` | timestamp with time zone |  |  |  |
| `closed_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `counselling_concern_max_length` — `CHECK ((char_length(concern) <= 3000))`
- `counselling_concern_not_blank` — `CHECK (is_non_blank(concern))`
- `counselling_mentor_is_not_student` — `CHECK ((mentor_id <> student_id))`
- `counselling_note_max_length` — `CHECK (((mentor_note IS NULL) OR (char_length(mentor_note) <= 3000)))`
- `counselling_status_valid` — `CHECK ((status = ANY (ARRAY['open'::text, 'acknowledged'::text, 'closed'::text])))`
- `counselling_type_valid` — `CHECK (((counselling_type IS NULL) OR (counselling_type = ANY (ARRAY['academic', 'personal', 'career', 'placement', 'financial', 'technical', 'health_wellness', 'behavioural', 'professional_development', 'higher_education', 'general_guidance', 'other']))))` (0040)
- index `counselling_mentor_open_idx` — `btree (mentor_id, created_at DESC) WHERE (status <> 'closed'::text)`
- index `counselling_student_idx` — `btree (student_id, created_at DESC)`

RLS policies:

- `counselling_select_two_parties` — **SELECT** to authenticated; using `((student_id = auth.uid()) OR (mentor_id = auth.uid()))`
- `counselling_update_mentor` — **UPDATE** to authenticated; using `(mentor_id = auth.uid())`; check `(mentor_id = auth.uid())`

Grants: `authenticated`: SELECT,UPDATE

Triggers:

- `trg_counselling_updated_at` — before update → `set_updated_at_timestamp()`
- `trg_notify_counselling` — after insert or update → `notify_on_counselling_request()`

#### `cycle_job_runs`

Every execution of a recurring job, scheduled or manual, with what it did. This is the audit trail for "did the trigger actually work".

*created in migration 0024 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `job_type` | cycle_job_type | not null |  |  |
| `trigger_source` | cycle_job_trigger | not null |  |  |
| `status` | cycle_job_status | not null | `'running'::cycle_job_status` |  |
| `triggered_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `started_at` | timestamp with time zone | not null | `now()` |  |
| `finished_at` | timestamp with time zone |  |  |  |
| `duration_ms` | integer |  |  |  |
| `result` | jsonb | not null | `'{}'::jsonb` |  |
| `error_message` | text |  |  |  |
| `note` | text |  |  |  |

Constraints and indexes:

- index `cycle_job_runs_recent_idx` — `btree (job_type, started_at DESC)`

RLS policies:

- `cycle_runs_select_hod` — **SELECT** to authenticated; using `is_hod()`

Grants: `authenticated`: SELECT

#### `cycle_job_schedule`

The 15-day clock. Independent of Cluster Head uploads by design: nothing in the upload path reads or writes next_run_due_on.

*created in migration 0024 · RLS enabled*

> **Doc note:** the reminder job runs every 7 days, not 15. Nothing runs these jobs automatically (§4.16).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `job_type` | cycle_job_type | not null |  | **PK** |
| `interval_days` | integer | not null | `15` |  |
| `is_enabled` | boolean | not null | `true` |  |
| `next_run_due_on` | date | not null | `CURRENT_DATE` |  |
| `last_run_at` | timestamp with time zone |  |  |  |
| `last_run_status` | cycle_job_status |  |  |  |
| `last_manual_run_at` | timestamp with time zone |  |  |  |
| `description` | text |  |  |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `cycle_job_interval_sane` — `CHECK (((interval_days >= 1) AND (interval_days <= 365)))`

RLS policies:

- `cycle_schedule_select_hod` — **SELECT** to authenticated; using `is_hod()`

Grants: `authenticated`: SELECT

Triggers:

- `trg_cycle_job_schedule_updated_at` — before update → `set_updated_at_timestamp()`

#### `mentor_reassignment_log`

*created in migration 0006 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `student_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `from_mentor_id` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `to_mentor_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `reason` | text |  |  |  |
| `performed_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `created_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `reassignment_changes_mentor` — `CHECK (((from_mentor_id IS NULL) OR (from_mentor_id <> to_mentor_id)))`
- index `reassignment_from_idx` — `btree (from_mentor_id)`
- index `reassignment_student_idx` — `btree (student_id, created_at DESC)`

RLS policies:

- `reassignment_log_hod_select` — **SELECT** to authenticated; using `(( SELECT is_admin() AS is_admin) OR (from_mentor_id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])) OR (to_mentor_id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])))`
- `reassignment_log_own_select` — **SELECT** to authenticated; using `(student_id = auth.uid())`

Grants: `authenticated`: SELECT

#### `mom_records`

Class-representative meeting minutes. Append-only: no UPDATE or DELETE policy exists for anyone. The action items raised in the meeting are support_tickets carrying this row's id in mom_id.

*created in migration 0027 · RLS enabled*

> **Doc note:** "support_tickets" in the comment is now `support_queries` (renamed in 0031).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `reported_by` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `mentor_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `meeting_date` | date | not null |  |  |
| `students_present` | integer |  |  |  |
| `students_total` | integer |  |  |  |
| `notes` | text | not null |  |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `mom_attendance_sane` — `CHECK (((students_present IS NULL) OR (students_total IS NULL) OR ((students_present >= 0) AND (students_present <= students_total))))`
- `mom_date_not_future` — `CHECK ((meeting_date <= CURRENT_DATE))`
- `mom_notes_max_length` — `CHECK ((char_length(notes) <= 5000))`
- `mom_notes_not_blank` — `CHECK (is_non_blank(notes))`
- `mom_reporter_is_not_mentor` — `CHECK ((reported_by <> mentor_id))`
- index `mom_records_mentor_idx` — `btree (mentor_id, meeting_date DESC)`
- index `mom_records_reporter_idx` — `btree (reported_by, meeting_date DESC)`

RLS policies:

- `mom_select_participants` — **SELECT** to authenticated; using `((reported_by = auth.uid()) OR (mentor_id = auth.uid()) OR ( SELECT is_admin() AS is_admin) OR (mentor_id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])))`

Grants: `authenticated`: SELECT

#### `notifications`

In-app notifications. Written only by database triggers and the service role — never directly by a client.

*created in migration 0005 · RLS enabled · published to Realtime*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `recipient_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `actor_id` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `type` | notification_type | not null |  |  |
| `title` | text | not null |  |  |
| `body` | text |  |  |  |
| `query_id` | uuid |  |  | FK → `support_queries(id) on delete cascade` |
| `link_path` | text |  |  |  |
| `is_read` | boolean | not null | `false` |  |
| `read_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `notification_read_has_timestamp` — `CHECK (((is_read = false) OR (read_at IS NOT NULL)))`
- `notification_title_not_blank` — `CHECK (is_non_blank(title))`
- index `notifications_query_idx` — `btree (query_id)`
- index `notifications_recipient_idx` — `btree (recipient_id, created_at DESC)`
- index `notifications_unread_idx` — `btree (recipient_id) WHERE (is_read = false)`

RLS policies:

- `notifications_delete_own` — **DELETE** to authenticated; using `(recipient_id = auth.uid())`
- `notifications_select_own` — **SELECT** to authenticated; using `(recipient_id = auth.uid())`
- `notifications_update_own` — **UPDATE** to authenticated; using `(recipient_id = auth.uid())`; check `(recipient_id = auth.uid())`

Grants: `authenticated`: DELETE,SELECT,UPDATE

#### `query_escalations`

Every referral of a query to a faculty mentor and every escalation to the HOD, with the reason (0042). Readable by the people handling the query, not by the student.

*created in migration 0042 · RLS enabled*

> **Doc note:** written only by `escalate_query_to_hod` (raised by `faculty`, to `hod`, the note as the reason) and `escalate_peer_query` (raised by `senior`, to `faculty` or `hod`). 0042 backfilled one row for every query escalated before it.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `query_id` | uuid | not null |  | FK → `support_queries(id) on delete cascade` |
| `raised_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `raised_by_kind` | text | not null |  | `'faculty'` or `'senior'` |
| `raised_to` | text | not null |  | `'faculty'` or `'hod'` |
| `target_faculty` | uuid |  |  | FK → `user_profiles(id) on delete set null`. The faculty mentor, for `raised_to = 'faculty'` |
| `reason` | text |  |  | Required for a senior; the mentor's optional note for a faculty referral |
| `created_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `escalation_raised_by_kind_valid` — `CHECK ((raised_by_kind = ANY (ARRAY['faculty'::text, 'senior'::text])))`
- `escalation_raised_to_valid` — `CHECK ((raised_to = ANY (ARRAY['faculty'::text, 'hod'::text])))`
- `escalation_reason_length` — `CHECK (((reason IS NULL) OR (char_length(reason) <= 1000)))`
- index `query_escalations_query_idx` — `btree (query_id, created_at DESC)`

RLS policies:

- `escalations_select_handlers` — **SELECT** to authenticated; using `can_handle_query(query_id)`

Grants: `authenticated`: SELECT

#### `query_messages`

Messages on a ticket. Inserted only through post_ticket_message() so authorisation and side-effects always run.

*created in migration 0004 · renamed from `ticket_messages` in 0031 · RLS enabled · published to Realtime*

> **Doc note:** the comment names `post_ticket_message()`; the function is now `post_query_message()`. System messages are also inserted by `create_support_query`, `resolve_support_query`, `confirm_query_resolution`, `escalate_query_to_hod`, `set_query_in_progress` and `submit_mom_report`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `query_id` | uuid | not null |  | FK → `support_queries(id) on delete cascade` |
| `sender_id` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `body` | text | not null |  |  |
| `is_system_message` | boolean | not null | `false` |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `message_body_max_length` — `CHECK ((char_length(body) <= 5000))`
- `message_body_not_blank` — `CHECK (is_non_blank(body))`
- index `query_messages_query_idx` — `btree (query_id, created_at)`
- index `query_messages_sender_idx` — `btree (sender_id)`

RLS policies:

- `messages_select_participants` — **SELECT** to authenticated; using `can_access_query(query_id)`

Grants: `authenticated`: SELECT

Triggers:

- `trg_notify_query_message` — after insert → `notify_on_query_message()`

#### `roster_import_batches`

*created in migration 0006 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `semester_cycle_id` | uuid |  |  | FK → `semester_cycles(id) on delete set null` |
| `import_type` | roster_import_type | not null |  |  |
| `original_filename` | text | not null |  |  |
| `total_rows` | integer | not null | `0` |  |
| `created_count` | integer | not null | `0` |  |
| `skipped_count` | integer | not null | `0` |  |
| `failed_count` | integer | not null | `0` |  |
| `row_errors` | jsonb | not null | `'[]'::jsonb` |  |
| `uploaded_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `cycle_id` | uuid |  |  | FK → `academic_cycles(id)`; the academic cycle the import went into, set by `trg_roster_batches_cycle` (0036). `semester_cycle_id` is the retired wizard's link and is no longer written. |

Constraints and indexes:

- index `roster_batches_cycle_idx` — `btree (semester_cycle_id, created_at DESC)`
- index `roster_import_batches_cycle_idx` — `btree (cycle_id, created_at DESC)`

RLS policies:

- `roster_batches_hod_select` — **SELECT** to authenticated; using `is_hod()`
- `roster_batches_own_select` — **SELECT** to authenticated; using `(uploaded_by = auth.uid())`

Grants: `authenticated`: SELECT

Triggers:

- `trg_roster_batches_cycle` — before insert → `tag_row_with_active_cycle('optional')`

#### `semester_cycles`

HOD semester initialisation wizard state (5-step stepper).

*created in migration 0006 · RLS enabled*

> **Doc note:** stale. The HOD semester wizard was removed; no page writes this table. Only the roster import touches it, and only when a `semester_cycle_id` is sent (the UI never sends one). It has nothing to do with the **academic cycles** of 0036 (`academic_cycles`, §4.24), which replaced the idea.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `academic_year` | text | not null |  |  |
| `term` | semester_term | not null | `'Odd'::semester_term` |  |
| `is_initialized` | boolean | not null | `false` |  |
| `current_step` | smallint | not null | `1` |  |
| `faculty_imported_count` | integer | not null | `0` |  |
| `student_imported_count` | integer | not null | `0` |  |
| `initialized_at` | timestamp with time zone |  |  |  |
| `created_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `one_cycle_per_term` — `UNIQUE (academic_year, term)`
- `semester_step_range` — `CHECK (((current_step >= 1) AND (current_step <= 5)))`
- `semester_year_shape` — `CHECK ((academic_year ~ '^[0-9]{4}-[0-9]{2}$'::text))`

RLS policies:

- `semester_cycles_hod_all` — **ALL** to authenticated; using `is_hod()`; check `is_hod()`

Grants: `authenticated`: DELETE,INSERT,SELECT,UPDATE

Triggers:

- `trg_semester_cycles_updated_at` — before update → `set_updated_at_timestamp()`

#### `senior_mentor_sections`

Which sections each senior mentor looks after (0042). Written only by set_senior_mentor_sections().

*created in migration 0042 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `section` | text | not null |  | **PK**. "A 3" … "T 4": one senior per section |
| `senior_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `assigned_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `assigned_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `senior_section_known` — `CHECK ((section ~ '^[A-T] [34]$'::text))`
- index `senior_mentor_sections_senior_idx` — `btree (senior_id)`

RLS policies:

- `senior_sections_select` — **SELECT** to authenticated; using `((senior_id = auth.uid()) OR ( SELECT is_hod() AS is_hod))`

Grants: `authenticated`: SELECT

#### `student_achievements`

Feature 6 — student-maintained achievements outside academics. Mentor may verify (badge only, never blocks display).

*created in migration 0005 · RLS enabled · published to Realtime*

> **Doc note:** stale. Verification does lock the entry: RLS allows the student to update or delete only while `verified_by_faculty = false`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `student_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `title` | text | not null |  |  |
| `category` | achievement_category | not null | `'other'::achievement_category` |  |
| `description` | text |  |  |  |
| `achieved_on` | date |  |  |  |
| `proof_file_path` | text |  |  |  |
| `verified_by_faculty` | boolean | not null | `false` |  |
| `verified_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `verified_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `achievement_date_not_future` — `CHECK (((achieved_on IS NULL) OR (achieved_on <= CURRENT_DATE)))`
- `achievement_desc_max_length` — `CHECK (((description IS NULL) OR (char_length(description) <= 2000)))`
- `achievement_title_max_length` — `CHECK ((char_length(title) <= 200))`
- `achievement_title_not_blank` — `CHECK (is_non_blank(title))`
- `achievement_verified_has_verifier` — `CHECK (((verified_by_faculty = false) OR (verified_by IS NOT NULL)))`
- index `achievements_category_idx` — `btree (category)`
- index `achievements_student_idx` — `btree (student_id, achieved_on DESC)`

RLS policies:

- `achievements_delete_own` — **DELETE** to authenticated; using `((student_id = auth.uid()) AND (verified_by_faculty = false))`
- `achievements_insert_own` — **INSERT** to authenticated; check `((student_id = auth.uid()) AND is_student() AND (verified_by_faculty = false))`
- `achievements_select_visible` — **SELECT** to authenticated; using `can_access_student(student_id)`
- `achievements_update_own` — **UPDATE** to authenticated; using `((student_id = auth.uid()) AND (verified_by_faculty = false))`; check `((student_id = auth.uid()) AND (verified_by_faculty = false))`

Grants: `authenticated`: DELETE,INSERT,SELECT,UPDATE

Triggers:

- `trg_achievements_updated_at` — before update → `set_updated_at_timestamp()`
- `trg_notify_achievement_verified` — after update of verified_by_faculty → `notify_on_achievement_verified()`

#### `student_attendance_records`

Attendance per student, per course, per reporting period. Uploaded by a Cluster Head on any day — there is no date restriction on when an upload may happen.

*created in migration 0021 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `student_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `course_id` | uuid | not null |  | FK → `cluster_head_courses(id) on delete cascade` |
| `section_label` | text | not null |  | The TEACHING section for this course, from the export header. Unrelated to the student's Form A / profile section, and expected to differ. |
| `period_start` | date | not null |  |  |
| `period_end` | date | not null |  |  |
| `classes_held` | integer |  |  |  |
| `classes_attended` | integer |  |  |  |
| `batch_id` | uuid |  |  | FK → `academic_upload_batches(id) on delete set null` |
| `recorded_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |
| `course_code` | text |  |  |  |
| `course_name` | text |  |  |  |
| `attendance_percent` | numeric(5,2) | not null |  | Taken verbatim from the "%" column of the ERP export. Never recomputed from classes_held/classes_attended — the portal must not disagree with the ERP. |
| `cycle_id` | uuid | not null |  | FK → `academic_cycles(id)`; its subject's cycle, set by `trg_attendance_cycle` (0036) |

Constraints and indexes:

- `attendance_attended_sane` — `CHECK (((classes_attended IS NULL) OR ((classes_attended >= 0) AND ((classes_held IS NULL) OR (classes_attended <= classes_held)))))`
- `attendance_classes_held_sane` — `CHECK (((classes_held IS NULL) OR ((classes_held >= 0) AND (classes_held <= 2000))))`
- `attendance_one_row_per_period` — `UNIQUE (student_id, course_id, period_start)`
- `attendance_percent_range` — `CHECK (((attendance_percent >= (0)::numeric) AND (attendance_percent <= (100)::numeric)))`
- `attendance_period_ordered` — `CHECK ((period_end >= period_start))`
- index `student_attendance_course_idx` — `btree (course_id, section_label)`
- index `student_attendance_student_idx` — `btree (student_id, period_start DESC)`
- index `student_attendance_records_cycle_idx` — `btree (cycle_id, student_id, course_id, period_start DESC)`

RLS policies:

- `attendance_select_owner` — **SELECT** to authenticated; using `(EXISTS ( SELECT 1
   FROM cluster_head_courses c
  WHERE ((c.id = student_attendance_records.course_id) AND (c.cluster_head_id = auth.uid()))))`
- `attendance_select_visible` — **SELECT** to authenticated; using `can_access_student(student_id)`

Grants: `authenticated`: SELECT

Triggers:

- `trg_student_attendance_updated_at` — before update → `set_updated_at_timestamp()`
- `trg_attendance_cycle` — before insert → `tag_attendance_with_cycle()`

#### `student_backlogs`

One row per backlog subject. A single row with is_cleared = false is enough to satisfy the at-risk backlog condition.

*created in migration 0021 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `student_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `subject_code` | text | not null |  |  |
| `subject_name` | text |  |  |  |
| `semester_number` | smallint |  |  |  |
| `exam_session` | text |  |  |  |
| `is_cleared` | boolean | not null | `false` |  |
| `cleared_at` | timestamp with time zone |  |  |  |
| `batch_id` | uuid |  |  | FK → `academic_upload_batches(id) on delete set null` |
| `recorded_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |
| `grade` | text |  |  | The defaulter grade (F, UFM, DT …), kept after clearing (0035) |
| `credits` | numeric(4,2) |  |  | From the result's subject table (0035) |
| `cycle_id` | uuid | not null |  | FK → `academic_cycles(id)`; the cycle it was first recorded in, set by `trg_backlogs_cycle` (0036) |

Constraints and indexes:

- `student_backlogs_code_not_blank` — `CHECK (is_non_blank(subject_code))`
- `student_backlogs_semester_range` — `CHECK (((semester_number IS NULL) OR ((semester_number >= 1) AND (semester_number <= 8))))`
- `student_backlogs_unique` — `UNIQUE (student_id, subject_code, semester_number)` (the upload functions match `upper(subject_code)` and store codes upper-case since 0035)
- index `student_backlogs_student_idx` — `btree (student_id) WHERE (is_cleared = false)`
- index `student_backlogs_open_by_subject_idx` — `btree (semester_number, upper(subject_code)) WHERE (is_cleared = false)` (0035)
- index `student_backlogs_cycle_idx` — `btree (cycle_id)`

RLS policies:

- `backlogs_select_uploader` — **SELECT** to authenticated; using `((recorded_by = auth.uid()) AND is_cluster_head())`
- `backlogs_select_visible` — **SELECT** to authenticated; using `can_access_student(student_id)`

Grants: `authenticated`: SELECT

Triggers:

- `trg_student_backlogs_updated_at` — before update → `set_updated_at_timestamp()`
- `trg_backlogs_cycle` — before insert → `tag_row_with_active_cycle('required')`

#### `student_black_dots`

Disciplinary black dots from Proctorial Board notices, one row per student per case. Uploaded by a Cluster Head; not part of the at-risk rule.

*created in migration 0035 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `student_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `case_number` | text | not null |  | Normalised ("034/Even Sem/2026") |
| `case_details` | text |  |  | What the case is about, from the case line |
| `incident_date` | date |  |  | Only when the notice gives a complete date |
| `incident_date_text` | text |  |  | As written ("14TH August") |
| `hostel_block` | text |  |  | "B7" or "Day scholar" |
| `room_no` | text |  |  |  |
| `course_branch` | text |  |  | "B Tech ECE, Sec- F1" |
| `mobile_no` | text |  |  | As written in the notice |
| `previous_record` | text |  |  | As written ("1 black dot", "NIL") |
| `previous_black_dots` | smallint |  |  | The number read from it (NIL → 0) |
| `batch_id` | uuid |  |  | FK → `academic_upload_batches(id) on delete set null` |
| `recorded_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |
| `cycle_id` | uuid | not null |  | FK → `academic_cycles(id)`; the cycle the incident date falls in, else the active one, set by `trg_black_dots_cycle` (0036). Only the active cycle's black dots count towards the at-risk rule. |

Constraints and indexes:

- `student_black_dots_case_not_blank` — `CHECK (is_non_blank(case_number))`
- `student_black_dots_previous_sane` — `CHECK ((previous_black_dots IS NULL) OR ((previous_black_dots >= 0) AND (previous_black_dots <= 100)))`
- unique index `student_black_dots_one_per_case` — `btree (student_id, lower(case_number))`
- index `student_black_dots_student_idx` — `btree (student_id, incident_date DESC)`
- index `student_black_dots_cycle_idx` — `btree (cycle_id, student_id)`

RLS policies:

- `black_dots_select_uploader` — **SELECT** to authenticated; using `((recorded_by = auth.uid()) AND is_cluster_head())`
- `black_dots_select_visible` — **SELECT** to authenticated; using `can_access_student(student_id)`

Grants: `authenticated`: SELECT (written only by `record_black_dot_batch`)

Triggers:

- `trg_student_black_dots_updated_at` — before update → `set_updated_at_timestamp()`
- `trg_black_dots_cycle` — before insert → `tag_black_dot_with_cycle()`

#### `student_cgpas`

Official CGPA and credit totals per student, from the ERP export uploaded by a Cluster Head. Same visibility as semester GPAs.

*created in migration 0035 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `student_id` | uuid | not null |  | **PK**; FK → `user_profiles(id) on delete cascade` |
| `cgpa` | numeric(4,2) | not null |  | Credit-weighted, as the university computes it |
| `total_earned_credits` | numeric(6,2) |  |  |  |
| `total_required_credits` | numeric(6,2) |  |  |  |
| `batch_id` | uuid |  |  | FK → `academic_upload_batches(id) on delete set null` |
| `recorded_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `student_cgpas_range` — `CHECK ((cgpa >= 0) AND (cgpa <= 10))`
- `student_cgpas_credits_sane` — both totals NULL or between 0 and 400

RLS policies:

- `cgpas_select_permitted` — **SELECT** to authenticated; using `can_view_student_gpa(student_id)`

Grants: `authenticated`: SELECT (written only by `record_gpa_batch`; cluster heads cannot read it)

Triggers:

- `trg_student_cgpas_updated_at` — before update → `set_updated_at_timestamp()`

#### `student_course_sections`

Student -> section mapping, learned from the first attendance upload for that course/section. No separate data-entry step exists by design.

*created in migration 0021 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `student_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `course_id` | uuid | not null |  | FK → `cluster_head_courses(id) on delete cascade` |
| `section_label` | text | not null |  | Teaching section for this course, e.g. "B" or "R 3". Unrelated to the student's roster section, and expected to differ. |
| `first_seen_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `student_course_sections_label_shape` — `CHECK ((section_label ~ '^[A-Za-z0-9][A-Za-z0-9 .-]{0,11}$'::text))`
- `student_course_sections_unique` — `UNIQUE (student_id, course_id)`
- index `student_course_sections_course_idx` — `btree (course_id, section_label)`

RLS policies:

- `student_sections_select_owner` — **SELECT** to authenticated; using `(EXISTS ( SELECT 1
   FROM cluster_head_courses c
  WHERE ((c.id = student_course_sections.course_id) AND (c.cluster_head_id = auth.uid()))))`
- `student_sections_select_visible` — **SELECT** to authenticated; using `can_access_student(student_id)`

Grants: `authenticated`: SELECT

#### `student_form_a_profiles`

Feature 1 — digitised Mentor-Mentee Scheme Form A. One-time institutional form; read-only after submission until an HOD unlocks it.

*created in migration 0003 · RLS enabled*

> **Doc note:** stale. Since 0017 the student can edit Form A at any time; `submit_student_form_a` resets `is_locked` on every save. `is_locked`, `unlock_requested*` and `unlocked_by` are vestigial.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `student_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `full_name` | text | not null |  |  |
| `registration_no` | text | not null |  |  |
| `section` | text |  |  |  |
| `roll_no` | text |  |  |  |
| `branch` | text |  |  |  |
| `mobile_no` | text | not null |  |  |
| `email` | text | not null |  |  |
| `hostel_block` | text |  |  |  |
| `room_no` | text |  |  |  |
| `blood_group` | text |  |  |  |
| `date_of_birth` | date |  |  |  |
| `is_day_scholar` | boolean | not null | `false` |  |
| `has_muj_alumni_in_family` | boolean | not null | `false` |  |
| `alumni_name` | text |  |  |  |
| `alumni_branch` | text |  |  |  |
| `alumni_batch` | text |  |  |  |
| `alumni_institution` | text |  |  |  |
| `alumni_relationship` | text |  |  |  |
| `father_name` | text | not null |  |  |
| `father_occupation` | parent_occupation |  |  |  |
| `father_organization` | text |  |  |  |
| `father_designation` | text |  |  |  |
| `father_mobile` | text |  |  |  |
| `father_email` | text |  |  |  |
| `mother_name` | text | not null |  |  |
| `mother_occupation` | parent_occupation |  |  |  |
| `mother_organization` | text |  |  |  |
| `mother_designation` | text |  |  |  |
| `mother_mobile` | text |  |  |  |
| `mother_email` | text |  |  |  |
| `communication_address` | text | not null |  |  |
| `communication_pin_code` | text | not null |  |  |
| `permanent_same_as_communication` | boolean | not null | `false` |  |
| `permanent_address` | text | not null |  |  |
| `permanent_pin_code` | text | not null |  |  |
| `parent_business_card_path` | text |  |  |  |
| `student_signature_path` | text |  |  |  |
| `gpa_sharing_enabled` | boolean | not null | `true` |  |
| `is_submitted` | boolean | not null | `false` |  |
| `submitted_at` | timestamp with time zone |  |  |  |
| `is_locked` | boolean | not null | `false` |  |
| `unlock_requested` | boolean | not null | `false` |  |
| `unlock_requested_at` | timestamp with time zone |  |  |  |
| `unlocked_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `form_a_alumni_details_required_when_yes` — `CHECK (((has_muj_alumni_in_family = false) OR is_non_blank(alumni_name)))`
- `form_a_blood_group_valid` — `CHECK (((blood_group IS NULL) OR (blood_group = ANY (ARRAY['A+'::text, 'A-'::text, 'B+'::text, 'B-'::text, 'AB+'::text, 'AB-'::text, 'O+'::text, 'O-'::text]))))`
- `form_a_dob_is_plausible` — `CHECK (((date_of_birth IS NULL) OR ((date_of_birth > '1950-01-01'::date) AND (date_of_birth < CURRENT_DATE))))`
- `form_a_email_shape` — `CHECK ((email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text))`
- `form_a_father_email_shape` — `CHECK (((father_email IS NULL) OR (father_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text)))`
- `form_a_father_mobile_shape` — `CHECK (((father_mobile IS NULL) OR (father_mobile ~ '^[0-9]{10}$'::text)))`
- `form_a_hostel_required_unless_day_scholar` — `CHECK (((is_day_scholar = true) OR is_non_blank(hostel_block)))`
- `form_a_mobile_is_10_digits` — `CHECK ((mobile_no ~ '^[0-9]{10}$'::text))`
- `form_a_mother_email_shape` — `CHECK (((mother_email IS NULL) OR (mother_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text)))`
- `form_a_mother_mobile_shape` — `CHECK (((mother_mobile IS NULL) OR (mother_mobile ~ '^[0-9]{10}$'::text)))`
- `form_a_pin_codes_are_6_digits` — `CHECK (((communication_pin_code ~ '^[0-9]{6}$'::text) AND (permanent_pin_code ~ '^[0-9]{6}$'::text)))`
- `form_a_submitted_has_timestamp` — `CHECK (((is_submitted = false) OR (submitted_at IS NOT NULL)))`
- `student_form_a_profiles_student_id_key` — `UNIQUE (student_id)`
- index `form_a_student_idx` — `btree (student_id)`
- index `form_a_submitted_idx` — `btree (is_submitted)`
- index `form_a_unlock_requested_idx` — `btree (unlock_requested) WHERE (unlock_requested = true)`

RLS policies:

- `form_a_insert_own` — **INSERT** to authenticated; check `((student_id = auth.uid()) AND is_student())`
- `form_a_select_visible` — **SELECT** to authenticated; using `can_access_student(student_id)`
- `form_a_update_hod` — **UPDATE** to authenticated; using `oversees_student(student_id)`; check `oversees_student(student_id)`
- `form_a_update_own` — **UPDATE** to authenticated; using `(student_id = auth.uid())`; check `(student_id = auth.uid())`

Grants: `authenticated`: INSERT,SELECT,UPDATE

Triggers:

- `trg_form_a_updated_at` — before update → `set_updated_at_timestamp()`

#### `student_risk_flags`

At-risk state per student. ANY of low attendance / low GPA / a backlog sets is_at_risk. Rewritten by evaluate_student_risk() whenever new academic data lands.

*created in migration 0022 · RLS enabled*

> **Doc note:** `latest_gpa` is readable by anyone who passes `can_access_student` (this table and `at_risk_student_overview`), regardless of GPA sharing. `attendance_percent` and `black_dot_count` are the active cycle's (0036).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `student_id` | uuid | not null |  | **PK** FK → `user_profiles(id) on delete cascade` |
| `is_at_risk` | boolean | not null | `false` |  |
| `low_attendance` | boolean | not null | `false` |  |
| `low_gpa` | boolean | not null | `false` |  |
| `has_backlog` | boolean | not null | `false` |  |
| `attendance_percent` | numeric(5,2) |  |  |  |
| `latest_gpa` | numeric(4,2) |  |  |  |
| `latest_gpa_semester` | smallint |  |  |  |
| `backlog_count` | integer | not null | `0` |  |
| `reasons` | text[] | not null | `ARRAY[]::text[]` |  |
| `first_flagged_at` | timestamp with time zone |  |  |  |
| `last_flagged_at` | timestamp with time zone |  |  |  |
| `cleared_at` | timestamp with time zone |  |  |  |
| `last_evaluated_at` | timestamp with time zone | not null | `now()` |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |
| `has_black_dot` | boolean | not null | `false` | At least one black dot in the active cycle (0036) |
| `black_dot_count` | integer | not null | `0` | Black dots in the active cycle (0036) |

Constraints and indexes:

- index `student_risk_flags_at_risk_idx` — `btree (is_at_risk) WHERE (is_at_risk = true)`

RLS policies:

- `risk_flags_select_visible` — **SELECT** to authenticated; using `can_access_student(student_id)`

Grants: `authenticated`: SELECT

Triggers:

- `trg_notify_risk_flag_change` — after insert or update → `notify_on_risk_flag_change()`
- `trg_student_risk_flags_updated_at` — before update → `set_updated_at_timestamp()`

#### `student_semester_gpas`

Feature 2 — semester GPA history. Visible to faculty/HOD only when the student has gpa_sharing_enabled.

*created in migration 0003 · RLS enabled*

> **Doc note:** the student's HOD (the HOD of their mentor) and the administrator can always read GPAs; the mentor reads them per `gpa_sharing_enabled` (default true; the UI toggle was removed). `source` is `cluster_head` (department upload, which always overwrites) or `student` (self-reported before 0037, which ended student entry). Since 0037 only the definer upload functions write this table: the student's INSERT/UPDATE/DELETE policies, which ignored `source` (S1), are gone.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `student_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `semester_number` | smallint | not null |  |  |
| `gpa` | numeric(4,2) | not null |  |  |
| `recorded_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |
| `source` | gpa_source | not null | `'student'::gpa_source` |  |
| `recorded_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `batch_id` | uuid |  |  | FK → `academic_upload_batches(id) on delete set null` |
| `earned_credits` | numeric(5,2) |  |  | From the ERP export (0035); NULL when self-reported |
| `required_credits` | numeric(5,2) |  |  | From the ERP export (0035) |

Constraints and indexes:

- `gpa_value_range` — `CHECK (((gpa >= (0)::numeric) AND (gpa <= (10)::numeric)))`
- `semester_gpa_credits_sane` — both credit columns NULL or between 0 and 100 (0035)
- `one_gpa_per_semester` — `UNIQUE (student_id, semester_number)`
- `semester_gpa_range` — `CHECK (((semester_number >= 1) AND (semester_number <= 8)))`
- index `semester_gpas_student_idx` — `btree (student_id, semester_number)`

RLS policies:

- `gpas_select_permitted` — **SELECT** to authenticated; using `can_view_student_gpa(student_id)`
- (`gpas_insert_own`, `gpas_update_own` and `gpas_delete_own` were dropped in 0037.)

Grants: `authenticated`: SELECT (INSERT, UPDATE and DELETE revoked in 0037)

Triggers:

- `trg_semester_gpas_updated_at` — before update → `set_updated_at_timestamp()`

#### `support_queries`

Student queries raised to their assigned mentor. Renamed from support_tickets in 0031; the reference codes (AN-1, AN-2, ...) are unchanged.

*created in migration 0004 · renamed from `support_tickets` in 0031 · RLS enabled · published to Realtime*

> **Doc note:** codes run from AN-1001 (the sequence starts at 1001). The `escalated_to_hod` column comment ("after 3 rejections") is stale — any query can be referred since 0030, and since 0042 a senior mentor can escalate too. Since 0042 the mentor and HOD UPDATE policies reach only `priority` (column grant), and students can no longer INSERT directly (the `queries_insert_own` policy remains but the grant is gone). `mentor_id` is the faculty **or senior** mentor the query was sent to.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `query_code` | text | not null |  |  |
| `student_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `mentor_id` | uuid | not null |  | FK → `user_profiles(id) on delete restrict` |
| `subject` | text | not null |  |  |
| `category` | query_category | not null |  |  |
| `priority` | query_priority | not null | `'Medium'::query_priority` |  |
| `status` | query_status | not null | `'Open'::query_status` |  |
| `resolution_status` | resolution_status | not null | `'none'::resolution_status` | Feature 3 — none -> pending_confirmation (faculty resolved) -> confirmed \| reopened (student answered). |
| `resolved_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `resolved_at` | timestamp with time zone |  |  |  |
| `student_confirmation` | confirmation_response |  |  |  |
| `student_confirmation_at` | timestamp with time zone |  |  |  |
| `student_confirmation_comment` | text |  |  |  |
| `reopen_count` | integer | not null | `0` |  |
| `first_response_at` | timestamp with time zone |  |  |  |
| `last_message_at` | timestamp with time zone | not null | `now()` |  |
| `satisfaction_rating` | smallint |  |  |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |
| `escalated_to_hod` | boolean | not null | `false` | Set when the mentor reports a repeatedly-reopened ticket to the HOD (after 3 rejections). |
| `escalated_at` | timestamp with time zone |  |  |  |
| `escalated_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `escalation_note` | text |  |  |  |
| `mom_id` | uuid |  |  | FK → `mom_records(id) on delete set null` Set when this ticket is an action item raised in a CR meeting. Null for an ordinary student ticket. Everything else about the ticket behaves identically. |
| `mentor_kind` | text | not null | `'faculty'::text` | 0042. Whom the student sent it to: `'faculty'` (their faculty mentor) or `'senior'` (their senior mentor). mentor_id is that person. |
| `referred_to_faculty` | uuid |  |  | FK → `user_profiles(id) on delete set null`. 0042. The faculty mentor a senior raised this query to, who can then read, reply and resolve. |
| `referred_at` | timestamp with time zone |  |  | 0042 |
| `escalation_source` | text |  |  | 0042. Who escalated it to the HOD: `'faculty'` or `'senior'` (earlier escalations backfilled `'faculty'`). |

Constraints and indexes:

- `query_comment_max_length` — `CHECK (((student_confirmation_comment IS NULL) OR (char_length(student_confirmation_comment) <= 1000)))`
- `query_escalation_source_valid` — `CHECK (((escalation_source IS NULL) OR (escalation_source = ANY (ARRAY['faculty'::text, 'senior'::text]))))` (0042)
- `query_mentor_kind_valid` — `CHECK ((mentor_kind = ANY (ARRAY['faculty'::text, 'senior'::text])))` (0042)
- `query_confirmation_has_timestamp` — `CHECK (((student_confirmation IS NULL) OR (student_confirmation_at IS NOT NULL)))`
- `query_rating_range` — `CHECK (((satisfaction_rating IS NULL) OR ((satisfaction_rating >= 1) AND (satisfaction_rating <= 5))))`
- `query_resolved_has_resolver` — `CHECK (((resolution_status = 'none'::resolution_status) OR (resolved_by IS NOT NULL)))`
- `query_student_is_not_mentor` — `CHECK ((student_id <> mentor_id))`
- `query_subject_max_length` — `CHECK ((char_length(subject) <= 200))`
- `query_subject_not_blank` — `CHECK (is_non_blank(subject))`
- `support_queries_query_code_key` — `UNIQUE (query_code)`
- index `queries_category_idx` — `btree (category)`
- index `queries_escalated_idx` — `btree (escalated_to_hod) WHERE (escalated_to_hod = true)`
- index `queries_mentor_idx` — `btree (mentor_id, created_at DESC)`
- index `queries_mom_idx` — `btree (mom_id) WHERE (mom_id IS NOT NULL)`
- index `queries_resolution_status_idx` — `btree (resolution_status) WHERE (resolution_status <> 'none'::resolution_status)`
- index `queries_status_idx` — `btree (status)`
- index `queries_student_idx` — `btree (student_id, created_at DESC)`
- index `queries_subject_trgm_idx` — `gin (subject extensions.gin_trgm_ops)`
- index `queries_updated_at_idx` — `btree (updated_at DESC)`
- index `support_queries_escalated_idx` — `btree (escalated_at DESC) WHERE escalated_to_hod` (0042)
- index `support_queries_referred_idx` — `btree (referred_to_faculty, last_message_at DESC) WHERE (referred_to_faculty IS NOT NULL)` (0042)
- index `support_queries_senior_idx` — `btree (mentor_id, last_message_at DESC) WHERE (mentor_kind = 'senior'::text)` (0042)

RLS policies:

- `queries_insert_own` — **INSERT** to authenticated; check `(is_student() AND (student_id = auth.uid()) AND (mentor_id = my_mentor_id()))`
- `queries_select_participants` — **SELECT** to authenticated; using `((student_id = auth.uid()) OR (mentor_id = auth.uid()) OR (referred_to_faculty = auth.uid()) OR ( SELECT is_admin() AS is_admin) OR (mentor_id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])) OR (escalated_to_hod AND oversees_student(student_id)))` (0042)
- `queries_update_hod` — **UPDATE** to authenticated; using `(( SELECT is_admin() AS is_admin) OR (mentor_id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])))`; check `(( SELECT is_admin() AS is_admin) OR (mentor_id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])))`
- `queries_update_mentor` — **UPDATE** to authenticated; using `(mentor_id = auth.uid())`; check `(mentor_id = auth.uid())`

Grants: `authenticated`: SELECT, and UPDATE on the column `priority` only (0042; before: INSERT,SELECT,UPDATE)

Triggers:

- `trg_assign_query_code` — before insert → `assign_query_code()`
- `trg_notify_query_created` — after insert → `notify_on_query_created()`
- `trg_notify_query_resolution` — after update → `notify_on_query_resolution_change()`
- `trg_queries_updated_at` — before update → `set_updated_at_timestamp()`

#### `survey_cycles`

One shared 15-day survey window for the whole department. Opened by open_survey_cycle() on the schedule, or on demand via the manual trigger.

*created in migration 0023 · RLS enabled*

> **Doc note:** there is no automatic schedule; cycles are opened only by a manual run. `closes_on` is informational — responses are accepted until the next cycle opens.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `cycle_number` | integer | not null |  |  |
| `opens_on` | date | not null | `CURRENT_DATE` |  |
| `closes_on` | date | not null |  |  |
| `is_active` | boolean | not null | `true` |  |
| `trigger_source` | cycle_job_trigger | not null | `'scheduled'::cycle_job_trigger` |  |
| `opened_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `job_run_id` | uuid |  |  |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `survey_cycles_cycle_number_key` — `UNIQUE (cycle_number)`
- `survey_cycles_window_ordered` — `CHECK ((closes_on >= opens_on))`
- index `survey_cycles_single_active_idx` — `unique btree (is_active) WHERE (is_active = true)`

RLS policies:

- `survey_cycles_select_all` — **SELECT** to authenticated; using `true`

Grants: `authenticated`: SELECT

#### `survey_questions`

*created in migration 0023 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `question_number` | smallint | not null |  |  |
| `prompt` | text | not null |  |  |
| `is_active` | boolean | not null | `true` |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `survey_questions_number_range` — `CHECK (((question_number >= 1) AND (question_number <= 100)))`
- `survey_questions_prompt_not_blank` — `CHECK (is_non_blank(prompt))`
- `survey_questions_question_number_key` — `UNIQUE (question_number)`

RLS policies:

- `survey_questions_select_all` — **SELECT** to authenticated; using `true`

Grants: `authenticated`: SELECT

#### `survey_response_answers`

*created in migration 0023 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `response_id` | uuid | not null |  | FK → `survey_responses(id) on delete cascade` |
| `question_id` | uuid | not null |  | FK → `survey_questions(id) on delete cascade` |
| `rating` | smallint | not null |  |  |

Constraints and indexes:

- `survey_answer_one_per_question` — `UNIQUE (response_id, question_id)`
- `survey_answer_rating_range` — `CHECK (((rating >= 1) AND (rating <= 5)))`
- index `survey_response_answers_response_idx` — `btree (response_id)`

RLS policies:

- `survey_answers_select_scope` — **SELECT** to authenticated; using `(EXISTS ( SELECT 1
   FROM survey_responses r
  WHERE ((r.id = survey_response_answers.response_id) AND can_access_student(r.student_id))))`

Grants: `authenticated`: SELECT

#### `survey_responses`

*created in migration 0023 · RLS enabled*

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null | `extensions.gen_random_uuid()` | **PK** |
| `cycle_id` | uuid | not null |  | FK → `survey_cycles(id) on delete cascade` |
| `student_id` | uuid | not null |  | FK → `user_profiles(id) on delete cascade` |
| `mentor_id` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `submitted_at` | timestamp with time zone | not null | `now()` |  |

Constraints and indexes:

- `survey_responses_one_per_cycle` — `UNIQUE (cycle_id, student_id)`
- index `survey_responses_cycle_idx` — `btree (cycle_id)`
- index `survey_responses_mentor_idx` — `btree (mentor_id, cycle_id)`

RLS policies:

- `survey_responses_select_scope` — **SELECT** to authenticated; using `can_access_student(student_id)`

Grants: `authenticated`: SELECT

#### `user_profiles`

Application identity for every authenticated user. One row per auth.users row.

*created in migration 0002 · RLS enabled · published to Realtime*

> **Doc note:** protected columns (see §7.1) can only change through the listed RPCs, by the administrator, or by a HOD for the people they can update (never the mapping columns, and never to or from the `hod` / `admin` role); every other column is editable by its owner through `profiles_update_self`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | not null |  | **PK** FK → `auth.users(id) on delete cascade` |
| `role` | user_role | not null | `'student'::user_role` |  |
| `full_name` | text | not null |  |  |
| `email` | text | not null |  |  |
| `login_id` | text |  |  | Registration number (students) or faculty ID. Display + roster matching only — login is by email. |
| `phone` | text |  |  |  |
| `department` | text | not null | `'IoT & IS'::text` |  |
| `branch` | text |  |  |  |
| `section` | text |  |  |  |
| `semester_label` | text |  |  |  |
| `avatar_url` | text |  |  | Storage object path in the profile-photos bucket, e.g. <uuid>/avatar-1712345678.png. Never a public URL. |
| `assigned_mentor_id` | uuid |  |  | FK → `user_profiles(id) on delete set null` Flat FK, not a join table. Bulk reassignment (Feature 8) is a single UPDATE. |
| `is_star_mentee` | boolean | not null | `false` |  |
| `star_mentee_assigned_by` | uuid |  |  | FK → `user_profiles(id) on delete set null` |
| `star_mentee_assigned_at` | timestamp with time zone |  |  |  |
| `employment_status` | employment_status | not null | `'active'::employment_status` |  |
| `available_for_reassignment` | boolean | not null | `true` |  |
| `mentee_capacity` | integer | not null | `30` |  |
| `form_a_completed` | boolean | not null | `false` |  |
| `form_a_completed_at` | timestamp with time zone |  |  |  |
| `must_change_password` | boolean | not null | `true` |  |
| `is_active` | boolean | not null | `true` |  |
| `last_login_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | not null | `now()` |  |
| `updated_at` | timestamp with time zone | not null | `now()` |  |
| `cluster_head_setup_completed` | boolean | not null | `false` | Cluster Head one-time setup form. Mirrors form_a_completed for students: the portal is route-gated until this is true. |
| `cluster_head_setup_completed_at` | timestamp with time zone |  |  |  |
| `parent_name` | text |  |  |  |
| `parent_mobile` | text |  |  | Guardian contact from the student roster import. Form A is still preferred where the student filled one in — see at_risk_student_overview. |
| `parent_email` | text |  |  |  |
| `hod_email` | text |  |  | Faculty only. The HOD's e-mail, kept in step with `hod_id` by the mapping and by `set_mentor_department_and_hod`. Protected once `hod_id` is set. |
| `hod_id` | uuid |  |  | FK → `user_profiles(id) on delete set null`. Faculty only (0039). The HOD this faculty member reports to: decides which HOD sees them and their mentees, and receives their referrals. Protected; set by the administrator's mapping upload (§4.25). |
| `mentor_section` | text |  |  | Faculty only (0039). Section from the mentor–HOD mapping, e.g. "A 3". Protected. |
| `mentor_designation` | text |  |  | Faculty only (0039). "Mentor" or "Class Coordinator (fallback)" from the mapping. Protected. |
| `is_senior_mentor` | boolean | not null | `false` | Students only (0042). A senior/alumni mentor: a student who also answers juniors' queries. Protected; set by `npm run db:seniors` (or the administrator). |

Constraints and indexes:

- `user_profiles_email_shape` — `CHECK ((email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text))`
- `user_profiles_full_name_not_blank` — `CHECK (is_non_blank(full_name))`
- `user_profiles_hod_email_shape` — `CHECK (((hod_email IS NULL) OR (hod_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text)))`
- `user_profiles_hod_mapping_faculty_only` — `CHECK (((role = 'faculty'::user_role) OR ((hod_id IS NULL) AND (mentor_section IS NULL) AND (mentor_designation IS NULL))))` (0039)
- `user_profiles_hod_not_self` — `CHECK (((hod_id IS NULL) OR (hod_id <> id)))` (0039)
- `user_profiles_mentor_designation_length` — `CHECK (((mentor_designation IS NULL) OR (char_length(mentor_designation) <= 80)))` (0039)
- `user_profiles_mentor_section_length` — `CHECK (((mentor_section IS NULL) OR (char_length(mentor_section) <= 40)))` (0039)
- `user_profiles_mentee_capacity_sane` — `CHECK (((mentee_capacity >= 1) AND (mentee_capacity <= 200)))`
- `user_profiles_no_self_mentor` — `CHECK (((assigned_mentor_id IS NULL) OR (assigned_mentor_id <> id)))`
- `user_profiles_senior_is_student` — `CHECK (((role = 'student'::user_role) OR (NOT is_senior_mentor)))` (0042)
- `user_profiles_student_only_fields` — `CHECK (((role = 'student'::user_role) OR ((assigned_mentor_id IS NULL) AND (is_star_mentee = false) AND (form_a_completed = false))))`
- index `user_profiles_assigned_mentor_idx` — `btree (assigned_mentor_id) WHERE (assigned_mentor_id IS NOT NULL)`
- index `user_profiles_email_unique_idx` — `unique btree (lower(email))`
- index `user_profiles_employment_status_idx` — `btree (employment_status) WHERE (role = 'faculty'::user_role)`
- index `user_profiles_full_name_trgm_idx` — `gin (full_name extensions.gin_trgm_ops)`
- index `user_profiles_hod_idx` — `btree (hod_id) WHERE (hod_id IS NOT NULL)` (0039)
- index `user_profiles_login_id_unique_idx` — `unique btree (lower(login_id)) WHERE (login_id IS NOT NULL)`
- index `user_profiles_role_idx` — `btree (role)`
- index `user_profiles_senior_mentor_idx` — `btree (id) WHERE is_senior_mentor` (0042)

RLS policies:

- `profiles_select_faculty_roster` — **SELECT** to authenticated; using `((role = 'faculty'::user_role) AND (( SELECT is_faculty() AS is_faculty) OR ( SELECT is_admin() AS is_admin)))`
- `profiles_select_hod_scope` — **SELECT** to authenticated; using `(( SELECT is_admin() AS is_admin) OR (id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])) OR (assigned_mentor_id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])))`
- `profiles_select_own_mentees` — **SELECT** to authenticated; using `(assigned_mentor_id = auth.uid())`
- `profiles_select_own_mentor` — **SELECT** to authenticated; using `(id = my_mentor_id())`
- `profiles_select_self` — **SELECT** to authenticated; using `(id = auth.uid())`
- `profiles_select_staff_directory` — **SELECT** to authenticated; using `((role = ANY (ARRAY['hod'::user_role, 'cluster_head'::user_role, 'admin'::user_role])) AND ( SELECT is_hod() AS is_hod))`
- `profiles_update_hod` — **UPDATE** to authenticated; using `(( SELECT is_admin() AS is_admin) OR (id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])) OR (assigned_mentor_id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])))`; check `(( SELECT is_admin() AS is_admin) OR (id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])) OR (assigned_mentor_id = ANY (( SELECT my_overseen_faculty() AS my_overseen_faculty)::uuid[])))`
- `profiles_update_self` — **UPDATE** to authenticated; using `(id = auth.uid())`; check `(id = auth.uid())`

Grants: `authenticated`: SELECT,UPDATE

Triggers:

- `trg_guard_protected_profile_columns` — before update → `guard_protected_profile_columns()`
- `trg_notify_mentor_reassignment` — after update of assigned_mentor_id → `notify_on_mentor_reassignment()`
- `trg_notify_star_mentee` — after update of is_star_mentee → `notify_on_star_mentee_change()`
- `trg_user_profiles_updated_at` — before update → `set_updated_at_timestamp()`

### 7.5 Views

Every view is created `WITH (security_invoker = true)`, so it runs with the caller's privileges and the underlying tables' RLS still applies.

#### `academic_upload_history`

`academic_upload_batches` with the cycle label, the semester each upload is filed under (attendance by period end, backlogs by programme-semester parity, the rest by upload date) and the subject code. Powers the cluster-head dashboard's Recent uploads.

*defined in migration 0036 · security_invoker=true · reads `academic_upload_batches`, `academic_cycles`, `cluster_head_courses`*

Columns: `id`, `cycle_id`, `cycle_label`, `semester`, `upload_type`, `course_id`, `course_code`, `section_label`, `period_start`, `period_end`, `semester_number`, `scope_label`, `original_filename`, `total_rows`, `matched_rows`, `failed_rows`, `uploaded_by`, `created_at`

#### `at_risk_student_overview`

At-risk roster: attendance, GPA, backlog count and guardian contact in one row. Parent contact prefers Form A and falls back to the student roster import.

*defined in migration 0022, 0027, 0036 · security_invoker=true · reads `at_risk_meetings`, `student_form_a_profiles`, `student_risk_flags`, `user_profiles`*

Columns: `student_id`, `student_name`, `registration_no`, `email`, `section`, `branch`, `semester_label`, `assigned_mentor_id`, `mentor_name`, `is_at_risk`, `low_attendance`, `low_gpa`, `has_backlog`, `attendance_percent`, `latest_gpa`, `latest_gpa_semester`, `backlog_count`, `reasons`, `first_flagged_at`, `last_evaluated_at`, `father_name`, `father_mobile`, `mother_name`, `mother_mobile`, `primary_parent_mobile`, `primary_parent_email`, `open_meeting_id`, `open_meeting_status`, `open_meeting_join_url`, `open_meeting_created_at`, `has_black_dot`, `black_dot_count` (the last two appended in 0036)

#### `current_cycle_courses`

The active cycle's subjects. The Cluster Head screens read this rather than `cluster_head_courses`.

*defined in migration 0036 · security_invoker=true · reads `cluster_head_courses`*

Columns: `id`, `cluster_head_id`, `course_name`, `course_code`, `display_order`, `created_at`, `updated_at`, `cycle_id`

#### `faculty_performance_summary`

*defined in migration 0012, 0031 · security_invoker=true · reads `support_queries`, `user_profiles`*

Columns: `faculty_id`, `faculty_name`, `faculty_email`, `faculty_login_id`, `branch`, `department`, `employment_status`, `available_for_reassignment`, `mentee_capacity`, `mentee_count`, `total_queries`, `open_queries`, `in_progress_queries`, `resolved_queries`, `academic_queries`, `erp_tech_queries`, `infrastructure_queries`, `confirmed_resolutions`, `reopened_resolutions`, `awaiting_confirmation`, `avg_first_response_hours`, `avg_resolution_hours`, `avg_satisfaction`, `rated_queries`, `resolution_rate_percent`

#### `faculty_reserve_pool`

*defined in migration 0012 · security_invoker=true · reads `user_profiles`*

Columns: `faculty_id`, `full_name`, `email`, `login_id`, `branch`, `employment_status`, `available_for_reassignment`, `mentee_capacity`, `current_mentees`, `remaining_capacity`

#### `query_daily_trend`

*defined in migration 0031 · security_invoker=true · reads `support_queries`*

Columns: `mentor_id`, `day`, `queries_created`, `queries_resolved`, `academic`, `erp_tech`, `infrastructure`

#### `student_attendance_overview`

One row per student per course **for the active academic cycle** (since 0036) — the most recent reporting period. Powers the attendance on the student Academics page, the student record and the at-risk breakdown.

*defined in migration 0025, 0036 · security_invoker=true · reads `student_attendance_records`*

Columns: `student_id`, `course_id`, `course_code`, `course_name`, `section_label`, `attendance_percent`, `classes_held`, `classes_attended`, `period_start`, `period_end`, `updated_at`

#### `student_query_summary`

*defined in migration 0031 · security_invoker=true · reads `support_queries`, `user_profiles`*

Columns: `student_id`, `student_name`, `registration_no`, `email`, `section`, `branch`, `semester_label`, `assigned_mentor_id`, `is_star_mentee`, `form_a_completed`, `total_queries`, `open_queries`, `in_progress_queries`, `resolved_queries`, `academic_queries`, `erp_tech_queries`, `infrastructure_queries`, `confirmed_resolutions`, `reopened_resolutions`, `avg_rating_given`, `last_query_at`

#### `survey_group_completion`

*defined in migration 0023 · security_invoker=true · reads `survey_mentee_status`*

Columns: `cycle_id`, `cycle_number`, `opens_on`, `closes_on`, `cycle_is_active`, `assigned_mentor_id`, `total_students`, `submitted_count`, `pending_count`, `completion_percent`

#### `survey_mentee_status`

Per-student completion status for every survey cycle. Powers the mentor's tracking column; RLS on user_profiles scopes it to the caller's own mentees.

*defined in migration 0023 · security_invoker=true · reads `survey_cycles`, `survey_responses`, `user_profiles`*

Columns: `cycle_id`, `cycle_number`, `opens_on`, `closes_on`, `cycle_is_active`, `student_id`, `student_name`, `registration_no`, `email`, `section`, `assigned_mentor_id`, `is_star_mentee`, `has_submitted`, `submitted_at`

### 7.6 Functions

The complete function catalogue, with security mode, grants, callers and purpose, is in §5.3.

### 7.7 Triggers on `auth.users`

- `trg_on_auth_user_created` on `auth.users` — after insert → `handle_new_auth_user()`
- `trg_on_auth_user_email_changed` on `auth.users` — after update of email → `handle_auth_user_email_change()`

### 7.8 Storage buckets and policies

| Bucket | Public | Size limit | Allowed MIME types |
|---|---|---|---|
| `achievement-proofs` | false | 5 MB | image/png, image/jpeg, image/jpg, image/webp, application/pdf |
| `form-a-uploads` | false | 5 MB | image/png, image/jpeg, image/jpg, image/webp, application/pdf |
| `profile-photos` | false | 3 MB | image/png, image/jpeg, image/jpg, image/webp |
| `roster-imports` | false | 10 MB | text/csv, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet |

Storage policies (on `storage.objects`):

- `achievement_proofs_delete_own` — **DELETE** to authenticated; using `((bucket_id = 'achievement-proofs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))`
- `achievement_proofs_insert_own` — **INSERT** to authenticated; check `((bucket_id = 'achievement-proofs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))`
- `achievement_proofs_select_scope` — **SELECT** to authenticated; using `((bucket_id = 'achievement-proofs'::text) AND can_access_student(((storage.foldername(name))[1])::uuid))`
- `form_a_uploads_delete_own` — **DELETE** to authenticated; using `((bucket_id = 'form-a-uploads'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))`
- `form_a_uploads_insert_own` — **INSERT** to authenticated; check `((bucket_id = 'form-a-uploads'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))`
- `form_a_uploads_select_scope` — **SELECT** to authenticated; using `((bucket_id = 'form-a-uploads'::text) AND can_access_student(((storage.foldername(name))[1])::uuid))`
- `form_a_uploads_update_own` — **UPDATE** to authenticated; using `((bucket_id = 'form-a-uploads'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))`
- `profile_photos_delete_own` — **DELETE** to authenticated; using `((bucket_id = 'profile-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))`
- `profile_photos_insert_own` — **INSERT** to authenticated; check `((bucket_id = 'profile-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))`
- `profile_photos_select_any` — **SELECT** to authenticated; using `(bucket_id = 'profile-photos'::text)`
- `profile_photos_update_own` — **UPDATE** to authenticated; using `((bucket_id = 'profile-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))`
- `roster_imports_hod_all` — **ALL** to authenticated; using `((bucket_id = 'roster-imports'::text) AND is_hod())`; check `((bucket_id = 'roster-imports'::text) AND is_hod())`

### 7.9 Other database objects

- Extensions: `citext`, `pg_trgm`, `pgcrypto`
- Sequences: `audit_log_id_seq`, `query_code_seq`
- Realtime publication `supabase_realtime`: `notifications`, `query_messages`, `student_achievements`, `support_queries`, `user_profiles`
- Session setting `ssmp.quiet_risk_notifications` (0036): while `on`, `notify_on_risk_flag_change` sends no "no longer at-risk" notices. Set only by `reevaluate_students_batch`, for its own transaction.

### 7.10 Who reads and writes each table

This table was generated from the code. The columns are:

- **Browser / API direct:** `supabase.from('<table>')` calls in `frontend/src` and `api/`, by operation.
- **Written by SQL:** functions whose bodies INSERT, UPDATE or DELETE the table.

Reads inside SQL functions and views are not listed.

| Table / view | Browser / API direct | Written by SQL functions |
|---|---|---|
| `academic_cycle_students` | **delete**: `make-administrator.mjs` (the new administrator's own row); otherwise counts through `get_cycle_overview` | `enroll_student_in_cycle` (via `activate_roster_students`, `map_students_to_mentors`, `sync_student_cycle_enrollment`), `carry_over_cycle_students` |
| `academic_cycles` | **select**: `useActiveCycle.js`, `seed-demo-accounts.mjs` | `create_academic_cycle`, `update_academic_cycle_dates`, `delete_academic_cycle` |
| `academic_upload_batches` | **select**: `uploadedSubjects.js` (a HOD's attendance batches); otherwise read through `academic_upload_history` and `get_cycle_overview` | `record_attendance_batch`, `record_backlog_batch`, `record_black_dot_batch`, `record_gpa_batch` |
| `academic_upload_history` (view) | **select**: `ClusterHeadDashboardPage.jsx` | — |
| `api_rate_limits` | — | `consume_rate_limit` |
| `at_risk_meetings` | — | `dispatch_at_risk_meetings`, `notify_on_at_risk_meeting`, `set_at_risk_meeting_status`, `delete_academic_cycle` (clears `cycle_id`) |
| `at_risk_student_overview` (view) | **select**: `FacultyAtRiskPage.jsx` | — |
| `audit_log` | — | `write_audit_entry` |
| `canned_replies` | **select**: `FacultyQueryDetailPage.jsx` | — |
| `cluster_head_courses` | **select**, **insert**: `seed-demo-accounts.mjs` (the screens read `current_cycle_courses`) | `submit_cluster_head_setup`, `create_academic_cycle` (copies the list), `record_attendance_batch` (a HOD's subject, 0039) |
| `current_cycle_courses` (view) | **select**: `ClusterHeadAttendancePage.jsx`, `ClusterHeadCoursesPage.jsx`, `ClusterHeadDashboardPage.jsx`, `ClusterHeadSetupPage.jsx`, `uploadedSubjects.js` | — |
| `counselling_requests` | **select**: `FacultyCounsellingPage.jsx`, `StudentCounsellingPage.jsx` | `request_counselling`, `respond_to_counselling` |
| `cycle_job_runs` | — | `run_cycle_job` |
| `cycle_job_schedule` | — | `run_cycle_job` |
| `faculty_performance_summary` (view) | **select**: `HodDashboardPage.jsx`, `HodFacultyPerformancePage.jsx` | — |
| `faculty_reserve_pool` (view) | **select**: `manage-faculty-roster.js` | — |
| `mentor_reassignment_log` | — | `notify_on_mentor_reassignment`, `reassign_mentees` |
| `mom_records` | **select**: `FacultyCrReportsPage.jsx`, `StudentCrReportPage.jsx` | `submit_mom_report` |
| `notifications` | **select**: `NotificationProvider.jsx`<br>**insert**: `sync-senior-mentors.mjs` (service role)<br>**update**: `NotificationProvider.jsx`<br>**realtime**: `NotificationProvider.jsx` | `enqueue_notification`, `mark_all_notifications_read` |
| `query_daily_trend` (view) | **select**: `HodDashboardPage.jsx` | — |
| `query_escalations` | **select**: `useRealtimeQueries.js` | `escalate_peer_query`, `escalate_query_to_hod` |
| `query_messages` | **select**: `useRealtimeQueries.js`<br>**insert**: `sync-senior-mentors.mjs` (service role)<br>**realtime**: `useRealtimeQueries.js` | `confirm_query_resolution`, `create_support_query`, `escalate_peer_query`, `escalate_query_to_hod`, `post_query_message`, `resolve_support_query`, `set_query_in_progress`, `submit_mom_report` |
| `roster_import_batches` | **select**: `ClusterHeadRosterPage.jsx`, `import-roster-spreadsheet.js`<br>**insert**: `import-roster-spreadsheet.js`<br>**update**: `import-roster-spreadsheet.js` | — |
| `semester_cycles` | **select**: `import-roster-spreadsheet.js`<br>**update**: `import-roster-spreadsheet.js` | — |
| `senior_mentor_sections` | **select**: `SeniorMenteesPage.jsx`<br>**delete**: `sync-senior-mentors.mjs` (service role) | `set_senior_mentor_sections` |
| `student_achievements` | **select**: `StudentAchievementsPage.jsx`<br>**insert**: `StudentAchievementsPage.jsx`<br>**update**: `StudentAchievementsPage.jsx`<br>**delete**: `StudentAchievementsPage.jsx` | `set_achievement_verification` |
| `student_attendance_overview` (view) | **select**: `FacultyAtRiskPage.jsx`, `FacultyMenteeDetailPage.jsx`, `StudentAcademicsPage.jsx` | — |
| `student_attendance_records` | — | `record_attendance_batch` |
| `student_backlogs` | **select**: `StudentAcademicsPage.jsx` (also through `get_student_dossier`) | `record_backlog_batch` |
| `student_black_dots` | **select**: `StudentAcademicsPage.jsx`, `FacultyAtRiskPage.jsx` (also through `get_student_dossier`) | `record_black_dot_batch` |
| `student_cgpas` | **select**: `StudentAcademicsPage.jsx` (also through `get_student_dossier`) | `record_gpa_batch` |
| `student_course_sections` | — | `record_attendance_batch` |
| `student_form_a_profiles` | **select**: `FormAFields.jsx` | `request_form_a_unlock`, `set_gpa_sharing`, `submit_student_form_a`, `unlock_student_form_a` |
| `student_query_summary` (view) | **select**: `FacultyMenteesPage.jsx`, `HodStudentsPage.jsx` | — |
| `student_risk_flags` | — | `evaluate_student_risk` |
| `student_semester_gpas` | **select**: `FacultyAtRiskPage.jsx`, `StudentAcademicsPage.jsx` | `record_gpa_batch`; `upsert_semester_gpa` (retired in 0037) |
| `support_queries` | **select**: `FacultyCrReportsPage.jsx`, `StudentCrReportPage.jsx`, `manage-faculty-roster.js`, `sync-senior-mentors.mjs`, `useRealtimeQueries.js`<br>**update**: `FacultyQueryDetailPage.jsx` (priority only since 0042), `manage-faculty-roster.js`, `sync-senior-mentors.mjs`<br>**realtime**: `StudentGroupQueriesPage.jsx`, `useRealtimeQueries.js` | `confirm_query_resolution`, `create_support_query`, `escalate_peer_query`, `escalate_query_to_hod`, `post_query_message`, `rate_support_query`, `resolve_support_query`, `set_query_in_progress`, `submit_mom_report` |
| `survey_cycles` | — | `open_survey_cycle` |
| `survey_group_completion` (view) | — | — |
| `survey_mentee_status` (view) | **select**: `FacultyMenteesPage.jsx` | — |
| `survey_questions` | — | — |
| `survey_response_answers` | — | `submit_survey_response` |
| `survey_responses` | — | `submit_survey_response` |
| `user_profiles` | **select**: `AddAccountModal.jsx`, `AdminHodMappingPage.jsx`, `AuthProvider.jsx`, `FacultyActivityReportPage.jsx`, `HodStudentsPage.jsx`, `create-admin-account.mjs`, `import-roster-spreadsheet.js`, `manage-faculty-roster.js`, `provision-user-accounts.js`, `request-guards.js`, `sync-senior-mentors.mjs`, `upload-academic-data.js`<br>**update**: `AuthProvider.jsx`, `FacultyProfilePage.jsx`, `ProfilePhotoUploader.jsx`, `StudentProfilePage.jsx`, `import-roster-spreadsheet.js`, `make-administrator.mjs`, `provision-user-accounts.js`, `seed-demo-accounts.mjs`, `sync-senior-mentors.mjs`, `upload-academic-data.js`<br>**realtime**: `AuthProvider.jsx` | `activate_roster_students`, `handle_auth_user_email_change`, `handle_new_auth_user`, `map_faculty_to_hods`, `map_students_to_mentors`, `reassign_mentees`, `set_faculty_employment_status`, `set_mentor_department_and_hod`, `set_star_mentee`, `submit_cluster_head_setup`, `submit_student_form_a`, `unlock_student_form_a` |

---

## 8. Authentication and security

### 8.1 Layers

| Layer | What it does | Is it a security boundary? |
|---|---|---|
| Route guards (`RouteGuards.jsx`) | Send users to sign-in, password change, onboarding or setup, or to their own portal | **No.** Convenience only. |
| Page-level checks (for example, star-mentee pages redirecting) | Hide what a user cannot use | **No.** |
| API guards (`request-guards.js`) | JWT verification, active profile, role, rate limit, audit | **Yes**, for the service-role work the API does |
| Postgres RLS | Row visibility and direct-write rules on every table | **Yes.** The primary boundary. |
| SECURITY DEFINER RPCs | Every rule-bearing state change re-checks the caller | **Yes** |
| `guard_protected_profile_columns` | Stops users editing their own role, mentor, flags and similar columns | **Yes** |
| Storage policies | Owner-folder writes; `can_access_student` reads | **Yes** |

### 8.2 Authentication

- **Provider.** Supabase Auth, e-mail and password. Self sign-up is disabled (`enable_signup = false` in `config.toml`; a hosted project must disable it too). Auth e-mail confirmation is off, and accounts are created pre-confirmed (`email_confirm: true`).
- **Account creation.** Only the service role, through the API, can create accounts (§4.1). New accounts get `must_change_password = true` and the shared temporary password from `SSMP_TEMPORARY_PASSWORD`. That variable has a hard-coded fallback in `api/_lib/environment.js`, so **it must be set in production**.
- **Forced password change.** `RequirePasswordChange` blocks every protected route until the flag is cleared. The rules (at least 10 characters with upper, lower, digit and symbol) are enforced **only in the browser**. Supabase's own minimum applies server-side, and no stronger server policy is configured in `config.toml`.
- **Sessions.**
  - PKCE flow; the session is persisted in `localStorage` (`ssmp.auth.session`) and auto-refreshed.
  - JWT lifetime is 3,600 s, with refresh-token rotation.
  - Inactivity timeout: 720 h in `config.toml`; this must be mirrored in hosted settings.
  - A token in `localStorage` is readable by any script on the page. There is **no Content-Security-Policy** to reduce XSS risk; see §8.7.
- **API authentication.**
  - Every endpoint except `/api/health` verifies the bearer token with `auth.getUser` (a network call to Supabase Auth).
  - It loads the profile with the service role and rejects inactive accounts.
  - Role checks use `user_profiles.role`, never JWT claims.
- **Password reset.** Supabase Auth e-mails a link to `<origin>/reset-password`. The link completes only in the requesting browser (PKCE).

### 8.3 Role capability matrix

"Direct" means a table operation allowed by RLS. "RPC" means through a definer function. Since 0039 a HOD's "their" means the faculty mapped to them (`hod_id`) and those faculty's mentees, queries and meetings; the administrator has what the single HOD had before (§4.25).

| Capability | student | faculty | hod | admin | cluster_head |
|---|---|---|---|---|---|
| Own profile: read; update non-protected columns (phone, avatar, name, section…) | direct | direct | direct (and their people's) | direct (any profile) | direct |
| Read other profiles | own mentor | own mentees; all faculty | their faculty and mentees; every HOD, cluster head and the administrator | all | none |
| Form A | own: read, RPC submit/edit, and a **direct insert/update of any column** (including `is_submitted`, `is_locked`, `gpa_sharing_enabled`) | mentees': read | theirs: read, direct update | all: read, direct update | — |
| Semester GPA and official CGPA | own: read only (student entry ended in 0037) | mentees': read if sharing | theirs: read | all: read | write via upload RPC only |
| Achievements | own: CRUD while unverified | mentees': read, RPC verify | theirs: read, RPC verify | all: read, RPC verify | — |
| Queries | own: RPC create (to the faculty or the senior mentor)/confirm/rate/post; read. **Senior mentor** (0042): the queries sent to them: read, RPC post/resolve/`escalate_peer_query` | assigned: read, RPC resolve/escalate/post/in-progress, direct update of `priority` only (0042); queries a senior raised to them: the same | their faculty's, and escalated queries of their students: same as faculty | all: same as faculty | — |
| Escalation reasons (`query_escalations`, 0042) | **none** (not even on their own queries); a senior: on queries sent to them | queries they handle | queries they handle | all | — |
| Senior mentor sections (0042) | a senior: read their own | — | read all; RPC set (Senior Mentors page) | the same | — |
| Senior mentor flag (0042) | — | — | — | direct (bypasses the guard); normally `npm run db:seniors` with the service role | — |
| Canned replies | — | read global and own; manage own (no UI) | same | same | — |
| Counselling | own: RPC request; read | assigned: read, RPC respond, direct update | **none** | **none** | — |
| CR reports (`mom_records`) | star mentee: RPC file; read the reports they filed | read reports addressed to them (`mentor_id`); act on items | their faculty's | all | — |
| At-risk flags, meetings, overview | own flags and meetings readable (RLS; no UI shows them) | mentees' (`can_access_student`); **direct UPDATE** of meetings they organise | theirs; direct UPDATE of their faculty's meetings | all; direct UPDATE of meetings | re-check everyone's flags by RPC (`reevaluate_students_batch`), without reading them |
| Attendance records and overview | own (active cycle) | mentees' | theirs | all | own uploads |
| Backlogs | own (Academics page) | mentees' (student page) | theirs (student page) | all (student page) | rows they uploaded |
| Black dots | own (Academics page) | mentees' (student page) | theirs (student page) | all (student page) | rows they uploaded |
| Surveys | own: RPC answer | mentees' status (view), **and each mentee's individual answers** (RLS; no UI) | theirs, including answers | all, including answers | — |
| Star mentee | star: group queries and survey status (RPCs) | RPC set | RPC set (theirs) | RPC set | — |
| Uploads (attendance, GPA, backlog, black dot, mentor map) | — | — | Uploads screens (no setup; a subject is created from an attendance file), department-wide | via API or RPCs (no screen) | via API (after setup), or the RPCs directly (no setup check) |
| Mentor–HOD mapping | — | name their HOD once, if unmapped (RPC) | — | Upload page (API → `map_faculty_to_hods`) | — |
| Academic cycles | read `academic_cycles` | read `academic_cycles`; their mentees' cycle rows | Uploads → Academic Cycles: start, edit, remove, carry over; the overview and cycle report (department-wide) | the same by RPC and API (no screen) | read; start, edit, remove, carry over by RPC; the whole-cycle overview (counts only) and the cycle report via API |
| Roster import, account creation | — | — | via API (roster; single accounts except HOD; mentor-map creates mentors); the faculty they create report to them | via API (roster, single accounts including HOD; the mapping creates HODs and faculty) | via API (roster; mentor-map creates mentors) |
| Faculty status, reassignment | — | — | their faculty, via API or the RPCs directly (no query handover) | all, the same way | — |
| Cycle jobs | — | — | via API, or the RPCs directly (department-wide) | the same | — |
| Reports | own dossier (API/RPC allow it; no UI) | own activity; mentees' dossiers | their faculty's activity, the all-faculty report for their faculty, their students' dossiers, cycle reports | all, plus the department report and cycle reports | cycle reports |
| Notifications | own | own | own | own | own |
| Audit log | — | — | — | read (no UI) | — |

### 8.4 Who can see what

- **Queries and messages.**
  - `support_queries` rows are visible to the student, the query's `mentor_id` (a faculty or, since 0042, a senior mentor), a faculty mentor's HOD and the administrator (`queries_select_participants`, 0039), and since 0042 also to the faculty mentor a senior raised it to and, once escalated, the HOD who oversees the student. A HOD or faculty member cannot see a query sent to a senior until it is raised to them.
  - `query_messages` are visible through `can_access_query`; `query_escalations` (the reasons) through `can_handle_query`, which excludes the query's student.
  - A mentor who loses a student keeps seeing that student's old queries if they still own them (§4.4).
- **Profiles.** `user_profiles` SELECT policies:
  - self;
  - own mentor (`my_mentor_id()`);
  - own mentees;
  - faculty rows for faculty and the administrator;
  - for a HOD: their mapped faculty and those faculty's mentees (`profiles_select_hod_scope`), plus every HOD, cluster head and administrator (`profiles_select_staff_directory`);
  - everything for the administrator.

  Students cannot see classmates' profiles. A HOD cannot see faculty mapped to another HOD, unmapped faculty, or students without a mentor. The star mentee's group views come from narrow definer RPCs, and so do a senior mentor's views of their juniors (`get_peer_queries`, `get_my_senior_mentees`, `get_query_people`, 0042).
- **Student records** (Form A, achievements, attendance, backlogs, black dots, risk flags, meetings, a student's per-cycle rows in `academic_cycle_students`): `can_access_student`, i.e. self, mentor, the mentor's HOD or the administrator. GPA and the official CGPA use `can_view_student_gpa` instead.
- **Academic cycles.** `academic_cycles` is readable by every signed-in user. The cycle overview (`get_cycle_overview`, `list_academic_cycles`) is for cluster heads, HODs and the administrator, department-wide, and carries counts and averages only.
- **Counselling.** Student and assigned mentor only. No HOD or administrator access.
- **Audit log.** The administrator only (0039).
- **Cluster heads.** Their own profile, their own courses, sections and attendance they uploaded, the backlog and black dot rows they uploaded, their own upload and roster batches, and each cycle's counts through `get_cycle_overview` (no student named; mentor names and e-mails are shown in the mentor workload). They have **no read access** to students' GPAs or CGPA, risk data, queries or Form A.
- **Storage.** See §2.5. Profile photos are readable by any signed-in user.

### 8.5 API hardening

- zod validation of every body and query; `parseOrThrow` returns readable 400s. Single-line sanitising is applied where names are copied into metadata.
- Body limits: 2 MB (provisioning); 10 MB (uploads; base64 capped at 8,000,000 characters).
- Rate limits per user and bucket, in Postgres; the limiter fails open (§4.23).
- The service-role key exists only in serverless environment variables. It is used for Auth admin, profile loading, audit, rate limiting, the query handover on reassignment, follow-up profile updates after account creation, the roster import's faculty and e-mail pre-loads and its `roster_import_batches` / `semester_cycles` writes, the faculty lookup when creating missing mentors, and the mentee count after a status change. Everything else runs as the user.
- Errors of status 500 or above never expose internals.
- CORS is an allow-list plus localhost outside production, plus `*.vercel.app` if one is allow-listed. Requests without `Origin` are served.
- Security headers on API responses and, through `vercel.json`, on all responses: `nosniff`, `DENY` framing, referrer policy, permissions policy, **HSTS with preload** (vercel.json), COOP.
- An audit entry for every privileged action that goes through the API (§4.23). Calling the underlying RPCs directly leaves none (S17).

### 8.6 Database hardening

- RLS on every table (enabled, not forced), nothing granted to `anon`, CI asserts RLS.
- Every definer function pins `search_path` and checks its caller, except the gaps in §8.9.
- Audit, rate-limit and notification writers are not executable by clients: `write_audit_entry` and `consume_rate_limit` are service-role only, and `enqueue_notification` is owner-only.
- `mom_records` and `audit_log` are append-only for clients.
- The `ssmp.trusted_operation` flag is transaction-local (`set_config(..., true)`) and only set inside definer functions.

### 8.7 Browser hardening

- `vercel.json` sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (camera, microphone, geolocation, payment, usb disabled), `Strict-Transport-Security` (2 years, preload), and `Cross-Origin-Opener-Policy`.
- **No `Content-Security-Policy` is set anywhere.** Neither `vercel.json` nor `index.html` has one. The comment in `lib/supabaseClient.js` that relies on "a strict Content-Security-Policy" is wrong.
- React escapes output. `dangerouslySetInnerHTML` is not used anywhere; the word appears only in a comment. The one `innerHTML` write is the static configuration-error page in `supabaseClient.js`.

### 8.8 Secrets and configuration

- Variable **names** and purposes are in §12. Values live only in `.env` files, which are ignored by git (`.env`, `.env.*` except `.env.example`), and in the Vercel / Supabase dashboards.
- The **anon key** and **Supabase URL** are public by design; they ship in the browser bundle. The **service-role key** must never be given a `VITE_` prefix.
- Hard-coded fallbacks exist for two passwords:
  - `SSMP_TEMPORARY_PASSWORD`, in `api/_lib/environment.js`;
  - `SEED_DEFAULT_PASSWORD`, in `supabase/scripts/seed-demo-accounts.mjs`.

  The local-only `supabase/seed.sql` also states its demo password in a comment. Treat all demo accounts as public: never seed them into production.
- The **senior list** `supabase/senior-mentors.txt` holds real student e-mails and is git-ignored (0042); only `senior-mentors.example.txt`, with a made-up address, is committed.

### 8.9 Known security gaps (verified)

These were found while writing this document and verified in the code; several were tested in rolled-back transactions. **S3 is fixed and S5 is narrowed by migration 0035, S1 is fixed by 0037, S19 is narrowed by 0039, and S6 and S15 are fixed by 0042; the rest are not fixed.**

| # | Gap | Impact | Where |
|---|---|---|---|
| S1 | **Fixed in 0037.** Students could **directly** INSERT, UPDATE or DELETE their own `student_semester_gpas` rows regardless of `source`, including department-published GPAs *(tested)* | A student could falsify official GPA, which feeds risk evaluation, mentor views and the dossier. 0037 dropped the three policies, narrowed the grant to SELECT and revoked `upsert_semester_gpa` *(tested)* | policies `gpas_insert_own`, `gpas_update_own`, `gpas_delete_own` (dropped) |
| S2 | `evaluate_student_risk(p_student_id)` has **no caller check** and is executable by `authenticated` | Any signed-in user, including students and cluster heads, can read any student's attendance mean, latest GPA, backlog count and reasons *(tested)*. The call also writes: it upserts the flag row and can trigger notifications | function `evaluate_student_risk` |
| S3 | **Fixed in 0035.** `resolve_student_ids(text[])` had no role check and was executable by `authenticated` | Any signed-in user could map registration numbers or e-mails to student UUIDs (enumeration). It now refuses anyone but a cluster head, the HOD or a no-JWT call, and matches registration numbers only | function `resolve_student_ids` (0033, 0035) |
| S4 | The department branch of `get_dashboard_metrics` is the `else` branch | A `cluster_head` calling the RPC receives department-wide query and user counts (the administrator does by design; a HOD's branch is scoped since 0039) | function `get_dashboard_metrics` |
| S5 | Profile self-update covers every unprotected column (**narrowed in 0035**: `login_id`, the registration number every upload matches on, is now protected) | A user can change their own `full_name`, `section`, `semester_label`, `department`, `avatar_url`, `hod_email`, `parent_*`, `created_at`, the `*_completed_at` timestamps, and (faculty) `mentee_capacity`, which feeds the reserve pool. They can also clear `must_change_password` *(tested)*. | policy `profiles_update_self`; guard column list |
| S6 | **Fixed in 0042.** Mentor and HOD `UPDATE` policies on `support_queries` were not column-restricted (the mentor's `WITH CHECK` only keeps `mentor_id = auth.uid()`) | A mentor could change `status`, `resolution_status`, `reopen_count`, `satisfaction_rating`, the escalation columns, `subject` and so on directly, bypassing the RPC rules, and the HOD anything. The UPDATE grant is now the column `priority` only *(tested)* | policies `queries_update_mentor`, `queries_update_hod`; column grant (0042) |
| S7 | `latest_gpa` is exposed through `student_risk_flags` / `at_risk_student_overview` with `can_access_student`, not `can_view_student_gpa` | GPA-sharing preference is bypassed (moot while the toggle is gone) | view `at_risk_student_overview` |
| S8 | Deactivation does not end sessions. `is_active` is checked at sign-in, by the API, and by `is_student()` / `is_faculty()` / `is_hod()` / `is_cluster_head()`, but **not** by `is_mentor_of()` (hence not by `can_access_student`) or by policies comparing `mentor_id = auth.uid()` | A deactivated mentor with a live session can still read mentees' profiles, Form A and risk flags, and update their queries *(tested)* | `AuthProvider`; `is_mentor_of`; no Auth ban |
| S9 | Shared temporary password with a public fallback, shown on screen and in CSV downloads | Anyone who knows the default can sign in to any account that has not yet changed it, if the variable is unset | `environment.js`, `ClusterHeadRosterPage` |
| S10 | Password complexity is client-side only | A user can set a weak password with a direct `auth.updateUser` call | `ChangePasswordPage` |
| S11 | No Content-Security-Policy, and the session is in `localStorage` | XSS impact is higher | `vercel.json`, `index.html` |
| S12 | The escalation note is visible to the student, although the UI says it is not | Privacy expectation mismatch | `escalate_query_to_hod` system message |
| S13 | `handle_new_auth_user` trusts `raw_user_meta_data.role` for `student`, `faculty`, `hod` and `cluster_head` (`admin` also needs `raw_app_meta_data.role` in the inserted row, which only the service role sets, 0039; the Auth Admin API adds it after the insert, so `npm run db:admin` sets the role itself) | Safe **only** while public sign-up is disabled | trigger `trg_on_auth_user_created` |
| S14 | Cluster heads can write `cluster_head_courses` directly | Bypasses setup validation. Deleting a course cascades attendance. | policy `ch_courses_write_own` |
| S15 | **Fixed in 0042** (the INSERT grant is revoked; the policy is left in place, unused *(tested)*). Students could INSERT `support_queries` directly (`queries_insert_own`: own id and current mentor) | Bypasses `create_support_query`'s 20-unresolved cap and description rules. Only the subject's CHECK constraints (non-blank, ≤ 200) still apply. The row can carry any `status`, `resolution_status`, `priority`, rating, `resolved_by` or `escalated_*` value allowed by the column constraints (for example, a fake "Resolved, confirmed, rated 1/5" query credited to the mentor, *tested*). No first message is created. The creation notification still fires. | policy `queries_insert_own` |
| S16 | Survey answers are readable by the mentor they are about | Individual ratings are not anonymous: `survey_responses` and `survey_response_answers` are visible to the mentor and the HOD through `can_access_student` *(tested)* | policies `survey_responses_select_scope`, `survey_answers_select_scope` |
| S17 | The privileged RPCs behind the API are executable by `authenticated` and check only the caller's role: `record_*_batch`, `map_students_to_mentors`, `activate_roster_students` (0036), `run_cycle_job`, `run_all_cycle_jobs_now`, `reassign_mentees`, `set_faculty_employment_status` | A cluster head or HOD calling them through PostgREST skips the API's setup gate (no SQL function checks `cluster_head_setup_completed`), rate limit and audit entry. A direct `reassign_mentees` also skips the query handover. | function grants |
| S18 | Mentors can UPDATE their counselling requests directly (`counselling_update_mentor`, all columns) | A mentor can rewrite the student's `concern` or `counselling_type`, or change `status`, outside `respond_to_counselling` | policy `counselling_update_mentor` |
| S19 | **Narrowed in 0039.** The administrator bypasses the protected-column guard and has `profiles_update_hod` over everyone; a HOD has it over their own faculty and mentees | The administrator can directly change any profile's role, activation, mentor, star flag or HOD mapping (by design, with no audit trail). A HOD can change those of their own people, except the mapping columns and the `hod` / `admin` role (their own included), and can no longer reach anyone else's profile | `guard_protected_profile_columns`, policy `profiles_update_hod` |
| S20 | `set_gpa_sharing` is still executable although the UI toggle was removed, and Form A rows are directly updatable | A student can turn GPA sharing off without the UI, hiding GPAs from the mentor | function `set_gpa_sharing`; policy `form_a_update_own` |

---

## 9. Frontend

### 9.1 Stack and build

| | |
|---|---|
| **Framework** | React 19 (`react`, `react-dom` ^19) |
| **Router** | React Router 7 (`react-router-dom` ^7.1), `BrowserRouter` |
| **Build** | Vite 6 with `@vitejs/plugin-react`. Dev server on port 5173. Manual chunks: `react-vendor`, `supabase-vendor`, `charts-vendor`. Output goes to `frontend/dist`. |
| **Styling** | Tailwind CSS 3.4, `@tailwindcss/forms`, PostCSS with autoprefixer, and custom component classes in `index.css` |
| **Charts** | Recharts 2.15, wrapped in `components/charts/Charts.jsx` |
| **Data** | `@supabase/supabase-js` ^2.48 (DB, RPC, Realtime, Storage, Auth) and a small `fetch` wrapper for `/api` |
| **Lint and test** | `oxlint src`; `vite-node test/ui-regression.test.jsx` (jsdom) |

There is no global store (no Redux, Zustand or React Query). The only shared state is in the three contexts; each page loads its own data.

### 9.2 Composition

`main.jsx` renders `<StrictMode><App/></StrictMode>`. `App.jsx` nests:

```
ErrorBoundary
└─ BrowserRouter
   └─ ToastProvider
      └─ AuthProvider            (session + profile + live profile updates)
         └─ NotificationProvider (bell data + realtime toasts)
            └─ AppRouter         (Suspense fallback = <PageLoader/>)
```

- `LoginPage`, `ChangePasswordPage` and `NotFoundPage` are imported eagerly. Every other page (40 of them) is `React.lazy`, inside one `Suspense`.
- Every signed-in page renders its own `PortalShell`. The exceptions are the onboarding pages and `/cluster-head/setup`, which render bare so that no menu is available until the step is done.

### 9.3 Route table

`Protected role=X` means `RequireAuth → RequirePasswordChange → RequireRole(X)`. `RequireRole` is an exact role match; a user with another role is redirected to their own `HOME_PATH`.

| Path | Component | Guards | Notes |
|---|---|---|---|
| `/login` | `LoginPage` | none | Redirects signed-in users home |
| `/change-password` | `ChangePasswordPage` | `RequireAuth` | Forced first-login password change |
| `/reset-password` | `ChangePasswordPage` | none | Password-reset landing (recovery session from the URL) |
| `/` | `HomeRedirect` | none | Goes to `HOME_PATH[role]` or `/login` |
| `/student/onboarding` | `StudentOnboardingFormPage` | Protected student | Form A, no shell |
| `/student/profile-photo` | `StudentProfilePhotoPage` | Protected student | Photo step, no shell |
| `/student` | `StudentDashboardPage` | Protected student + `RequireOnboarding` | |
| `/student/queries` | `StudentQueriesPage` | same | |
| `/student/queries/:queryId` | `StudentQueryDetailPage` | same | |
| `/student/peer-queries` | `SeniorPeerQueriesPage` | same + `RequireSeniorMentor` | Senior mentor only (0042) |
| `/student/peer-queries/:queryId` | `SeniorPeerQueryDetailPage` | same + `RequireSeniorMentor` | Live chat, Mark resolved, Ask HOD / Escalate (0042) |
| `/student/senior-mentees` | `SeniorMenteesPage` | same + `RequireSeniorMentor` | Assigned Mentees (0042) |
| `/student/group-queries` | `StudentGroupQueriesPage` | same | Star mentee only (page redirect and RPC) |
| `/student/academics` | `StudentAcademicsPage` | same | Titled "Academic performance overview" |
| `/student/survey` | `StudentSurveyPage` | same | |
| `/student/survey-tracking` | `StudentSurveyTrackingPage` | same | Star mentee only |
| `/student/cr-report` | `StudentCrReportPage` | same | Star mentee only |
| `/student/counselling` | `StudentCounsellingPage` | same | |
| `/student/achievements` | `StudentAchievementsPage` | same | |
| `/student/profile` | `StudentProfilePage` | same | |
| `/faculty` | `FacultyDashboardPage` | Protected faculty | |
| `/faculty/queries` | `FacultyQueryQueuePage` | Protected faculty | |
| `/faculty/queries/:queryId` | `FacultyQueryDetailPage` | Protected faculty | Also the queries a senior raised to them (0042) |
| `/faculty/raised` | `RaisedQueriesPage` | Protected faculty | "Raised to Me" (0042) |
| `/faculty/mentees` | `FacultyMenteesPage` | Protected faculty | |
| `/faculty/mentees/:studentId` | `FacultyMenteeDetailPage` | Protected faculty | |
| `/faculty/at-risk` | `FacultyAtRiskPage` | Protected faculty | |
| `/faculty/counselling` | `FacultyCounsellingPage` | Protected faculty | |
| `/faculty/cr-reports` | `FacultyCrReportsPage` | Protected faculty | |
| `/faculty/report` | `FacultyActivityReportPage` | Protected faculty | |
| `/faculty/profile` | `FacultyProfilePage` | Protected faculty | |
| `/hod` | `HodDashboardPage` | Protected hod | Their faculty's figures (0039) |
| `/hod/queries` | `FacultyQueryQueuePage isHodView` | Protected hod | Their faculty's queries, Mentor column, no Raise; escalated queries excluded (0042) |
| `/hod/queries/:queryId` | `FacultyQueryDetailPage isHodView` | Protected hod | No Raise, no mentee link |
| `/hod/raised` | `RaisedQueriesPage isHodView` | Protected hod | "Raised to HOD", with the Raised by faculty / senior tag and the reason (0042) |
| `/hod/seniors` | `HodSeniorMentorsPage` | Protected hod | "Senior Mentors": star a senior and choose their sections (0042) |
| `/hod/performance` | `HodFacultyPerformancePage` | Protected hod | |
| `/hod/reports` | `FacultyActivityReportPage isHodView` | Protected hod | Faculty picker including "all" |
| `/hod/roster` | `HodFacultyRosterPage` | Protected hod | |
| `/hod/students` | `HodStudentsPage` | Protected hod | |
| `/hod/students/:studentId` | `FacultyMenteeDetailPage isHodView` | Protected hod | No star toggle |
| `/hod/at-risk` | `FacultyAtRiskPage isHodView` | Protected hod | Their faculty's mentees, with a Mentor column |
| `/hod/cr-reports` | `FacultyCrReportsPage isHodView` | Protected hod | Their faculty's reports |
| `/hod/operations` | `HodOperationsPage` | Protected hod | "Scheduled Jobs" |
| `/hod/profile` | `HodProfilePage` (re-exports `FacultyProfilePage`) | Protected hod | |
| `/hod/uploads` | `ClusterHeadDashboardPage` | Protected hod | Uploads → Overview, "Uploads overview" (0039) |
| `/hod/uploads/cycles` | `ClusterHeadCyclesPage` | Protected hod | Uploads → Academic Cycles |
| `/hod/uploads/attendance` | `ClusterHeadAttendancePage` | Protected hod | No subject gate; subjects from the files |
| `/hod/uploads/gpa` | `ClusterHeadGpaPage` | Protected hod | |
| `/hod/uploads/backlogs` | `ClusterHeadBacklogPage` | Protected hod | |
| `/hod/uploads/black-dots` | `ClusterHeadBlackDotPage` | Protected hod | |
| `/hod/uploads/rosters` | `ClusterHeadRosterPage` | Protected hod | Accounts created report to the HOD |
| `/admin`, `/admin/queries`, `/admin/queries/:queryId`, `/admin/raised`, `/admin/seniors`, `/admin/performance`, `/admin/reports`, `/admin/roster`, `/admin/students`, `/admin/students/:studentId`, `/admin/at-risk`, `/admin/cr-reports`, `/admin/operations`, `/admin/profile` | the same components as the fourteen `/hod` routes above | Protected admin | The whole department (0039); mounted with the `/hod` ones by `departmentRoutes(base, role)` |
| `/admin/upload` | `AdminHodMappingPage` | Protected admin | "Upload": the mentor–HOD mapping (§4.25) |
| `/cluster-head/setup` | `ClusterHeadSetupPage` | Protected cluster_head | No shell |
| `/cluster-head` | `ClusterHeadDashboardPage` | Protected cluster_head + `RequireClusterHeadSetup` | |
| `/cluster-head/cycles` | `ClusterHeadCyclesPage` | same | "Academic Cycles" (0036) |
| `/cluster-head/attendance` | `ClusterHeadAttendancePage` | same | |
| `/cluster-head/gpa` | `ClusterHeadGpaPage` | same | |
| `/cluster-head/backlogs` | `ClusterHeadBacklogPage` | same | |
| `/cluster-head/black-dots` | `ClusterHeadBlackDotPage` | same | "Upload Black dot" (0035) |
| `/cluster-head/rosters` | `ClusterHeadRosterPage` | same | |
| `/cluster-head/courses` | `ClusterHeadCoursesPage` | same | "My Subjects" |
| `/cluster-head/profile` | `ClusterHeadProfilePage` (re-exports `FacultyProfilePage`) | same | |
| `*` | `NotFoundPage` | none | |

That is 78 routes (14 of them under `/admin`, 7 under `/hod/uploads` and `/admin/upload` added in 0039; 0042 added the three senior pages, `/faculty/raised`, and `raised` and `seniors` under both `/hod` and `/admin`). **Removed** since the old document: `/hod/semester` and every `/…/tickets…` path. There is no HOD or administrator counselling route, and a HOD has no `/hod/uploads/courses` (My Subjects) or setup route.

### 9.4 Guards (`routes/RouteGuards.jsx`)

- **`RequireAuth`.** Shows `PageLoader` ("Restoring your session...") while auth loads. Without both a session and a profile (`isAuthenticated`) it redirects to `/login` with `state.from`.
- **`RequirePasswordChange`.** While `profile.must_change_password` is true it redirects to `/change-password`.
- **`RequireRole({role})`.** On a mismatch it redirects to `HOME_PATH[profile.role]`. So the administrator opening `/hod/...` lands on `/admin`, and a HOD opening `/cluster-head/...` lands on `/hod`.
- **`RequireOnboarding`** (students). It checks `form_a_completed`, then `avatar_url` (§4.3).
- **`RequireSeniorMentor`** (0042). It redirects anyone without `profile.is_senior_mentor` to `/student`; used on the three senior pages.
- **`RequireClusterHeadSetup`.** It redirects to `/cluster-head/setup` until `cluster_head_setup_completed`. It only acts on cluster heads, and the HOD's `/hod/uploads` routes do not use it. Its comment about "the Course and Section dropdowns on every upload screen" is stale; the uploads have no such dropdowns.

All guards are UX only. The database enforces access.

### 9.5 Navigation (`NAVIGATION` in `lib/constants.js`)

The sidebar renders the list for `profile.role`. An item with a `when` predicate renders only if it returns true for the profile. An item with `children` (and a `base` path) is a **group**: a heading button (`aria-expanded`) that opens its own list, open by default when the current page is under `base`; folded over the current page, the heading carries the active pill. The HOD and administrator department items come from one helper, `departmentNavigation(base)`. The sidebar subtitle reads "Head of Department" for a HOD and "Administrator" for the administrator.

| Role | Items (label → path) |
|---|---|
| student | Home `/student`; My Queries `/student/queries`; **Peer Queries** `/student/peer-queries`†; **Assigned Mentees** `/student/senior-mentees`†; **Group Queries** `/student/group-queries`\*; Academics `/student/academics`; Feedback Survey `/student/survey`; **Survey Tracking** `/student/survey-tracking`\*; **CR Report** `/student/cr-report`\*; Counselling `/student/counselling`; Achievements `/student/achievements`; My Profile `/student/profile` |
| faculty | Home; Query Queue; **Raised to Me** `/faculty/raised` (0042); My Mentees; At-Risk Students; Counselling; CR Reports; My Report; My Profile |
| hod | Home; All Queries; **Raised to HOD** `/hod/raised` (0042); Faculty Performance; Faculty Reports; Faculty Roster; Students; **Senior Mentors** `/hod/seniors` (0042); At-Risk Students; CR Reports; Scheduled Jobs (`/hod/operations`); **Uploads** ▾ (Overview `/hod/uploads`; Academic Cycles; Upload Attendance; Upload GPA; Upload Backlogs; Upload Black dot; Rosters & Mentors); My Profile |
| admin | Home `/admin`; All Queries; Raised to HOD; Faculty Performance; Faculty Reports; Faculty Roster; Students; Senior Mentors; At-Risk Students; CR Reports; Scheduled Jobs; **Upload** (`/admin/upload`); My Profile |
| cluster_head | Home; Academic Cycles (`/cluster-head/cycles`); Upload Attendance; Upload GPA; Upload Backlogs; Upload Black dot (`/cluster-head/black-dots`); My Subjects (`/cluster-head/courses`); Rosters & Mentors (`/cluster-head/rosters`); My Profile |

\* only when `profile.is_star_mentee`. † only when `profile.is_senior_mentor` (0042). Form A is deliberately not a menu item; after onboarding it lives inside My Profile.

A page can override which item is marked with `PortalShell activeNav` (0042): the query detail page marks the list it came back to (Raised to HOD, All Queries, Query Queue or Raised to Me), since every query opens under `…/queries/<id>`.

### 9.6 Page index

Each page's behaviour is described in the feature section named in the last column.

| Page | Main data | Main actions | § |
|---|---|---|---|
| `LoginPage` | — | sign in, forgot password | 4.2 |
| `ChangePasswordPage` | — | `auth.updateUser`, clear `must_change_password` | 4.2 |
| `StudentOnboardingFormPage` / `StudentProfilePhotoPage` | `student_form_a_profiles` | `submit_student_form_a`, photo upload | 4.3 |
| `StudentDashboardPage` | `get_dashboard_metrics`, `useRealtimeQueries(5, studentId)`, `profile.mentor`, `profile.senior_mentor` (My Senior Mentor) | raise query | 4.17, 4.4, 4.26 |
| `StudentQueriesPage` / `StudentQueryDetailPage` | `useRealtimeQueries(studentId)`, `useQueryThread` | create (to the faculty or senior mentor), post, confirm, rate | 4.4, 4.26 |
| `SeniorPeerQueriesPage` | `get_peer_queries` (live) | — | 4.26 |
| `SeniorPeerQueryDetailPage` | `useQueryThread`, `get_peer_queries` | post, resolve, `escalate_peer_query` | 4.26 |
| `SeniorMenteesPage` | `get_my_senior_mentees`, `senior_mentor_sections` | — | 4.26 |
| `StudentGroupQueriesPage` | `get_mentor_group_queries` | — (read-only) | 4.6 |
| `StudentAcademicsPage` | `student_semester_gpas`, `student_cgpas`, `student_attendance_overview`, `student_backlogs`, `student_black_dots` (Academic Performance Overview, no semester picker) | — (read-only since 0037) | 4.9 |
| `StudentSurveyPage` / `StudentSurveyTrackingPage` | `get_active_survey_for_student` / `get_mentor_group_survey_status` | `submit_survey_response` | 4.15 |
| `StudentCrReportPage` | `mom_records`, `support_queries` (with `mom_id`) | `submit_mom_report` | 4.7 |
| `StudentCounsellingPage` | `counselling_requests` | `request_counselling` | 4.8 |
| `StudentAchievementsPage` | `student_achievements` | direct CRUD, proof upload | 4.10 |
| `StudentProfilePage` | profile, Form A | phone update, Form A edit | 4.22, 4.3 |
| `FacultyDashboardPage` | `get_dashboard_metrics`, `useRealtimeQueries(8, mentorId)` | — | 4.17 |
| `FacultyQueryQueuePage` | `useRealtimeQueries` (`mentorId` for faculty; `excludeEscalated` for the HOD and administrator) | raise to HOD | 4.4, 4.5 |
| `FacultyQueryDetailPage` | `useQueryThread`, `canned_replies` | post, priority (not on a senior's query), resolve, raise to HOD | 4.4, 4.5, 4.26 |
| `RaisedQueriesPage` (Raised to Me; Raised to HOD with `isHodView`) | `get_raised_queries` (live) | — | 4.5, 4.26 |
| `FacultyMenteesPage` | `student_query_summary`, `survey_mentee_status` | star, department and HOD, dossier PDF | 4.6, 4.5, 4.15 |
| `FacultyMenteeDetailPage` | `get_student_dossier` (incl. official CGPA, backlogs, black dots), `student_attendance_overview` (Academic Performance Overview) | verify achievement, star, PDF | 4.18, 4.9, 4.10, 4.12 |
| `FacultyAtRiskPage` | `at_risk_student_overview` (every row, paged), `student_attendance_overview`, `student_semester_gpas`, `student_black_dots` (active cycle), `academic_cycles` | mark meeting done | 4.14 |
| `FacultyCounsellingPage` | `counselling_requests` | `respond_to_counselling` | 4.8 |
| `FacultyCrReportsPage` | `mom_records`, `support_queries` | `set_query_in_progress`, `resolve_support_query` | 4.7 |
| `FacultyActivityReportPage` | `get_faculty_activity_report` / `get_department_faculty_report` | PDF | 4.18 |
| `FacultyProfilePage` (also HOD, administrator, cluster head) | profile | phone update | 4.22 |
| `HodDashboardPage` (HOD and administrator) | `get_dashboard_metrics`, `faculty_performance_summary`, `query_daily_trend` | — | 4.17 |
| `HodFacultyPerformancePage` | `faculty_performance_summary` | report links, PDF | 4.17 |
| `HodFacultyRosterPage` | `/api/admin/manage-faculty-roster` | set status, reassign | 4.19 |
| `HodStudentsPage` | `student_query_summary` (every row, paged), faculty names | Add account | 4.20 |
| `HodOperationsPage` | `/api/admin/run-cycle-job` (GET) | run a job, run all | 4.16 |
| `HodSeniorMentorsPage` (HOD and administrator) | `list_senior_mentors` | star a senior: `set_senior_mentor_sections` | 4.26 |
| `ClusterHeadSetupPage` / `ClusterHeadCoursesPage` | `current_cycle_courses` | `submit_cluster_head_setup` | 4.11 |
| `ClusterHeadDashboardPage` (also a HOD's Uploads → Overview) | `academic_cycles`, `current_cycle_courses` (a HOD: `fetchUploadedSubjects`), `academic_upload_history` (10, exact count; a HOD: their own) | — | 4.17, 4.25 |
| `ClusterHeadCyclesPage` | `list_academic_cycles`, `get_cycle_overview` | start the next cycle, edit dates, remove, carry over, re-check flags, download the report | 4.24 |
| `ClusterHeadAttendancePage` | `current_cycle_courses` (a HOD: `fetchUploadedSubjects`) | attendance upload | 4.12, 4.25 |
| `AdminHodMappingPage` | `user_profiles` (every faculty member, paged; every HOD) | mentor–HOD mapping upload | 4.25 |
| `ClusterHeadGpaPage` / `BacklogPage` / `BlackDotPage` | — | GPA, backlog and black dot uploads; each shows what it read from the file | 4.12 |
| `ClusterHeadRosterPage` | `roster_import_batches` (15, with the cycle label) | roster uploads (activating existing students), mentor map | 4.13 |

### 9.7 Shared components

**Layout (`components/layout/`)**

- **`PortalShell({searchPlaceholder, onSearch, activeNav, children})`.** The sidebar plus the top bar plus the page body. The frame is identical for every role. `activeNav` (0042), when given, is the menu path to mark instead of the one the URL matches.
- **`SidebarNavigation`.**
  - The MUJ logo, "SMP Portal", and a role subtitle: Student Portal, Faculty Mentor, Department Admin or Cluster Head.
  - The role's menu, with an orange pill marking the active item.
  - A user card with Sign Out.
  - Off-canvas below the `lg` breakpoint, with an overlay.
- **`TopBar`.**
  - The menu toggle and the global search box. It is debounced 320 ms, and shown only on pages that pass `onSearch`: StudentQueries, FacultyQueryQueue, FacultyMentees, FacultyAtRisk, HodStudents, HodFacultyRoster and HodFacultyPerformance.
  - The notification bell.
  - The identity block "`<login_id>` :: `<name>`".
- **`NotificationBell`.** The dropdown list with type icons, "Mark all read", and click-to-navigate (§4.21).

**UI primitives (`components/ui/`)**

| Component | Notes |
|---|---|
| `Panel` | White card with a peach header strip (`title`, `tab`, `tabIcon`, `actions`). The body has padding and no default variant; this was a regression fixed earlier and is covered by the UI test. |
| `Modal`, `ConfirmDialog` | Focus goes to the first field on open. The focus effect depends only on `[open]`, so typing never jumps to ✕ (also covered by the UI test). |
| `FormControls` | `TextField`, `PasswordField`, `TextAreaField`, `SelectField`, `RadioGroupField`, `CheckboxField`, `ToggleSwitch`, `FilterPills`, `Pagination`, and a file picker |
| `DataTable` | Column definitions plus rows, empty state |
| `StatCard` | KPI card with an optional caption and trend |
| `StatusBadge` | `QueryStatusBadge`, `ResolutionBadge` (nothing for `none`), `PriorityBadge`, `CategoryBadge` (current and legacy categories; unknown values fall back to the Others style), `EmploymentBadge`; since 0042 `MentorKindBadge` (Faculty Mentor / Senior Mentor, the senior in violet), `EscalationBadges` (Raised to faculty mentor, Escalated to HOD, when they apply) and `RaisedByBadge` (Raised by faculty / Raised by senior) |
| `Avatar` | Signed-URL cache (1 h, re-signed 60 s early); silhouette fallback. Also exports `resolveAvatarUrl` and `forgetAvatar`. |
| `ProfilePhotoUploader` | Upload and replace a photo (3 MB, images). Used **only** by the onboarding photo step, although its comment says it serves all profile pages. |
| `Skeleton` | `SkeletonLine`, `SkeletonCards`, `SkeletonTable`, `PageLoader` |
| `EmptyState`, `PageHeader`, `ErrorBoundary` | Simple building blocks; `ErrorBoundary` wraps the whole app |

**Feature components**

- `charts/Charts.jsx` — themed Recharts wrappers with a shared palette, tooltip and empty state ("No data to display yet").
- `queries/*` — §4.4. `queries/EscalationHistory.jsx` (0042) is the "Raised for help" panel: each referral and escalation with its tag, who raised it, to whom, when and the reason (§4.26).
- `student/FormAFields.jsx` — §4.3.
- `hod/AddAccountModal.jsx` — §4.20.
- `hod/SectionMultiSelect.jsx` — §4.26. A button showing the chosen sections ("A3, B3") that opens a list of the 40 sections as ticks, with "n selected" and Clear; sections another senior has are disabled with their name.
- `clusterHead/AcademicUploadPanel.jsx` — §4.12 and §4.13. Shows the cycle the upload goes into (`showCycle`).
- `clusterHead/cycles/CycleModules.jsx`, `clusterHead/cycles/CycleDialogs.jsx` — §4.24.
- `academics/AcademicOverview.jsx` — §4.9. `showHeader={false}` drops its heading, description and semester picker (the student's page).

### 9.8 Data-access conventions

1. **RLS decides the scope; the page never filters for security.** Explicit `.eq(...)` filters exist only to narrow queries (for example `mentor_id = me` on the counselling page).
2. **State transitions use `supabase.rpc()`.** Direct writes are limited to the self-edits in §2.3.
3. **Privileged or heavy work goes through `apiClient`** (`/api/*`).
4. **Actions use `useAsyncAction().run(fn, {successMessage, onSuccess})`.** It shows the success toast, or `toast.error(describeError(err))` on failure.
5. **Realtime is used for queries, messages, notifications and the own profile.** Everything else reloads after the user's own action. Pages do not live-refresh other users' changes.
6. **Files are uploaded before the form is saved.** Only the object path is stored; files are viewed through signed URLs.
7. **Row limits.** PostgREST returns at most `max_rows` (1,000) rows per request, silently. A list that can be longer is read with `lib/fetchAllRows.js` (the HOD Students page and the at-risk list); the other unpaged reads are per mentor, per student or explicitly limited (§4.20).

### 9.9 Design system

- **Fonts:** Manrope (`font-headline`: 400–800) and Hanken Grotesk (`font-body`: 400–700), loaded from Google Fonts. Icons are Material Symbols Outlined (Google Fonts, variable axes).
- **Tailwind tokens** (`tailwind.config.cjs`; the names are unchanged from the earlier theme, only the values moved):

  | Group | Values |
  |---|---|
  | Brand | `primary` #c2410c, `primary-container` #ea580c, `primary-fixed` #fdece3 (peach headers and chips), `primary-fixed-dim` #fbd9c8, `on-primary-fixed` #9a3412, `secondary` #ea580c, `secondary-container` #fb923c, `tertiary` #a8a29e |
  | Status | `error` #dc2626 / `error-container` #fee2e2; `success` #16a34a / #dcfce7; `warning` #d97706 / #fef3c7; `info` #2563eb / #dbeafe |
  | Surfaces | `background` #fdfaf8, `surface` #ffffff, `surface-container-*` (lowest #fff … highest #efdfd6), `on-surface` #1c1917, `on-surface-variant` #57534e, `outline` #a8a29e, `outline-variant` #e7ddd6 |
  | Shell | `sidebar` (#fff; hover #fdf1ea; active pill #c2410c; border #f2e4dc; text #57534e; muted #a8a29e); `topbar` (#fff; border #f2e4dc) |
  | Radius | DEFAULT 0.5rem, md 0.625rem, lg 0.75rem, xl 1rem, 2xl 1.25rem |
  | Spacing extras | `base` 4px, `xs` 8px, `sm` 16px, `md` 24px, `lg` 32px, `xl` 48px, `gutter` 20px, `sidebar` 264px |
  | Font sizes | `display-lg` 44/52, `headline-lg` 32/40, `headline-md` 26/34, `headline-sm` 19/27, `body-lg` 18/28, `body-md` 16/24, `body-sm` 14/21, `label-md` 14/20, `label-sm` 12/16 |
  | Shadows | `card`, `raised`, `dropdown` |
  | Animations | `fade-in`, `scale-in`, `slide-in-right`, `shimmer` |

- **Component classes** (`index.css`, `@layer components`): `.panel`, `.panel-header`, `.panel-header-title`, `.field-label`, `.field-input`, `.field-error`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.sidebar-link`, `.sidebar-link-active`, `.data-table` (with its thead, tbody and hover rules), `.chip`, `.break-anywhere`, `.skeleton`.
- **Other styles:** `.material-symbols-outlined` settings, `.custom-scrollbar`, and a print rule (`.no-print`).
- **Theme:** there is no dark mode. `theme-color` is #a43700.
- **`CHART_COLORS`** (JS): `open`, `inProgress`, `resolved`; `primary`, `secondary`, `slate`; and `series` [#c2410c, #f97316, #a8a29e, #ea580c, #d97706, #16a34a], which also colours the query categories in order (Academics, Examination, Behavioural, Administrative, Others, then the legacy Academic; `QUERY_CATEGORY_COLORS`). The PDF palette is `PALETTE` in `pdf-chart-primitives.js`.
- **Academic Performance Overview** (`AcademicOverview.jsx`, its own constants): attendance bars #2a78d6 (75% or more) and #e34948 (below), a pair checked for colour-blind separation and contrast on white, always with a legend and the value on the bar; the GPA line is the brand #c2410c with a 10% area; target lines are dashed #57534e.

### 9.10 Constants (`lib/constants.js`)

These must be kept in sync with the Postgres enums wherever the UI offers a value.

| Export | Value |
|---|---|
| `ROLES` / `ROLE_LABELS` | student "Student", faculty "Faculty Mentor", hod "Head of Department", cluster_head "Cluster Head", admin "Administrator" |
| `QUERY_CATEGORIES` | Academics, Examination, Behavioural, Administrative, Others. Legacy values are deliberately not offered. |
| `QUERY_STATUSES` / `QUERY_PRIORITIES` | Open, In Progress, Resolved / Low, Medium, High, Urgent |
| `RESOLUTION_STATUS_LABELS` | Defined but **unused**; the badges carry their own labels |
| `ACHIEVEMENT_CATEGORIES`, `PARENT_OCCUPATIONS`, `BLOOD_GROUPS` | Mirror the enums and the Form A options |
| `COURSE_CATALOGUE`, `OTHER_COURSE_OPTION`, `CLUSTER_HEAD_DEFAULT_SUBJECT_ROWS` | 27 course names including "Other"; "Other"; 5 |
| `SEMESTER_OPTIONS` | 1–8 |
| `ACADEMIC_UPLOAD_LABELS` | attendance "Attendance", gpa "GPA", backlog "Backlogs", black_dot "Black dots" |
| `SURVEY_SCALE` | 1 Poor … 5 Excellent |
| `CYCLE_JOBS` | The four jobs, with labels and descriptions for the Operations page |
| `AT_RISK_MEETING_STATUS_LABELS` | awaiting_link "Awaiting meeting link", scheduled, completed, cancelled |
| `COUNSELLING_STATUS` | open, acknowledged and closed, each with `studentLabel`, `mentorLabel` and `className` (§4.8) |
| `COUNSELLING_TYPES`, `counsellingTypeLabel` | The twelve counselling types as `{value, label}`, in dropdown order, and the label of a stored value (null for none). Must match 0040's CHECK and `counselling_type_label()` (§4.8) |
| `EMPLOYMENT_STATUS_LABELS` | Active, On leave, Departed |
| `MENTOR_KIND_LABELS` | faculty "Faculty Mentor", senior "Senior Mentor" (0042; `support_queries.mentor_kind`) |
| `RAISED_BY_LABELS` | faculty "Raised by faculty", senior "Raised by senior" (0042; `query_escalations.raised_by_kind`) |
| `SENIOR_SECTIONS` | "A3", "A4", … "T3", "T4" (40). Must match 0042's `senior_section_known` CHECK; the database stores them as "A 3" (§4.26) |
| `CHART_COLORS` | §9.9 |
| `NAVIGATION` | §9.5 |
| `HOME_PATH` | student `/student`, faculty `/faculty`, hod `/hod`, cluster_head `/cluster-head`, admin `/admin` |

### 9.11 Dead or unused frontend code

- **`components/tickets/`** (`CreateTicketModal`, `TicketConversation`, `ResolutionConfirmation`, `SatisfactionRating`):
  - Nothing imports these files.
  - They call RPCs removed in 0031: `create_support_ticket`, `post_ticket_message`, `confirm_ticket_resolution`, `rate_support_ticket`.
  - `CreateTicketModal` imports `TICKET_CATEGORIES`, which no longer exists.

  The files are safe to delete.
- **Unused exports:** `RESOLUTION_STATUS_LABELS`, `BUCKETS.ROSTERS`.
- **Stale comments:**
  - `AuthProvider` mentions the HOD unlocking Form A.
  - `supabaseClient.js` claims a CSP.
  - `ProfilePhotoUploader` claims it is used on every profile page.
  - `StudentAchievementsPage` claims verification never blocks.
  - `FacultyAtRiskPage` promises columns it does not render.

---

## 10. Backend

The backend has two halves:

- **The database.** Most business rules live here, in SQL (§7 and §5.3).
- **Eight Vercel serverless functions.** These do the work that needs the service role, files or PDFs (§6).

There is no long-running server.

### 10.1 Serverless runtime and layout

- **Runtime.**
  - Node ≥ 20, ES modules (`"type": "module"` in both `package.json` files).
  - Deployed from `api/**/*.js` with 1,024 MB of memory and a **30-second maximum duration** (`vercel.json`).
  - Files under `api/_lib/` are shared modules, not endpoints.
- **Dependencies** (root `package.json`): `@supabase/supabase-js`, `exceljs`, `pdf-lib`, `zod`.
- **Statelessness.** Instances are stateless. Anything that must be shared across invocations (rate-limit counters, upload history, import progress) lives in Postgres. Import progress also lives in the browser's chunk loop.
- **Request lifecycle.** See §6.1. Every endpoint is `withApiDefaults([...methods], async (req, res) => {...})`. Errors are thrown as `ApiError(message, status)` and serialised by the wrapper.

### 10.2 Two Supabase clients, two trust levels

| Client | Created by | Key | RLS | Used for |
|---|---|---|---|---|
| `context.admin` | `createAdminClient()` | service role | bypassed | `auth.getUser` / `auth.admin.createUser`; loading the caller's profile; rate limit and audit RPCs; reading all e-mails and faculty for imports; post-creation profile updates; the query handover on reassignment; creating missing mentors |
| `context.asUser` | `createUserClient(jwt)` | anon plus the caller's JWT | applied | every business RPC (`record_*_batch`, `map_students_to_mentors`, `reassign_mentees`, `set_faculty_employment_status`, `run_cycle_job`, the report RPCs), and roster reads in manage-faculty-roster |

Because the business RPCs run as the user, the API's role check and the database's own check must both pass.

### 10.3 Database-side conventions

- **RPC shape.**
  - `create or replace function public.x(...) returns ... language plpgsql security definer set search_path = public, pg_temp`.
  - The body first checks the caller (`is_hod()`, `is_mentor_of()` and so on), raising `42501`, then validates input with readable messages.
  - Execute is revoked from `public` and `anon` and granted to `authenticated` (and/or `service_role`).
- **Allowed without a JWT.** Batch and job functions also allow `auth.uid() is null`. That covers the service role and SQL scripts, which is how the seed script runs them.
- **Protected columns** are changed only inside definer functions that set `ssmp.trusted_operation` (§7.1).
- **Side effects** — system messages, notifications, risk re-evaluation, logs — happen inside the same transaction as the change. Either everything commits or nothing does.
- **Batch uploads** (0033):
  1. Resolve every identifier in the file once, with `resolve_student_ids`. It uses the unique index on `lower(login_id)` and, since 0035, matches the registration number only.
  2. Loop over the rows, reading the map.
  3. Collect per-row errors into `row_errors` JSON: `[{row, identifier, reason}]`.

  This replaced a per-row sequential scan that made about 2,300-row files exceed Supabase's statement timeout.

### 10.4 Spreadsheet formats and header aliases (`api/_lib/spreadsheet-parser.js`)

**Reading a file** (`readSheetRows`), in this order:

1. If the first 2 KB contain `<table`, `<html`, `<!doctype html` or `<tr`, the file is parsed as an **HTML table**, whatever its extension. This is how the ERP's `.xls` export is read.
2. `.csv` is read with a quoted-field reader, comma delimiter only.
3. A `.xls` that is not HTML is rejected: "This is a legacy binary .xls file. Open it in Excel and save as .xlsx, then upload again."
4. `.xlsx` is read with ExcelJS, **first worksheet only**.
   - Hyperlinks → text; formulas → result; dates → `YYYY-MM-DD` (UTC); rich text → its plain text.
   - A merged range reports its text in every cell it covers.
5. Anything else: "Only .csv, .xlsx and the ERP .xls export are supported."

Fully empty rows are dropped.

**Reading a file for the GPA, backlog and black dot parsers** (`readSheetGrid`, 0035) adds two things:

- HTML goes through `readHtmlGrid` (`api/_lib/table-readers.js`) instead of the flat tag-splitter: rowspan and colspan are honoured by repeating a merged cell's text into every position it covers, the same thing ExcelJS does for `.xlsx`. Every table in the file is flattened, in order, into one list of rows; `<br>` and block ends become line breaks inside a cell.
- `.docx` (black dots only) goes through `readDocxGrid`: `word/document.xml` is unzipped with `node:zlib` (no dependency), each `w:tbl` becomes rows, `w:gridSpan` repeats across and `w:vMerge` continuations take the text of the cell above. Paragraphs in a cell become lines. Text outside tables is ignored. An old binary `.doc` → "This is an old-style .doc file. Open it in Word, save it as .docx, then upload again."

**Registration number headings** (`REGISTRATION_ALIASES`, the only student identifier any Cluster Head upload accepts): registration no, registration number, registration, reg no, reg number, regn no, regn number, regd no, enrolment no, enrollment no, enrolment number, enrollment number. E-mail, roll number and "id" are **not** accepted (Form A keeps roll number as a separate field, so it is a different number).

**Header normalisation** (`cleanHeader`): lower-case; `.` and `_` become spaces; whitespace collapses; trim. So "Reg. No." becomes `reg no`.

- Aliases written with a dot ("reg. no", "registration no.") **can never match** and are dead entries. The dot-free alias catches those headers.
- When two columns map to the same field, the **last non-empty** one wins (roster, attendance). The **first** wins in the mentor map, the mentor–HOD map and the GPA, backlog and black dot parsers.

**Row limits.**

- Roster, GPA, backlog, black dot, mentor map and mentor–HOD map: at most **5,000** data rows ("Too many rows (N). Split the file into batches of 5000.").
- Attendance: no cap.
- A header row and at least one data row are required.

**Roster** (`parseRosterFile`). Missing Email → 'No "Email" column found. Required columns: Email, Name. Optional: …'.

| Field | Accepted headers (after normalisation) |
|---|---|
| `email` (required) | email, e-mail, email id, e-mail id, mail, email address |
| `full_name` (required per row) | name, full name, student name, faculty name, staff name |
| `login_id` | reg no, registration no, registration number, roll no, roll number, faculty id, employee id, staff id, id |
| `branch` | branch, dept, department, discipline, program, program name, programme, programme name |
| `section` | section, sec |
| `semester_label` | semester, sem, semester label |
| `phone` | phone, mobile, mobile no, mobile number, contact, contact no |
| `mentor_email` | mentor email, faculty email, assigned mentor, mentor |
| `parent_name` | father's name, father name, parent name, guardian name |
| `parent_mobile` | father's number, father number, father's mobile, father's contact, parent number, parent mobile, guardian number, guardian mobile |
| `parent_email` | father's email, father email, parent email, guardian email |
| `password` | password, initial password, temporary password, temp password, default password |
| `role` (needed for `combined`) | role, type, user type, category, designation type |

- `classifyRole(value)` does a lower-cased **substring** match.
  - It checks faculty words first: faculty, mentor, staff, teacher, professor, prof, teaching.
  - Then student words: student, mentee, learner.
  - Anything else → `null`.
- A "Department" column maps to `branch`. Every imported account's `department` is `'IoT & IS'`.

**CGPA / GPA & Credits export** (`parseGpaExport`).

- **Header row:** the first of the first 30 rows with a registration column and either a semester group heading or a GPA/CGPA column. Otherwise: 'Could not find the GPA table. The file needs a "Registration No." column and either the ERP's Semester I, Semester II ... columns or a GPA column.'
- **Two-level header (the ERP layout):** a heading that names one semester ("Semester I", "Sem 3", "3rd Semester"; Roman or Arabic, via `semesterGroup`) starts a group, and the group runs across the following blank cells until the next heading, so a CSV (blanks under a merged cell), an `.xlsx` (repeated text) and the HTML export all read the same. The row below gives each group's columns. Semester groups without a GPA column → 'Found the Semester columns but no GPA under them...'.

  | Field | Accepted headers |
  |---|---|
  | `identifier` | `REGISTRATION_ALIASES` |
  | `name` | student name, name, name of student, name of the student (sent, unused) |
  | `cgpa` | cgpa, c gpa, cumulative gpa, cumulative grade point average |
  | `total_earned_credits` | total earned credits, total credits earned, earned credits total |
  | `total_required_credits` | total required credits, total credits required, total req credits, required credits total |
  | under each semester: `gpa` | gpa, sgpa, semester gpa |
  | under each semester: `earned_credits` | earned credits, credits earned, earned credit, earned |
  | under each semester: `required_credits` | req credits, required credits, credits required, req credit, required |
  | flat layout only: `gpa`, `semester` | gpa, sgpa, semester gpa, grade point average; semester, sem, semester number, semester no |

- **Rows:** a semester whose GPA is blank or a placeholder (`-`, `--`, NA, N/A) is left out. A repeated header row is skipped. `meta`: `layout` (erp/flat), `semesters_in_file`, `graded_semesters`, `ignored_semesters` (outside 1–8), `has_cgpa`.

**Defaulter Grade result export** (`parseBacklogExport`).

- **Header row:** the first of the first 40 rows with a registration column. Otherwise: 'Could not find the student table. The file needs a "Registration No" column.'
- **Title lines** (everything above it, each distinct line once): the semester from "III SEMESTER" / "Semester 3" / "3rd Sem" (`semesterFromTitle`), the exam from "RESULT OF … (" with a " -24-25" tail tidied to " 24-25" (`examFromTitle`, capped at 60 characters), the programme from the text before the semester (display only).
- **Hand-made list** when the header has a subject-code column (subject code, course code, paper code, backlog code, code): one record per row with `subject_name` (subject, subject name, course name, paper name, subject description), `grade` (grade, grade obtained), `credits` (credit, credits) and `is_cleared` (cleared, is cleared, status, result; blank when there is no such column).
- **ERP layout** otherwise: every heading that is not the registration number, the name or a known non-subject column (S.No., section, branch, programme, semester, remarks, result, total, SGPA, CGPA, e-mail, mobile, father's name, roll no) is a **subject code**. No subject columns → 'No subject columns found...'. The subject table below the students (a row with "Subject Code" and a description or credit heading) gives names and credits; a column with no exact code match takes the entry whose code or description has matching initials ("OE" → "OPEN ELECTIVE"). A non-blank, non-placeholder cell is a grade. `meta`: `semester`, `exam_session`, `programme`, `layout`, `subject_codes` (every subject column; `null` for a hand-made list), `subjects`.

**Proctorial Board notice** (`parseBlackDotNotice`; `.docx`, `.xlsx`, `.csv` or HTML).

- **Header row:** any row with a registration column and at least one other notice column (it repeats in every case's table). Otherwise: 'Could not find the student table in the notice...'.

  | Field | Accepted headers |
  |---|---|
  | `identifier` | `REGISTRATION_ALIASES` ("Regn No") |
  | `serial` | s/no, s no, sno, sr no, sl no, serial no |
  | `name` | name, student name, name of student, name of the student |
  | `incident` | date of incidence, date of incident, incident date, date of the incident, date |
  | `hostel_block` | block, hostel block, hostel, block no, hostel/block |
  | `room_no` | room no, room, room number |
  | `course_branch` | course/branch, course / branch, course branch, course & branch, course, branch, program, programme |
  | `mobile_no` | mob no, mobile no, mobile, mobile number, contact no, contact number, phone, phone no |
  | `previous_record` | previous record, previous records, prev record, past record, previous black dots |
  | `case_number` | case no, case number, case |
  | `case_details` | case details, details, offence, offense, nature of offence, nature of offense, description, charge |

- **Case lines:** a row whose cells all carry one text that reads "Case No: …" / "Case No …" / "Case: …" (`parseCaseLine`). The case number ends at the first ", ", ". " before a letter, " - ", or " the"; slashes lose their surrounding spaces and trailing punctuation goes. A single-text row that is not a case line (a note spanning the table) is skipped. A Case No **column** wins over the case line above.
- **Dates** (`parseNoticeDate`): `dd/mm/yy`, `dd.mm.yyyy`, `dd-mm-yyyy` (day first), `YYYY-MM-DD`, "5 Sept 2026", "September 5, 2026"; impossible dates and dates without a year give no date. A blank date takes the last date seen in the same case.
- **Rows:** Course/Branch lines join with ", "; other fields' lines with spaces; whitespace inside the registration number is removed. `where` is "Case … · S/No …". `meta.cases`: `[{case_number, case_details, students}]`.

- **`parseSemesterLabel`** takes the **first run of digits**, or failing that a standalone Roman numeral, and accepts 1–8; anything else is `null`. "Semester 4", "4th" and "Semester IV" give 4. "2025-26 Sem 4" gives nothing (the first number, 2025, is out of range).

**ERP attendance export** (`parseAttendanceExport`).

- **Header row.** The first of the first 25 non-empty rows that has both an identifier column and a % column. Otherwise: 'Could not find the attendance table. The file needs a header row with "Registration No." and a "%" column.'

  | Field | Accepted headers |
  |---|---|
  | `identifier` | `REGISTRATION_ALIASES` (e-mail, roll number and student id are **not** accepted) |
  | `section` | section, sec |
  | `classes_held` | total class, total classes, classes held, total |
  | `classes_attended` | present, classes attended, attended |
  | `attendance_percent` | %, percentage, attendance %, % attendance, percent |
  | (ignored) | absent; name, student name |

- **Header block.** Cells above the table are read with `<label>\s*:?\s*-?\s*(value)` (case-insensitive) for *Course Code*, *Course Name*, *Section*, *From Date* and *To Date*. *Faculty Name*, *Academic Year* and *Academic Session* are parsed but unused.
- **Dates** are `d/m/yyyy` or `d-m-yyyy`, day first. If missing or unparseable, `period_start` defaults to **today** (UTC), and `period_end` defaults to `period_start`.
- **Errors:**
  - "That attendance file appears to be empty."
  - 'No "Course Code:" line found in the file header.'
  - "The attendance table has a header but no student rows."
  - 'No section found — the file header has no "Section:" line and the table has no Section column.'
- **Rows.** A row without an identifier is skipped silently. The section is the row's Section, else the header's.
- **Duplicates** (the same registration number, even across sections) merge into one row:
  - If both rows have counts, the counts are summed and % is recomputed as `round(attended × 100 / held, 2)`.
  - Otherwise the two percentages are averaged.

**Mentor–mentee mapping** (`parseMentorMappingFile`). Missing columns → 'The file needs a "Registration No." column and a "Mentor Email" column.'

| Field | Accepted headers |
|---|---|
| `identifier` | `REGISTRATION_ALIASES` only (no e-mail, since 0035) |
| `mentor_email` | mentor email, faculty email, mentor email id, mentor mail |
| `mentor_name` | mentor name, faculty name, mentor |

Other columns, such as the mentor's phone, are ignored.

**Mentor–HOD mapping** (`parseHodMappingFile`, the administrator's Upload page, 0039). Missing columns → 'The file needs the mentor's email ("Official Email") and the HOD's email ("Official Email of HOD") columns.'

Headers are classified by what they say (after `cleanHeader`, with spaces around `/` removed), in this order:

| Field | A header is this field when it… |
|---|---|
| `hod_email` | names the HOD (hod, cluster head, head of department) **and** an e-mail (email, e-mail, mail): "Official Email of Cluster Head", "HOD Email" |
| `hod_name` | names the HOD without an e-mail: "Cluster Head", "HOD", "Head of Department" |
| `mentor_email` | names an e-mail but not the HOD: "Official Email", "Mentor Email" |
| `section` | is section, sec, class section, section name or class |
| `designation` | is role, designation, mentor role, type or responsibility |
| `mentor_name` | contains "name", or is mentor, class coordinator, mentor/class coordinator or faculty: "Mentor / Class Coordinator Name" |

- The department's sheet heads the HOD columns "Cluster Head"; it is read as the HOD.
- Every value has its whitespace collapsed and trimmed; e-mails are lower-cased; a hyperlinked e-mail cell reads as its text.
- `section` is normalised by `normaliseMappingSection`: "O3", "o 3" and "O-3" all become "O 3".
- A row with no mentor e-mail, HOD e-mail or mentor name (the blank rows at the end of the sheet) is skipped. Each record keeps its spreadsheet row number as `row`.
- Output: `[{row, section, mentor_name, designation, mentor_email, hod_name, hod_email}]`, at most 5,000 rows.

**Self-check.** `node api/_lib/spreadsheet-parser.check.mjs` (`npm run test:parser`, also part of `npm test`) runs 20 checks:

1. Attendance: the section comes from the row, not a blank header; a repeated registration number is summed; a single row keeps the ERP percentage; the header section still works as a fallback.
2. Mentor map: registration number, mentor e-mail and name, phone ignored; an e-mail column no longer stands in for the registration number.
3. Mentor–HOD map: the department's `.xlsx` layout with "Cluster Head" columns ("O3" → "O 3", tidied names, lower-cased and hyperlinked e-mails, blank trailing rows skipped); the sample CSV with "HOD" columns; a file without both e-mail columns is refused.
4. GPA: each GPA lands under the semester written above it and "-" is left out (the ERP layout, from the sample generator); the same export as CSV and as `.xlsx` with merged headers; a flat sheet; an e-mail column is rejected.
5. Backlogs: semester and exam from the title, names and credits (and "OE") from the subject table; the real title wording ("-24-25 ()", "III SEMESTER"); a hand-made list with no Cleared column.
6. Black dots: the `.docx` notice (case lines, merged dates, two-line Course/Branch, `where`); a CSV with a Case No column; day-first dates that are never guessed.

It is **not** run in CI.

### 10.5 PDF generation

- **Library and fonts.** pdf-lib with the standard fonts (Helvetica, Helvetica-Bold, Helvetica-Oblique), on A4 (595.28 × 841.89 pt).
- **`ReportDocument`** (`report-document-builder.js`) handles:
  - page breaks (`reserve`);
  - the header band;
  - title blocks;
  - section headings;
  - footers with "Page n of N" and "Confidential — for internal academic use only".
- **Charts and tables** are drawn with the vector primitives in `pdf-chart-primitives.js`. The MUJ logo is embedded from base64.
- **Metadata.** Title, subject, and author "SSMP — Manipal University Jaipur" (old name).
- **Data** comes only from the report RPC's JSON, which is the same JSON the page renders.
- **Edge case (pdf-lib behaviour, not exercised here).** The standard fonts can only encode WinAnsi characters. Text outside that set in a name, subject or achievement makes the PDF build throw, which the client sees as the generic 500 message.

### 10.6 Performance characteristics

| Concern | Mechanism |
|---|---|
| Account creation for about 2,700-row rosters within 30 s functions | Chunked requests (20 s budget per request), waves of 25, 5 concurrent `createUser` calls, one retry on an Auth rate limit (§4.13) |
| About 2,300-row uploads within Postgres's statement timeout | One indexed identifier resolution per file (0033) |
| Risk re-evaluation per upload | One `evaluate_student_risk` per distinct matched student, inside the upload transaction |
| List pages | 25 rows per page, with an exact count; a realtime change re-runs the page query |
| Long lists | Read in pages of 1,000 with `fetchAllRows` (HOD Students, at-risk list), because PostgREST caps each response at `max_rows` = 1,000 (§4.20) |
| Re-checking everyone's at-risk flags (new cycle, "Re-check now") | `reevaluate_students_batch` in slices of 300, each its own request and transaction: under 30 ms per slice at 1,949 students (§4.24) |
| The cycle overview and report | One `get_cycle_overview` call (about 130 ms for a whole cycle at 1,949 students and 11,694 attendance rows); every "this cycle" filter uses a `(cycle_id, …)` index |
| A HOD's scoped reads (0039) | Policies read `my_overseen_faculty()` once per statement (`(select …)::uuid[]`); `can_access_student` adds one indexed join per row. At 1,949 students, a HOD's student list page reads in about 13 ms and the at-risk list in about 210 ms (about 250 ms for the old all-seeing HOD). A full scan of a large table through `can_access_student` (every attendance row, which no screen asks for) costs about 0.3 ms a row. |
| Rate-limit table growth | A 1% chance per call to purge rows older than a day |

---

## 11. Integrations

| System | How SMP uses it | Where |
|---|---|---|
| **Supabase Auth** | E-mail and password sign-in (PKCE), session refresh, password reset e-mails, `updateUser` for password changes. The Admin API (`auth.admin.createUser`, `auth.getUser`) is used from serverless functions with the service role. | `lib/supabaseClient.js`, `context/AuthProvider.jsx`, `api/_lib/request-guards.js`, import and provisioning endpoints |
| **Supabase Postgres / PostgREST** | All data: tables, views, RPCs. RLS enforces access. | everywhere |
| **Supabase Realtime** | Live query lists and threads, notifications, own-profile updates (§2.4) | `useRealtimeQueries.js`, `NotificationProvider.jsx`, `AuthProvider.jsx`, `StudentGroupQueriesPage.jsx` |
| **Supabase Storage** | 4 private buckets; signed URLs (§2.5) | `lib/fileUpload.js`, `Avatar.jsx`, `ProfilePhotoUploader.jsx` |
| **Vercel** | Static hosting of the SPA (with an SPA rewrite), serverless functions for `/api`, environment variables, response headers | `vercel.json` |
| **Google Fonts** | Manrope, Hanken Grotesk and Material Symbols Outlined, loaded at runtime from `fonts.googleapis.com` / `fonts.gstatic.com` | `frontend/index.html` |
| **GitHub Actions** | CI on pushes to `main`/`master` and on pull requests (§13.4) | `.github/workflows/ci.yml` |
| **University ERP** | **File exports only.** The Class Attendance export (an HTML table saved as `.xls`), plus GPA, backlog and mentor-mapping sheets, are uploaded by a cluster head. There is no API connection. | `spreadsheet-parser.js` |

**Not integrated.** None of these have any code:

- e-mail or SMS delivery (apart from Supabase Auth's reset mail);
- Microsoft Teams or Google Meet (meeting links are a placeholder, §4.14);
- single sign-on;
- error tracking or analytics. Server logs are Vercel's function logs, written with `console.error` tags such as `[api-error]`, `[audit]`, `[rate-limit]`, `[cluster-head-upload]` and `[run-cycle-job]`.

---

## 12. Configuration and environment

### 12.1 Environment variables

No values are given here. The templates are `.env.example` (server) and `frontend/.env.example` (browser). Real `.env` files are git-ignored.

**Server:** Vercel project environment, or the root `.env` for local tools.

| Name | Required | Read by | Purpose |
|---|---|---|---|
| `SUPABASE_URL` | yes | `api/_lib/environment.js`; `supabase/scripts/seed-demo-accounts.mjs`, `create-admin-account.mjs`, `sync-senior-mentors.mjs` | Project URL. Validated as `http(s)://host`; whitespace is stripped. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | `environment.js`; the seed, admin and senior list scripts | Service-role key for Auth admin and privileged writes. It must match the three-part key shape. **Never expose it to the browser.** |
| `SUPABASE_ANON_KEY` | yes | `environment.js` | Anon key, used to build the "as user" client |
| `ALLOWED_ORIGINS` | no | `environment.js` | Comma-separated CORS allow-list, for example the production domain. One `*.vercel.app` entry enables all `*.vercel.app` preview origins. |
| `ALLOWED_EMAIL_DOMAINS` | no | `input-validation.js` (`process.env`, read at module load) | Comma-separated domains that account e-mails must end with. Blank means any domain. Applies to provisioning, roster rows, mentor-map mentors and the HODs and mentors the mentor–HOD mapping creates. |
| `SSMP_TEMPORARY_PASSWORD` | no, but **set it** | `environment.js`; `create-admin-account.mjs`, `sync-senior-mentors.mjs` (through `environment.js`) | Shared first-login password for every account the API creates, for the administrator `npm run db:admin` creates and for the senior mentors `npm run db:seniors` creates. Falls back to a built-in value when unset. **Not listed in `.env.example`.** |
| `SSMP_ADMIN_EMAIL` | no | `create-admin-account.mjs` | The administrator's address for `npm run db:admin` (default `smp.admin@jaipur.manipal.edu`) |
| `SSMP_SENIOR_LIST` | no | `sync-senior-mentors.mjs` | Another path for the senior list (default `supabase/senior-mentors.txt`, §4.26) |
| `SEED_DEFAULT_PASSWORD` | seed only | the seed script | Password given to the demo accounts. Has a built-in fallback. |
| `VERCEL_ENV`, `NODE_ENV` | set by the platform | `environment.js`, `health.js` | `production` disables the localhost CORS rule; also reported by `/api/health` |

**Browser:** Vercel build environment, or `frontend/.env` / `frontend/.env.local`. These values are **baked into the bundle** at build time.

| Name | Required | Read by | Purpose |
|---|---|---|---|
| `VITE_SUPABASE_URL` | yes | `lib/supabaseClient.js` | Project URL. If missing, the app shows a configuration-error page at boot. |
| `VITE_SUPABASE_ANON_KEY` | yes | `lib/supabaseClient.js` | Anon key (public by design) |
| `VITE_API_BASE_URL` | no (default `/api`) | `lib/apiClient.js` | Base for API calls. It is normalised to end in `/api`. Leave it as `/api` when the SPA and API share a Vercel project. |
| `VITE_INSTITUTION_NAME` | no | `pages/auth/LoginPage.jsx` | Login-page brand text (default "Manipal University Jaipur") |
| `VITE_DEPARTMENT_NAME` | no | `pages/auth/LoginPage.jsx` | Login-page department text (default "Department of IoT & Intelligent Systems") |

### 12.2 `supabase/config.toml` (local stack)

- **Ports:** API 54321 (schemas `public`, `storage`, `graphql_public`; **`max_rows = 1000`**), DB 54322 (Postgres 15), Studio 54323.
- **Auth:**
  - `site_url` and `additional_redirect_urls` are `http://localhost:5173`;
  - `jwt_expiry = 3600`, `enable_refresh_token_rotation = true`;
  - `enable_signup = false` (both `[auth]` and `[auth.email]`), `enable_confirmations = false`, `double_confirm_changes = true`, `secure_password_change = true`;
  - `[auth.sessions] inactivity_timeout = "720h"`, with no timebox.
- **Storage:** `file_size_limit = "10MiB"`. Per-bucket limits are set by migration 0014.
- **Realtime:** enabled.

### 12.3 Settings a hosted Supabase project must mirror

`config.toml` only configures the local stack. In the hosted dashboard:

1. **Authentication → Providers → Email:** disable sign-ups. This is required: `handle_new_auth_user` trusts the role in user metadata (§8.9 S13). Leave e-mail confirmation off.
2. **Authentication → URL configuration:** set the Site URL to the production origin, and add `https://<domain>/reset-password` (plus local and preview origins as needed) to the redirect URLs.
3. **Authentication → Sessions:** set the inactivity timeout to 30 days so users are not signed out frequently.
4. **API → Max rows:** the default of 1,000 is fine. The lists that can be longer (HOD Students, the at-risk list) page through it (§4.20).
5. Buckets, policies, the realtime publication and every function come from the migrations. No manual dashboard setup is needed for them.

### 12.4 `vercel.json`

- `installCommand: npm install`, `buildCommand: npm run build` (installs and builds `frontend/`), `outputDirectory: frontend/dist`, `framework: null`.
- `functions: { "api/**/*.js": { memory: 1024, maxDuration: 30 } }`.
- Rewrite `/((?!api/).*)` → `/index.html`, so client-side routes work and `/api/*` stays serverless.
- **Headers:**
  - on everything: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `Cross-Origin-Opener-Policy: same-origin`;
  - `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`;
  - `/api/*`: `Cache-Control: no-store, max-age=0`.
- **Absent:** no `crons` and no Content-Security-Policy.

### 12.5 Tunable constants in code

These are hard-coded. Changing one means editing code or SQL; they are collected in Appendix C.

---

## 13. Running, testing and deploying

### 13.1 Prerequisites

- Node ≥ 20 and npm.
- The Supabase CLI, to link or push migrations and to run a local stack. The local stack also needs Docker.
- Optionally the Vercel CLI (`vercel dev`), to run the SPA and `/api` together locally.

### 13.2 Local development

1. Install dependencies: `npm run install:all`. That is the root (API) plus `frontend/`.
2. Create the env files from the templates, `.env` and `frontend/.env` (or `frontend/.env.local`), and fill in the variables from §12.1.
3. Set up a database. Choose one:
   - **Local:** `supabase start`, then `npm run db:reset`. This applies all migrations and `supabase/seed.sql`, which creates the local demo users.
   - **Hosted:** `supabase link --project-ref <ref>`, then `npm run db:push`. Optionally run `npm run db:seed` for demo data (Appendix D).
4. Run the app. Choose one:
   - `npm run dev`: the Vite dev server at http://localhost:5173, **frontend only**. Everything that talks to Supabase directly works, but API features (uploads, account creation, PDFs, jobs, the faculty roster) need a running API.
   - `vercel dev`: the SPA and `/api` together, on port 3000 by default.
5. Optionally, `npm run sample:files` writes demo upload files to `sample-data/generated/`.

### 13.3 npm scripts

| Script | Runs |
|---|---|
| `dev` / `preview` / `lint` | `npm --prefix frontend run dev` / `preview` / `lint` (`oxlint src`) |
| `build` | `npm --prefix frontend install && npm --prefix frontend run build` → `frontend/dist` |
| `install:all` | root and frontend `npm install` |
| `db:push` / `db:reset` | `supabase db push` / `supabase db reset` |
| `db:seed` | `node supabase/scripts/seed-demo-accounts.mjs` |
| `db:admin` | `node supabase/scripts/create-admin-account.mjs`: the administrator account only (§4.25). Safe on a real project. |
| `db:seniors` | `node supabase/scripts/sync-senior-mentors.mjs`: makes the senior mentors match `supabase/senior-mentors.txt`, creating, flagging, unflagging and deleting accounts (§4.26). `npm run db:seniors -- --dry-run` changes nothing. Safe on a real project; reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SSMP_TEMPORARY_PASSWORD` and optionally `SSMP_SENIOR_LIST` from the root `.env`. |
| `sample:files` | `node sample-data/cluster-head-sample-data.mjs` |
| `verify:security` | `node supabase/scripts/verify-security-policies.mjs` — **the file does not exist; this script fails** |
| `test` | `npm --prefix frontend run test:ui && node api/_lib/spreadsheet-parser.check.mjs` |
| `test:parser` | the parser self-check only |
| frontend `test:ui` | `vite-node test/ui-regression.test.jsx` |

### 13.4 Tests and CI

**Automated tests** (these are all of them):

1. `frontend/test/ui-regression.test.jsx` renders `Panel`, `Modal`, `TextField` and `TextAreaField` in jsdom. It asserts that the Panel body is padded, that the first field (not ✕) gets focus when a Modal opens, that focus stays in the input while typing, and that it stays in a textarea such as the Report-to-HOD note. Since 2026-09-27 it also checks that `fetchAllRows` returns every row past a 1,000-row cap (and past a smaller server page) with no duplicates; the overview arithmetic in `lib/academicRecord.js` (semester labels, the 75% rounding guard, the GPA change, gaps in the trend, backlog order, the semester picker); and that `AcademicOverview` renders its tiles and tables, with no CGPA of 0 when nothing is uploaded. Since 2026-09-28 it also checks the student's version (`showHeader={false}`: no heading, no semester picker, still the current view, no "record below" copy) and the academic-cycle helpers in `lib/academicCycles.js` (labels, which semester a date is in, India time, the next cycle's year, date validation, upload scope). Since 2026-10-07 it checks the administrator and HOD menus: the same department screens under `/admin` and `/hod`, Upload before My Profile for the administrator, the HOD's Uploads group (the cluster head's menu with Overview for Home, without My Subjects or My Profile, every entry under `/hod/uploads`), the cluster head's own menu unchanged, and `departmentBase` / `uploadsBase`. Since 2026-10-22 it checks the senior mentor additions: Peer Queries and Assigned Mentees only for a senior, Raised to Me for faculty, Raised to HOD and Senior Mentors for the HOD and the administrator, `SENIOR_SECTIONS` (A3 … T4), the mentor-kind and raised-by labels, and the senior list parser (`parseSeniorList`: names, comments, bad lines and duplicates). 98 checks in all.
2. `api/_lib/spreadsheet-parser.check.mjs` runs the 20 parser checks (§10.4).

There are **no** tests for RLS, the RPCs or the API handlers.

**CI** (`.github/workflows/ci.yml`; on pushes to `main` or `master`, and on pull requests):

- **Job `build`:**
  1. `npm ci`, falling back to `npm install` (root and frontend).
  2. Frontend lint.
  3. The UI regression test.
  4. A frontend build with placeholder `VITE_*` values.
  5. `node --check` on every file under `api/`.

  The parser check is **not** run.
- **Job `database`:**
  1. A `postgres:15` service.
  2. Apply `supabase/scripts/ci-supabase-stubs.sql`.
  3. Apply every migration in order with `ON_ERROR_STOP`.
  4. Fail if any public table lacks RLS.

### 13.5 Deploying to production

1. **Database first.** Run `supabase link` and then `npm run db:push`, which applies pending migrations in order.
   - Deploy migrations **before or together with** the application code that needs them:
     - after 0031, the frontend calls `*_query` functions and tables;
     - after 0032, the setup form no longer sends a section count;
     - 0033 is needed for large uploads;
     - 0034 and 0035 must be applied before the API that sends `black-dot` uploads, the new GPA/backlog row shapes and `p_subject_codes`;
     - **0038 then 0039, as two transactions** (`db push` applies each file on its own; pasting both into one SQL editor run fails, because a transaction cannot use the enum value it added). Both must be in before the frontend that routes `/admin` and `/hod/uploads`, and before the API that sends `hod-map`.
     - 0041 can go in before or after its frontend: the old pages ignore `queries_by_category`, and the new ones show "No data to display yet" until it exists.
     - **0040 before the frontend** that sends `p_counselling_type`: the new page calls `request_counselling` with two arguments, which do not exist before 0040. The other way round, the old page is refused with "Choose the type of counselling" until the new frontend is live, so deploy both together.
     - **0042 before the frontend** that sends `p_recipient`: without 0042 the new Raise a query modal fails (`create_support_query` has no fifth argument) and the Raised to HOD, Raised to Me, Senior Mentors and senior pages have no RPCs to call. Sign-in and the query pages tolerate the missing `get_my_senior_mentor`, `get_query_people` and `query_escalations` (a console warning, or nothing shown). The old frontend keeps working on 0042 (its four-argument call matches the new defaults), except that it shows a senior's query like any other. Then run `npm run db:seniors` (step 6).
   - Never edit an applied migration.
2. **Supabase settings:** follow §12.3.
3. **Vercel project:**
   - The root directory is the repository root. Vercel picks up the build and output settings from `vercel.json`.
   - Set every server and `VITE_*` variable from §12.1, including `SSMP_TEMPORARY_PASSWORD` and `ALLOWED_ORIGINS`.
   - Redeploy after changing a `VITE_*` value; those are build-time values.
4. **Smoke test:**
   - `GET /api/health` should show `configured` with all three variables `ok`.
   - Sign in as each role.
   - As a cluster head, complete setup and upload a small file.
   - As a HOD, open Scheduled Jobs, which calls the API, and Uploads → Overview.
   - As the administrator, open Upload.
5. **The administrator and the mapping** (once, after 0039): run `npm run db:admin`, sign in as the administrator (temporary password, then a new one), open **Upload** and upload the department's mentor–HOD sheet. Until then each HOD sees only the faculty whose HOD e-mail already named them, and nobody but the administrator sees the rest.
   - An earlier version of the script stopped with "The account was created but is not an administrator" and, on a second run, "… belongs to a student". That account is a student made by the script; the current script finishes it (§4.25). Deleting the user in Supabase (Auth → Users) and running `db:admin` again also works: the profile and its cycle enrolment go with it.
6. **Senior mentors** (after 0042): copy `supabase/senior-mentors.example.txt` to `supabase/senior-mentors.txt`, put one senior's e-mail per line (optionally `, Full Name`), run `npm run db:seniors -- --dry-run` to see what it would do, then `npm run db:seniors`. A HOD then gives each senior their sections on **Senior Mentors**. Re-run the script after every change to the list; an e-mail taken off the list moves that senior's queries to the students' faculty mentors and deletes the account if the list created it (§4.26).
7. **Do not** run `db:seed` against production. The demo accounts use known passwords.

### 13.6 Operating the system (what has no UI)

| Task | How |
|---|---|
| Run the periodic jobs | HOD or administrator → Scheduled Jobs → "Run now" / "Run all". Nothing runs automatically (§4.16). |
| Decide which faculty each HOD sees | Administrator → Upload: upload the mentor–HOD sheet again (§4.25). To take a mentor away from every HOD, clear `hod_id` in SQL. |
| Reset a user's password | No UI. The user can use "Forgot password", or an admin uses the Supabase dashboard (Auth → Users). |
| Deactivate an account | No UI. Update `user_profiles.is_active` in SQL. Also ban or delete the Auth user to end their sessions. |
| Change a student's mentor | HOD (within their faculty) or administrator → Faculty Roster → Reassign, or a mentor–mentee mapping upload. Only the roster route moves open queries. |
| Change the shared temporary password | Set `SSMP_TEMPORARY_PASSWORD` in Vercel and redeploy. Existing accounts are unaffected. |
| Create the administrator | `npm run db:admin` (§4.25). Nothing in the app can create one, and an account made in the Supabase dashboard with `admin` in its metadata becomes a student (§4.1). |
| Create HOD or cluster-head accounts | HODs: the administrator's mentor–HOD mapping upload creates every HOD it names, or administrator → Students → Add account. Cluster heads: HOD or administrator → Students → Add account. A HOD cannot create HOD accounts. |
| Add canned replies | No UI. Insert rows into `canned_replies` (global rows need SQL or the service role). |
| Add or remove senior mentors | Edit `supabase/senior-mentors.txt` and run `npm run db:seniors` (§4.26). Their sections are set by a HOD or the administrator → Senior Mentors. |
| Read the audit log | No UI. Run SQL on `audit_log` (readable by the administrator via RLS since 0039). |

---

## 14. Error handling and edge cases

### 14.1 How an error travels

| Origin | Path to the user |
|---|---|
| **SQL** (`raise exception '…' using errcode = …`, or a CHECK / unique violation) | PostgREST returns it. supabase-js gives `{error}`. The page's `run()` shows `toast.error(describeError(error))`. `describeError` rewrites check-constraint, duplicate-key, bad-login and unconfirmed-e-mail errors; any other message is shown **verbatim**, which is why SQL messages are written for end users. |
| **SQL called by the API** | The endpoint turns it into `ApiError(message, 400)` (403 for `42501` in the report endpoints). The envelope carries `{success:false, message}`, `apiClient` throws `message`, and the page shows a toast. |
| **API validation** | zod → 400 "Invalid request — field: problem; …" |
| **API auth, role, rate limit, size** | 401 / 403 / 429 / 413 with fixed messages (§5.1) |
| **Unexpected API failure** | Logged with its stack. The client sees 500 "Something went wrong on our side. Please try again." |
| **Network or API not deployed** | `apiClient`: "Could not reach the API at /api. Check that VITE_API_BASE_URL is set to "/api" and that the serverless functions are deployed." |
| **Missing browser configuration** | A boot-time error page: "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY…" |
| **A render crash** | `ErrorBoundary` at the app root shows a fallback instead of a blank page |
| **Upload rows** | Per-row problems are returned in `row_errors` and listed in the upload panel. Only type and constraint errors abort a whole upload. |

### 14.2 Validation layers

| Rule kind | Client | API | Database |
|---|---|---|---|
| Required fields, formats (mobile, PIN, e-mail) | yes (forms) | zod | CHECK constraints (Form A, profiles) |
| Length limits | `maxLength` and checks | zod | RPC checks and CHECK constraints (subject ≤ 200, comment ≤ 1000, notes ≤ 5000…) |
| Business caps (20 unresolved queries, 5 open counselling requests, 12 CR items, 3 reopens, 500 reassignments, 60 subjects) | some | reassign ≤ 500 | **yes**, in the RPCs. Direct inserts used to bypass the query cap (§8.9 S15, closed in 0042); filing a CR report is not checked against it. |
| Permissions | guards and hidden buttons | role check | **RLS and RPC checks** |
| File type and size | photos, Form A, proofs (`validateUpload`) | upload endpoints (size, parser type detection) | bucket limits and MIME lists |

### 14.3 Edge cases by area

**Accounts and sign-in**

- **Re-uploading a roster** skips existing e-mails and never updates them. Fixing a name or registration number requires a direct edit, and there is no admin UI for that.
- **Duplicate registration numbers** across two accounts fail the second account (unique `lower(login_id)`).
- **A mentor e-mail that is not on the allowed domains** is silently not created during a mentor-map upload. Its rows then fail with 'No faculty account for "…"'.
- **An interrupted roster upload** (tab closed, 429, network) leaves the accounts already created and a partial history row. Re-uploading resumes naturally, because existing accounts are skipped, but credentials created in the lost chunks are not shown again.
- **A deactivated user with a live session** keeps it until it expires (§8.9 S8).

**The mentor–HOD mapping and HOD scope** (§4.25)

- **A HOD with nobody mapped** sees empty department screens ("No faculty mapped to you yet" on the dashboard leaderboard). The administrator's upload fixes it.
- **The same mentor twice in the sheet** ends on the last row; both rows count.
- **A HOD e-mail that is a faculty account** becomes a HOD only if that faculty member mentors nobody; otherwise the row fails and asks for their mentees to be moved first.
- **A HOD e-mail that is a cluster head** becomes a HOD; their subjects and upload history stay theirs, and their portal is now the HOD portal.
- **A mentor named as a HOD elsewhere in the sheet** is created (if new) as a HOD, and the rows naming them as a mentor then fail ("…the hod role, not a faculty member").
- **An e-mail outside the allowed domains** that has no account yet is listed under "Accounts that could not be created", and its rows fail as having no account.
- **A mentor the sheet omits** keeps their HOD. There is no "remove" row.
- **A HOD's upload of an attendance code a cluster head already has** files under the cluster head's subject, so the course is not doubled on students' records; the HOD's "Subjects uploaded" list still shows it.

**Queries**

- **After a reassignment through a mentor-map upload**, open queries stay with the old mentor (§4.4).
- **A student at the 20-unresolved cap** cannot raise more. A representative's CR items count toward the cap once filed, although filing the report itself is not blocked by it.
- **A query awaiting confirmation** counts as Resolved for the cap and for most counters, and can already be rated.
- **Posting after confirmation** is possible through the RPC; the UI hides the composer.
- **Referral** is allowed for any status, once per query.

**Uploads**

- **A course-code mismatch** between the ERP header and My Subjects aborts a cluster head's attendance upload with guidance. Matching is case-insensitive, but the stored spelling is kept. A HOD's upload creates the subject instead (§4.25), so a typo in a HOD's file creates a subject with the typo.
- **A student not active, or not in the roster**, produces a per-row "No student matches…".
- **The same registration number twice in an attendance file** is merged. Twice in a GPA or backlog file, the last row wins, because each row upserts.
- **Changing a subject's code** deletes its attendance history (§4.11).
- **A backlog re-upload** can un-clear rows or create case-variant duplicates (§4.12).
- **A GPA cell with text** ("NA", "Absent") aborts the whole GPA upload.
- **Attendance dates missing** from the header default to today, so a re-upload on another day creates a new period instead of replacing the old one.
- **Rich-text `.xlsx` cells** read as `[object Object]`. Save such files as plain values or CSV.

**Risk and meetings**

- **The first sweep** no longer notifies mentors that every healthy mentee is "no longer at-risk" (B2, fixed in 0036).
- **Starting a new academic cycle** lifts last year's attendance and black-dot flags; the page's re-check does it quietly, so mentors hear only about students who are newly flagged (§4.14, §4.24).
- **A cycle started by mistake** can be removed while nothing has been uploaded into it; the previous cycle becomes active again (§4.24).
- **Uploading with no active cycle** is refused with "There is no active academic cycle..." (only possible if someone deletes the cycles in SQL; the portal always keeps one).
- **Students without a mentor** are evaluated, but no one is notified and no meeting is created. The dispatch result counts them as `without_mentor`.
- **A completed meeting** is not re-raised while the student stays flagged, unless the dispatch job runs again. It then creates a new meeting, because only `awaiting_link` and `scheduled` count as open.

**Surveys and jobs**

- **Opening a new cycle** closes the previous one immediately, however many students have not answered.
- **"Run all"** runs the survey job, which opens a **new** cycle. Pressing it twice opens two cycles in succession.
- **A job failure** rolls back its own run record (§4.16).

**Reports**

- **Period boundaries** are dates (`to` inclusive). Default periods are computed in the browser with UTC date strings.
- **Characters outside WinAnsi** in PDF text are a failure risk (§10.5).
- **The department report's monthly trend** is ordered alphabetically (§4.18).

**Time zones**

- **Server-side dates** — `current_date` for survey windows and job due dates, and `date_trunc('week', now())` for "this week" — use the database time zone, which is UTC on Supabase unless changed. Users are in IST (UTC+05:30), so day and week boundaries are 5½ hours off local midnight.

**Data volume**

- **Long lists.** The HOD / administrator Students page, the at-risk list and the administrator's mapping table page through PostgREST's `max_rows` (1,000 by default) (B11). The remaining unpaged reads are per mentor or per student.
- **The HOD trend chart** misbehaves after 400 (mentor, day) rows (§4.17).

---

## 15. Current status and limitations

### 15.1 Feature status

| Area | Status | Notes |
|---|---|---|
| Account provisioning (roster, single account, mentor-map mentors) | **Implemented** | Shared temporary password; no invite e-mails (§4.1) |
| Sign-in, forced password change, password reset | **Implemented** | Complexity rules are client-side only |
| Student onboarding (Form A and photo) | **Implemented** | Form A editable any time; staff have no photo upload |
| Queries: raise, converse, resolve, confirm or reopen (cap 3), rate, priority | **Implemented** | Category charts fixed in 0041 (B1). To the faculty or the senior mentor since 0042; direct writes limited to the priority (S6, S15 fixed) |
| Canned replies | **Partial** | Read-only chips; no management UI; the four global replies come only from the seeds |
| Raise to HOD (routed to the mentor's mapped HOD, else the administrator) | **Implemented** | Since 0042 on the HOD's Raised to HOD page with the tag and reason, not in All Queries; a mentor's note is visible to the student |
| Mentor department and HOD e-mail | **Implemented** | Read-only once the mentor is mapped (0039) |
| Star mentee: group queries, survey tracking | **Implemented** | |
| CR reports (minutes and action items) | **Implemented** | |
| Counselling | **Implemented** | The student chooses one of twelve types first (0040). Single overwriting reply, no thread; no realtime |
| Student GPA self-entry | **Removed** | 2026-09-28: the panel is gone and 0037 closes the database paths (S1 fixed). GPAs entered earlier are kept (§4.9) |
| GPA sharing preference | **Partial** | Enforced in the database, but the UI toggle was removed. It can still be switched off through `set_gpa_sharing` or a direct Form A update (S20). |
| Achievements and verification | **Implemented** | |
| Cluster head setup and My Subjects | **Implemented** | Subjects are per academic cycle since 0036; a code edit deletes that cycle's attendance for the subject (B5) |
| Attendance, GPA, backlog and black dot uploads | **Implemented** | GPA and backlogs read the ERP's own exports since 0035; registration number only; filed under the active cycle since 0036. See B9 and §4.12 known issues |
| Student and faculty roster import (chunked) | **Implemented** | `combined` type supported by the API; no UI option. Existing students are activated in the current cycle (0036) |
| Mentor–mentee mapping (with mentor creation) | **Implemented** | Mentor creation errors are not shown |
| At-risk detection and notifications | **Implemented** | Four conditions since 0036 (attendance and black dots per cycle); first-evaluation notices fixed (B2) |
| At-risk meetings | **Partial** | Rows and notifications are created; **meeting links are a placeholder**; only "Mark done" in the UI; students never see meetings |
| Feedback survey (cycles, answers, reminders, tracking) | **Partial** | Answers are collected but **no report or analysis reads them**. `closes_on` is not enforced, and answers are readable by the mentor at the database level (S16). |
| Periodic jobs | **Partial** | Manual triggering works; **no scheduler exists** |
| Dashboards and performance table | **Implemented** | B1, B3 |
| Faculty activity, department and dossier reports and PDFs | **Implemented** | B1, B4 |
| Faculty roster, status and reassignment | **Implemented** | B10 |
| HOD Students directory and Add account | **Implemented** | 1,000-row cap fixed 2026-09-27 (B11) |
| Notifications (19 types; 16 in use) | **Implemented** | 3 types never sent |
| Audit log | **Implemented** (writes) | No viewer UI |
| Rate limiting | **Implemented** | Fails open |
| HOD semester setup wizard | **Removed** | Route, page and navigation removed; the table remains unused |
| Form A lock / unlock workflow | **Dead** | Functions exist; no callers; Form A is always editable |
| "Upload Black dot" (PB notice), ERP CGPA / GPA & Credits and Defaulter Grade formats | **Implemented** | Added 2026-09-27 (0034–0035, §4.12). Black dots show on the student's Academics page, on the mentor's and HOD's student page and, since 0036, on the at-risk pages (one in the active cycle flags a student); no removal UI |
| Academic Performance Overview (student Academics page, mentor's and HOD's student page) | **Implemented** | Added 2026-09-27 (§4.9, §4.18). Attendance is shown for the current semester only. Since 2026-09-28 the student's page is titled with it and has no semester picker |
| Academic cycles (per-year filing, subjects, students, report) | **Implemented** | Added 2026-09-28 (0036, §4.24). Cluster heads, and HODs from Uploads since 0039; the administrator can use the RPCs and the report API |
| Administrator portal (the department screens for everyone, Upload) | **Implemented** | Added 2026-10-07 (0038–0039, §4.25). One account, created by `npm run db:admin` |
| Mentor–HOD mapping upload (with HOD and mentor creation) | **Implemented** | Administrator only. No way to unmap a mentor from the sheet |
| Each HOD sees only their mapped faculty and mentees | **Implemented** | Enforced by RLS and the RPCs (§4.25). Uploads, cycles and jobs stay department-wide |
| HOD Uploads (the cluster head's screens in the HOD portal) | **Implemented** | No setup or My Subjects; an attendance file's subject is created on first upload |
| Senior mentors: two mentors per student, Peer Queries, Assigned Mentees, Ask HOD / Escalate with a reason | **Implemented** | Added 2026-10-22 (0042, §4.26). A student's senior follows their faculty mentor's section; a section change does not move queries already sent |
| Raised to Me (faculty) and Raised to HOD (HOD, administrator) | **Implemented** | Added 2026-10-22 (0042). Tags Raised by faculty / Raised by senior, with the reason; the student never sees a senior's reason |
| Senior Mentors page (HOD assigns sections A3 … T4) | **Implemented** | Added 2026-10-22 (0042). One senior per section; any HOD sees every senior |
| Senior list (`npm run db:seniors`) | **Implemented** | Added 2026-10-22. Creates, flags, unflags and deletes accounts to match the list; a removed senior's queries move to the faculty mentors |

### 15.2 Known functional bugs (verified in the code)

| ID | Bug | Where |
|---|---|---|
| B1 | **Fixed 2026-10-08 (0041).** Category charts counted only the legacy categories (Academic, ERP/Tech, Infrastructure), so they stayed empty: the student, faculty and HOD dashboards, the mentee "Query mix" and the three PDFs. They now count every category. Legacy-only columns remain, unread, in `get_dashboard_metrics`, `get_student_dossier` and three views. | §4.4 |
| B2 | **Fixed in 0036.** A student's first-ever risk evaluation that was **not** at risk sent the mentor "… is no longer at-risk" | `notify_on_risk_flag_change` |
| B3 | The HOD 30-day trend reads the **oldest** 400 (mentor, day) rows once more exist; "resolved" is computed but not drawn | `HodDashboardPage` |
| B4 | The activity report's "Active" / "Still open" column always shows "—" (it reads `open_count`; the RPC returns `open`). The department `monthly_trend` is sorted alphabetically. | `FacultyActivityReportPage`, PDF builder, `get_department_faculty_report` |
| B5 | Editing a course code in My Subjects deletes and re-creates the course, **cascading away its attendance in the current cycle** (since 0036 earlier cycles keep their own copy); a case-only edit is silently ignored | `submit_cluster_head_setup` |
| B6 | **Fixed in 0035.** A backlog re-upload without a Cleared column un-cleared backlogs, and subject codes were matched case-sensitively, so a clearance could create a new row. A blank Cleared now leaves the state alone and codes match case-insensitively; the ERP list clears by its own rule (§4.12). | `record_backlog_batch` |
| B7 | **Fixed in 0035.** A non-numeric GPA cell aborted the whole GPA upload with a raw Postgres message; it is now a row error | `record_gpa_batch` |
| B8 | **Mostly fixed in 0035.** `exam_session` now shows on the student page's backlog list and in the upload's scope label; `skipped_rows` is written by the GPA upload only | `record_backlog_batch`, upload RPCs |
| B9 | Upload-page copy is wrong: the attendance section comes from the row, not the header; the My Subjects advice is inverted. (The GPA page's meeting claim was corrected with the new GPA page.) | cluster-head pages |
| B10 | Re-activating a faculty member leaves `available_for_reassignment = false`. `reassign_mentees` does not check capacity or ownership and does not clear the star flag, so a group can end up with two representatives (a mentor-map upload has the same effect). A failed query handover is silent. A status change sent with `available_for_reassignment = true` is stored as sent, even for `departed`. | §4.19, §4.6 |
| B11 | **Fixed 2026-09-27.** The HOD Students page (and its KPIs) and the HOD at-risk list read only the first 1,000 rows (PostgREST `max_rows`), so the page showed 1,000 students where the dashboard showed all of them. Both now page through with `fetchAllRows` | `HodStudentsPage`, `FacultyAtRiskPage` |
| B12 | A mentor change made through a mentor-map upload does not move open queries; the old mentor keeps them | `map_students_to_mentors` |
| B13 | A cycle-job failure leaves no run record (rolled back with the re-raise) | `run_cycle_job` |
| B14 | A roster-chunk failure discards the displayed results of earlier chunks (including their credentials); there is no retry | `AcademicUploadPanel` |
| B15 | The "Department & HOD" save toast reports only the number of mentees whose department actually changed, which can be 0, while the button promised to update all of them | `FacultyMenteesPage`, `set_mentor_department_and_hod` |
| B16 | The student confirmation banner counts only the 5 most recent queries | `StudentDashboardPage` |
| B17 | **Fixed 2026-09-28.** "Uploads recorded" on the cluster-head dashboard was capped at 10; "Uploads this cycle" is now an exact count | `ClusterHeadDashboardPage` |
| B18 | CR-report items count toward the representative's 20-unresolved cap once filed, so a large report can block them from raising normal queries | `submit_mom_report`, `create_support_query` |
| B19 | Every new query notifies the mentor twice (`query_created` plus `query_message` for the first message), and a CR report with n items sends 1 + n notifications | `notify_on_query_message` |
| B20 | When the HOD calls `escalate_query_to_hod`, routing uses the HOD's own `hod_email`. With a single HOD nobody is notified, and the system message names the HOD as the referrer. | `escalate_query_to_hod` |
| B21 | At-risk meetings stay with the old mentor after a mentor change. The new mentor cannot see or close them, and dispatch never raises a new one. | `at_risk_meetings` policies, `dispatch_at_risk_meetings` |
| B22 | An attendance file without parsable header dates is recorded as a one-day period ending on the upload day, so re-uploading it on another day adds a period | `parseAttendanceExport` |
| B23 | CHECK violations during uploads surface as the generic "Please review the highlighted fields" message | `describeError`, upload pages |
| B24 | The roster import ignores errors from its follow-up profile update (mentor link, parent fields) | `import-roster-spreadsheet.js` |
| B25 | The provisioning duplicate check uses `ilike`, so `_` and `%` act as wildcards, and multiple matches make the check fall through | `provision-user-accounts.js` |
| B26 | `set_query_in_progress` can move a query awaiting confirmation back to In Progress without the student's decision | `set_query_in_progress` |

Security gaps S1–S20 are in §8.9.

### 15.3 Dead or unused code and schema

| Item | Kind |
|---|---|
| `frontend/src/components/tickets/*` (4 files) | Unimported components calling dropped RPCs |
| `request_form_a_unlock`, `unlock_student_form_a`, `set_gpa_sharing`, `resolve_students_for_upload`, `run_due_cycle_jobs`, `current_user_role` | SQL functions with no caller |
| `upsert_semester_gpa` | Retired in 0037: not executable by signed-in users, kept so it could be re-granted |
| `survey_group_completion` | View with no reader |
| `semester_cycles`, `roster_import_batches.semester_cycle_id` | Table with no UI writer (the import writes to it only if a cycle id is sent, and none is); unrelated to the academic cycles of 0036 |
| `student_form_a_profiles.is_locked`, `unlock_requested`, `unlock_requested_at`, `unlocked_by` | Vestigial columns |
| `academic_upload_batches.skipped_rows` | Written only by the GPA upload |
| Notification types `onboarding_reminder`, `account_provisioned`, `academic_data_uploaded` | Never sent |
| Enum values `Academic`, `ERP/Tech`, `Infrastructure` (`query_category`) | Legacy; not offered by the UI; shown in the charts only when they have queries. Unread legacy-only columns remain (B1) |
| `clusterHeadSetupSchema` (zod), dotted header aliases in the roster list | Unused code paths |
| `send_invite_email` (provisioning), `semester_cycle_id` / `default_mentor_id` / `combined` (roster import) | Accepted inputs the UI never sends (or that are ignored) |
| `GET /api/admin/manage-faculty-roster?action=reserve-pool` | Endpoint action never called |
| `roster-imports` bucket, `BUCKETS.ROSTERS` | Storage never used |
| `RESOLUTION_STATUS_LABELS` | Unused constant |
| `docs/~$MP-Platform-Context.docx` | A Word lock file committed by accident (the `.gitignore` has no `~$*` rule) |
| `npm run verify:security` | References a missing file |

### 15.4 Placeholders and TODOs in code

- `create_at_risk_meeting_link`: `TODO(provider)`. It should create a Teams/Meet meeting and set `meeting_provider`, `meeting_join_url`, `meeting_external_id` and `scheduled_for`, with status `scheduled`. Today it returns the row unchanged.
- The periodic jobs are designed for a scheduler (`trigger_source = 'scheduled'` and `run_due_cycle_jobs`), but none is connected. As written, the API endpoint cannot be called by a cron because it requires a HOD's JWT.

### 15.5 Stale documentation and UI copy

**Documents** (all superseded by this file):

- **`README.md`:**
  - "three portals" (there are five: student, faculty, HOD, cluster head and administrator);
  - HOD "semester initialisation with roster import" (removed; rosters are uploaded by the cluster head);
  - HOD can "unlock a submitted Form A" (dead).
- **`SETUP_GUIDE.md`:**
  - the end-to-end test still sends the HOD to "Semester setup → Import roster" (step 16);
  - it uses the removed GPA-sharing toggle (step 8).
- **`docs/SECURITY.md`:**
  - roster import limited to 10 per 5 minutes (now 200 per 300 s);
  - roster imports HOD-only (now cluster head, HOD or administrator);
  - `unlock_student_form_a` described as a feature;
  - "14-character generated" temporary passwords (now one shared password).
- **`docs/CLUSTER-HEAD-AND-CYCLE-JOBS.md`:** describes a Vercel Cron or `pg_cron` hook-up that does not exist and cannot work as written, plus several upload details that have since changed.
- **`docs/SSMP-Platform-Context.docx`:** the old context document. §16 lists what changed.

**Code comments and UI strings that contradict the code:**

- 0008's first line ("every table is FORCE'd").
- The table comments listed as Doc notes in §7.4.
- `supabaseClient.js` (CSP claim).
- `AuthProvider` (Form A unlock).
- `ChangePasswordPage` ("mirrored from Supabase Auth's configured policy").
- `StudentAchievementsPage` (verification never blocks).
- `StudentGroupQueriesPage` (classmates' queries arrive live).
- `ProfilePhotoUploader` (used by all profile pages).
- Escalation hints ("…but is not shown this note").
- `FacultyQueryDetailPage` ("After 3 rejections").
- `HodOperationsPage` and `run-cycle-job.js` ("15-day" for reminders; "Three things").
- `FacultyAtRiskPage` header.
- The roster page hints ("Department" column; mentors created "silently").
- "Import the faculty roster from Semester setup" (`HodFacultyRosterPage`, `FacultyActivityReportPage`).
- `FacultyMenteesPage` empty state ("The HOD assigns mentees…").
- `upload-academic-data.js` header ("The service_role client is used for nothing but the audit entry"; it is also used for rate limiting and mentor creation).
- PDF metadata "SSMP".

---

## 16. Change history against the old document

The old `docs/SSMP-Platform-Context.docx` (August 2026) described the system at migration 0019: three portals, 13 tables, 12 enums, 4 views and 6 API functions. Every claim in it was checked against the current code. This section records the result.

### 16.1 At a glance

| | Old document | Now |
|---|---|---|
| Product name | SSMP — Student Support & Mentorship Portal | SMP — Student Mentorship Portal ("SSMP" survives in identifiers) |
| Portals and roles | 3 (student, faculty, HOD) | 4 (adds **cluster head**) |
| Migrations | 19 | 33 |
| Tables / views / enums | 13 / 4 / 12 | 28 / 8 / 18 |
| API functions | 6 | 8 (adds `run-cycle-job`, `upload-academic-data`) |
| Support requests | "tickets" | "queries" (0031 rename, everywhere) |
| Code size (approximate) | 4,050 SQL · 2,500 API · 10,100 frontend lines | ~10,700 SQL · ~4,500 API · ~13,300 frontend lines |

### 16.2 Still valid

These parts of the old document still describe the code correctly. The names have changed where noted in §16.3.

- The stack: Supabase / Postgres 15, React 19, Vite 6, React Router 7, Tailwind 3, Node 20 ESM, Recharts, pdf-lib, ExcelJS plus CSV, zod.
- Authorization lives in the database: RLS on every table (enabled, not forced), SECURITY DEFINER RPCs, the protected-column guard with the `ssmp.trusted_operation` flag, views with `security_invoker`, and notifications only from the database.
- Five realtime tables; four private buckets and their owner-folder path convention; `profile-photos` readable by any signed-in user.
- The API handler pattern: envelope, CORS, headers, rate limiting that fails open, audit; the `toClientError` pattern; the PDF primitives and `ReportDocument`.
- The Form A contents and gate (Form A, then photo); achievements and verification; star mentee; the query confirmation loop and the 3-reopen cap; dossier and activity reports built from the same RPC as the page; HOD reassignment with the handover of open queries; the reserve pool.
- Deploy basics: `vercel.json` (1024 MB / 30 s, SPA rewrite, headers), `enable_signup = false`, the CI jobs (lint, UI test, build, `node --check`, PG15 migration apply, RLS assertion).
- Invariants 10.1, 10.2, 10.4–10.8 and 10.10. Recipes 11.1, 11.3, 11.4, 11.8 and 11.9 (with updated file locations).
- The bug fixes in the old §12.1–12.5: recursive profile policy, "Failed to fetch", Panel padding, modal focus, JWT header error.
- Open items that are still open: no automated authorization tests; no e-mail delivery; realtime refetches whole pages; `unlock_student_form_a` is a no-op for the UI.

### 16.3 Changed

| Area | Old document | Now | Changed by |
|---|---|---|---|
| Naming | ticket, `support_tickets`, `ticket_messages`, `ticket_code`, `ticket_*` enums, RPCs, notification types, `/…/tickets` routes, `useRealtimeTickets` | query, `support_queries`, `query_messages`, `query_code`, `query_*`, `/…/queries`, `useRealtimeQueries` / `useQueryThread`. Stored notification links were rewritten. | 0031 |
| Query categories | Academic / ERP-Tech / Infrastructure | UI offers Academics, Examination, Behavioural, Administrative, Others. The old three remain in the enum and in several counters (B1). | 0026 |
| Referral to the HOD | Only after 3 rejections; notifies every HOD | Any query, once. Routed to the mentor's configured HOD (`hod_email`), falling back to all HODs. A button in the queue and on the detail page. | 0030 |
| Notification table | 12 types | 19 types (at-risk ×3, survey ×2, counselling, and an unused `academic_data_uploaded`) | 0020, 0028 |
| Roster import | HOD-only, from Semester Setup | Cluster head or HOD, from Rosters & Mentors. Chunked (20 s budget, waves of 25, pool of 5); `offset` / `batch_id`; 200 per 300 s. Adds parent-contact and password columns and more header aliases. | 0027, API |
| Temporary passwords | Generated, 14 characters, shown once | One shared password from `SSMP_TEMPORARY_PASSWORD` (built-in fallback), or a per-row Password column | API |
| Provisioning | Student, faculty, HOD | Adds `cluster_head`, `department` and an ignored `send_invite_email` | API |
| `user_profiles` | — | Adds `cluster_head_setup_completed(_at)`, `parent_name`/`mobile`/`email`, `hod_email`; `department` set by the mentor | 0021, 0027, 0030 |
| `student_semester_gpas` | Student-entered | Adds `source` (student / cluster_head), `recorded_by`, `batch_id`. Department values overwrite and lock the student UI. | 0021 |
| GPA sharing | Student toggle | Toggle removed from the UI; the database still honours the flag (default on) | frontend |
| Star mentee | Read-only group ticket view | Also Survey Tracking and CR Report filing | 0023, 0027 |
| Guard columns | … | Adds `cluster_head_setup_completed`. Also protects `star_mentee_assigned_by` and `available_for_reassignment`, which the old §7.2 list omitted. | 0021 |
| Route guards | 4 | 5 (adds `RequireClusterHeadSetup`). Six faculty pages are reused with `isHodView` (was 4). | frontend |
| Navigation | 3 menus | 4 menus. The student menu adds Feedback Survey, Counselling and three star-only items; faculty adds At-Risk, Counselling, CR Reports; HOD drops Semester Setup and adds At-Risk, CR Reports, Scheduled Jobs. | frontend |
| Sessions | Token not HttpOnly | Persisted in `localStorage`, with a 30-day inactivity timeout in `config.toml` | frontend, config |
| npm scripts | dev, build, db:seed, test | Adds preview, install:all, db:push, db:reset, sample:files, test:parser, and `verify:security` (broken). `test` also runs the parser check. | package.json |
| Seed | 1 HOD, 3 faculty, 4 students | Adds 2 cluster heads, subjects, uploaded attendance, GPA and backlogs, survey data and job runs | seed script |
| "Where the current body lives" | 0009 / 0011 / 0012 / 0013 / 0017–0019 | Most workflow, trigger, view and report bodies now live in **0031**; escalation in 0030/0031 | 0030, 0031 |
| Enum-value rule | New value as its own statement | New value in its **own migration file** | 0020, 0026, 0028 |
| Endpoint count in recipe 11.6 | 6 | 8 | API |

### 16.4 Removed

- **HOD Semester Setup**: the page `HodSemesterSetupPage`, the route `/hod/semester` and its menu item. The old §12.6 stepper fix is moot. The `semester_cycles` table remains, unused.
- **`generateTemporaryPassword()`** in `input-validation.js`.
- The **"after 3 rejections" gate** on referral.
- Every **`ticket`-named** table, column, enum, function, trigger, policy and route (renamed, §16.3). The orphaned `components/tickets/*` files still exist but are dead.
- The **student GPA-sharing toggle**, from the UI only.

### 16.5 New since the old document

| Area | What | Where |
|---|---|---|
| Role and portal | Cluster head: setup gate, subjects, uploads, rosters, mentor mapping | 0020, 0021; `/cluster-head/*` |
| Academic data | `cluster_head_courses`, `student_course_sections`, `student_attendance_records` (ERP export, per registration number), `student_backlogs`, `academic_upload_batches`; `student_attendance_overview` | 0021, 0025, 0027, 0032, 0033 |
| At-risk | `student_risk_flags`, `at_risk_meetings`, the evaluation rule, dispatch, the link stub, `at_risk_student_overview`, the At-Risk pages | 0022 |
| Survey | `survey_questions` (10), `survey_cycles`, `survey_responses`, `survey_response_answers`, the survey RPCs and views, the student Survey and Survey Tracking pages | 0023 |
| Jobs | `cycle_job_schedule` (4 jobs), `cycle_job_runs`, `run_cycle_job`, `run_all_cycle_jobs_now`, `get_cycle_job_status`, the HOD Scheduled Jobs page, `/api/admin/run-cycle-job` | 0024 |
| CR reports | `mom_records`, `submit_mom_report`, `set_query_in_progress`, the student and faculty/HOD CR pages | 0027 |
| Counselling | `counselling_requests`, `request_counselling`, `respond_to_counselling`, the student and faculty pages; the counselling type dropdown (`counselling_type`, `COUNSELLING_TYPES`) | 0028, 0029, 0040 |
| Category charts | `queries_by_category`, `lib/queryCategoryChart.js`, `CategoryBarChart` `allLabels`; every "by category" chart counts the current categories, one colour per category (B1 fixed) | 0041 |
| HOD routing | `set_mentor_department_and_hod`, `hod_email`, the "Department & HOD" modal, the Raise-to-HOD column | 0030 |
| Uploads API | `POST /api/cluster-head/upload-academic-data` (attendance, GPA, backlog, mentor map with mentor creation) | API |
| Performance | `resolve_student_ids` (batch lookup), chunked roster import, `runPool` | 0033, API |
| Frontend | `/reset-password`, `components/queries/*`, `PasswordField`, `AcademicUploadPanel`, `COURSE_CATALOGUE`, `SURVEY_SCALE`, `CYCLE_JOBS`, counselling and at-risk labels | frontend |
| Config and docs | `SSMP_TEMPORARY_PASSWORD`, `[auth.sessions]`, `docs/CLUSTER-HEAD-AND-CYCLE-JOBS.md`, `sample-data/cluster-head-sample-data.mjs` and `generated/` | repo |
| Academic cycles | `academic_cycles`, `academic_cycle_students`, `cycle_id` on seven tables, the Academic Cycles page, the cycle report, black dots in the at-risk rule; student GPA entry removed | 0036, 0037; `/cluster-head/cycles`; `/api/reports/academic-cycle-report` |
| Administrator and HOD scope | The `admin` role and portal (`/admin`, Upload); the mentor–HOD mapping (`hod_id`, `mentor_section`, `mentor_designation`, `map_faculty_to_hods`, `parseHodMappingFile`, the `hod-map` action); each HOD limited to their mapped faculty (`is_admin`, `my_overseen_faculty`, `oversees_faculty`, `oversees_student`, scoped policies and RPCs); the cluster head's upload screens inside the HOD portal (`/hod/uploads`, subjects from the attendance files); `npm run db:admin` | 0038, 0039; §4.25 |
| Senior mentors | `is_senior_mentor`, `senior_mentor_sections`, `query_escalations`, `mentor_kind`, `referred_to_faculty`, `escalation_source`; `create_support_query(… p_recipient)`, `escalate_peer_query` and the read RPCs; Peer Queries, Assigned Mentees, Raised to Me, Raised to HOD, Senior Mentors; the senior list (`npm run db:seniors`); direct query writes limited to the priority (S6, S15 fixed) | 0042; §4.26 |
| Fixes not in the old §12 | Blank "Referred to HOD" card (0030); attendance filed everyone under one section (0027); stale `/tickets` notification links (0031); roster-import timeouts (chunking and pool); statement timeouts on ~2,300-row uploads (0033); frequent sign-outs (localStorage and the 30-day window) | as listed |

### 16.6 Statements that were already wrong in the old document

- It spoke of "the seven cross-portal notification triggers". 0011 created six; there are nine now.
- Its §7.2 guard list omitted `star_mentee_assigned_by` and `available_for_reassignment`, both of which were already protected.
- The activity report's "Referred to HOD" card read `summary.escalated_tickets`, which the RPC did not return until 0030, so the card was always blank.

---

## Appendix A — Invariants (rules that must keep holding)

Each rule exists because breaking it caused a real failure, or would cause one that testing would not catch.

1. **Authorization never moves out of the database.**
   - New features reuse the helpers and RLS. A check that exists only in React or the API protects nothing, because PostgREST and Realtime expose the same data.
   - A new table holding user data needs RLS **and** policies in the migration that creates it. CI fails otherwise.
2. **Enable RLS; never force it.** Definer functions run as the owner and must write rows no client policy allows: system messages, notifications, state machines.
3. **Protected profile columns** (§7.1) change only when one of these holds:
   - no JWT;
   - the caller is the administrator (a HOD only for their own people, and never the mapping columns or the `hod` / `admin` role);
   - a definer RPC that has already checked authorization sets the transaction-local `ssmp.trusted_operation` flag around the write:

     ```sql
     perform set_config('ssmp.trusted_operation', 'on', true);
     update public.user_profiles set … where id = …;
     perform set_config('ssmp.trusted_operation', 'off', true);
     ```

   If you forget the flag, the guard raises 42501 and the feature breaks for everyone except the administrator.
4. **Rule-bearing state changes are SECURITY DEFINER RPCs.** Each one:
   - pins `set search_path = public, pg_temp`;
   - checks the caller first;
   - raises end-user-readable messages, because they are shown verbatim;
   - revokes EXECUTE from `public`/`anon` and grants it to `authenticated` (and/or `service_role`).
5. **Notifications come only from the database,** through `enqueue_notification`, in triggers or definer RPCs. Never insert them from React or the API.
6. **Every view is `WITH (security_invoker = true)`.** Otherwise it runs as its owner and bypasses RLS.
7. **Storage object paths start with the owner's user id.** The storage policies read the first folder.
8. **Never edit an applied migration.** Add a new one. **Each new enum value gets its own migration file**, because Postgres refuses to use a value in the transaction that created it.
9. **Enum values the UI offers are mirrored in `lib/constants.js`.** The legacy query categories are a deliberate exception: they stay in the enum but are not offered.
10. **One source for report numbers.** A page and its PDF call the same SQL function. Never recompute report numbers in JavaScript for one of them only.
11. **The service-role key never reaches the browser,** and API work runs `asUser` unless it truly needs the service role.
12. **`Panel`'s `bodyClassName` has no default value.** The component falls back with `?? 'p-5'`; a default of `''` once removed the padding from 56 of 71 panels. Pass `bodyClassName=""` explicitly for edge-to-edge bodies.
13. **`Modal`'s setup effect depends only on `open`.** `onClose` is kept in a ref. The auto-focus prefers form fields over buttons, or focus lands on ✕ on every keystroke.
14. **Uploads resolve identifiers once per file** (`resolve_student_ids`). Never reintroduce a per-row lookup: it exceeded the statement timeout at about 2,300 rows.
15. **Long account-creation work must stay chunked.** Any loop of Auth calls must fit the 30 s function limit; follow the `offset` / `next_offset` pattern (§4.13).
16. **Exactly one academic cycle is active, and a closed cycle is never rewritten** (§4.24). New tables whose rows belong to a year get a `cycle_id` set by a `BEFORE INSERT` trigger, never by the page. Screens and rules that mean "this year" filter on `active_cycle_id()`; nothing overwrites or deletes an earlier cycle's rows to start a new year.
17. **A cycle is not a semester.** Which semester (odd or even) a row belongs to is computed from its own date against `even_starts_on` when it is read; it is never stored, so a date correction re-files everything. The programme semester (1–8) stays on the student and on GPA and backlog rows.
18. **Anything that re-evaluates many students at once runs in slices** (`reevaluate_students_batch`, 300 at a time) and with `ssmp.quiet_risk_notifications` on, so no single call nears the statement timeout and mentors are not flooded with "no longer at-risk" notices.
19. **Who a HOD sees is decided by `hod_id`, through the `oversees_*` helpers, never by `is_hod()`** (§4.25). `is_hod()` is true for every HOD and the administrator and is only for department-level actions (uploads, cycles, jobs, imports). A new policy or RPC that lets "the HOD" read or change a person, query or meeting must use `oversees_student` / `oversees_faculty` (or `my_overseen_faculty()` read once per statement as `(select …)::uuid[]`); a new department-level one uses `is_hod()`. Using `is_hod()` for a person would show every HOD the whole department again.
20. **Only the administrator changes the mentor–HOD mapping and the `hod` / `admin` roles,** and only the service role creates an administrator (`npm run db:admin`, which sets the profile's role itself, §4.1). The mapping sheet is the source of truth; a mentor may name their HOD only while unmapped.
21. **A query's people are decided by its columns, through `can_access_query` and `can_handle_query`** (0042): the student, the mentor it was sent to (`mentor_id`, faculty or senior by `mentor_kind`), the faculty mentor's HOD, the faculty member it was raised to (`referred_to_faculty`) and, once escalated, the student's HOD. A new query screen narrows by person (`studentId`, `mentorId`) on top of RLS, because a senior mentor is a student who can read other students' queries and a faculty member can read queries raised to them.
22. **A senior's escalation reason never reaches the student.** It lives only in `query_escalations` (readable through `can_handle_query`); the system messages say that the query was raised, never why. (A faculty mentor's referral note is still copied into its system message, §8.9 S12.) Direct writes to `support_queries` stay limited to the `priority` column; every other change goes through an RPC.
23. **The senior flag comes from the senior list** (`npm run db:seniors`, the service role) and is protected like the mapping; a senior is always a student account (`user_profiles_senior_is_student`). A senior's account can be deleted only after their queries have moved (`mentor_id` is `on delete restrict`), which the script does first.

## Appendix B — Change recipes

Each recipe ends with the verification loop in B.10.

**B.1 Add a field to Form A**

1. In a new migration, add the column (with CHECKs if needed) to `student_form_a_profiles`, and `create or replace` `submit_student_form_a` so it copies the payload key. The current body is in 0017/0010 lineage; copy the live definition from the database.
2. Add the field to `EMPTY_FORM_A`, `validateFormA` and the field layout in `components/student/FormAFields.jsx`.
3. If mentors should see it, add it to `get_student_dossier` (current body in 0035), the dossier page and the PDF.

**B.2 Add a page to a portal**

1. Create the page under `pages/<role>/`, wrapped in `PortalShell`.
2. Add a `lazy()` import and a `<Route>` in `AppRouter.jsx` inside `Protected role="…"`. Students also need `RequireOnboarding`; cluster heads need `RequireClusterHeadSetup`. A department page belongs in `departmentRoutes(base, role)`, which mounts it for both the HOD (`/hod`) and the administrator (`/admin`); a cluster-head upload page that HODs should also have gets a `/hod/uploads/...` route too.
3. Add a `NAVIGATION[role]` item, with `when` if it is conditional (a department page: `departmentNavigation(base)`; a HOD upload page: the Uploads group's `children`). Links inside a page shared by two portals use `usePortalPaths()`, never a hard-coded `/hod` or `/cluster-head`.
4. Enforce access in the database, not in the page.

**B.3 Add a table**

1. In a new migration: create the table with FKs to `user_profiles` as needed, then `alter table … enable row level security`, the policies, and minimal grants to `authenticated`.
2. Add an `updated_at` trigger if the table has that column.
3. Add the table to the realtime publication only if something will subscribe.
4. CI checks that RLS is on.

**B.4 Add a state transition**

1. Write a definer RPC: caller check, validation, the update, a system message or log, and the notification via `enqueue_notification` (or a trigger).
2. Call it with `supabase.rpc` through `useAsyncAction`.
3. Do not add a client `update` policy for the same columns.

**B.5 Add a notification**

1. If the type is new: a migration containing **only** `alter type notification_type add value '…'`.
2. Then, in a later migration, the trigger or RPC that calls `enqueue_notification(recipient, actor, type, title, body, query_id, link_path)`.
3. Add an icon for the type to `TYPE_ICONS` in `components/layout/NotificationBell.jsx`.

**B.6 Add a serverless endpoint**

1. Create `api/<area>/<name>.js` exporting `withApiDefaults([...methods], handler)`.
2. Follow the anatomy in §6.1: auth, role, rate limit, zod, `asUser` work, audit, envelope.
3. Put the schema in `input-validation.js`.
4. There are 9 functions today. The `action` / discriminated-union pattern keeps related operations in one function.

**B.7 Add a chart or KPI**

1. Prefer extending the existing RPC or view, in a new migration with `create or replace`. The current bodies are mostly in 0031.
2. Render it with the `Charts.jsx` wrappers and `StatCard`.
3. **Use the current query categories.** Chart them with `queryCategoryChartData` (`lib/queryCategoryChart.js`); do not copy the legacy-only columns.

**B.8 Add a report or PDF**

1. Write one SQL function returning JSON, with an access check.
2. Render it on the page from `supabase.rpc`.
3. Add a builder in `report-document-builder.js` using `pdf-chart-primitives.js`.
4. Add an endpoint that calls the same RPC `asUser` and streams the PDF.

**B.8a Start a new academic year.** Nothing to deploy. A cluster head opens Academic Cycles → **Start next cycle**, checks the dates and ticks the box; the page re-checks every student's at-risk flags. Then, in order: import this year's student roster (or **Carry over** last year's students), upload the mentor mapping, and review My Subjects, which starts as a copy of last year's. If the cycle was started by mistake and nothing has been uploaded into it yet, **Remove** it from All cycles.

**B.8b Make a new kind of record per cycle.** Add `cycle_id uuid references academic_cycles(id)` in a new migration, backfill existing rows into the cycle they belong to, add a `BEFORE INSERT` trigger with `tag_row_with_active_cycle('required')` (or a function of its own if the row's date decides the cycle), index `(cycle_id, …)`, and read it with `where cycle_id = active_cycle_id()` where "this year" is meant. Add it to `get_cycle_overview`, `delete_academic_cycle`'s emptiness check and the report if the cluster head should see it.

**B.8c Move mentors between HODs, or add a HOD.** Nothing to deploy. Edit the department's mentor–HOD sheet (a new HOD is just a new e-mail in the HOD columns) and upload it as the administrator (Upload). New HOD and mentor accounts are created on the temporary password; the mapping and the HOD's view change at once.

**B.9 Change the visual theme.** Change token **values** in `tailwind.config.cjs`, `CHART_COLORS` and the PDF `PALETTE`. Keep the token names; every screen depends on them.

**B.10 Verification loop**

1. `npm run lint`.
2. `npm test` (UI regression and parser checks).
3. `npm run build`.
4. `node --check` on changed API files.
5. Apply the migrations to a scratch Postgres with `supabase/scripts/ci-supabase-stubs.sql`, as CI does.
6. Exercise the change as each affected role.

`npm run verify:security` is broken (missing file).

## Appendix C — Limits and constants (quick reference)

| Limit | Value | Where |
|---|---|---|
| Unresolved queries per student | < 20 | `create_support_query` |
| Query subject / description / message / confirmation comment | 200 / 5,000 / 5,000 / 1,000 characters | RPCs and CHECKs |
| Resolution rejections (reopens) | 3 | `max_resolution_rejections()` |
| Referral note | 1,000 characters | `escalate_query_to_hod` |
| Senior's escalation reason | required, 1,000 characters | `escalate_peer_query`, `query_escalations` CHECK |
| Senior mentor sections | A3 … T4 (40); one senior per section, any number of sections per senior | `senior_mentor_sections`, `SENIOR_SECTIONS` |
| Open counselling requests per student; concern / reply length | 5; 3,000 / 3,000 characters | counselling RPCs |
| CR report items; notes | 12; 5,000 characters | `submit_mom_report` |
| Subjects per cluster head | 1–60 per academic cycle | `submit_cluster_head_setup` |
| Mentor–HOD mapping | ≤ 5,000 rows per upload; section ≤ 40, role ≤ 80 characters | `map_faculty_to_hods`, constraints |
| Academic cycles | one per `start_year` (2000–2098); exactly one active; dates within a year either side of the label | `academic_cycles` constraints |
| At-risk re-check slice | 300 students per call (1–1,000) | `reevaluate_students_batch` |
| Reassignment batch | 500 students | `reassign_mentees`, zod |
| Provisioning batch | 1–500 accounts; body ≤ 2 MB | zod, `assertBodySize` |
| Upload body; base64; effective file size | 10 MB (body parser); ≤ 8,000,000 characters (zod); about 3.3 MB in practice, because Vercel limits function request bodies to 4.5 MB | endpoints, platform |
| Spreadsheet data rows | 5,000 (not attendance) | parser |
| Roster chunk | 20 s budget, waves of 25, 5 concurrent, 1 Auth retry after 1.5 s | import endpoint |
| Function duration / memory | 30 s / 1,024 MB | `vercel.json` |
| GPA | 0–10, 2 dp; semesters 1–8 | RPCs and CHECKs |
| Attendance | 0–100%; held ≤ 2,000; attended ≤ held | CHECKs |
| At-risk thresholds | attendance < 75 (active cycle), latest GPA < 6, uncleared backlogs ≥ 1, black dots ≥ 1 (active cycle) | `evaluate_student_risk` |
| Survey | 10 questions, 1–5; 15-day window; reminders every 7 days | 0023/0024 |
| Rate limits | provision 20/60 s; roster 200/300 s; faculty-roster 60/60 s per action; cycle-job 40/300 s; academic-upload 30/300 s; faculty and student reports 30/60 s each; cycle report 20/60 s | endpoints |
| Password (client) | ≥ 10 characters, upper, lower, digit, symbol | `ChangePasswordPage` |
| Temporary password (roster column) | ≥ 8 characters | import endpoint |
| Files | Form A and proofs 5 MB (png, jpg, webp, pdf); photos 3 MB (png, jpg, webp); signed URLs 300 s (avatars 3,600 s) | `fileUpload.js`, buckets |
| Lists | query pages of 25; notifications 30; PostgREST `max_rows` 1,000 | hooks, config |
| Session | JWT 3,600 s; inactivity 720 h | `config.toml` |
| Query codes | `AN-` + sequence from 1001 | `query_code_seq` |

## Appendix D — Demo and seed data

**Never seed production.** The demo passwords are known. They are set by `SEED_DEFAULT_PASSWORD`, which has a built-in fallback; `supabase/seed.sql` states its password in a comment. No password is reproduced here. (For a real deployment, `npm run db:admin` creates only the administrator, on `SSMP_TEMPORARY_PASSWORD`.)

| Role | E-mail | Notes |
|---|---|---|
| admin | `smp.admin@jaipur.manipal.edu` | "SMP Admin", ADM001. Sees the whole department; Upload. |
| hod | `hod.iotis@jaipur.manipal.edu` | "Dr. Sarah Jenkins", HOD001. Mapped: Alice (A 3) and Bob (B 3), so John, Jane and Mike |
| hod | `hod2.iotis@jaipur.manipal.edu` | "Dr. Vikram Rao", HOD002. Mapped: Carol (A 4, class coordinator), so Emily |
| faculty | `alice.smith@jaipur.manipal.edu`, `bob.johnson@jaipur.manipal.edu`, `carol.williams@jaipur.manipal.edu` | FAC1001–FAC1003 |
| student | `john.doe@muj.manipal.edu`, `jane.smith@muj.manipal.edu`, `mike.davis@muj.manipal.edu`, `emily.wilson@muj.manipal.edu` | Registration numbers 2428020221–2428020224; mentors assigned by the seed |
| cluster_head | `cluster.head1@jaipur.manipal.edu`, `cluster.head2@jaipur.manipal.edu` | From `sample-data/cluster-head-sample-data.mjs`; seed script only |
| student, senior mentor | `riya.senior@muj.manipal.edu` | "Riya Kapoor", 2228020101 (0042). Senior mentor for A3 and B3, so John, Jane (Alice's mentees) and Mike (Bob's) see her as their senior; Emily (Carol, A 4) has none and sees the notice. Seeded queries: Jane → Riya "Which electives count for the IoT minor?"; with `seed.sql` also Mike → Riya "Lab locked in the evenings", escalated to the HOD with a reason |

**`npm run db:seed`** (the hosted-safe path through the Admin API) creates:

- the accounts above, with mentor links. The administrator is filed as a student by Supabase Auth and then made the administrator (`makeAdministrator`, §4.1; the seed prints "~ promoted admin");
- the mentor–HOD mapping (`SAMPLE_HOD_MAPPING`, through `map_faculty_to_hods`); the same rows are `sample-data/generated/mentor-hod-mapping-sample.csv`, for trying the administrator's Upload page;
- sample queries and messages;
- the senior mentor (0042): Riya's flag and sections, written with the service role as `npm run db:seniors` and the Senior Mentors page would, and Jane's query to her;
- the 4 global canned replies;
- the cluster heads' subjects, in the active academic cycle (the seed stops with "No active academic cycle. Apply migration 0036 before seeding." if there is none);
- uploaded sample attendance, GPA (the CGPA / GPA & Credits shape: semesters 1–2 and CGPA), two Defaulter Grade results for semester 2 (end term, then a make-up that clears Emily's backlog) and a black dot notice (John and Jane, plus one student from outside the portal who is reported back), through `record_attendance_batch`, `record_gpa_batch`, `record_backlog_batch` and `record_black_dot_batch`. Each demo student trips a different at-risk condition, and one trips none. Since 0036 John's and Jane's black dots are an at-risk reason of their own in the cycle they fall in.
- The seed then runs the at-risk jobs and a survey cycle through `run_cycle_job`, and records sample survey responses.

**`supabase/seed.sql`** (local `db reset` only) inserts the 11 non-cluster-head accounts (administrator, two HODs, three faculty, four students and the senior mentor) directly into `auth.users`/`auth.identities` (with `app_metadata` in the same insert, so the trigger makes the administrator directly), plus mentors, the mentor–HOD mapping, the senior mentor's flag and sections with her two peer queries (one escalated, with a `query_escalations` reason), sample queries and messages, and the canned replies.

## Appendix E — Glossary

| Term | Meaning |
|---|---|
| **SMP / SSMP** | Student Mentorship Portal (current name) / Student Support & Mentorship Portal (former name, still in identifiers) |
| **Query** (formerly *ticket*) | A student's support request to their mentor; code `AN-<n>` |
| **Mentor** | The faculty member in `user_profiles.assigned_mentor_id` (the **faculty mentor**). For a query, `mentor_id` is whoever it was sent to: the faculty or the senior mentor |
| **Senior mentor** (senior / alumni mentor) | A student with `is_senior_mentor` (0042), set from the senior list, who answers the queries of the students in the sections a HOD gave them (§4.26) |
| **Peer query** | A query a student sent to their senior mentor (`mentor_kind = 'senior'`) |
| **Raised to faculty mentor / Raised to Me** | A senior passed a peer query to the student's faculty mentor (`referred_to_faculty`), who sees it under Raised to Me |
| **Raised to HOD** | The HOD's list of escalated queries, tagged Raised by faculty or Raised by senior, with the reason; they are not in All Queries |
| **Section (A3 … T4)** | A mentor's section from the mentor–HOD mapping, stored "A 3"; a student is in their faculty mentor's section, which decides their senior mentor |
| **Mentor group** | All students who share a mentor |
| **Star mentee / student representative / CR** | The one student per mentor group with `is_star_mentee`. They see group queries and survey status and file CR reports. |
| **CR report / MoM** | Class-representative meeting minutes (`mom_records`). Their action items are queries with `mom_id`. |
| **Resolution confirmation** | The student's yes/no after a mentor resolves a query; "no" reopens it (at most 3 times) |
| **Raise to HOD / referral / escalation** | The mentor flags a query for the HOD they are mapped to (or the administrator); since 0042 a senior mentor can too, with a required reason (Ask HOD / Escalate) |
| **Administrator** | The `admin` role: the department-wide portal the single HOD used to have, plus the mentor–HOD mapping upload (§4.25) |
| **Mentor–HOD mapping** | The department's sheet of mentors and class coordinators with their section and HOD, uploaded by the administrator; stored as `user_profiles.hod_id`, `mentor_section`, `mentor_designation` |
| **Class coordinator** | A faculty member listed in the mapping as "Class Coordinator (fallback)" for a section; to the portal, a mentor like any other |
| **A HOD's faculty / scope** | The faculty mapped to a HOD (`hod_id`) and those faculty's mentees, queries, meetings and reports: everything that HOD sees |
| **Coverage** | Whose figures a dashboard or all-faculty report holds: `department` (administrator, cluster head) or `hod` (one HOD's faculty) |
| **Uploads (HOD)** | The cluster head's upload screens inside the HOD portal, under `/hod/uploads` |
| **Form A** | The department's mentor–mentee onboarding form, digitised in `student_form_a_profiles` |
| **Cluster head** | The staff role that uploads academic data and rosters for its subjects |
| **Subjects / My Subjects** | A cluster head's `cluster_head_courses` (name and code). A HOD has no list: their subjects are created from attendance files |
| **ERP export** | The university ERP's Class Attendance file: an HTML table saved as `.xls` |
| **At-risk** | A student meeting any of: attendance < 75% in the active cycle, latest GPA < 6, ≥ 1 uncleared backlog, ≥ 1 black dot in the active cycle |
| **Academic cycle** | One academic year ("2026–27", `academic_cycles`), with an odd and an even semester. Exactly one is active; everything uploaded is filed under one (§4.24) |
| **Odd / even semester** | The two halves of an academic cycle ("Odd semester 2026", July–December; "Even semester 2027", January–June). Not the same thing as a programme semester |
| **Programme semester** | A student's own semester, 1–8 (`semester_label` "3rd Semester"; `semester_number` on GPA and backlog rows) |
| **Carry over / activate** | Bringing students into a new cycle: from the previous cycle's list, or from a roster that lists students who already have accounts |
| **Sweep / dispatch** | Re-evaluating everyone's risk / raising meetings for flagged students |
| **Cycle job** | One of the four periodic jobs (§4.16); run manually. "Cycle" here is the 15-day job cycle, not an academic cycle; a **survey cycle** (`survey_cycles`) is one round of the feedback survey |
| **Reserve pool** | Active faculty accepting reassignments, with remaining capacity |
| **Department-published GPA** | A `student_semester_gpas` row with `source = 'cluster_head'` |
| **Trusted operation** | The transaction-local `ssmp.trusted_operation` flag that lets a definer RPC write protected profile columns |
| **Temporary password** | The shared first-login password (`SSMP_TEMPORARY_PASSWORD`) |
