/**
 * The bars of a "queries by category" chart.
 *
 * Migration 0026 replaced the categories Academic, ERP/Tech and
 * Infrastructure with the five in QUERY_CATEGORIES. The old values are
 * still in the enum and on old queries, so a chart shows the five current
 * categories (zeros included, so its shape does not jump about) and then
 * any old category that still has queries.
 *
 * Each category keeps one colour on every chart and every page: the
 * dashboard palette (CHART_COLORS.series) in the order the categories are
 * listed, then two more from the same family for the last retired ones.
 */

import { CHART_COLORS, QUERY_CATEGORIES } from './constants.js';

/** Retired by 0026, in enum order. */
export const LEGACY_QUERY_CATEGORIES = ['Academic', 'ERP/Tech', 'Infrastructure'];

/** category -> bar colour. */
export const QUERY_CATEGORY_COLORS = Object.fromEntries(
  [...QUERY_CATEGORIES, ...LEGACY_QUERY_CATEGORIES].map((name, index) => [
    name,
    [...CHART_COLORS.series, '#b45309', '#78716c'][index]
  ])
);

/**
 * category -> number of queries: one per row of a query list, or, with
 * valueOf, from summary rows such as a report's by_category
 * ({ category, total }).
 */
export function countQueriesByCategory(rows, valueOf = () => 1) {
  const counts = {};
  for (const row of rows ?? []) {
    if (row?.category) counts[row.category] = (counts[row.category] ?? 0) + (Number(valueOf(row)) || 0);
  }
  return counts;
}

/**
 * @param {Record<string, number|string> | null | undefined} counts
 *   category -> count, as get_dashboard_metrics() returns it in
 *   queries_by_category (0041) or countQueriesByCategory() builds it.
 * @returns {{ name: string, value: number, color: string }[]}
 */
export function queryCategoryChartData(counts) {
  const source = counts ?? {};
  const valueOf = (name) => Number(source[name] ?? 0) || 0;
  const extra = Object.keys(source)
    .filter((name) => !QUERY_CATEGORIES.includes(name) && valueOf(name) > 0)
    .sort((a, b) => {
      const rank = (name) => (LEGACY_QUERY_CATEGORIES.includes(name) ? LEGACY_QUERY_CATEGORIES.indexOf(name) : 99);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  return [...QUERY_CATEGORIES, ...extra].map((name, index) => ({
    name,
    value: valueOf(name),
    color: QUERY_CATEGORY_COLORS[name] ?? CHART_COLORS.series[index % CHART_COLORS.series.length]
  }));
}
