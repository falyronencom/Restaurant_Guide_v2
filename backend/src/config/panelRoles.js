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
