/**
 * Roles of the admin panel (admin-web).
 *
 * `admin` acts, `viewer` only reads. Coordinator decision 2026-09-08
 * (SDL CAT-C-2.11): the panel moves from the operator's machine to a hosted
 * Railway service and may be shown to a third party (a prospective partner)
 * by one of our own people. A full admin account cannot be handed out for
 * that — every button in the panel acts on real partners — so the panel got
 * a second role that can read everything and change nothing.
 *
 * The split is enforced by the API, not only hidden in the UI: this module
 * is the single source for the login gate (adminController.adminLogin) and
 * for the two access tiers of adminRoutes.js. A role listed here but not
 * placed into a tier changes nothing — authorize() answers 403 to any role
 * outside the tier of the route.
 *
 * What a viewer may still see: one layer under every read route —
 * projections/viewerProjection.js, wired into the read tier — withholds the
 * personal data of people (contacts and documents of partners, names and
 * e-mails of moderators and review authors, IP / user agent). Decisions that
 * depend on a row's state stay in the services with isViewer(): no deleted
 * reviews, hidden ones without the person and the text, journal actors by
 * role (pack 2, points 1–3, 2026-10; Coordinator decision 2026-09-08).
 */

export const ADMIN_ROLE = 'admin';
export const VIEWER_ROLE = 'viewer';

/** Roles that may log in through POST /api/v1/admin/auth/login. */
export const PANEL_ROLES = Object.freeze([ADMIN_ROLE, VIEWER_ROLE]);

/** Read tier: every GET of the panel except reads that only serve an action. */
export const PANEL_READ_ROLES = PANEL_ROLES;

/** Action tier: every mutation, plus reads that exist only to serve one. */
export const PANEL_ACTION_ROLES = Object.freeze([ADMIN_ROLE]);

export const isPanelRole = (role) => PANEL_ROLES.includes(role);

export const isViewer = (role) => role === VIEWER_ROLE;

/**
 * How long a panel session survives without a renewal: one day (Coordinator
 * decision 2026-10-29, S1 option «а»). Every other role keeps the 30 days of
 * the refresh token's expires_at.
 *
 * The panel renews only when its access token runs out (one hour for the
 * panel's accounts, config/accessToken.js), so a moderator at work renews many
 * times a day and is never logged out; one who has not opened the panel for a
 * day has to log in again. Measured from the refresh token's created_at — each renewal mints a
 * new row — and not written into expires_at: that column stays at 30 days so
 * that a chain's expires_at keeps growing along the chain, which the pruner's
 * oldest-first order relies on (services/refreshTokenPruner.js) — a 30-day
 * predecessor rotated into a 1-day successor would stall it. The check at
 * renewal covers the panel tokens issued before this rule as well.
 */
export const PANEL_SESSION_IDLE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a refresh token of an account in this role has outlived the panel's
 * idle limit. Only panel roles lapse; the role is the account's current one,
 * so the rule follows the account, not the door the token came from.
 *
 * created_at is read in JS on purpose, like expires_at in
 * authService.refreshAccessToken: generateTokenPair writes it from a JS Date
 * into a naive column, node-pg reads it back in the same local time, so the
 * age is right in any process time zone. A row without created_at counts as
 * lapsed. Exactly the limit is still alive, one millisecond more is not —
 * the same strictness as the expires_at check.
 *
 * @param {string} role - The account's current role
 * @param {Date|string|null} createdAt - refresh_tokens.created_at
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export const panelSessionLapsed = (role, createdAt, now = Date.now()) => {
  if (!isPanelRole(role)) {
    return false;
  }
  if (!createdAt) {
    return true;
  }
  return now - new Date(createdAt).getTime() > PANEL_SESSION_IDLE_MS;
};
