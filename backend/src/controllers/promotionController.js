/**
 * Promotion Controller
 *
 * HTTP handlers for promotion CRUD endpoints.
 * Thin layer: extracts params, delegates to promotionService, formats response.
 * Follows patterns from mediaController.js.
 */

import * as PromotionService from '../services/promotionService.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { PROMOTION_REFUSALS } from '../constants/partnerSectionRefusals.js';
import { discardTempUpload } from '../utils/tempUpload.js';
import { longerThan } from '../utils/textLength.js';
import { isCanonicalUuid } from '../utils/canonicalUuid.js';
import logger from '../utils/logger.js';

/**
 * A title the partner can read on the card: a string with something besides
 * spaces. Anything else gets the refusal of an empty title, on create and
 * update alike: a title field sent twice in the form arrives as an array, a
 * JSON body can carry a number, an object or null. Until 16.10.2026 an array,
 * a number or an object — and null on update — reached `.trim()` and came
 * back as 500, and an update with spaces only saved an empty title.
 *
 * @param {*} value - req.body.title
 * @returns {boolean}
 */
const isTitle = (value) => typeof value === 'string' && value.trim() !== '';

/** 400 VALIDATION_ERROR «Укажите название акции.» */
const refuseTitle = (res) => res.status(400).json({
  success: false,
  message: PROMOTION_REFUSALS.titleRequired,
  error: { code: 'VALIDATION_ERROR' },
});

/**
 * The longest title promotions.title holds — varchar(255). Postgres counts
 * characters and JavaScript's `length` counts UTF-16 units (an emoji is one
 * and two), so the title is counted by code points (utils/textLength.js).
 */
const TITLE_MAX_CHARS = 255;

/** The highest position the refusal names: «от 0 до 1 000 000». */
const POSITION_MAX = 1000000;

/** A day as the app sends it (create_promotion_screen.dart): YYYY-MM-DD. */
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const daysInMonth = (year, month) => {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

/**
 * A day the calendar has, written YYYY-MM-DD. Postgres refuses 2026-13-45
 * and an array, and reads a number or a date with a time its own way.
 *
 * @param {*} value
 * @returns {boolean}
 */
const isCalendarDate = (value) => {
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
};

/**
 * A whole number from 0 to POSITION_MAX — a number in JSON, digits in a form.
 *
 * @param {*} value
 * @returns {boolean}
 */
const isPosition = (value) => {
  let number = NaN;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string' && /^\d+$/.test(value)) number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= POSITION_MAX;
};

/** The description and the terms: text, or null where nothing is said. */
const isTextOrNothing = (value) => value === undefined || value === null || typeof value === 'string';

/**
 * The fields besides the title's presence, checked before the service — so
 * before the picture goes to the cloud and before the database (brief «500
 * вместо отказа», pp. 1, 5 and 9). Until 18.10.2026 a title over 255
 * characters, a date the calendar lacks, a position past the integer column
 * came back as 500 — with the picture already in the cloud — and a
 * description sent twice in a form was stored as `{"a","b"}`.
 *
 * Absent is always fine. On create null and an empty form field are fine
 * too: the service puts the defaults in (today, no end, position 0, no text).
 * On update a present field must be storable: null clears the description,
 * the terms, the end date and the position — their columns allow it — and an
 * empty form field clears the end date as well (a form has no null; the
 * update handler stores it as null). The start date cannot be cleared (NOT
 * NULL), and an empty form field is no position.
 *
 * The title, when present, is already a string with text (isTitle).
 *
 * @param {Object} body - req.body
 * @param {boolean} creating - true on create, false on update
 * @throws {AppError} 422 VALIDATION_ERROR with the field's refusal
 */
const checkFields = (body, creating) => {
  const { title, description, terms_and_conditions, valid_from, valid_until, position } = body;
  const notGiven = (value) => value === undefined || (creating && (value === null || value === ''));
  const noEnd = valid_until === undefined || valid_until === null || valid_until === '';

  if (title !== undefined && longerThan(title.trim(), TITLE_MAX_CHARS)) {
    throw new AppError(PROMOTION_REFUSALS.titleTooLong, 422, 'VALIDATION_ERROR');
  }
  if (!isTextOrNothing(description) || !isTextOrNothing(terms_and_conditions)) {
    throw new AppError(PROMOTION_REFUSALS.notText, 422, 'VALIDATION_ERROR');
  }
  if ((!notGiven(valid_from) && !isCalendarDate(valid_from)) || (!noEnd && !isCalendarDate(valid_until))) {
    throw new AppError(PROMOTION_REFUSALS.dateInvalid, 422, 'VALIDATION_ERROR');
  }
  if (!notGiven(position) && position !== null && !isPosition(position)) {
    throw new AppError(PROMOTION_REFUSALS.positionInvalid, 422, 'VALIDATION_ERROR');
  }
};

/**
 * POST /api/v1/partner/promotions
 * Create a new promotion (multipart/form-data for optional image).
 */
export const createPromotion = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishment_id, title, description, terms_and_conditions, valid_from, valid_until, position } = req.body;

  // The optional image is already on disk (multer, TEMP_UPLOAD_DIR) and nothing
  // downstream deletes it: the finally discards it on every outcome — the 400s
  // and 422s below, a service throw, a DB error, success — and the 201 is sent
  // only after the disk is clean.
  let promotion;
  try {
    // The card's id as the database writes it (utils/canonicalUuid.js): one
    // in capitals filed the picture in a folder the ownership rule does not
    // recognise, anything else came back as the database's English 400. The
    // refusal is the one of a missing card — the app sends the id it read.
    if (!isCanonicalUuid(establishment_id)) {
      return res.status(400).json({
        success: false,
        message: PROMOTION_REFUSALS.establishmentRequired,
        error: { code: 'VALIDATION_ERROR' },
      });
    }

    if (!isTitle(title)) return refuseTitle(res);
    checkFields(req.body, true);

    promotion = await PromotionService.createPromotion(
      partnerId,
      establishment_id,
      { title: title.trim(), description, terms_and_conditions, valid_from, valid_until, position },
      req.file || null,
    );
  } finally {
    await discardTempUpload(req.file);
  }

  logger.info('Promotion created via API', {
    promotionId: promotion.id,
    establishmentId: establishment_id,
    partnerId,
    endpoint: 'POST /api/v1/partner/promotions',
  });

  res.status(201).json({
    success: true,
    data: promotion,
  });
});

/**
 * GET /api/v1/partner/promotions/establishment/:establishmentId
 * List all promotions for a partner's establishment (including inactive).
 */
export const getPromotions = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishmentId } = req.params;

  const promotions = await PromotionService.getPartnerPromotions(partnerId, establishmentId);

  res.status(200).json({
    success: true,
    data: promotions,
  });
});

/**
 * PATCH /api/v1/partner/promotions/:id
 * Update a promotion.
 */
export const updatePromotion = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { id } = req.params;
  const { title, description, terms_and_conditions, valid_from, valid_until, position } = req.body;

  // Same ownership of the optional image as in createPromotion: discarded in
  // the finally on every outcome, before the 200 leaves.
  let promotion;
  try {
    // A promotion's id as the database writes it (utils/canonicalUuid.js);
    // anything else names no promotion — the refusal of a missing one,
    // before the picture goes to the cloud.
    if (!isCanonicalUuid(id)) {
      throw new AppError(PROMOTION_REFUSALS.promotionNotFound, 404, 'PROMOTION_NOT_FOUND');
    }

    // Absent means «leave as is»; present, it follows the create rule.
    if (title !== undefined && !isTitle(title)) return refuseTitle(res);
    checkFields(req.body, false);

    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description;
    if (terms_and_conditions !== undefined) updateData.terms_and_conditions = terms_and_conditions;
    if (valid_from !== undefined) updateData.valid_from = valid_from;
    // An empty form field clears the end date, as on create (checkFields).
    if (valid_until !== undefined) updateData.valid_until = valid_until === '' ? null : valid_until;
    if (position !== undefined) updateData.position = position;

    promotion = await PromotionService.updatePromotion(
      partnerId,
      id,
      updateData,
      req.file || null,
    );
  } finally {
    await discardTempUpload(req.file);
  }

  logger.info('Promotion updated via API', {
    promotionId: id,
    partnerId,
    endpoint: 'PATCH /api/v1/partner/promotions/:id',
  });

  res.status(200).json({
    success: true,
    data: promotion,
  });
});

/**
 * DELETE /api/v1/partner/promotions/:id
 * Deactivate a promotion (soft delete → status='expired').
 */
export const deletePromotion = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { id } = req.params;

  const promotion = await PromotionService.deactivatePromotion(partnerId, id);

  logger.info('Promotion deactivated via API', {
    promotionId: id,
    partnerId,
    endpoint: 'DELETE /api/v1/partner/promotions/:id',
  });

  res.status(200).json({
    success: true,
    data: promotion,
  });
});
