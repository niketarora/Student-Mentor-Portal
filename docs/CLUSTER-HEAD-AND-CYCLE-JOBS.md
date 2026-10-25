# Cluster Head, at-risk students, and the 15-day cycle jobs

Everything added in migrations `0020`–`0024`. Read §10 (Invariants) of the
engineering context first if you are changing any of it.

---

## 1. The Cluster Head role

A Cluster Head uploads two kinds of data and has access to nothing else —
no queries, no student profiles, no reports.

| What | Where |
|---|---|
| One-time setup form (course name, course code, sections 1–15) | `/cluster-head/setup`, `submit_cluster_head_setup()` |
| Attendance upload | `/cluster-head/attendance`, `record_attendance_batch()` |
| GPA upload | `/cluster-head/gpa`, `record_gpa_batch()` |
| Backlog upload | `/cluster-head/backlogs`, `record_backlog_batch()` |

The setup form shows **5 subject blocks by default** with an "Add another
subject" button. Blank blocks are ignored, so a Cluster Head who handles
three subjects does not have to delete two.

The **Section dropdown is derived** from what they entered: a course saved
with 3 sections offers A, B and C.

The **first attendance upload for a (course, section) pair is what
establishes the student→section mapping**. There is no separate data-entry
step for it, by design.

### What a Cluster Head can read

No RLS policy grants them access to `user_profiles`, `support_queries`,
`student_form_a_profiles` or `student_risk_flags`. Matching an uploaded row
to a student happens inside `resolve_students_for_upload()`, a SECURITY
DEFINER function returning a four-column projection — the same technique
`get_mentor_group_queries()` uses for the star mentee.

### Upload timing is deliberately unconstrained

**There is no date gate anywhere.** A Cluster Head may upload on the 3rd,
the 15th, the 27th, twice in one afternoon, or six weeks late. The
`period_start` / `period_end` fields on the attendance screen describe
*which fortnight the numbers cover*; they do not restrict *when* the upload
may happen.

An upload's only knock-on effect is that the students in that file get
their risk flags re-evaluated immediately. It never touches the 15-day job
schedule.

---

## 2. The at-risk rule

A student is flagged when **ANY ONE** of these holds:

- overall attendance below **75%**
- latest GPA below **6**
- **at least one** uncleared backlog

Each condition only fires when the underlying data exists, so a newly
enrolled student with no records is not flagged by default.

> The feature request said *"all three of these are true at once or any of
> the one"*, which is self-contradictory. ANY was chosen: a student at 30%
> attendance should not go unnoticed because their GPA held up.

Overall attendance is `sum(classes_attended) / sum(classes_held)` across
every course and period — weighted, so a 4-lecture elective does not
outweigh a 40-lecture core subject.

A GPA uploaded by a Cluster Head is marked `source = 'cluster_head'` and a
student can no longer edit it, so they cannot edit away their own flag.

### What happens on flagging

1. `student_risk_flags` is rewritten with the reasons and the numbers.
2. A row is inserted into `at_risk_meetings` with **the student's mentor as
   `mentor_id` (the owner/organiser)** — not the cluster head, not the HOD.
3. The mentor is notified, **whether or not a join link exists**.
4. Parent contact appears on `/faculty/at-risk` alongside attendance, GPA
   and backlog count. Clicking the student's name opens their existing
   full profile page.

### The one intentionally unfinished step

`create_at_risk_meeting_link(meeting_id)` is a **placeholder**. Teams vs
Google Meet has not been decided, so it returns the meeting unchanged and
the row stays in `awaiting_link` with `meeting_join_url = null`.

Nothing else reads `meeting_join_url` to decide whether to act. To finish
it, set `meeting_provider`, `meeting_join_url`, `meeting_external_id`,
`scheduled_for` and `status = 'scheduled'` inside that one function. Both
states are already handled everywhere else.

---

## 3. The 15-day survey

Separate from the at-risk workflow. Goes to **every** student.

One **department-wide window** is open at a time (cycle 7 = Aug 1–15 for
everybody). A per-student rolling window would make "how many have filled
it in" unanswerable, since everyone would be at a different point.

- Student fills it at `/student/survey` — 10 questions, 5-point scale.
- Star mentee tracks their group at `/student/survey-tracking` — names and
  a yes/no, never anyone's answers.
- Mentor sees a **Survey column** and a completion StatCard on My Mentees.

---

## 4. Firing the cycle jobs on demand

Four jobs normally run on a schedule:

| Job | Default interval | What it does |
|---|---|---|
| `at_risk_sweep` | 15 days | Re-evaluates every student against the rule |
| `at_risk_meeting_dispatch` | 15 days | Raises mentor-owned meetings + notifies |
| `survey_cycle` | 15 days | Opens the next survey window, notifies everyone |
| `survey_reminder_sweep` | 7 days | Nudges only those who have not answered |

### Two properties that matter

1. **A manual run does the real work but does NOT advance
   `next_run_due_on`.** Run the survey job ten times this afternoon and the
   15-day rhythm is exactly where it was.
2. **None of it is coupled to Cluster Head uploads.** Nothing in the upload
   path reads or writes `cycle_job_schedule`.

Both are asserted by the verification suite.

### Option A — the HOD portal (easiest)

Sign in as the HOD → **Scheduled Jobs** in the sidebar. Each job has a
**Run now** button, plus **Run all now** which runs the sweep, then the
dispatch, then opens a survey cycle — in that order, so the meetings act on
fresh data. Every run is logged underneath with what it changed.

### Option B — SQL

```sql
select public.run_cycle_job('at_risk_sweep');
select public.run_cycle_job('at_risk_meeting_dispatch');
select public.run_cycle_job('survey_cycle');
select public.run_cycle_job('survey_reminder_sweep');

-- all three main jobs in dependency order
select public.run_all_cycle_jobs_now();

-- re-check one student after fixing their data
select public.evaluate_student_risk('<student-uuid>');

-- what a real cron would call (this one DOES advance the schedule)
select public.run_due_cycle_jobs();
```

`run_cycle_job` defaults to `'manual'`. Pass `'scheduled'` explicitly to
also move the clock:

```sql
select public.run_cycle_job('survey_cycle', 'scheduled', 'nightly cron');
```

### Option C — HTTP

```bash
# status of every job
curl -H "Authorization: Bearer $HOD_TOKEN" https://<app>/api/admin/run-cycle-job

# fire one
curl -X POST https://<app>/api/admin/run-cycle-job \
  -H "Authorization: Bearer $HOD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"job_type":"survey_cycle","trigger_source":"manual"}'
```

### Wiring up a real schedule later

Nothing calls `run_due_cycle_jobs()` today — the scheduled path is written
and reviewable but not connected. To connect it, add a Vercel Cron (or
pg_cron) that hits `/api/admin/run-cycle-job` with
`trigger_source: "scheduled"`, or calls `run_due_cycle_jobs()` directly.

---

## 5. Sample data

All of it lives in **one file**: `sample-data/cluster-head-sample-data.mjs`.

```bash
npm run db:seed        # loads it through the real upload RPCs
npm run sample:files   # writes upload-ready CSVs to sample-data/generated/
```

Each demo student trips a **different** condition, so every branch of the
rule is visible at once:

| Student | Reg no | Condition | Flagged? |
|---|---|---|---|
| John Doe | 2428020221 | attendance 59.65% | yes |
| Jane Smith | 2428020222 | GPA 5.40 | yes |
| Mike Davis | 2428020223 | one uncleared backlog | yes |
| Emily Wilson | 2428020224 | 90%, GPA 8.2, one *cleared* backlog | **no** |

---

## 6. Session length

Users were being signed out too often. The fix is **not** `jwt_expiry` —
that is the life of one access token, which the client silently rotates.
What ends a session is the refresh token expiring.

`supabase/config.toml` now sets `[auth.sessions] inactivity_timeout =
"720h"` (30 days) and keeps access tokens at 1 hour. On a **hosted
project this must also be set in the dashboard** under
Authentication → Sessions; the config file only covers local development.
