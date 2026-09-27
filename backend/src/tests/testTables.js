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
  'establishments',
  'refresh_tokens',
  'users',
];
