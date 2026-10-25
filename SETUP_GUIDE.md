# SSMP Platform — Setup Guide

Everything you need to fill in, and exactly how to run it. Follow the steps in order; the whole thing takes about 20 minutes.

---

## Part 1 — The placeholders you have to fill

There are **six values** in total, and they all come from one place: your Supabase project dashboard. Nothing else in the codebase needs editing.

### Where to find them in Supabase

1. Go to [supabase.com](https://supabase.com) → create a free account → **New project**
2. Name it `ssmp-platform`, pick a strong database password (save it somewhere), choose a region near Jaipur (e.g. `ap-south-1 / Mumbai`)
3. Wait ~2 minutes for it to provision
4. Open **Project Settings** (gear icon, bottom left)
   - **Data API** → copy the **Project URL**
   - **API Keys** → copy the **`anon` / `public`** key and the **`service_role`** key (click "Reveal")

### The two files you create

#### File 1 — `.env` in the repo root (server-side secrets)

Copy `.env.example` to `.env`, then fill in:

| Placeholder | Replace with | Where it comes from |
|---|---|---|
| `SUPABASE_URL` | `https://abcdefgh.supabase.co` | Project Settings → Data API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGci...` (very long) | Project Settings → API Keys → `service_role` |
| `SUPABASE_ANON_KEY` | `eyJhbGci...` (very long) | Project Settings → API Keys → `anon` / `public` |
| `ALLOWED_ORIGINS` | `http://localhost:5173,https://your-app.vercel.app` | Your own URLs — update after your first deploy |
| `ALLOWED_EMAIL_DOMAINS` | `jaipur.manipal.edu,muj.manipal.edu` | Your university's email domains. Leave blank to allow any. |
| `SEED_DEFAULT_PASSWORD` | anything strong, e.g. `SsmpDemo@2026` | You choose. Only used by the demo seed script. |

> **The `service_role` key bypasses every security rule in the database.** Never commit it, never paste it into the frontend, never share it in a screenshot. `.gitignore` already excludes `.env`.

#### File 2 — `frontend/.env.local` (browser-safe values)

Copy `frontend/.env.example` to `frontend/.env.local`, then fill in:

| Placeholder | Replace with |
|---|---|
| `VITE_SUPABASE_URL` | the same Project URL as above |
| `VITE_SUPABASE_ANON_KEY` | the same `anon` key as above |
| `VITE_API_BASE_URL` | **leave as exactly `/api`** — see the warning below |
| `VITE_INSTITUTION_NAME` | `Manipal University Jaipur` |
| `VITE_DEPARTMENT_NAME` | `Department of IoT & Intelligent Systems` |

> **`VITE_API_BASE_URL` must be `/api`, not your site URL.** Setting it to a bare domain like `https://your-app.vercel.app` drops the `/api` segment, so every report download and roster import 404s and the browser reports it as an unhelpful "Failed to fetch". The frontend and the API are served from the same domain, so a relative `/api` is all that is needed. (The app now repairs a bare domain automatically, but setting it correctly avoids cross-origin requests entirely.)

The `anon` key is *designed* to be public — it can only do what your Row Level Security policies allow. The `service_role` key is the one that must stay secret.

---

## Part 2 — Set up the database

You have two options. **Option A is easier** and needs no extra tools.

### Option A — Paste the SQL into the Supabase dashboard

1. In Supabase, open **SQL Editor** → **New query**
2. Open each file in `supabase/migrations/` **in numerical order** and run them one at a time:

   ```
   0001_extensions_enums_and_shared_helpers.sql
   0002_user_profiles_table.sql
   0003_student_form_a_onboarding.sql
   0004_support_queries_and_messages.sql
   0005_notifications_and_achievements.sql
   0006_semester_setup_roster_and_audit.sql
   0007_authorization_helper_functions.sql
   0008_row_level_security_policies.sql
   0009_query_workflow_functions.sql
   0010_student_and_mentor_functions.sql
   0011_cross_portal_notification_triggers.sql
   0012_analytics_views.sql
   0013_report_and_dashboard_functions.sql
   0014_realtime_and_storage_buckets.sql
   0015_rate_limiting_and_audit_helpers.sql
   0016_fix_user_profiles_policy_recursion.sql
   0017_form_a_editable_and_star_mentee_group_view.sql
   0018_reopen_limit_and_hod_escalation.sql
   0019_profile_photos_combined_roster_and_department_report.sql
   ```

   Paste the whole file, click **Run**, wait for "Success", move to the next. Order matters — later files reference earlier ones.

3. Turn off public signup: **Authentication → Sign In / Providers → Email** → switch **Allow new users to sign up** to **off**. Accounts are created by the HOD, not self-service.

### Option B — Supabase CLI

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF     # the abcdefgh part of your URL
supabase db push
```

---

## Part 3 — Create the demo accounts

```bash
npm install                 # installs the serverless API dependencies
npm run db:seed             # creates 1 HOD, 3 faculty, 4 students + sample queries
```

The script prints every account it creates. All of them use the password from `SEED_DEFAULT_PASSWORD`:

| Role | Email |
|---|---|
| HOD | `hod.iotis@jaipur.manipal.edu` |
| Faculty | `alice.smith@jaipur.manipal.edu` |
| Faculty | `bob.johnson@jaipur.manipal.edu` |
| Faculty | `carol.williams@jaipur.manipal.edu` |
| Student | `john.doe@muj.manipal.edu` |
| Student | `jane.smith@muj.manipal.edu` |
| Student | `mike.davis@muj.manipal.edu` |
| Student | `emily.wilson@muj.manipal.edu` |

It is safe to run more than once — existing accounts are reused, not duplicated.

**For real use**, skip the demo accounts entirely: sign in as the HOD and use **Semester setup → Import roster** with a CSV or XLSX of your actual faculty and students. The portal creates the accounts and hands you a credentials file to distribute.

---

## Part 4 — Run it locally

```bash
npm install                   # root: serverless API dependencies
npm --prefix frontend install # frontend dependencies
npm run dev                   # → http://localhost:5173
```

`npm run dev` starts the frontend only. The three portals, live query updates, notifications, Form A, GPA, achievements and star mentee all work this way, because they talk to Supabase directly.

**To also run the serverless API locally** (needed for roster import, PDF reports and faculty reassignment):

```bash
npm install -g vercel
vercel dev                    # → http://localhost:3000, serves both frontend and /api
```

Use `vercel dev` when you want the complete system. Use `npm run dev` for faster frontend iteration.

---

## Part 5 — Deploy to Vercel

1. Push the repo to GitHub
2. [vercel.com](https://vercel.com) → **Add New → Project** → import the repo
3. **Do not change the build settings** — `vercel.json` already configures everything
4. Under **Environment Variables**, add all five of these (Production, Preview and Development):

   ```
   SUPABASE_URL                 = https://YOUR-PROJECT-REF.supabase.co
   SUPABASE_SERVICE_ROLE_KEY    = eyJhbGci...
   SUPABASE_ANON_KEY            = eyJhbGci...
   ALLOWED_ORIGINS              = https://your-app.vercel.app
   ALLOWED_EMAIL_DOMAINS        = jaipur.manipal.edu,muj.manipal.edu
   VITE_SUPABASE_URL            = https://YOUR-PROJECT-REF.supabase.co
   VITE_SUPABASE_ANON_KEY       = eyJhbGci...
   VITE_API_BASE_URL            = /api
   ```

   The `VITE_*` ones are needed at build time; the others at runtime.

5. **Deploy**
6. Back in Supabase → **Authentication → URL Configuration**:
   - **Site URL** → `https://your-app.vercel.app`
   - **Redirect URLs** → add `https://your-app.vercel.app/**`

   Password resets will not work until you do this.

7. Redeploy once so the build picks up the final `ALLOWED_ORIGINS`.

---

## Part 6 — Check it works end to end

Sign in as each role in three different browser windows (or one normal + two private):

| # | Do this | You should see |
|---|---|---|
| 1 | Sign in as a **student** for the first time | A full-screen Form A with **no sidebar and no menu** — there is nothing else to click until it is submitted |
| 2 | Submit Form A | Step 2 appears: a **profile photo, which is compulsory**. Still no menu until it is uploaded |
| 2b | Upload the photo | Landed on the student dashboard. Form A is no longer a menu item; it now lives under **My Profile**, editable with no HOD approval |
| 3 | Raise a query | It appears in the **faculty** window within a second, and the faculty bell shows a badge — no refresh |
| 4 | Reply as faculty | The reply appears in the student window instantly; query flips to *In Progress* |
| 5 | Faculty clicks **Mark resolved** | Student gets "Was your issue fixed?" with Yes / No |
| 6 | Student clicks **No** + a comment | Query reopens, faculty is notified and sees the comment |
| 7 | Student clicks **Yes** | Query closes, student can leave a 1–5 star rating |
| 8 | Student → Academics → turn **GPA sharing off** | Faculty's mentee report now says "not shared" instead of the grades |
| 9 | Faculty → My Mentees → click a **star** | That student becomes the representative; starring another replaces them after a confirmation |
| 9b | Check that student's window | Notification explains the role, and a new **Group Queries** menu item appears — a read-only list of the whole mentor group's queries, with no way to open, reply or resolve |
| 10 | Faculty → My Report → **Download PDF** | A branded PDF with KPI cards, bar chart, donut chart, weekly trend and tables |
| 11 | Faculty → a mentee → **Generate report** | Per-student PDF with GPA trend, achievements, query history |
| 12 | HOD → Faculty Roster → mark someone **departed** | Their mentee list opens; reassign to someone from the reserve pool |
| 13 | Check the reassigned student's window | They are notified their mentor changed, and it is already updated on screen |
| 14 | HOD → Faculty Reports, or **PDF** on any row of Faculty Performance | The same analytical report a faculty member gets for themselves, for any faculty member |
| 15 | HOD → Faculty Reports → **All faculty members (consolidated)** | Department-wide charts plus one row per faculty member, on screen and as a single PDF |
| 16 | HOD → Semester Setup → **Both together** + `sample-data/combined-roster-sample.csv` | Faculty and students created from one file, mentors matched from the same upload |
| 17 | Any portal → My Profile → **Upload photo** | The photo replaces the grey silhouette in the sidebar, top bar and every query message |

---

## Troubleshooting: "Failed to fetch"

Everything under `/api` — roster import, both PDF reports, faculty reassignment — goes through the Vercel serverless functions. If those requests fail while the rest of the portal works, it is almost always one of three things, in this order:

1. **`VITE_API_BASE_URL` is not `/api`.** Open DevTools → Network and look at the failing request URL. If it is missing `/api/`, or points at a different `*.vercel.app` domain than the page you are on, this is it. Set it to `/api` and redeploy.
2. **You are running `npm run dev`.** That serves the frontend only; there is no `/api` locally. Use `vercel dev` instead.
3. **The functions did not deploy.** Visit `https://your-app.vercel.app/api/health` directly. A JSON response means they are live; a 404 means Vercel is not picking up the `api/` directory — check that the Root Directory in the project settings is the repo root, not `frontend`.

---

## Troubleshooting

**"Missing VITE_SUPABASE_URL"** — `frontend/.env.local` does not exist or is missing a value. Restart `npm run dev` after creating it; Vite only reads env files at startup.

**Login says "Invalid login credentials"** — the account does not exist yet. Run `npm run db:seed`, or create it from the HOD portal.

**Login works but the page is blank / "No profile found"** — the migrations were not all applied, so the `user_profiles` trigger never ran. Re-run migration `0002`, then delete and recreate the account.

**Realtime updates are not arriving** — check Supabase → **Database → Publications → `supabase_realtime`** lists `support_queries`, `query_messages`, `notifications`, `user_profiles`, `student_achievements`. If not, re-run migration `0014`.

**PDF download does nothing** — the serverless API is not running. Use `vercel dev` locally, or check the environment variables on Vercel in production.

**Roster import fails with "No Email column found"** — your header row needs an `Email` and a `Name` column. Accepted spellings are listed on the import screen itself.

**"... is an invalid header value"** — one of your Supabase keys has a space or line break inside it, usually from the value wrapping when it was pasted. Copy it again from Project Settings → API Keys as a single unbroken line, in both `.env` and the Vercel environment variables. Check with `https://your-app.vercel.app/api/health`, which reports each variable as `ok`, `missing` or `malformed` without ever printing the value.

**Student cannot reject a resolution any more** — working as designed. A student may answer "No" at most **3 times** on one query. After that the mentor gets a **Report to HOD** button on the query, which notifies every HOD with the mentor's note.

---

## What is where

```
ssmp-platform/
├── supabase/migrations/     the entire database: tables, RLS, functions, triggers, views
├── supabase/scripts/        demo seed + CI stubs
├── api/                     Vercel serverless functions (privileged operations only)
│   ├── _lib/                shared: auth guards, validation, PDF engine, spreadsheet parser
│   ├── admin/               account provisioning, roster import, faculty roster
│   └── reports/             Feature 4 and Feature 5 PDF endpoints
├── frontend/src/
│   ├── components/layout/   the SLCM shell — sidebar, top bar, notification bell
│   ├── components/ui/       panels, stat cards, badges, tables, modals, form controls
│   ├── components/charts/   themed Recharts wrappers
│   ├── pages/student/       student portal
│   ├── pages/faculty/       faculty portal
│   └── pages/hod/           HOD portal
├── docs/SECURITY.md         every security control, and the trade-offs taken
├── sample-data/             example roster CSVs
└── design-reference/        original mockups (excluded from the deploy)
```
