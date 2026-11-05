/**
 * SQL for reading establishment_analytics.share_count.
 *
 * Migration 039 is applied by hand, after the deploy. Until then a query naming
 * the column would fail with «column does not exist» — and these reads sit
 * inside the partner's statistics and the partner's list of establishments,
 * which must keep working in that window. Turned into JSON, a row without the
 * column simply has no such key: the value is NULL and SUM skips it, so the
 * figure reads 0 on either schema.
 */

/** One row's share count, NULL when the column is not there yet. */
export const shareCountOf = (row) => `(to_jsonb(${row}) ->> 'share_count')::int`;

/** All-time shares of one establishment, as a subquery. */
export const shareTotalOf = (establishmentId) => `(
  SELECT COALESCE(SUM(${shareCountOf('ea')}), 0)::int
  FROM establishment_analytics ea
  WHERE ea.establishment_id = ${establishmentId}
)`;
