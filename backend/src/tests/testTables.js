/**
 * Canonical list of tables that accumulate state during tests.
 *
 * Single source of truth shared by:
 *   - globalSetup.js            — one clean baseline before the whole run (F1)
 *   - tests/utils/database.js   — clearAllData() between/after files     (F2)
 *
 * Excludes spatial_ref_sys (PostGIS reference data, NOT test state). When a
 * migration adds a new state-bearing table, add it here so both the global
 * baseline and clearAllData stay complete — the drift this list prevents was
 * the root of the historical isolation debt (F1/F2).
 *
 * Order is load-bearing: every FK child comes before its parent. Both callers
 * truncate the whole list in ONE statement, and PostgreSQL locks the tables in
 * list order and holds them until COMMIT. A fire-and-forget INSERT of the
 * previous test holds its own table and asks for the parents only on its FK
 * check — for every FK of the table, even when the column is NULL. A parent
 * listed first closes a ring with it: `deadlock detected`, and the next test's
 * hook fails. Place a new table before every table it references.
 * Guard: integration/clear-all-data-lock-order.test.js.
 */
export const TEST_STATE_TABLES = [
  'audit_log',
  'favorites',
  'bookings',
  'booking_settings',
  'promotions',
  'menu_items',
  'ocr_jobs',
  'establishment_media_kinds_042',
  'establishment_media',
  'notifications',
  'reviews',
  'device_tokens',
  'notification_preferences',
  'partner_documents',
  'subscriptions',
  'establishment_analytics',
  'email_verification_codes',
  'password_reset_tokens',
  'menu_item_hidden_names',
  'establishments',
  'refresh_tokens',
  'avatar_deletions',
  'avatar_file_deletions',
  'users',
];

const inListOrder = (...tables) => TEST_STATE_TABLES.filter((table) => tables.includes(table));

/**
 * What clearTableTree truncates for a parent: the parent and every table a
 * `TRUNCATE <parent> CASCADE` reaches from it, children first. The order comes
 * from TEST_STATE_TABLES and is load-bearing the same way.
 *
 * seed_import_registry references establishments and is left to CASCADE, which
 * locks it after the list: nothing writes it in the background, and a pg-test
 * built before migration 031 does not have it.
 *
 * A migration that adds a child of one of these tables adds it here too.
 * Guard: integration/clear-all-data-lock-order.test.js.
 */
export const TABLE_TREES = {
  establishments: inListOrder(
    'favorites',
    'bookings',
    'booking_settings',
    'promotions',
    'menu_items',
    'ocr_jobs',
    'establishment_media_kinds_042',
    'establishment_media',
    'notifications',
    'reviews',
    'partner_documents',
    'subscriptions',
    'establishment_analytics',
    'menu_item_hidden_names',
    'establishments',
  ),
  reviews: inListOrder('notifications', 'reviews'),
};
