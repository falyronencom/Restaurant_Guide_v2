/**
 * Viewer projection — the one server layer every panel answer to a viewer
 * passes through (pack 2, point 3; cloud critic 2A, B-3).
 *
 * The viewer is the read-only panel role (config/panelRoles.js) that people
 * outside the project are shown. Until this layer, hiding personal data from
 * it was decided route by route — the establishment card hid the partner's
 * contacts, the review list the author's e-mail, the journal IP and user
 * agent — and every new route or new column was a fresh chance to forget.
 *
 * The layer is wired into the read tier itself (adminRoutes.js `readAccess`),
 * so no read route of the panel can be registered without it, and works on
 * the answer, not on the query: whatever a service returns, a key from the
 * list below reaches a viewer as null. Keys stay — the panel's models read
 * them as nullable — only values go.
 *
 * What the layer does NOT do, and where that lives instead: decisions that
 * depend on the state of a row are the services' — a deleted review is not
 * returned at all, a hidden one loses its author and text, a review snippet
 * in the journal is kept only while the review is visible
 * (adminReviewService.getReviews, auditLogModel.getAuditLogEntries). The
 * layer is the floor under them, not a replacement.
 *
 * Kept for a viewer on purpose: the establishment's own phone, e-mail and
 * website (the contacts of a business, printed on its public card), company
 * name and tax number of a partner (a legal entity), identifiers.
 *
 * The sentinel test admin-viewer-sentinel.test.js walks every panel route
 * from the router itself and fails if a viewer receives personal data —
 * by value, so a new column under a new name is caught too.
 */

import { isViewer } from '../config/panelRoles.js';

/**
 * Keys whose value is personal data of a person — a partner's contact, a
 * moderator, a review author — wherever they appear in an answer.
 */
export const VIEWER_WITHHELD_KEYS = Object.freeze(new Set([
  // Review authors. author_name is not here: a visible review is signed on
  // the public card too; the service withholds it for a hidden one.
  'author_email',
  'reviewer_name',
  // People acting in the journal (moderators, partners)
  'admin_name',
  'admin_email',
  // Partner contacts and documents on the establishment card
  'contact_person',
  'contact_email',
  'contact_phone',
  'registration_doc_url',
  'document_url',
  // Generic carriers of a person's contacts, should a query ever join users
  'partner_name',
  'partner_email',
  'partner_phone',
  'user_name',
  'user_email',
  'user_phone',
  'owner_name',
  'owner_email',
  'owner_phone',
  // Operator metadata of the journal
  'ip_address',
  'user_agent',
  // The reviews a block from the panel hid and an unblock showed again
  // (adminUserService): next to the person's id they tie hidden reviews to the
  // person. The journal model withholds them first; this is the floor.
  'hidden_review_ids',
  'restored_review_ids',
]));

/**
 * hidden_reason — общий ключ двух разных строк, и решение о нём зависит от
 * того, чья это строка (PR #118 гасил его во всём ответе, и просмотрщик
 * перестал видеть, почему скрыта позиция меню).
 *
 * - Почему скрыт ОТЗЫВ — свободный текст модератора об отзыве, который может
 *   назвать автора (adminReviewService.getReviews гасит его первым; здесь пол).
 * - Почему скрыта ПОЗИЦИЯ МЕНЮ — заметка команды о блюде и цене
 *   (adminService.hideMenuItem), о людях в ней ничего: просмотрщику остаётся.
 *
 * Гасится везде, кроме строки позиции меню: новая строка с этим ключом под
 * другим именем сущности закрыта по умолчанию, а не открыта.
 */
const HIDDEN_REASON_KEY = 'hidden_reason';

/**
 * Строка позиции меню: у неё и только у неё есть item_name (menu_items —
 * listFlagged, ответы hide/unhide/dismiss-flag). У отзыва такого ключа нет.
 */
const isMenuItemRow = (row) => Object.prototype.hasOwnProperty.call(row, 'item_name');

/**
 * Keys whose value is an object describing a person: inside it the name and
 * contacts are withheld, the rest (an identifier, a time) is kept.
 * suspended_by — who suspended the card (adminService.getEstablishmentForModeration).
 */
export const VIEWER_PERSON_OBJECT_KEYS = Object.freeze(new Set([
  'suspended_by',
  // The owner of the card on the moderation detail (A1-02, 2026-10-20).
  'partner',
]));

const PERSON_FIELDS = Object.freeze(new Set(['name', 'email', 'phone']));

/**
 * Keys whose value is passed as is: moderation_notes maps a FIELD of the card
 * to the moderator's comment on it («contact_person: укажите ФИО» is a remark
 * about the field, not the person). Projecting inside would silently drop
 * reasons for a rejection (Phase 3.5 review of pack 2). The comments are the
 * team's text — kept for a viewer, like the reasons in the journal.
 */
export const VIEWER_OPAQUE_KEYS = Object.freeze(new Set(['moderation_notes']));

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const projectPerson = (value) => {
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = PERSON_FIELDS.has(key) ? null : projectForViewer(inner);
  }
  return out;
};

/**
 * Deep copy of a JSON-bound value with personal data of people withheld.
 * Pure: the argument is not modified.
 *
 * @param {*} value - Body about to be sent with res.json
 * @returns {*} The same shape, withheld keys set to null
 */
export const projectForViewer = (value) => {
  if (Array.isArray(value)) return value.map(projectForViewer);
  if (!isPlainObject(value)) return value;

  const out = {};
  const menuItemRow = isMenuItemRow(value);
  for (const [key, inner] of Object.entries(value)) {
    if (VIEWER_OPAQUE_KEYS.has(key)) {
      out[key] = inner;
    } else if (VIEWER_WITHHELD_KEYS.has(key) || (key === HIDDEN_REASON_KEY && !menuItemRow)) {
      out[key] = inner === undefined ? undefined : null;
    } else if (VIEWER_PERSON_OBJECT_KEYS.has(key)) {
      out[key] = projectPerson(inner);
    } else {
      out[key] = projectForViewer(inner);
    }
  }
  return out;
};

/**
 * Express middleware: answers to a viewer go through projectForViewer.
 * Placed after authorize() — req.user is set by then. It sits both in the
 * router's default-closed gate and in the read tier of each route; the flag
 * keeps it to one wrap per response.
 */
export const viewerResponseProjection = (req, res, next) => {
  if (isViewer(req.user?.role) && !res.locals.viewerProjection) {
    res.locals.viewerProjection = true;
    const send = res.json.bind(res);
    res.json = (body) => send(projectForViewer(body));
  }
  next();
};
