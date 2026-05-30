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
 * Order is not load-bearing: callers truncate under
 * session_replication_role = replica with CASCADE, so FK direction is handled.
 */
export const TEST_STATE_TABLES = [
  'audit_log',
  'establishment_media',
  'favorites',
  'reviews',
  'bookings',
  'booking_settings',
  'menu_items',
  'promotions',
  'notifications',
  'device_tokens',
  'notification_preferences',
  'ocr_jobs',
  'partner_documents',
  'subscriptions',
  'establishment_analytics',
  'email_verification_codes',
  'establishments',
  'refresh_tokens',
  'users',
];
