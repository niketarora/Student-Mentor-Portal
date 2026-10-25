# SMP — Student Mentorship Portal

**Academic Nexus** · Department of IoT & Intelligent Systems · Manipal University Jaipur

A role-based support and mentorship platform connecting **students**, **faculty mentors** and the **Head of Department**. Students raise queries, faculty resolve them, the HOD oversees the whole department — and every action taken in one portal shows up in the others in real time.

> **New in this version:** the backend has been migrated from Node/Express + MongoDB to **Supabase** (Postgres, Auth, Storage, Realtime, Row Level Security). Every feature was preserved and eight new ones were added.

---

## Architecture

```
                          ┌──────────────────────────────┐
   Student portal ───┐    │  Supabase                    │
   Faculty portal ───┼───►│  • Postgres + RLS            │
   HOD portal    ───┘    │  • Auth (email + password)    │
        React 19          │  • Storage (private buckets) │
        Vite + Tailwind   │  • Realtime (RLS-aware)      │
             │            └──────────────────────────────┘
             │                        ▲
             │  privileged operations │ service_role
             └───► Vercel Serverless ─┘
                   • account provisioning
                   • roster import (CSV / XLSX)
                   • faculty roster + reassignment
                   • PDF report generation
```

**Why this split.** Ordinary reads and writes go straight from the browser to Postgres, with Row Level Security as the security boundary — which means the same rules also cover Realtime subscriptions and any direct API call, not just the paths the UI happens to use. Only the handful of operations that genuinely need elevated rights (creating auth accounts, bulk reassignment, PDF generation) run in serverless functions, where the `service_role` key never touches the browser.

| Layer | Technology |
|---|---|
| Database | Supabase Postgres 15, 12 tables, 15 migrations |
| Authorization | Row Level Security on every table + `SECURITY DEFINER` RPCs |
| Auth | Supabase Auth, email + password, PKCE, no public signup |
| Realtime | Supabase Realtime (Postgres logical replication, RLS-filtered) |
| Files | Supabase Storage, three private buckets, signed URLs only |
| API | Vercel serverless functions (Node 20, ESM) |
| Frontend | React 19, Vite 6, Tailwind CSS 3, React Router 7, Recharts |
| PDF | `pdf-lib` with hand-drawn vector charts (no headless browser) |
| Hosting | Vercel — static frontend + serverless API on one domain |

---

## Roles

| Role | What they can do |
|---|---|
| **Student** | Submit Form A once, raise and track queries, chat with their mentor, confirm or reject a resolution, rate the support, record semester GPA and control who sees it, maintain a list of achievements |
| **Faculty Mentor** | Work their query queue with canned replies, resolve queries, see their mentee group, mark one student as representative, verify achievements, generate an analytical report on their own activity and on any individual mentee |
| **HOD** | Department-wide dashboard, faculty performance leaderboard, semester initialisation with roster import, faculty roster with departure and bulk reassignment, oversight of every query and student, unlock a submitted Form A |

---

## How the three portals stay connected

Every cross-role event is turned into a notification by a database trigger, so it fires regardless of whether the action came from the web app, the admin API or a direct RPC call. Supabase Realtime then pushes it to whoever is allowed to see it.

| Something happens | Who finds out, instantly |
|---|---|
| Student raises a query | Assigned faculty — bell badge + live row in their queue |
| Either party sends a message | The other party, in the open thread and the bell |
| Faculty marks a query resolved | Student gets the "Was your issue fixed?" prompt |
| Student answers **No** | Query reopens, faculty sees the student's comment |
| Student answers **Yes** | Query closes, faculty is notified, rating unlocks |
| Student rates a query | Faculty's rating average and dashboard update |
| HOD reassigns a mentor | The student, the old mentor and the new mentor are all notified; open queries move too |
| Faculty stars a mentee | That student is told they are now the representative |
| Faculty verifies an achievement | Student sees the verified badge appear |
| HOD unlocks a Form A | Student is redirected to it on their next visit |

---

## Features

### Carried over from the original platform
Querying across Academic / ERP-Tech / Infrastructure, threaded mentor conversations, role-scoped dashboards, HOD semester initialisation with spreadsheet upload, faculty performance comparison, satisfaction ratings, status badges, quick-filter pills, canned replies, skeleton loaders, empty states, and full mobile responsiveness.

### Feature 1 — One-time student onboarding (Form A)
The Mentor-Mentee Scheme Form-A, digitised field for field: student details, MUJ alumni in family, both parents with the occupation radio group, communication and permanent addresses with a "same as above" checkbox, and optional business-card and signature uploads. Enforced as a route gate — a student cannot reach any other page until it is submitted. Locked read-only afterwards; only the HOD can reopen it.

### Feature 2 — Semester-wise GPA with a sharing toggle
Students record GPA for semesters 1–8 and see their own trend chart. A toggle controls *visibility*, not permission: entry is always available, but when sharing is off, faculty reports show "not shared" instead of the numbers. The rule is enforced by an RLS policy (`can_view_student_gpa`), so it holds even against a direct API call.

### Feature 3 — Resolution confirmation
Faculty no longer have the final word on their own work. Marking a query resolved moves it to *awaiting confirmation*; the student answers Yes (closed) or No (reopened, with a comment the mentor sees). Reopen counts feed both reports.

### Feature 4 — Faculty activity report
An analytical report of a mentor's own work: eight KPI cards, queries-by-category bar chart, student-confirmation donut, weekly raised-vs-resolved comparison, satisfaction histogram, resolution-rate and onboarding gauges, plus category and mentee tables. Downloadable as a branded PDF built from the same numbers the screen shows. Faculty see only their own data; the HOD can view anyone's.

### Feature 5 — Per-student mentorship report
A report *about one student*, generated by their mentor: Form A summary, GPA trend (when shared), achievements by category, full query history and the confirmation record — as an on-screen dashboard and a multi-page PDF. No parent-communication section; parents are out of scope.

### Feature 6 — Non-academic achievements
Students maintain sports, cultural, technical, volunteering, certification and leadership entries with optional proof files. Mentors can verify an entry, which adds a badge and locks it from further edits. Feeds Feature 5's report.

### Feature 7 — Star mentee
Each mentor flags one student as their group representative. Exactly one per mentor is guaranteed at the database level — the unset-then-set runs inside a single row-locked function, so the table can never be observed with two.

### Feature 8 — HOD faculty reassignment
Mark a faculty member as *on leave* or *departed*, see their full mentee list, then bulk-reassign to faculty from the reserve pool — which shows live capacity, not just names. Unresolved queries move with the students so no conversation is orphaned. Every move is notified and written to the audit log.

---

## Security

Full detail in [`docs/SECURITY.md`](docs/SECURITY.md). In short:

- **Row Level Security on every table.** The original Express guards (`isStudentOwner` / `isAssignedMentor` / `isHod`) were preserved exactly, and moved into Postgres policies and `SECURITY DEFINER` functions, where they also cover Realtime and any direct API call.
- **No privilege escalation.** A trigger blocks any attempt to change your own role, mentor, star flag, employment status or onboarding state. New auth users always default to `student`.
- **The `service_role` key never reaches the browser.** It exists only in Vercel serverless functions.
- **Every state transition is a function, not a raw UPDATE**, so authorisation checks and side effects can never be skipped.
- **All input validated twice** — Zod at the API edge, CHECK constraints and enums in Postgres.
- **Private storage buckets**, path-scoped by user id, served through short-lived signed URLs.
- **Durable rate limiting** in Postgres, shared across serverless instances.
- **Append-only audit log** with no UPDATE or DELETE policy for anyone, including the HOD.
- **No public signup**, forced password change on first login, security headers and HSTS on every response.

---

## Getting started

See **[`SETUP_GUIDE.md`](SETUP_GUIDE.md)** for the placeholders to fill and step-by-step instructions.

```bash
npm install                    # serverless API dependencies
npm --prefix frontend install  # frontend dependencies
npm run db:seed                # demo accounts (after applying migrations)
npm run dev                    # → http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Frontend dev server |
| `vercel dev` | Frontend **and** the serverless API together |
| `npm run build` | Production build |
| `npm run lint` | Lint the frontend |
| `npm run db:push` | Apply migrations via the Supabase CLI |
| `npm run db:seed` | Create the demo accounts and sample queries |

---

## Decisions worth knowing about

These were made deliberately rather than by default, and are documented in full in `docs/SECURITY.md`.

**Session storage.** The old backend kept its JWT in an HttpOnly cookie. A static SPA talking directly to Supabase cannot: the token must be readable by JS to be attached to PostgREST and Realtime calls. Mitigated by 1-hour tokens with rotation, RLS confining a stolen token to what that user could already see, strict security headers, and zero use of `dangerouslySetInnerHTML`.

**`ENABLE` rather than `FORCE` row level security.** `FORCE` would subject the table owner to the same policies, and every `SECURITY DEFINER` function legitimately writes rows no client-facing policy allows (system messages, notifications, query state changes). `ENABLE` already blocks the only roles a client can authenticate as.

**`pdf-lib` with hand-drawn charts** rather than a headless browser. Puppeteer does not fit inside Vercel's serverless bundle limits; the charts are drawn as vectors, so PDFs stay under 15 KB and print crisply.

**`ExcelJS`, not SheetJS.** SheetJS 0.18.5 carried prototype-pollution and ReDoS advisories. The parser also builds every row on a null-prototype object, so a `__proto__` column header cannot poison anything.

**Query codes come from a sequence**, not `count(*)`. Counting races under concurrency and can mint duplicate codes.

---

## Project layout

```
supabase/migrations/    15 SQL files — schema, RLS, functions, triggers, views
supabase/scripts/       demo seeding + CI database stubs
api/                    Vercel serverless functions (6 endpoints)
frontend/src/           React app — shared shell, three portals
docs/SECURITY.md        security model and trade-offs
sample-data/            example roster spreadsheets
design-reference/       original UI mockups, excluded from the deploy
```
