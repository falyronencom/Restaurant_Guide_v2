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
import { ESTABLISHMENT_REFUSALS } from '../constants/establishmentRefusals.js';
import { MENU_ITEM_REFUSALS, MENU_RECOGNITION_REFUSALS } from '../constants/partnerSectionRefusals.js';
import { AppError } from '../middleware/errorHandler.js';
import { findCopies, withGuestHiddenReason } from '../projections/menuItemProjections.js';
import logger from '../utils/logger.js';
import { longerThan } from '../utils/textLength.js';
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
 * The code of a restart that finds nothing to recognise: every menu file of
 * the card has been recognised at least once (retryOcr). Such a refusal does
 * not spend one of the day's five restarts — the controller gives the slot
 * back by this code.
 */
export const NOTHING_TO_RECOGNIZE = 'NOTHING_TO_RECOGNIZE';

/**
 * The code of a restart on a card with no menu file at all (retryOcr) — the
 * same «nothing to recognise»: the controller gives the day's restart back by
 * it too (from 24.11.2026, thread Н8, finding 5). The code predates menu
 * photos and is kept verbatim (the header of retryOcr says why).
 */
export const NO_PDF_MENUS = 'NO_PDF_MENUS';

/**
 * The columns a partner's edit writes (migrations/production_schema.sql,
 * menu_items): item_name varchar(255) NOT NULL, category_raw varchar(100),
 * price_byn numeric(10,2). A value past them failed in the database and came
 * back as 500 «Сбой на сервере» (finding 4 of the discovery for the site's
 * cabinet, 22.11.2026); the edit refuses it with the partner's text instead.
 */
const ITEM_NAME_MAX_CHARS = 255;
const SECTION_MAX_CHARS = 100;
// numeric(10,2) rounds to two places, and a price that rounds to
// 100 000 000,00 does not fit (22003): the least such is 99 999 999,995.
// node-pg sends a number as its shortest text, so the number of this literal
// goes as '99999999.995', and every number below it as a text below it —
// one that rounds to 99 999 999,99 at most.
const PRICE_TOO_HIGH_FROM = 99999999.995;

/** A price written as text: digits, and a dot with digits after it. */
const DECIMAL_TEXT = /^\s*\d+(?:\.\d+)?\s*$/;

/**
 * The price of a partner's edit as a number, or NaN when it is none: a JSON
 * number, or a plain decimal in a string (the edit took Number(x) before
 * 23.11.2026, so a client may send «12.50»). Anything else — an empty string,
 * a comma, an exponent in a string, a flag, an array — is NaN: Number() made 0
 * of '' and of [], 1 of true, and the database refused them as a 400 in
 * English.
 *
 * @param {*} value - price_byn as the request sent it, not null
 * @returns {number}
 */
const priceOf = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && DECIMAL_TEXT.test(value)) return Number(value);
  return Number.NaN;
};

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
 * file) the file without a job needs as well — a restart queues every file
 * never recognised, and only those (retryOcr).
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
 * Alcohol and tobacco are in the list: the guest does not see them, the
 * partner does, each row with `guest_hidden_reason` ('alcohol', 'tobacco' or
 * null), so that the partner does not take a line missing on the card for an
 * error (menuItemProjections.withGuestHiddenReason).
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
    // The card's own text, the one the route answers an id not written as the
    // database writes it (routes/v1/establishmentRoutes.js cardIdMenu).
    throw new AppError(ESTABLISHMENT_REFUSALS.notOwner, 404, 'ESTABLISHMENT_NOT_FOUND');
  }

  const [items, recognition, hasHiddenItems] = await Promise.all([
    MenuItemModel.getByEstablishmentId(establishmentId, { includeHidden: false }),
    readRecognitionState(establishmentId),
    readHasHiddenItems(establishmentId),
  ]);
  return { items: withGuestHiddenReason(items), recognition, hasHiddenItems };
};

/**
 * Inline-edit a menu item the partner owns.
 *
 * Allowed fields: item_name, price_byn, category_raw.
 * Side effect: sanity_flag is cleared (partner accepts responsibility for values).
 * is_hidden_by_admin is untouched — only admin can toggle that.
 *
 * The fields are checked before anything is written (from 23.11.2026, thread
 * Н8, finding 4: a value past its column failed in the database as a 500),
 * in the order of the app's form, the first that fails answering:
 *   item_name    — text, not empty once the spaces round it are cut, at most
 *                  255 characters as the database counts them; stored cut;
 *   price_byn    — null (the price removed), or a number from 0 to
 *                  99 999 999,99 (priceOf: a JSON number or a decimal in a
 *                  string); stored as the number;
 *   category_raw — null, or text of at most 100 characters once cut; stored
 *                  cut, '' included (the app sends it for a section cleared).
 * A name or a section — 422 VALIDATION_ERROR, a price — 422 INVALID_PRICE, as
 * before; each with the partner's text (MENU_ITEM_REFUSALS).
 *
 * @param {string} partnerId - UUID
 * @param {string} menuItemId - UUID
 * @param {Object} updates - { item_name?, price_byn?, category_raw? }
 * @returns {Promise<Object>} Updated menu item
 */
export const updateMenuItem = async (partnerId, menuItemId, updates) => {
  const existing = await MenuItemModel.findById(menuItemId);
  if (!existing) {
    throw new AppError(MENU_ITEM_REFUSALS.notFound, 404, 'MENU_ITEM_NOT_FOUND');
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
    throw new AppError(MENU_ITEM_REFUSALS.notFound, 404, 'MENU_ITEM_NOT_FOUND');
  }

  const partnerAllowed = ['item_name', 'price_byn', 'category_raw'];
  const filteredUpdates = {};
  for (const field of partnerAllowed) {
    if (updates[field] !== undefined) {
      filteredUpdates[field] = updates[field];
    }
  }

  if (Object.keys(filteredUpdates).length === 0) {
    throw new AppError(MENU_ITEM_REFUSALS.noChanges, 400, 'NO_FIELDS_TO_UPDATE');
  }

  if (filteredUpdates.item_name !== undefined) {
    const name = typeof filteredUpdates.item_name === 'string' ? filteredUpdates.item_name.trim() : '';
    if (name === '') {
      throw new AppError(MENU_ITEM_REFUSALS.nameRequired, 422, 'VALIDATION_ERROR');
    }
    if (longerThan(name, ITEM_NAME_MAX_CHARS)) {
      throw new AppError(MENU_ITEM_REFUSALS.nameTooLong, 422, 'VALIDATION_ERROR');
    }
    filteredUpdates.item_name = name;
  }

  if (filteredUpdates.price_byn !== undefined && filteredUpdates.price_byn !== null) {
    const price = priceOf(filteredUpdates.price_byn);
    if (!Number.isFinite(price) || price < 0) {
      throw new AppError(MENU_ITEM_REFUSALS.priceInvalid, 422, 'INVALID_PRICE');
    }
    if (price >= PRICE_TOO_HIGH_FROM) {
      throw new AppError(MENU_ITEM_REFUSALS.priceTooHigh, 422, 'INVALID_PRICE');
    }
    filteredUpdates.price_byn = price;
  }

  if (filteredUpdates.category_raw !== undefined && filteredUpdates.category_raw !== null) {
    const section = typeof filteredUpdates.category_raw === 'string' ? filteredUpdates.category_raw.trim() : null;
    if (section === null || longerThan(section, SECTION_MAX_CHARS)) {
      throw new AppError(MENU_ITEM_REFUSALS.sectionTooLong, 422, 'VALIDATION_ERROR');
    }
    filteredUpdates.category_raw = section;
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
  // The id as the database writes it — the rows are told apart by the stored
  // spelling. The route lets only that spelling through (from 23.11.2026,
  // routes/v1/partnerMenuItemRoutes.js); before, the address could carry the
  // same id in capitals.
  const rowId = existing.id;
  const copies = findCopies(rowId, visibleRows);
  const reasonBefore = withGuestHiddenReason(visibleRows)
    .find(row => row.id === rowId)?.guest_hidden_reason ?? null;

  // The row and its copies change together or not at all (updateByIds): one
  // by one, a failure in the middle left the guest's line with two prices.
  // Under the establishment's lock, in line with the moderator's «Скрыть» and
  // the write of a recognised file — and checked again there (thread Н8,
  // finding 3, 23.11.2026): since the row was looked at above, a re-read of
  // its file may have replaced it, or the moderator may have hidden it. Then
  // nothing is written, the copies neither, and the partner hears what a row
  // not there is answered. Until then such an edit answered 200 without the
  // row, written to the copies alone, or wrote into the hidden row and sent
  // the moderator's reason back. A copy hidden meanwhile is left out, as the
  // copies hidden before.
  const written = await MenuItemModel.updateByIds(
    [rowId, ...copies.map(copy => copy.id)],
    filteredUpdates,
    { lockMenuOf: existing.establishment_id, shownOnly: true, required: rowId },
  );
  if (written === null) {
    throw new AppError(MENU_ITEM_REFUSALS.notFound, 404, 'MENU_ITEM_NOT_FOUND');
  }
  const updated = written.find(row => row.id === rowId);

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

  // The edit may decide the mark: a name or a section is what it is read from.
  // Read after the edit, as the list would show it; the edit itself stands
  // whatever this read does, so a failure here does not answer it as failed.
  try {
    const rowsNow = withGuestHiddenReason(await MenuItemModel.getByEstablishmentId(
      existing.establishment_id,
      { includeHidden: false },
    ));
    const marked = rowsNow.find(row => row.id === rowId) ?? updated;
    // A rename is how a wrongly hidden dish comes back, and how a wine could.
    // Nothing stops it; the log keeps who brought what back into the guest's view.
    if (reasonBefore !== null && (marked.guest_hidden_reason ?? null) === null) {
      logger.warn('Partner edit brought a menu line back into the guest menu', {
        menuItemId,
        partnerId,
        establishmentId: existing.establishment_id,
        reasonBefore,
        before: { item_name: existing.item_name, category_raw: existing.category_raw },
        after: { item_name: marked.item_name, category_raw: marked.category_raw },
      });
    }
    return marked;
  } catch (error) {
    logger.error('The mark of an edited menu item could not be read — answered without it', {
      menuItemId,
      establishmentId: existing.establishment_id,
      error: error.message,
    });
    return updated;
  }
};

/**
 * Re-run OCR for the menu files of an establishment owned by the partner that
 * were never recognised: PDF menus and menu photos (vision_image strategy)
 * with no job done — the last job failed for good, or there is none (the
 * menu screen's «не удалось» and «не запущено»). A file recognised once is
 * left alone, even when a later re-read of it failed: its dishes stand, and a
 * re-read replaces them from the model's answer (MenuItemModel.replaceForMedia)
 * — the partner's corrections of names, prices and sections with them, and
 * the day's pages as well. Decision of the Coordinator 23.11.2026 (Н8, option
 * «Б»), carrying out his decision of 13.11.2026 (SDL CAT-C-2.14, п. 2г): a
 * restart does not erase the establishment's corrections. Until then every
 * menu file was queued, recognised ones last. To read a recognised file
 * again, the partner deletes it and uploads it anew.
 *
 * A file never recognised whose job is pending or processing — its first
 * reading going on — keeps that job and counts as queued, as before. Each
 * file is asked in that order — a job going on, then one done — right before
 * it is queued: a first reading that ended done after the card's list was
 * read is seen as done, and its fresh dishes are not read again.
 *
 * Nothing to recognise — every menu file recognised, or recognised by the
 * time its turn came — is refused: 409 NOTHING_TO_RECOGNIZE with the
 * partner's text; the controller gives the day's restart back. Every new job
 * comes out of the partner's daily recognition allowance
 * (services/ocrAllowance.js), shared with the card's create, save and upload;
 * the route's own limit (five restarts a day) still holds. A restart that the
 * spent allowance leaves with nothing queued is refused — DailyOcrLimitError,
 * 429 with Retry-After until Minsk midnight; one whose every queuing failed —
 * 500 OCR_RESTART_FAILED with the partner's text (the controller gives any
 * 5xx restart back to its daily limit); one that queued part of the files
 * answers how many, as before («запущено N из M»). The files are queued one
 * after another: a reservation waits for Redis at most its deadline
 * (config/redis.js), and queuing them at once would take that many pool
 * connections.
 *
 * Contract note: the error code NO_PDF_MENUS and the response key totalPdfs
 * predate menu-photo support and are kept verbatim — mobile matches on the
 * code (partner_menu_screen) and renaming would widen the blast radius of
 * this backend-only slice. totalPdfs carries the count of the files this
 * restart tried to queue — the menu files never recognised, less any found
 * recognised by its turn; recognised files are not counted (decision of Trunk
 * of thread Н8, 23.11.2026; until then — every menu file of the card). The app
 * shows «Распознавание запущено (N из M)», and so does the site's cabinet from
 * its part 1: on a card with two recognised files and one failed, «1 из 3»
 * read as two files that did not start; now it is «1 из 1». The name stays,
 * the wire is the same.
 *
 * @param {string} partnerId - UUID
 * @param {string} establishmentId - UUID
 * @returns {Promise<{enqueuedJobs: number, totalPdfs: number}>}
 * @throws {AppError} NOTHING_TO_RECOGNIZE when every menu file is recognised
 * @throws {DailyOcrLimitError} When the allowance left nothing queued
 * @throws {AppError} OCR_RESTART_FAILED when every file's queuing failed
 */
export const retryOcr = async (partnerId, establishmentId) => {
  const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
  if (!isOwner) {
    // The card's own text, as the route's check of the id answers.
    throw new AppError(ESTABLISHMENT_REFUSALS.notOwner, 404, 'ESTABLISHMENT_NOT_FOUND');
  }

  const eligibleMedia = await MediaModel.getOcrEligibleMedia(establishmentId);
  if (eligibleMedia.length === 0) {
    throw new AppError(MENU_RECOGNITION_REFUSALS.noMenuFiles, 400, NO_PDF_MENUS);
  }

  const recognised = await OcrJobModel.getMediaIdsWithCompletedJob(establishmentId);
  const unrecognised = eligibleMedia.filter((media) => !recognised.has(media.id));
  if (unrecognised.length === 0) {
    throw new AppError(MENU_RECOGNITION_REFUSALS.nothingToRecognize, 409, NOTHING_TO_RECOGNIZE);
  }

  let enqueuedJobs = 0;
  let refusal = null;
  let failures = 0;
  // Files found recognised by their turn: not tried, not counted in totalPdfs.
  let recognisedMeanwhile = 0;
  for (const media of unrecognised) {
    try {
      // A job going on first, then a job done (the order — the header above).
      if (await OcrJobModel.findActiveJob(media.id)) {
        enqueuedJobs += 1;
        continue;
      }
      if (await OcrJobModel.hasCompletedJobForMedia(media.id)) {
        recognisedMeanwhile += 1;
        continue;
      }
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
      failures += 1;
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
    unrecognisedMedia: unrecognised.length,
    recognisedMeanwhile,
    enqueuedJobs,
  });

  if (enqueuedJobs === 0 && refusal) {
    throw new DailyOcrLimitError(refusal);
  }
  // Every file's queuing failed (each is logged above): the restart did
  // nothing, and an answer of success let the app say «already running»
  // (finding Н40 of 25.10.2026).
  if (enqueuedJobs === 0 && failures > 0) {
    throw new AppError(MENU_RECOGNITION_REFUSALS.restartNotQueued, 500, OCR_RESTART_FAILED);
  }
  // Each file left was recognised by the time its turn came.
  if (enqueuedJobs === 0) {
    throw new AppError(MENU_RECOGNITION_REFUSALS.nothingToRecognize, 409, NOTHING_TO_RECOGNIZE);
  }

  return { enqueuedJobs, totalPdfs: unrecognised.length - recognisedMeanwhile };
};
