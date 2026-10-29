/**
 * Partner Menu-Item Service
 *
 * Business logic for partner operations on parsed menu items (Segment B):
 *   - listMenuItems:    GET /partner/establishments/:id/menu-items
 *   - updateMenuItem:   PATCH /partner/menu-items/:id (inline editing)
 *   - retryOcr:         POST /partner/establishments/:id/retry-ocr
 *
 * Ownership invariant: every entry point verifies that the menu item (or its
 * establishment) belongs to the calling partner before mutating or returning data.
 */

import * as MenuItemModel from '../models/menuItemModel.js';
import * as EstablishmentModel from '../models/establishmentModel.js';
import * as MediaModel from '../models/mediaModel.js';
import * as OcrJobModel from '../models/ocrJobModel.js';
import { MENU_RECOGNITION_REFUSALS } from '../constants/partnerSectionRefusals.js';
import { AppError } from '../middleware/errorHandler.js';
import { findCopies } from '../projections/menuItemProjections.js';
import logger from '../utils/logger.js';
import { invalidateCache as invalidateBadges } from './badgesService.js';
import { DailyOcrLimitError, enqueueWithinDailyAllowance } from './ocrAllowance.js';
import { failureCauseOf, failureTextOf } from './ocr/failureReason.js';
import { invalidateCache as invalidateHealth } from './qualityHealthService.js';

/**
 * The code of a restart whose every queuing failed — the app shows the
 * refusal by it.
 */
const OCR_RESTART_FAILED = 'OCR_RESTART_FAILED';

/**
 * The state of recognition of an establishment's menu, as the partner's menu
 * screen shows it (finding 3 of the Railway incident, directive of
 * 24.10.2026: until then a failed recognition looked like a menu not
 * uploaded yet, or one still being read). Read from the newest job of every
 * menu file the card has now (OcrJobModel.getLatestJobPerMenuFile); the
 * file's state is its newest job's, and the menu's — the worst of the files':
 *
 *   processing — some file is queued or being read (a restart of a failed
 *                file shows as this: its newest job is the new one);
 *   failed     — otherwise, some file never recognised has a newest job
 *                that failed for good: `cause` — the cause's code (the app
 *                gives advice by it), `reason` — the partner's text
 *                (failureReason.js), `failedAt` — when; with several such
 *                files, the latest failure's;
 *   not_started — otherwise, some file has no job at all: it is on the card,
 *                but nothing will read it until the partner restarts the
 *                recognition — the daily allowance refused it at upload, or
 *                its queuing failed (both answer the upload as a success;
 *                ocrAllowance.js), or it predates the pipeline (finding Н39
 *                of 25.10.2026: until then such a file read as «none», like
 *                a menu not uploaded, and beside a recognised file it was not
 *                seen at all);
 *   done       — otherwise, some file was recognised — a file whose re-read
 *                failed counts here: its dishes stand (replaceForMedia runs
 *                only on success), and the partner is not to be sent to
 *                replace a file that works (review of 24.10.2026);
 *   none       — no menu files.
 *
 * `processing` outranks `failed` so that a restart answers at once, and
 * `failed` outranks `done` so that one failed file among recognised ones is
 * not hidden by the dishes the others gave; `not_started` stands between
 * them for the same reason, below `failed`, whose advice (restart, or another
 * file) the file without a job needs as well — a restart queues every file.
 * A build of the app that does not know `not_started` reads it as no field
 * at all — the screen it had (models/menu_recognition.dart, fromJson).
 *
 * @param {Array<{status: string|null, error_message: string|null, completed_at: Date|null, has_done_job?: boolean}>} files
 * @returns {{status: 'none'|'processing'|'failed'|'not_started'|'done', cause?: string, reason?: string, failedAt?: Date|null}}
 */
export const recognitionState = (files) => {
  if (files.some((file) => file.status === 'pending' || file.status === 'processing')) {
    return { status: 'processing' };
  }
  const failed = files.filter((file) => file.status === 'failed' && !file.has_done_job);
  if (failed.length > 0) {
    const latest = failed.reduce((a, b) => (
      (b.completed_at?.getTime?.() ?? -Infinity) > (a.completed_at?.getTime?.() ?? -Infinity) ? b : a
    ));
    return {
      status: 'failed',
      cause: failureCauseOf(latest.error_message),
      reason: failureTextOf(latest.error_message),
      failedAt: latest.completed_at ?? null,
    };
  }
  // A file never queued: no job row, so the LEFT JOIN's status is null.
  if (files.some((file) => file.status === null)) {
    return { status: 'not_started' };
  }
  if (files.some((file) => file.status === 'done' || (file.status === 'failed' && file.has_done_job))) {
    return { status: 'done' };
  }
  return { status: 'none' };
};

/**
 * The recognition state of a card, or null when it cannot be read: the list
 * of items is what the screen exists for, and a failure of this second query
 * must not take it down (review of 24.10.2026). A client reads null as a
 * server without the field — the screen it always had. Logged, not silent.
 *
 * @param {string} establishmentId - UUID
 * @returns {Promise<Object|null>}
 */
const readRecognitionState = async (establishmentId) => {
  try {
    return recognitionState(await OcrJobModel.getLatestJobPerMenuFile(establishmentId));
  } catch (error) {
    logger.error('Recognition state of the partner menu could not be read — answered without it', {
      establishmentId,
      error: error.message,
    });
    return null;
  }
};

/**
 * Whether the card has items hidden by admin, or null when it cannot be read —
 * a helper field, like the recognition state: its failure must not take the
 * list down. A client reads null as «not known» and shows what it always did.
 *
 * @param {string} establishmentId - UUID
 * @returns {Promise<boolean|null>}
 */
const readHasHiddenItems = async (establishmentId) => {
  try {
    return await MenuItemModel.hasHiddenByEstablishment(establishmentId);
  } catch (error) {
    logger.error('Hidden items of the partner menu could not be read — answered without them', {
      establishmentId,
      error: error.message,
    });
    return null;
  }
};

/**
 * List parsed menu items for an establishment owned by the partner.
 *
 * Phase 1 policy: admin-hidden items are filtered out at the service layer.
 * Partners see only non-hidden items: no names, no reasons, no moderator.
 * Rationale: platform owns content quality; hiding is not the partner's concern.
 * One exception, a fact without content (finding КО-1, Coordinator's choice
 * «Б» of 29.10.2026): `hasHiddenItems` tells the screen that an empty list is
 * empty because items are hidden, so that it does not advise a clearer photo
 * — the hiding is tied to the dish name and survives a re-read.
 *
 * With the items comes the state of the menu's recognition (recognitionState;
 * null when it cannot be read); the controller sends it beside `data`, which
 * stays the list it always was.
 *
 * @param {string} partnerId - UUID
 * @param {string} establishmentId - UUID
 * @returns {Promise<{items: Object[], recognition: Object, hasHiddenItems: boolean|null}>}
 *   Non-hidden menu items ordered by position, the recognition state, and
 *   whether any items are hidden by admin
 */
export const listMenuItems = async (partnerId, establishmentId) => {
  const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
  if (!isOwner) {
    throw new AppError(
      'Establishment not found or access denied',
      404,
      'ESTABLISHMENT_NOT_FOUND',
    );
  }

  const [items, recognition, hasHiddenItems] = await Promise.all([
    MenuItemModel.getByEstablishmentId(establishmentId, { includeHidden: false }),
    readRecognitionState(establishmentId),
    readHasHiddenItems(establishmentId),
  ]);
  return { items, recognition, hasHiddenItems };
};

/**
 * Inline-edit a menu item the partner owns.
 *
 * Allowed fields: item_name, price_byn, category_raw.
 * Side effect: sanity_flag is cleared (partner accepts responsibility for values).
 * is_hidden_by_admin is untouched — only admin can toggle that.
 *
 * @param {string} partnerId - UUID
 * @param {string} menuItemId - UUID
 * @param {Object} updates - { item_name?, price_byn?, category_raw? }
 * @returns {Promise<Object>} Updated menu item
 */
export const updateMenuItem = async (partnerId, menuItemId, updates) => {
  const existing = await MenuItemModel.findById(menuItemId);
  if (!existing) {
    throw new AppError('Menu item not found', 404, 'MENU_ITEM_NOT_FOUND');
  }

  const isOwner = await EstablishmentModel.checkOwnership(
    existing.establishment_id,
    partnerId,
  );
  // A dish the moderator hid is not the partner's to edit: the partner's
  // list does not show it, and renaming it would detach the moderator's
  // decision from the dish — a re-read carries «Скрыть» over by name
  // (MenuItemModel.replaceForMedia). Answered like a stranger's item.
  if (!isOwner || existing.is_hidden_by_admin === true) {
    throw new AppError(
      'Menu item not found or access denied',
      404,
      'MENU_ITEM_NOT_FOUND',
    );
  }

  const partnerAllowed = ['item_name', 'price_byn', 'category_raw'];
  const filteredUpdates = {};
  for (const field of partnerAllowed) {
    if (updates[field] !== undefined) {
      filteredUpdates[field] = updates[field];
    }
  }

  if (Object.keys(filteredUpdates).length === 0) {
    throw new AppError(
      'No editable fields provided (item_name, price_byn, category_raw)',
      400,
      'NO_FIELDS_TO_UPDATE',
    );
  }

  // Validate price if provided: must be non-negative number
  if (filteredUpdates.price_byn !== undefined && filteredUpdates.price_byn !== null) {
    const price = Number(filteredUpdates.price_byn);
    if (!Number.isFinite(price) || price < 0) {
      throw new AppError(
        'price_byn must be a non-negative number',
        422,
        'INVALID_PRICE',
      );
    }
  }

  // Partner edit implies they vouch for the values — clear sanity_flag.
  filteredUpdates.sanity_flag = null;

  // The guest sees one line for a dish the menu's files share
  // (collapseMenuRepeats); an edit of one copy reaches the others, or the guest
  // would see the old price next to the new one. The copies are found before
  // the edit — by the values the line has now — among the rows the guest sees:
  // a copy the moderator hid is the moderator's and stays as it is, and the
  // guest's grouping knows no hidden rows.
  const visibleRows = await MenuItemModel.getByEstablishmentId(
    existing.establishment_id,
    { includeHidden: false },
  );
  const copies = findCopies(menuItemId, visibleRows);

  const updated = await MenuItemModel.updateById(menuItemId, filteredUpdates);
  for (const copy of copies) {
    await MenuItemModel.updateById(copy.id, filteredUpdates);
  }

  // Снятый флаг уменьшает hanging_flags — ту самую величину, что стоит бейджем
  // в рейле админки, строкой на дашборде и карточкой «Флаги без реакции». Правит
  // партнёр, а расходятся числа у модератора: без сброса он до полутора минут
  // видел бы флаг, которого уже нет, и шёл бы разбирать несуществующую работу.
  invalidateBadges();
  invalidateHealth();

  logger.info('Partner edited menu item', {
    menuItemId,
    partnerId,
    fields: Object.keys(filteredUpdates),
    copies: copies.map(copy => copy.id),
  });

  return updated;
};

/**
 * Re-run OCR for all OCR-eligible menu media of an establishment owned by the
 * partner: PDF menus plus menu photos (vision_image strategy).
 * A file whose job is pending or processing keeps that job (it counts as
 * queued). A re-read replaces the rows of each file but keeps the
 * moderator's «Скрыть» on dishes read again under the same name
 * (MenuItemModel.replaceForMedia) — a partner cannot bring back a hidden dish
 * by re-running the recognition.
 *
 * Every new job comes out of the partner's daily recognition allowance
 * (services/ocrAllowance.js), shared with the card's create, save and upload;
 * the route's own limit (five restarts a day) still holds. Files never
 * recognised are queued first. A restart that the spent allowance leaves with
 * nothing queued is refused — DailyOcrLimitError, 429 with Retry-After until
 * Minsk midnight; one whose every queuing failed — 500 OCR_RESTART_FAILED
 * with the partner's text (the controller gives any 5xx restart back to its
 * daily limit); one that queued part of the files answers how many, as
 * before («запущено N из M»). The files are queued one after another: a
 * reservation waits for Redis at most its deadline (config/redis.js), and
 * queuing them at once would take that many pool connections.
 *
 * Contract note: the error code NO_PDF_MENUS and the response key totalPdfs
 * predate menu-photo support and are kept verbatim — mobile matches on the
 * code (partner_menu_screen) and renaming would widen the blast radius of
 * this backend-only slice. totalPdfs now carries the eligible-media count.
 *
 * @param {string} partnerId - UUID
 * @param {string} establishmentId - UUID
 * @returns {Promise<{enqueuedJobs: number, totalPdfs: number}>}
 * @throws {DailyOcrLimitError} When the allowance left nothing queued
 * @throws {AppError} OCR_RESTART_FAILED when every file's queuing failed
 */
export const retryOcr = async (partnerId, establishmentId) => {
  const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
  if (!isOwner) {
    throw new AppError(
      'Establishment not found or access denied',
      404,
      'ESTABLISHMENT_NOT_FOUND',
    );
  }

  const eligibleMedia = await MediaModel.getOcrEligibleMedia(establishmentId);
  if (eligibleMedia.length === 0) {
    throw new AppError(
      'No menu media (PDF or menu photos) to re-process for this establishment',
      400,
      'NO_PDF_MENUS',
    );
  }

  // Files never recognised first, each group in its own order (the sort is
  // stable): with a few places left in the allowance, they go to the files
  // that have no dishes yet, not to re-reading recognised ones.
  const recognised = await OcrJobModel.getMediaIdsWithCompletedJob(establishmentId);
  const queueOrder = [...eligibleMedia]
    .sort((a, b) => Number(recognised.has(a.id)) - Number(recognised.has(b.id)));

  let enqueuedJobs = 0;
  let refusal = null;
  for (const media of queueOrder) {
    try {
      const result = await enqueueWithinDailyAllowance({
        userId: partnerId,
        establishmentId,
        mediaId: media.id,
      });
      if (result.queued) {
        enqueuedJobs += 1;
      } else {
        refusal = result.refusal;
      }
    } catch (err) {
      logger.error('Failed to enqueue OCR job during retry', {
        error: err.message,
        mediaId: media.id,
        establishmentId,
      });
    }
  }

  logger.info('Partner requested OCR retry', {
    partnerId,
    establishmentId,
    totalEligibleMedia: eligibleMedia.length,
    enqueuedJobs,
  });

  if (enqueuedJobs === 0 && refusal) {
    throw new DailyOcrLimitError(refusal);
  }
  // Every file's queuing failed (each is logged above): the restart did
  // nothing, and an answer of success let the app say «already running»
  // (finding Н40 of 25.10.2026). A file whose job is already active counts as
  // queued, so this is the one way to get here with files to queue.
  if (enqueuedJobs === 0) {
    throw new AppError(MENU_RECOGNITION_REFUSALS.restartNotQueued, 500, OCR_RESTART_FAILED);
  }

  return { enqueuedJobs, totalPdfs: eligibleMedia.length };
};
