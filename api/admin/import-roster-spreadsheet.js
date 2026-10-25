/**
 * POST /api/admin/import-roster-spreadsheet
 * Cluster Head or HOD. Parses an uploaded faculty or student roster
 * (.csv / .xlsx / the ERP's HTML .xls),
 * creates Supabase Auth accounts, links students to their mentor and
 * records the batch (successes and per-row failures) for the audit trail.
 *
 * Body: {
 *   import_type: 'faculty' | 'student',
 *   filename: string,
 *   file_base64: string,
 *   semester_cycle_id?: uuid,
 *   default_mentor_id?: uuid,      // fallback when a row has no Mentor Email
 *   create_accounts?: boolean,     // false = dry run / validation only
 *   offset?: number,               // first row of this chunk (see below)
 *   batch_id?: uuid                // the history row chunk 0 created
 * }
 *
 * CHUNKING
 * ---------------------------------------------------------------------
 * Every account is a round trip to Supabase Auth, and the function is
 * capped at 30 seconds (vercel.json), so a 2,700-row roster cannot be
 * done in one request — it used to run out of time partway and leave a
 * few hundred accounts behind with nothing to say which.
 *
 * So a request works through the file until its time is nearly up and
 * returns the row it stopped at; the browser posts the same file back
 * with that offset until there is nothing left. The stopping point is
 * decided by the clock rather than a row count, so it adapts to however
 * fast Auth is answering instead of guessing at a safe batch size.
 *
 * Nothing is kept between requests: existing accounts are re-read at the
 * top of each one, so a chunk sees everything its predecessors created,
 * and re-running a finished import simply reports every row as "already
 * existed".
 *
 * ACADEMIC CYCLES (migration 0036)
 * ---------------------------------------------------------------------
 * A roster is imported into the active cycle. New accounts join it on
 * their own (a trigger on user_profiles). A student who already has an
 * account is not created again, but is ACTIVATED: they join the cycle,
 * and the Semester, Section and Program in the file become their current
 * ones (a blank cell changes nothing; guardian details only fill gaps).
 * That is what lets next year's roster move everyone into 2027-28
 * without touching what 2026-27 recorded about them.
 *
 * Within a request the rows are created a few at a time rather than one
 * after another, because almost all of the elapsed time is spent waiting
 * on Auth rather than doing anything. Deciding what to do with a row
 * stays strictly in order — that is what notices the same address twice
 * in one file — and only the account creation itself is overlapped.
 */
import { withApiDefaults, sendSuccess, ApiError } from '../_lib/http-response.js';
import { requireAuthenticatedUser, requireRole, enforceRateLimit, recordAuditEntry } from '../_lib/request-guards.js';
import { parseOrThrow, rosterImportSchema, emailSchema, assertBodySize, sanitizeSingleLine } from '../_lib/input-validation.js';
import { env } from '../_lib/environment.js';
import { parseRosterFile, classifyRole } from '../_lib/spreadsheet-parser.js';
import { runPool } from '../_lib/concurrency.js';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

/**
 * Every account already in use, by lower-cased email, read in pages.
 *
 * A plain select of the whole table can come back capped (PostgREST's
 * db-max-rows, 1000 on many projects) without saying so. That was
 * harmless while the import was one request; now that a later chunk
 * relies on seeing what the earlier ones created, a short read would make
 * it re-attempt hundreds of accounts that already exist. The id and role
 * are what activating an existing student needs. Ordered by id so the
 * pages cannot overlap.
 */
async function fetchExistingAccounts(admin) {
  const page = 1000;
  const accounts = new Map();
  for (let from = 0; ; from += page) {
    const { data, error } = await admin
      .from('user_profiles')
      .select('id, email, role')
      .order('id')
      .range(from, from + page - 1);
    if (error || !data?.length) break;
    for (const row of data) accounts.set(row.email.toLowerCase(), { id: row.id, role: row.role });
    if (data.length < page) break;
  }
  return accounts;
}

export default withApiDefaults(['POST'], async (req, res) => {
  assertBodySize(req);

  const context = await requireAuthenticatedUser(req);
  // Roster upload lives on the cluster head's screens, which every HOD
  // has too since migration 0039; the administrator has everything a
  // HOD has.
  requireRole(context, 'cluster_head', 'hod', 'admin');
  // Faculty a HOD introduces report to that HOD (hod_id), so they are not
  // invisible to the person who just added them.
  const uploadingHod = context.profile.role === 'hod' ? context.profile : null;
  // One upload is now many requests, so the old ceiling of 10 would stop
  // a single large roster halfway through.
  await enforceRateLimit(context, { key: 'roster-import', max: 200, windowSeconds: 300 });

  const body = parseOrThrow(rosterImportSchema, req.body ?? {});
  const { admin } = context;

  let buffer;
  try {
    buffer = Buffer.from(body.file_base64, 'base64');
  } catch {
    throw new ApiError('The uploaded file could not be decoded.', 400);
  }
  if (!buffer.length) throw new ApiError('The uploaded file is empty.', 400);
  if (buffer.length > 10 * 1024 * 1024) throw new ApiError('The file is larger than 10 MB.', 413);

  const records = await parseRosterFile(buffer, body.filename);

  /**
   * A combined file holds both faculty and students, told apart by a Role
   * column. Faculty are processed FIRST so that a student's "Mentor Email"
   * can resolve against a colleague created moments earlier in the same
   * upload — otherwise the order of rows in the spreadsheet would silently
   * decide whether mentors got assigned.
   */
  const isCombined = body.import_type === 'combined';
  let orderedRecords = records;

  if (isCombined) {
    const unclassified = [];
    for (const record of records) {
      record.resolvedRole = classifyRole(record.role);
      if (!record.resolvedRole) unclassified.push(record.rowNumber);
    }
    if (unclassified.length) {
      throw new ApiError(
        `A combined import needs a "Role" column saying Faculty or Student on every row. ` +
          `${unclassified.length} row(s) are missing or unrecognised, starting at row ${unclassified[0]}.`,
        400
      );
    }
    orderedRecords = [
      ...records.filter((r) => r.resolvedRole === 'faculty'),
      ...records.filter((r) => r.resolvedRole === 'student')
    ];
  }

  // Pre-load faculty so we can resolve "Mentor Email" without N queries.
  const { data: facultyRows } = await admin
    .from('user_profiles')
    .select('id, email, full_name, employment_status')
    .eq('role', 'faculty');
  const facultyByEmail = new Map((facultyRows ?? []).map((f) => [f.email.toLowerCase(), f]));

  const existingAccounts = await fetchExistingAccounts(admin);
  const existingEmails = new Set(existingAccounts.keys());

  const created = [];
  const skipped = [];
  const failed = [];
  // Students in the file who already have an account: activated in the
  // active cycle once the chunk's new accounts are done.
  const activate = [];

  // Leaves room inside the 30s cap for the parse, the two lookups above
  // and writing the history row below.
  const TIME_BUDGET_MS = 20_000;
  // Five at a time: enough to hide the network, low enough that Auth does
  // not start refusing. The wave is what the clock is checked between, so
  // it also bounds how far past the budget a request can run.
  const POOL_SIZE = 5;
  const WAVE_SIZE = 25;
  const startedAt = Date.now();
  const startOffset = Math.min(body.offset, orderedRecords.length);
  let nextOffset = null;

  /**
   * Deciding what to do with a row is cheap and has to stay in order —
   * it is what catches the same address appearing twice in one file.
   * Creating the account is a round trip and is what everything waits
   * for. So the two are separated: plan a wave of rows in sequence, then
   * create them a few at a time.
   */
  const roleOf = (record) => (isCombined ? record.resolvedRole : body.import_type);

  const planRow = (record, rowRole) => {
    try {
      const emailResult = emailSchema.safeParse(record.email ?? '');
      if (!emailResult.success) {
        failed.push({ row: record.rowNumber, email: record.email ?? '', reason: emailResult.error.issues[0].message });
        return null;
      }
      const email = emailResult.data;

      if (!record.full_name || record.full_name.length < 2) {
        failed.push({ row: record.rowNumber, email, reason: 'Missing or too-short Name' });
        return null;
      }
      if (existingEmails.has(email)) {
        const existing = existingAccounts.get(email);
        if (rowRole === 'student' && existing?.role === 'student') {
          skipped.push({ row: record.rowNumber, email, reason: 'Already has an account — activated in this cycle' });
          activate.push({
            row: record.rowNumber,
            email,
            student_id: existing.id,
            semester_label: record.semester_label ? sanitizeSingleLine(record.semester_label, 40) : null,
            section: record.section ? sanitizeSingleLine(record.section, 10) : null,
            branch: record.branch ? sanitizeSingleLine(record.branch, 60) : null,
            parent_name: record.parent_name ? sanitizeSingleLine(record.parent_name, 120) : null,
            parent_mobile: /^[0-9]{10}$/.test(record.parent_mobile ?? '') ? record.parent_mobile : null,
            parent_email: record.parent_email ? sanitizeSingleLine(record.parent_email, 255).toLowerCase() : null
          });
        } else {
          skipped.push({ row: record.rowNumber, email, reason: 'Account already exists' });
        }
        return null;
      }

      let mentorId = null;
      if (rowRole === 'student') {
        if (record.mentor_email) {
          const mentor = facultyByEmail.get(record.mentor_email.toLowerCase());
          if (!mentor) {
            failed.push({ row: record.rowNumber, email, reason: `Mentor "${record.mentor_email}" is not a registered faculty member. Import the faculty roster first.` });
            return null;
          }
          if (mentor.employment_status !== 'active') {
            failed.push({ row: record.rowNumber, email, reason: `Mentor "${record.mentor_email}" is marked ${mentor.employment_status}` });
            return null;
          }
          mentorId = mentor.id;
        } else if (body.default_mentor_id) {
          mentorId = body.default_mentor_id;
        }
      }

      if (!body.create_accounts) {
        created.push({ row: record.rowNumber, email, full_name: record.full_name, role: rowRole, dry_run: true });
        existingEmails.add(email);
        // In a dry run a faculty row is not really created, but a later
        // student row should still be able to point at it.
        if (isCombined && rowRole === 'faculty' && !facultyByEmail.has(email)) {
          facultyByEmail.set(email, { id: null, email, full_name: record.full_name, employment_status: 'active' });
        }
        return null;
      }

      /**
       * Everyone starts on env.TEMPORARY_PASSWORD, so the department
       * announces one value rather than distributing 2,500 different
       * ones. A "Password" column in the roster still overrides it per
       * row, for the cohort that was told something else.
       *
       * Either way must_change_password stays true below, so the account
       * is forced onto "Set your password" at first sign-in. A shared
       * password is a way to distribute a first login, not a credential
       * to keep.
       */
      const suppliedPassword = String(record.password ?? '').trim();
      if (suppliedPassword && suppliedPassword.length < 8) {
        failed.push({
          row: record.rowNumber,
          email,
          reason: 'The Password column must be at least 8 characters (leave it blank to set the shared one)'
        });
        return null;
      }

      // Claimed here rather than after the account exists, because the
      // rows of a wave are created concurrently: without this, the same
      // address twice in one file would be sent to Auth twice.
      existingEmails.add(email);

      return {
        record,
        rowRole,
        email,
        mentorId,
        password: suppliedPassword || env.TEMPORARY_PASSWORD,
        passwordFromFile: Boolean(suppliedPassword)
      };
    } catch (error) {
      failed.push({ row: record.rowNumber, email: record.email ?? '', reason: `Row ${record.rowNumber}: ${error.message}` });
      return null;
    }
  };

  const createAccount = async ({ record, rowRole, email, mentorId, password, passwordFromFile }) => {
    try {
      const payload = {
        email,
        password,
        email_confirm: true,
        user_metadata: {
          role: rowRole,
          full_name: sanitizeSingleLine(record.full_name, 120),
          login_id: record.login_id ? sanitizeSingleLine(record.login_id, 40) : null,
          branch: record.branch ? sanitizeSingleLine(record.branch, 60) : null,
          section: record.section ? sanitizeSingleLine(record.section, 10) : null,
          semester_label: record.semester_label ? sanitizeSingleLine(record.semester_label, 40) : null,
          phone: /^[0-9]{10}$/.test(record.phone ?? '') ? record.phone : null,
          department: 'IoT & IS',
          must_change_password: true
        },
        app_metadata: { role: rowRole }
      };

      let { data, error } = await admin.auth.admin.createUser(payload);

      // Sending several at once is what makes a rate limit reachable at
      // all, so absorb one before calling the row a failure.
      if (error && /rate limit|too many requests|429/i.test(error.message)) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        ({ data, error } = await admin.auth.admin.createUser(payload));
      }

      if (error) {
        // Auth, not the lookup above, is the authority on whether an
        // address is taken: if the two ever disagree the account exists,
        // which is "already there", not a failure to investigate.
        if (/already been registered|already exists|duplicate key/i.test(error.message)) {
          skipped.push({ row: record.rowNumber, email, reason: 'Account already exists' });
        } else {
          failed.push({ row: record.rowNumber, email, reason: error.message });
        }
        return;
      }

      /**
       * Guardian contact and the mentor link are one UPDATE. The roster
       * is where the parent's number actually comes from — the At-Risk
       * page's Parent Contact column reads Form A first and falls back
       * to this, so it stops saying "Not on Form A" for everyone.
       */
      const profilePatch = {};
      if (mentorId) profilePatch.assigned_mentor_id = mentorId;
      if (rowRole === 'faculty' && uploadingHod) {
        profilePatch.hod_id = uploadingHod.id;
        profilePatch.hod_email = uploadingHod.email;
      }
      if (rowRole === 'student') {
        if (record.parent_name) profilePatch.parent_name = sanitizeSingleLine(record.parent_name, 120);
        if (/^[0-9]{10}$/.test(record.parent_mobile ?? '')) profilePatch.parent_mobile = record.parent_mobile;
        if (record.parent_email) profilePatch.parent_email = sanitizeSingleLine(record.parent_email, 255).toLowerCase();
      }
      if (Object.keys(profilePatch).length) {
        await admin.from('user_profiles').update(profilePatch).eq('id', data.user.id);
      }
      // Safe to do from inside the pool: a wave never mixes roles, so no
      // student being planned right now is looking this mentor up.
      if (rowRole === 'faculty') {
        facultyByEmail.set(email, { id: data.user.id, email, full_name: record.full_name, employment_status: 'active' });
      }

      created.push({
        row: record.rowNumber,
        id: data.user.id,
        email,
        full_name: record.full_name,
        role: rowRole,
        login_id: record.login_id ?? null,
        temporary_password: password,
        password_from_file: passwordFromFile
      });
    } catch (error) {
      failed.push({ row: record.rowNumber, email, reason: `Row ${record.rowNumber}: ${error.message}` });
    }
  };

  let index = startOffset;
  while (index < orderedRecords.length) {
    // Always do at least one wave, so a slow Auth can never stall the
    // upload on a chunk that does nothing and asks to be called again.
    if (index > startOffset && Date.now() - startedAt > TIME_BUDGET_MS) {
      nextOffset = index;
      break;
    }

    /**
     * A wave stops at a change of role, which is what keeps a combined
     * file correct: faculty are ordered first, so every mentor an upload
     * introduces is in facultyByEmail before the student rows naming
     * them are planned. Rows that never reach Auth — already-existing,
     * malformed, dry-run — cost nothing and do not fill the wave.
     */
    const waveRole = roleOf(orderedRecords[index]);
    const wave = [];
    while (
      index < orderedRecords.length &&
      wave.length < WAVE_SIZE &&
      roleOf(orderedRecords[index]) === waveRole
    ) {
      const job = planRow(orderedRecords[index], waveRole);
      if (job) wave.push(job);
      index += 1;
    }

    if (wave.length) await runPool(wave, POOL_SIZE, createAccount);
  }

  // Concurrent rows finish out of order; the credentials download and the
  // error table both read better in the order of the spreadsheet.
  for (const list of [created, skipped, failed, activate]) list.sort((a, b) => a.row - b.row);

  // Existing students on this roster join the active cycle with the
  // semester, section and program the file gives them. Done after the
  // chunk's accounts rather than row by row: one round trip per chunk.
  let activation = { activated: 0, updated: 0, cycle: null };
  if (activate.length && body.create_accounts) {
    const { data, error } = await admin.rpc('activate_roster_students', {
      p_rows: activate.map(({ row, email, ...fields }) => fields)
    });
    if (error) {
      failed.push({
        row: activate[0].row,
        email: activate[0].email,
        reason: `The existing students in this part of the file could not be activated: ${error.message}`
      });
    } else {
      activation = { ...activation, ...(data ?? {}) };
    }
  }

  /**
   * One history row for the whole upload, not one per chunk. The first
   * chunk inserts it and hands back its id; the rest add their own counts
   * to it. The counts come from this request's own tallies rather than
   * anything the browser sent, and the row is matched on uploader as well
   * as id so a passed-in batch_id cannot inflate somebody else's import.
   */
  let batch = null;
  if (body.batch_id) {
    const { data: open } = await admin
      .from('roster_import_batches')
      .select('id, created_count, skipped_count, failed_count, row_errors')
      .eq('id', body.batch_id)
      .eq('uploaded_by', context.profile.id)
      .maybeSingle();
    if (open) {
      const { data: merged } = await admin
        .from('roster_import_batches')
        .update({
          total_rows: orderedRecords.length,
          created_count: (open.created_count ?? 0) + created.length,
          skipped_count: (open.skipped_count ?? 0) + skipped.length,
          failed_count: (open.failed_count ?? 0) + failed.length,
          row_errors: [...(open.row_errors ?? []), ...failed].slice(0, 200)
        })
        .eq('id', open.id)
        .select()
        .single();
      batch = merged ?? open;
    }
  }
  if (!batch) {
    const { data: fresh } = await admin
      .from('roster_import_batches')
      .insert({
        semester_cycle_id: body.semester_cycle_id ?? null,
        import_type: body.import_type,
        original_filename: sanitizeSingleLine(body.filename, 255),
        total_rows: orderedRecords.length,
        created_count: created.length,
        skipped_count: skipped.length,
        failed_count: failed.length,
        row_errors: failed.slice(0, 200),
        uploaded_by: context.profile.id
      })
      .select()
      .single();
    batch = fresh;
  }

  if (body.semester_cycle_id && body.create_accounts) {
    const facultyCreated = created.filter((c) => (c.role ?? body.import_type) === 'faculty').length;
    const studentCreated = created.filter((c) => (c.role ?? body.import_type) === 'student').length;

    const { data: cycle } = await admin
      .from('semester_cycles').select('*').eq('id', body.semester_cycle_id).maybeSingle();
    if (cycle) {
      await admin
        .from('semester_cycles')
        .update({
          faculty_imported_count: (cycle.faculty_imported_count ?? 0) + facultyCreated,
          student_imported_count: (cycle.student_imported_count ?? 0) + studentCreated,
          // A combined upload completes the whole upload phase in one go.
          current_step: Math.max(cycle.current_step, isCombined ? 5 : body.import_type === 'faculty' ? 3 : 4)
        })
        .eq('id', body.semester_cycle_id);
    }
  }

  // One audit line for the upload, written when the last chunk lands —
  // twenty entries for one spreadsheet would bury the log.
  if (nextOffset === null) {
    await recordAuditEntry(context, req, `admin.import_${body.import_type}_roster`, {
      type: 'roster_import_batches',
      id: batch?.id,
      metadata: {
        filename: body.filename,
        total: orderedRecords.length,
        created: batch?.created_count ?? created.length,
        failed: batch?.failed_count ?? failed.length,
        dry_run: !body.create_accounts
      }
    });
  }

  const facultyCreated = created.filter((c) => (c.role ?? body.import_type) === 'faculty').length;
  const studentCreated = created.filter((c) => (c.role ?? body.import_type) === 'student').length;

  // Counts here describe THIS chunk. The browser adds them up and shows
  // the running total; batch.*_count is the server's own tally for the
  // whole upload and is what the import history displays.
  sendSuccess(
    res,
    body.create_accounts
      ? `Imported ${created.length} row(s)` +
        (isCombined ? ` (${facultyCreated} faculty, ${studentCreated} students)` : '') +
        `. ${skipped.length} already existed, ${failed.length} failed.`
      : `Validated ${created.length + skipped.length + failed.length} row(s). ${created.length} ready to import, ${skipped.length} already exist, ${failed.length} have problems.`,
    {
      batch_id: batch?.id ?? null,
      total_rows: orderedRecords.length,
      offset: startOffset,
      next_offset: nextOffset,
      processed_through: nextOffset ?? orderedRecords.length,
      faculty_created: facultyCreated,
      student_created: studentCreated,
      // A list rather than a count, so the browser can add the chunks up
      // the way it does for created / skipped / failed.
      activated: activate.map(({ row, email }) => ({ row, email })),
      students_updated: activation.updated ?? 0,
      cycle: activation.cycle,
      created, skipped, failed
    },
    201
  );
});
