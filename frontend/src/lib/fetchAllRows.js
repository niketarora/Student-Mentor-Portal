/**
 * fetchAllRows.js
 *
 * PostgREST returns at most `max_rows` rows per request — 1,000 on a
 * Supabase project unless someone changed it — and it does so silently:
 * no error, just a shorter list. A page that counts or lists everyone
 * (the HOD's Students directory, the department's at-risk list) therefore
 * has to page through with .range(), or it shows 1,000 where the
 * dashboard, which counts in SQL, shows the real number.
 *
 * makeQuery(withCount) must return a NEW query builder on every call
 * (builders are single-use) and should order by something unique, or rows
 * can repeat or go missing between pages. The first request also asks for
 * an exact count, so paging stops at the true total even if the server's
 * page size turns out to be smaller than ours.
 */
export async function fetchAllRows(makeQuery, { pageSize = 1000 } = {}) {
  const rows = [];
  let total = null;

  for (let from = 0; ; ) {
    const { data, error, count } = await makeQuery(from === 0).range(from, from + pageSize - 1);
    if (error) return { data: rows, error, count: total ?? rows.length };
    if (from === 0) total = typeof count === 'number' ? count : null;

    const page = data ?? [];
    rows.push(...page);
    if (!page.length) break;
    from += page.length;
    if (total != null ? from >= total : page.length < pageSize) break;
  }

  return { data: rows, error: null, count: total ?? rows.length };
}
