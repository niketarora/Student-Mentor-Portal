# Security Model

Every control in the platform, why it is there, and the trade-offs that were taken consciously.

---

## 1. The security boundary is the database, not the UI

The original Express backend enforced authorization in `query.controller.js`:

```js
const isStudentOwner   = query.studentId._id.toString() === req.user._id.toString();
const isAssignedMentor = query.mentorId._id.toString() === req.user._id.toString();
const isHod            = req.user.role === 'hod';
if (!isStudentOwner && !isAssignedMentor && !isHod) return sendError(res, '...', 403);
```

That logic is **preserved exactly**. It moved from Node middleware into Postgres, where it now also covers Realtime subscriptions and any direct PostgREST call — not just the routes the UI happens to use.

`supabase/migrations/0008_row_level_security_policies.sql`:

```sql
create policy queries_select_participants on public.support_queries
  for select to authenticated
  using (
    student_id = auth.uid()      -- isStudentOwner
    or mentor_id = auth.uid()    -- isAssignedMentor
    or public.is_hod()           -- isHod
  );
```

**Row Level Security is enabled on all 12 tables.** Nothing is granted to the `anon` role: an unauthenticated request reads nothing at all.

### Why `ENABLE` and not `FORCE`

`FORCE ROW LEVEL SECURITY` also subjects the table owner to the policies. Every `SECURITY DEFINER` function runs as the owner and legitimately writes rows no client-facing policy allows — system messages on a query, notifications, the query state machine. With `FORCE`, all of those would fail.

`ENABLE` already blocks the only two roles a client can ever authenticate as (`anon` and `authenticated`), which is the entire threat model. This is the standard Supabase pattern and the choice is documented inline in the migration.

---

## 2. Privilege escalation is blocked at the row level

RLS lets a user update their own profile row. Without a guard, they could set `role = 'hod'` on themselves.

`guard_protected_profile_columns()` (migration 0007) is a `BEFORE UPDATE` trigger that rejects any change to:

`role` · `assigned_mentor_id` · `is_star_mentee` · `star_mentee_assigned_by` · `employment_status` · `available_for_reassignment` · `is_active` · `form_a_completed` · `id` · `email`

...unless one of three things is true:

1. `auth.uid()` is null — a trusted server or migration call
2. the caller is the HOD
3. `ssmp.trusted_operation` is set — meaning we are inside one of the audited `SECURITY DEFINER` RPCs that has already done its own authorisation check

That third flag is transaction-local and is always cleared by the function that set it, so it cannot leak into an unrelated statement.

**New accounts always default to `student`.** `handle_new_auth_user()` only honours a different role when it is one of the three known values, and only the service-role provisioning endpoint ever supplies one. Public signup is disabled in `supabase/config.toml`.

---

## 3. State transitions are functions, not raw UPDATEs

Anything with side effects goes through a `SECURITY DEFINER` RPC that re-checks authorisation itself. This makes it impossible to, say, resolve a query without the student being asked to confirm it.

| Function | Guard |
|---|---|
| `create_support_query` | student only, own id, own assigned mentor, ≤20 unresolved queries |
| `post_query_message` | owner, assigned mentor or HOD |
| `resolve_support_query` | assigned mentor or HOD (students cannot resolve their own) |
| `confirm_query_resolution` | **student owner only** — the whole point of Feature 3 |
| `rate_support_query` | student owner, resolved query, once only |
| `submit_student_form_a` | student only, refuses if already locked |
| `unlock_student_form_a` | HOD only |
| `upsert_semester_gpa`, `set_gpa_sharing` | student only, own record |
| `set_achievement_verification` | assigned mentor or HOD (a student cannot self-verify) |
| `set_star_mentee` | assigned mentor or HOD, row-locked so two stars can never coexist |
| `reassign_mentees` | HOD only, target must be `active`, max 500 per call |
| `get_faculty_activity_report` | own data only; HOD may pass another `faculty_id` |
| `get_student_dossier` | assigned mentor, HOD, or the student themselves |

Every one pins `search_path = public, pg_temp` so a malicious schema on the path cannot hijack it, and is revoked from `public` and `anon` before being granted to `authenticated`.

`query_messages` and `notifications` have **no INSERT policy at all** — they can only be written by these functions and by triggers. A client cannot fabricate a notification or post a message that skips the side effects.

---

## 4. Feature 2's GPA toggle is enforced in SQL

A student's GPA sharing preference would be meaningless if it were only a UI condition. It is an RLS predicate:

```sql
create policy gpas_select_permitted on public.student_semester_gpas
  for select to authenticated
  using (public.can_view_student_gpa(student_id));
```

`can_view_student_gpa()` returns true for the student themselves and for the HOD (institutional oversight), and for a faculty mentor **only if** that student has `gpa_sharing_enabled`. Turning the toggle off removes the rows from the mentor's result set entirely — including in the PDF report, which reads the same function.

---

## 5. The service-role key never reaches the browser

Two clients with very different trust levels (`api/_lib/supabase-clients.js`):

- `createAdminClient()` — service-role key, bypasses RLS. Constructed only inside a serverless function.
- `createUserClient(token)` — the caller's own access token. RLS applies, so a bug in the API layer still cannot leak another user's rows.

The read paths in `manage-faculty-roster.js` deliberately use the *user* client even though the caller is the HOD and would pass the policy anyway — defence in depth.

Only five operations use the admin client, and all of them genuinely require it: creating auth accounts, roster import, moving queries during reassignment, writing audit entries, and consuming rate-limit counters.

---

## 6. Input validation happens twice

**At the API edge** — Zod schemas in `api/_lib/input-validation.js` for every request body, including an optional institutional-email-domain allow-list. Failures return a readable 400, never a raw Postgres error.

**In the database** — the schema does not trust the application:

- Real Postgres `enum` types for role, status, category, priority, occupation, achievement category — an invalid value is rejected by the database itself
- `CHECK` constraints for 10-digit mobiles, 6-digit pin codes, email shape, GPA 0–10, rating 1–5, plausible dates of birth, text length caps
- `CHECK (role = 'student' or (assigned_mentor_id is null and ...))` — non-students cannot carry student-only fields
- `CHECK (student_id <> mentor_id)` and `CHECK (assigned_mentor_id <> id)` — nobody mentors themselves
- `UNIQUE (student_id, semester_number)` — one GPA per semester

### Spreadsheet parsing

SheetJS (`xlsx`) 0.18.5 carried prototype-pollution and ReDoS advisories. It was replaced with **ExcelJS**, and `api/_lib/spreadsheet-parser.js` builds every parsed row on `Object.create(null)`, so a `__proto__` column header cannot poison anything. Row limit 5000, file limit 10 MB, `.xlsx` and `.csv` only.

The import endpoint also supports a **dry run**, so the HOD can validate a roster before any account is created.

---

## 7. Files are private by default

Three Storage buckets, all private, all with a MIME allow-list and a 5 MB cap:

| Bucket | Contents | Who can read |
|---|---|---|
| `form-a-uploads` | parent business card, student signature | the student, their mentor, the HOD |
| `achievement-proofs` | certificates and photos | the student, their mentor, the HOD |
| `roster-imports` | uploaded spreadsheets | HOD only |

Every object path begins with the owner's user id, and the storage policies key off exactly that:

```sql
create policy form_a_uploads_select_scope on storage.objects
  for select to authenticated
  using (
    bucket_id = 'form-a-uploads'
    and public.can_access_student(((storage.foldername(name))[1])::uuid)
  );
```

Files are only ever served through short-lived signed URLs (5 minutes), never public links, because Form A uploads contain personal data. Client-side filenames are sanitised before upload, so a crafted name cannot traverse paths.

---

## 8. Rate limiting that actually works in serverless

An in-memory counter rate-limits nothing when your functions are stateless and horizontally scaled. Counting happens in Postgres instead (`consume_rate_limit`), giving one shared view across every warm instance:

| Endpoint | Limit |
|---|---|
| Account provisioning | 20 / minute |
| Roster import | 10 / 5 minutes |
| Faculty roster writes | 60 / minute |
| Report generation | 30 / minute |
| Sign-in | 30 / hour (Supabase Auth) |

The limiter **fails open** — if the counter itself errors, a legitimate request is not blocked, and the error is logged.

Application-level abuse guards sit alongside: max 20 unresolved queries per student, max 500 students per reassignment, 5000 rows per import.

---

## 9. Audit trail

`audit_log` is append-only. There is **no UPDATE or DELETE policy for any client role, including the HOD** — the only SELECT policy is HOD-read. Entries are written exclusively by `write_audit_entry()`, which is granted to `service_role` alone.

Recorded: account provisioning, roster imports (with per-row failures), faculty status changes, mentee reassignments, and every PDF report generated — each with actor, role, IP and user agent.

`mentor_reassignment_log` separately preserves every mentor change permanently, and students can read their own history.

---

## 10. Transport, headers and secrets

- HSTS with `preload`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy` on every response (`vercel.json` and `api/_lib/http-response.js`)
- `Cache-Control: no-store` on all API responses
- CORS allow-list from `ALLOWED_ORIGINS`; localhost is accepted only outside production
- **No secret has a fallback value.** `api/_lib/environment.js` throws at first use with a message naming the missing variable — the exact failure mode flagged in the Phase 1 review, where `|| 'ssmp_jwt_secret_key'` would have silently shipped a known JWT secret
- Server errors never leak a stack trace; the detail goes to the log and the client gets a generic message
- `.gitignore` excludes every `.env` variant except the examples

---

## 11. Passwords and accounts

- No public signup. Accounts exist only because the HOD created them.
- Temporary passwords are 14 characters, generated with mixed character classes, shown exactly once in a downloadable CSV.
- `must_change_password` forces a new password on first sign-in — enforced in the routing layer, so it cannot be skipped by typing a URL.
- The password screen requires 10+ characters with upper, lower, digit and symbol.
- Supabase Auth handles hashing (bcrypt), refresh-token rotation and reuse detection.
- Deactivating an account (`is_active = false`) blocks sign-in and every query-creating RPC.

---

## 12. Known trade-offs

### Session storage is not HttpOnly

**The trade-off.** The old backend kept its JWT in an HttpOnly cookie, unreadable by JavaScript. A static SPA talking directly to Supabase cannot do that — the access token has to be readable by JS to be attached to PostgREST and Realtime requests. Cookie-backed storage (`@supabase/ssr`) requires a server rendering the page, which a static Vercel deploy does not have.

**Why it is acceptable here.**

1. Access tokens live 1 hour and refresh tokens rotate, with reuse detection.
2. RLS means a stolen token is confined to exactly what that one user could already see — there is no admin token to steal, and no endpoint that returns more than the policy allows.
3. The service-role key, the only thing that bypasses RLS, is never in the browser.
4. The XSS surface is deliberately small: no `dangerouslySetInnerHTML` anywhere in the codebase, no `eval`, no user-controlled HTML rendering, and strict security headers.

**If this is not acceptable for your threat model**, the alternative is to route every request through the Vercel API with the session in an HttpOnly cookie — which also means giving up Realtime and polling instead.

### CORS permits requests with no `Origin` header

Non-browser clients (curl, mobile WebViews) send no `Origin`. Blocking them would break legitimate integrations, and CORS is a browser policy rather than a server boundary in any case — a valid JWT is still required, and RLS still applies. Documented inline in `api/_lib/http-response.js` rather than left silent.

### The HOD can read GPA even when sharing is off

Deliberate. The student toggle governs *faculty* visibility; the HOD retains institutional oversight for academic review. The UI states this plainly on the toggle so the student is not misled about what "off" means.

---

## 13. Automated checks

`.github/workflows/ci.yml` runs on every push and pull request:

1. Lint and build the frontend
2. `node --check` every serverless function
3. Apply all 15 migrations in order to a throwaway Postgres 15 container (with `supabase/scripts/ci-supabase-stubs.sql` standing in for the Supabase-managed schemas), failing on the first SQL error
4. **Assert that no table in the `public` schema is missing RLS** — a new table shipped without a policy fails the build

---

## Reporting a vulnerability

Contact the department administrator. Please do not open a public issue.
