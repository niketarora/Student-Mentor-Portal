# SMP — Student Mentorship Portal

**Academic Nexus** · Department of IoT & Intelligent Systems · Manipal University Jaipur

A production-grade, role-based academic mentorship, query governance, and ERP monitoring platform connecting **Students**, **Faculty Mentors**, **Senior Mentors**, **Heads of Department (HODs)**, **Cluster Heads**, and the **System Administrator**. 

The platform digitises and unifies the university's entire mentor–mentee scheme: from compulsory student onboarding (Form A) and multi-turn query resolution loops with student confirmation, to automated at-risk detection, 12-category pastoral counselling, Class Representative (CR) reports, academic cycle management, and vector PDF dossier exports.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                    FRONTEND CLIENTS                                      │
│                                React 19 · Vite 6 · Tailwind CSS 3                        │
│                                                                                          │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌─────────┐ │
│  │ Student Portal │ │ Faculty Portal │ │   HOD Portal   │ │  Cluster Head  │ │  Admin  │ │
│  │ • Form A & Pic │ │ • Query Queue  │ │ • Scoped Dept  │ │ • Cycles & ERP │ │ • Super  │ │
│  │ • Queries & CR │ │ • Mentee Docs  │ │ • Reassign     │ │ • Attendance   │ │   Admin │ │
│  │ • Senior Views │ │ • At-Risk MoMs │ │ • Allocations  │ │ • GPA/Backlogs │ │ • HOD   │ │
│  │ • Counselling  │ │ • Reports/PDF  │ │ • Uploads      │ │ • Black Dots   │ │   Map   │ │
│  └───────┬────────┘ └───────┬────────┘ └───────┬────────┘ └───────┬────────┘ └───┬─────┘ │
└──────────┼──────────────────┼──────────────────┼──────────────────┼──────────────┼───────┘
           │                  │                  │                  │              │
           │ Direct client queries (PostgREST)   │                  │              │
           │ JWT authenticated · RLS enforced    │                  │              │
           ▼                                     ▼                  ▼              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                             SUPABASE POSTGRESQL 15 BACKEND                               │
│                                                                                          │
│  • 34 Public Tables across 42 Migrations (0001–0042)                                     │
│  • Row Level Security (RLS) enabled on 100% of public tables                             │
│  • SECURITY DEFINER RPCs with pinned search_path = public, pg_temp                       │
│  • 10 Reporting & Analytics Views (all created with security_invoker = true)             │
│  • Realtime Engine: Logical replication publication over 5 core tables                   │
│  • 4 Private Storage Buckets (profile-photos, form-a-uploads, achievements, rosters)     │
│  • Postgres-backed distributed rate limiting (api_rate_limits)                           │
│  • Tamper-evident append-only audit trails (audit_log, reassignment_log, escalations)    │
└──────────────────────────────────────────▲───────────────────────────────────────────────┘
                                           │ service_role key
                                           │ (never exposed to browser)
┌──────────────────────────────────────────┴───────────────────────────────────────────────┐
│                               VERCEL SERVERLESS FUNCTIONS                                │
│                                      Node 20 · ESM                                       │
│                                                                                          │
│  • Account Provisioning (single & batch)      • Time-budgeted Resumable Roster Import    │
│  • Faculty Departure & Mentee Reassignment    • Academic Data Parsing & Ingestion        │
│  • Scheduled 15-day Cycle & Survey Jobs       • Pure JS Vector PDF Reports (pdf-lib)     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Architectural Principles

1. **Database as the Definitive Security Boundary**: Standard reads, writes, and real-time subscriptions go straight from the browser to Supabase Postgres over PostgREST and WebSockets. Authorisation is enforced by Postgres Row Level Security (RLS) policies at the data layer, not by middleware. UI route guards serve purely for UX convenience.
2. **Strict Isolation of Privileged Operations**: Actions requiring elevated credentials (creating Auth accounts, batch roster ingestion, mentor reassignments, and multi-page vector PDF generation) execute exclusively within Vercel serverless functions holding the `service_role` key.
3. **Multi-Role Scoping & Soft Tenancy**: The database supports multi-HOD departments (introduced in migration `0039`). Each HOD is scoped to the faculty and mentees mapped to them, while the System Administrator retains global department oversight.
4. **Lightweight Vector Artifacts**: Reports export as vector PDFs rendered in pure JavaScript using `pdf-lib` and custom geometric primitives (bars, donuts, gauges, tables), avoiding headless browser overhead in serverless runtimes.
5. **Defensive Ingestion**: Spreadsheet parsers use `ExcelJS` and a custom RFC-4180 CSV parser built entirely on null-prototype objects (`Object.create(null)`), neutralizing prototype pollution attacks (`__proto__`) and ReDoS vulnerabilities.

---

## System Overview & Technology Stack

| Layer | Specifications & Technologies |
|---|---|
| **Database** | Supabase Postgres 15 · 34 public tables · 42 migrations (`0001`–`0042`) · 10 `security_invoker` views |
| **Data Protection** | Row Level Security (RLS) enabled on all 34 tables (`ENABLE`, not `FORCE`) · `SECURITY DEFINER` stored procedures |
| **Authentication** | Supabase Auth · Email & Password · PKCE flow · No public sign-up (`enable_signup = false`) · Mandatory temporary password rotation |
| **Realtime** | Supabase Realtime via Postgres WAL logical replication on 5 tables (`support_queries`, `query_messages`, `notifications`, `user_profiles`, `student_achievements`) |
| **File Storage** | Supabase Storage · 4 private buckets (`form-a-uploads`, `achievement-proofs`, `roster-imports`, `profile-photos`) · Authenticated short-lived signed URLs |
| **Serverless API** | Vercel Serverless Functions (Node 20, ESM) · 9 routes · Zod schema validation · Concurrency pooling |
| **Frontend** | React 19 · Vite 6 · React Router 7 · Tailwind CSS 3 · Recharts 2.15 · Material Symbols Outlined |
| **Document Engine**| `pdf-lib` 1.17.1 with custom hand-drawn vector charts (zero headless browser dependency) |
| **Ingestion Engine**| `exceljs` 4.4.0 + custom RFC-4180 CSV parser + DOM table parser for legacy ERP `.xls` files |
| **CI / CD Pipeline** | GitHub Actions: Parallel frontend checks (Oxlint, UI regression tests, Vite production build, API syntax check) and database validation (throwaway Postgres 15 container executing all 42 migrations with `ON_ERROR_STOP=1` and asserting RLS across 100% of tables) |

---

## User Roles & Portal Capabilities

The system defines 5 first-class user roles in the Postgres `user_role` enum, augmented by role flags for specialized responsibilities:

### 1. Student Portal (`/student`)
- **Compulsory Two-Step Onboarding**: Enforced by React route guards (`RequireOnboarding`). Students must submit **Form A** (digitised Mentor-Mentee record including family background, MUJ alumni details, and permanent address) and upload an approved **Profile Photo** before accessing any other page. Form A is permanently locked upon submission.
- **Support Queries (`support_queries`)**: Students raise queries to their **Faculty Mentor** or assigned **Senior Mentor**. Queries use sequence-generated identifiers (`QRY-000123`). Supports threaded real-time conversations (`query_messages`), status tracking, and file attachments.
- **Resolution Confirmation Loop**: A query marked resolved by a mentor enters `pending_confirmation`. The student confirms resolution (closing the query and unlocking a 1–5 star satisfaction rating) or rejects it (reopening the query with mandatory feedback; capped at 3 rejections before automated HOD escalation).
- **Academic Record Tracking**: View official academic standing uploaded by Cluster Heads: fortnightly ERP attendance (flagged if overall < 75%), official semester GPAs and cumulative CGPA, active/cleared backlogs, and Proctorial Board black dot notices. *(Student manual GPA entry was retired in migration 0037)*.
- **Non-Academic Achievements**: Maintain sports, cultural, technical, volunteering, certification, and leadership records with proof uploads for mentor verification.
- **Pastoral Counselling**: Submit private counselling requests across 12 distinct categories with a 5-request open cap.
- **Cycle Surveys**: Complete active mentorship feedback surveys per academic cycle.
- **Star Mentee / CR Workflow**: Students flagged as Class Representative (`is_star_mentee`) gain access to **Group Queries**, **Survey Tracking**, and **CR Reports** to submit class meeting minutes whose action items become trackable mentor queries.
- **Senior Mentorship Module**: Senior students designated as mentors (`is_senior_mentor`) access dedicated views (`/student/peer-queries` and `/student/mentees`) to mentor junior sections, respond to peer queries, and refer complex cases to faculty.

### 2. Faculty Mentor Portal (`/faculty`)
- **Query Queue Management**: Active queue with status filters, priority flags (Low, Medium, High, Urgent), category tags, and canned replies. Mentors can post replies, mark queries resolved, or escalate queries directly to the HOD.
- **"Raised to Me" Workspace**: Dedicated queue for queries escalated by senior peer mentors or referred by the HOD.
- **Mentee Roster & Student Dossiers**: Comprehensive view of assigned mentees with quick contact cards, Form A summaries, academic records, and downloadable individual Student Dossier PDFs.
- **Star Mentee Designation**: Mentors designate exactly one mentee as group representative (`is_star_mentee`), atomically enforced via PostgreSQL row locks (`FOR UPDATE`).
- **At-Risk Tracking & MoMs**: Live at-risk dashboard tracking mentees flagged for attendance (< 75%), GPA (< 6.0), backlogs, or black dots. Mentors log intervention meetings and Minutes of Meetings (MoM).
- **Pastoral Counselling Management**: Review and reply to confidential counselling requests submitted by mentees.
- **CR Reports Review**: Track action items submitted by Class Representatives.
- **Faculty Activity Report**: Dynamic dashboard with 8 KPI metrics, category breakdowns, resolution turnaround averages, satisfaction distribution, and one-click branded PDF download.

### 3. Head of Department (HOD) Portal (`/hod`)
- **Scoped Department Oversight**: Since migration `0039`, each HOD oversees only the faculty members mapped to them (via `user_profiles.hod_id`) and their respective mentees.
- **Department Performance Analytics**: Benchmark faculty resolution rates, response latencies, mentee loads, and student satisfaction ratings across all overseen faculty.
- **Faculty Roster & Bulk Reassignment**: Manage faculty employment statuses (`active`, `on_leave`, `departed`). Bulk reassign mentees from departing faculty to active mentors in the reserve pool, automatically transferring open queries in the process.
- **Senior Mentor Section Allocation**: Allocate senior student mentors to specific section codes (e.g., A3, B3 through T4) to establish peer mentorship coverage.
- **Academic Operations & Batch Ingestion**: Access full upload interfaces for attendance, GPAs, backlogs, black dots, and student/faculty rosters.
- **Scheduled Cycle Jobs**: Trigger 15-day cycle maintenance jobs: risk re-evaluations, survey cycle dispatch, and reminder notifications.

### 4. Cluster Head Portal (`/cluster-head`)
- **Subject Catalog Configuration**: One-time setup form to register course names, course codes, and section counts.
- **Academic Cycle Management**: Initialize and transition annual academic cycles (e.g., "2026–27" Odd and Even semesters), carry forward enrolled students, and download cycle performance reports.
- **Batch ERP Data Ingestion**:
  - *Attendance*: Ingest fortnightly ERP attendance spreadsheets; automatically maps student sections.
  - *GPA & CGPA*: Ingest semester GPA and cumulative CGPA spreadsheets.
  - *Backlogs*: Ingest ERP defaulter grade reports.
  - *Black Dots*: Ingest Proctorial Board disciplinary notices (`.docx` / `.xlsx` / `.csv`).
- **Roster & Mapping Uploads**: Ingest master student and faculty rosters, as well as mentor–mentee allocation spreadsheets.
- **Zero Query Access**: By database design and RLS enforcement, Cluster Heads have no visibility into student support queries, Form A profiles, or personal records.

### 5. System Administrator Portal (`/admin`)
- **Department-Wide Master Control**: Global visibility across all HODs, faculty mentors, students, queries, and uploads.
- **Mentor–HOD Mapping Upload**: Upload the master mentor-to-HOD spreadsheet (`map_faculty_to_hods`), assigning faculty members and section coordinators to their supervising HOD.
- **Account Provisioning & Super-Admin Oversight**: Provision individual faculty, HOD, and cluster head accounts, manage global cycle operations, and configure administrative settings.

---

## Core Features & Workflow Lifecycle

```
QUERY LIFECYCLE STATE MACHINE
═════════════════════════════

  [Student] Creates Query (QRY-XXXXXX)
      │
      ▼
   ( OPEN ) ──────────► [Mentor / Senior] First Reply
                            │
                            ▼
                    ( IN PROGRESS ) ◄────────┐
                            │                │ Student Rejects
                            ▼                │ Resolution
                   [Mentor Marks Fixed]      │ (Max 3 Reopens)
                            │                │
                            ▼                │
               ( AWAITING CONFIRMATION ) ────┤
                            │                │
            Student Confirms│                ▼
               Resolution   │       ( REOPENED / ESCALATED )
                            ▼                │
                        ( CLOSED )           └──► 3rd Rejection or Manual:
                            │                     Escalated to HOD
                            ▼
                   [Rating 1–5 Unlocked]
```

### Feature 1 — Compulsory Onboarding (Form A & Profile Photo)
Digitizes the university's Mentor-Mentee Scheme Form-A: student demographics, MUJ alumni relations, parental occupation details, contact addresses with auto-fill toggles, and profile photo upload. Protected by `RequireOnboarding` route guards and database triggers preventing profile tampering.

### Feature 2 — Query Lifecycle & Resolution Confirmation
Replaces open-ended tickets with a closed-loop governance state machine. Mentors cannot unilaterally close queries; a query marked resolved requires explicit student confirmation. Students can reopen an unsatisfied query up to 3 times before automated escalation to the HOD. Query identifiers are minted atomically from the `public.query_code_seq` sequence (`QRY-FM000000`).

### Feature 3 — Senior Mentorship & Peer Mentoring
Enables senior students and alumni to serve as peer mentors. Junior students select whether to send a query to their Faculty Mentor or their assigned Senior Mentor. Senior mentors resolve peer queries or escalate complex issues directly to the student's faculty mentor with documented reasoning.

### Feature 4 — ERP Academic Monitoring & Automated At-Risk Detection
Every batch upload of ERP attendance, GPAs, backlogs, or black dot notices immediately triggers the `reevaluate_student_risk()` database function. A student is flagged **At-Risk** if **ANY** of the following conditions are met:
- Overall weighted attendance falls below **75%** in the active cycle.
- Latest semester GPA falls below **6.0**.
- Student has **one or more uncleared backlogs**.
- Student receives a **Proctorial Board black dot notice**.

Flagged students generate automated mentor notifications and initiate intervention meeting logs (`at_risk_meetings`).

### Feature 5 — Academic Cycles & Multi-Year Scoping
All academic uploads, attendance logs, backlogs, black dots, and surveys are scoped to an **Academic Cycle** (e.g., 2026–27 Odd/Even semester). Transitioning to a new cycle preserves historical performance and allows student carry-over without overwriting previous records.

### Feature 6 — Pastoral Care & Counselling
Provides a confidential counselling channel separate from technical and academic queries. Students choose from 12 structured counselling categories (Academic, Personal, Career, Placement, Financial, Technical, Health & Wellness, Behavioural, Professional Development, Higher Education, General Guidance, Other). Strict RLS policies restrict access exclusively to the student and their faculty mentor.

### Feature 7 — Bulk Mentee Reassignment & Faculty Reserve Pool
When a faculty member takes leave or departs, HODs can reassign their mentees in bulk. The system calculates live mentor capacities (up to 200 mentees per mentor) and automatically transfers all active, unresolved queries to the incoming mentor within a coordinated transaction.

### Feature 8 — Vector PDF Report Generation
Generates publication-quality, branded reports with zero headless browser dependencies. Built with `pdf-lib`, custom vector charts (bar charts, donuts, gauges, distribution histograms) render in milliseconds with minimal serverless memory usage:
- **Faculty Activity Report**: Comprehensive faculty mentoring metrics and query distribution.
- **Student Mentorship Dossier**: Multi-page complete student academic, query, and Form A summary.
- **Academic Cycle Report**: Cycle-wide departmental attendance, backlog, and performance analysis.

---

## Database Architecture & Row Level Security

The platform schema consists of **34 public tables** and **10 reporting views** managed across **42 sequential SQL migrations** (`supabase/migrations/0001` to `0042`).

### Public Tables Overview

| Domain | Tables |
|---|---|
| **Identity & Profiles** | `user_profiles`, `senior_mentor_sections` |
| **Onboarding & Academics** | `student_form_a_profiles`, `student_semester_gpas`, `student_cgpas`, `student_achievements` |
| **Support Queries** | `support_queries`, `query_messages`, `query_escalations`, `canned_replies` |
| **Pastoral & Meetings** | `counselling_requests`, `at_risk_meetings`, `mom_records` |
| **Academic ERP Data** | `cluster_head_courses`, `student_course_sections`, `academic_upload_batches`, `student_attendance_records`, `student_backlogs`, `student_black_dots`, `student_risk_flags` |
| **Cycles & Surveys** | `academic_cycles`, `academic_cycle_students`, `semester_cycles`, `survey_questions`, `survey_cycles`, `survey_responses`, `survey_response_answers` |
| **System, Admin & Audit** | `audit_log`, `mentor_reassignment_log`, `roster_import_batches`, `api_rate_limits`, `cycle_job_schedule`, `cycle_job_runs`, `notifications` |

### Database Views (`security_invoker = true`)
All 10 reporting views are created with `WITH (security_invoker = true)` in PostgreSQL 15, ensuring the calling user's RLS policies are applied to underlying tables, eliminating data leakage:
- `faculty_performance_summary`
- `student_query_summary`
- `query_daily_trend`
- `faculty_reserve_pool`
- `at_risk_student_overview`
- `academic_upload_history`
- `current_cycle_courses`
- `survey_cycle_summary`
- `survey_group_completion`
- `attendance_period_summary`

### Security Implementation Highlights

- **RLS Policy Design (`ENABLE`, not `FORCE`)**: Row Level Security is enabled on every public table. `ENABLE` applies strict policy checks to client roles (`authenticated`, `anon`), while allowing internal `SECURITY DEFINER` workflow functions (which run as table owner) to create system audit rows and notifications.
- **Privilege Escalation Protection**: The trigger `guard_protected_profile_columns()` blocks self-service modification of sensitive columns (`role`, `assigned_mentor_id`, `is_star_mentee`, `is_senior_mentor`, `employment_status`, `hod_id`, `form_a_completed`).
- **Policy Recursion Elimination**: Migration `0016` eliminated circular subquery recursion on `user_profiles` by introducing the `SECURITY DEFINER` lookup function `my_mentor_id()`.
- **Search Path Pinning**: All `SECURITY DEFINER` functions explicitly set `search_path = public, pg_temp` and revoke execute permissions from `public` and `anon` to prevent search path hijacking.
- **Append-Only Audit Logs**: `audit_log`, `mentor_reassignment_log`, and `query_escalations` expose `SELECT` policies to administrators/HODs, but define zero `INSERT`, `UPDATE`, or `DELETE` client policies. Writes occur exclusively via server-side database functions.
- **Storage Protection**: Buckets (`profile-photos`, `form-a-uploads`, `achievement-proofs`, `roster-imports`) enforce folder ownership matching `auth.uid()`. Files are accessed strictly via authenticated short-lived signed URLs.

---

## Serverless API Reference

The backend provides 9 serverless function routes located in `api/`:

| Route | Method | Access / Guard | Description |
|---|---|---|---|
| `/api/health` | `GET` | Public | System health check and API status. |
| `/api/admin/provision-user-accounts` | `POST` | `admin`, `hod` | Creates individual authenticated user accounts via Supabase Admin Auth API. |
| `/api/admin/import-roster-spreadsheet` | `POST` | `cluster_head`, `admin`, `hod` | Time-budgeted (~22s), resumable bulk roster importer with concurrency pooling (concurrency: 5) for students and mentors. |
| `/api/admin/manage-faculty-roster` | `POST`, `GET` | `admin`, `hod` | Updates faculty status (`active`, `on_leave`, `departed`) and reassigns mentee groups with live capacity checks. |
| `/api/admin/run-cycle-job` | `POST`, `GET` | `admin`, `hod` | Executes scheduled 15-day cycle jobs: at-risk re-evaluations, survey cycle dispatch, and notification reminders. |
| `/api/cluster-head/upload-academic-data` | `POST` | `cluster_head`, `admin`, `hod` | Streams and parses ERP attendance, semester GPAs/CGPAs, backlogs, and black dot notices. |
| `/api/reports/faculty-activity-report` | `GET` | `faculty`, `admin`, `hod` | Returns JSON metrics or generates a branded vector PDF of a mentor's activity. |
| `/api/reports/student-dossier-report` | `GET` | `faculty`, `admin`, `hod` | Generates a multi-page comprehensive PDF dossier for an individual student. |
| `/api/reports/academic-cycle-report` | `GET` | `cluster_head`, `admin`, `hod` | Generates a departmental academic cycle performance and completion PDF. |

---

## Project Structure

```
├── .github/
│   └── workflows/
│       └── ci.yml                   # CI: parallel frontend lint/test/build + Postgres 15 migration runner
├── api/                             # Vercel serverless API (Node 20 ESM)
│   ├── _lib/                        # Shared utilities (auth guards, rate limiting, pdf primitives, parser)
│   ├── admin/                       # Provisioning, roster import, faculty management, cycle jobs
│   ├── cluster-head/                # Academic ERP data upload endpoints
│   ├── reports/                     # Vector PDF report generation endpoints
│   └── health.js                    # Health check endpoint
├── docs/                            # In-depth architectural & security documentation
│   ├── CLUSTER-HEAD-AND-CYCLE-JOBS.md
│   ├── SECURITY.md
│   └── SMP-Master-Documentation.md  # Master technical reference specification (560+ KB)
├── frontend/                        # React 19 SPA
│   ├── src/
│   │   ├── components/              # Layout, UI primitives, modals, charts, query threads
│   │   ├── context/                 # AuthProvider, NotificationProvider, ToastProvider
│   │   ├── hooks/                   # Realtime subscriptions, active cycles, async actions
│   │   ├── lib/                     # API client, Supabase client, formatters, constants
│   │   ├── pages/
│   │   │   ├── admin/               # Administrator portal (mentor-HOD mapping)
│   │   │   ├── auth/                # Login, password reset, temporary password rotation
│   │   │   ├── clusterHead/         # Setup, courses, attendance, GPA, backlogs, black dots, cycles
│   │   │   ├── faculty/             # Query queue, raised queries, mentees, at-risk MoMs, reports
│   │   │   ├── hod/                 # Department dashboard, faculty roster, seniors, operations
│   │   │   └── student/             # Onboarding Form A, photo, queries, academics, counselling, senior views
│   │   └── routes/                  # AppRouter, RouteGuards (Auth, Role, Onboarding, Password)
│   └── test/
│       └── ui-regression.test.jsx   # Automated UI regression tests
├── sample-data/                     # Sample CSV, XLSX, and XLS rosters and ERP test files
├── supabase/
│   ├── migrations/                  # 42 ordered SQL migration files (0001 to 0042)
│   └── scripts/                     # Seed scripts, admin account generator, senior mentor sync, CI stubs
├── package.json                     # Root package configuration
├── vercel.json                      # Vercel deployment configuration, headers, and SPA rewrites
└── SETUP_GUIDE.md                   # Step-by-step local setup and deployment walkthrough
```

---

## Getting Started

### Prerequisites
- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- A free **Supabase** account (or local Supabase CLI)

### Installation & Local Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/niketarora/Student-Mentor-Portal.git
   cd Student-Mentor-Portal
   ```

2. **Install dependencies**:
   ```bash
   npm run install:all
   ```

3. **Configure Environment Variables**:
   Follow [`SETUP_GUIDE.md`](SETUP_GUIDE.md) to populate secrets:
   - Copy `.env.example` to `.env` in the project root.
   - Copy `frontend/.env.example` to `frontend/.env.local`.

4. **Apply Migrations**:
   Execute migrations `0001` through `0042` via the Supabase Dashboard SQL Editor or using the CLI:
   ```bash
   supabase db push
   ```

5. **Seed Demo Data & Admin Accounts**:
   ```bash
   npm run db:seed     # Creates demo students, mentors, HODs, and sample queries
   npm run db:admin    # Generates the System Administrator account
   npm run db:seniors  # Synchronizes senior mentor accounts from list
   ```

6. **Start Development Server**:
   ```bash
   npm run dev         # Launches Vite frontend dev server at http://localhost:5173
   # OR
   vercel dev          # Runs frontend and Vercel serverless API together locally
   ```

### Available Scripts

| Command | Action |
|---|---|
| `npm run dev` | Starts the Vite frontend development server. |
| `npm run build` | Builds the frontend for production. |
| `npm run lint` | Runs `oxlint` across frontend source code. |
| `npm run test` | Runs frontend UI regression tests and spreadsheet parser checks. |
| `npm run db:push` | Deploys SQL migrations using Supabase CLI. |
| `npm run db:seed` | Populates demo users and query test data. |
| `npm run db:admin` | Creates or elevates a user to the `admin` role. |
| `npm run db:seniors`| Synchronizes senior mentors from `supabase/senior-mentors.txt`. |
| `npm run sample:files` | Generates sample attendance, GPA, and backlog spreadsheets for testing. |

---

## License

This project was developed for the **Department of IoT & Intelligent Systems, Manipal University Jaipur**. All rights reserved.
