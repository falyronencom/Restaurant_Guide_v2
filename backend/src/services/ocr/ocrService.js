/**
 * OCR Service — Orchestrator
 *
 * Executes the full OCR pipeline for a single job:
 *   1. Fetch job + associated media
 *   2. For PDFs: read every page as an image — one vision call per page
 *      (Cloudinary pg_N URLs), all pages at once; pdf-parse supplies the page
 *      count and the text layer, which is used only when the image read fails
 *      (extractPageTexts)
 *   3. For photos (file_type='image' with type='menu'): one vision call
 *   4. Run the LLM structurer on the text of each page — one call per page,
 *      all pages at once — and join the pages into one array of menu items
 *      (structurePages)
 *   5. Run sanity checker with previous items as context (delta comparison)
 *   6. Transactionally replace menu_items for this media
 *   7. Mark job done (with result_summary) or failed (with retry logic)
 *   8. Notify partner once per upload batch via notifyMenuParsed — when the job
 *      that just settled was the last active one for the establishment
 *      (awaited, errors logged only, Segment B; see notifyPartnerIfBatchFinished)
 */

import logger from '../../utils/logger.js';
import * as ocrJobModel from '../../models/ocrJobModel.js';
import * as menuItemModel from '../../models/menuItemModel.js';
import * as MediaModel from '../../models/mediaModel.js';
import * as NotificationService from '../notificationService.js';
import * as pdfTextExtractor from './pdfTextExtractor.js';
import * as visionOcrAdapter from './visionOcrAdapter.js';
import * as llmStructurer from './llmStructurer.js';
import * as sanityChecker from './sanityChecker.js';
import { generatePdfPageImageUrl } from '../../config/cloudinary.js';

/**
 * Maximum pages to send to vision OCR when pdf-parse failed entirely and we can't
 * determine the real page count. Phase 1 safety valve — prevents runaway cost on
 * corrupted PDFs. Real page count from pdf-parse metadata is preferred.
 */
const VISION_FALLBACK_PAGE_LIMIT = 2;

/**
 * Upper bound of one job's wall-clock time, from the stage timeouts: the PDF
 * download (pdfTextExtractor.PDF_FETCH_TIMEOUT_MS), the image read and the
 * structuring; pdf-parse and the DB writes are seconds at most. Every page has
 * its own vision call and its own structurer call, and the pages of a stage
 * run at the same time: the image read ends when its slowest page settles —
 * within one vision timeout — and only then does structuring start, which
 * ends within one structurer timeout (readPagesAsImages, structurePages). A
 * download failure still leaves the image read (without the page count), and
 * on the job's last attempt an image-read failure on a PDF with a text layer
 * falls back to that text layer, structured in one call — both inside the same
 * sum (extractPageTexts). A structurer failure, or an image-read failure with
 * nothing to fall back to, fails the job right there (markFailed). Either way
 * a job settles — done or failed — within this bound. server.js measures the
 * graceful-shutdown budget against it
 * (config/shutdown.js): ocrJobPoller.stop() waits for the job in flight, and
 * a job that outlives the budget dies with the process as a 'processing'
 * zombie for the stale sweep. Observed on production, July–August 2026
 * (84 jobs): p50 6.7 s, p99 30 s, max 38 s. Big PDFs, measured 2026-09-29
 * with one call per stage: Zalkind (9 pages → 128 items) vision 27–32 s,
 * structurer 40–41 s; Сорренто (3 pages → 161 items) — the structurer timed
 * out at 60 s. Page by page the same menus read in ≈ 7 s and structured in
 * 15 s and 23 s.
 */
const JOB_DURATION_BOUND_MS = pdfTextExtractor.PDF_FETCH_TIMEOUT_MS +
  visionOcrAdapter.REQUEST_TIMEOUT_MS +
  llmStructurer.REQUEST_TIMEOUT_MS;

/**
 * Build the list of image URLs to send to vision OCR, given a PDF media record.
 *
 * @param {Object} media - establishment_media row (file_type='pdf')
 * @param {number} knownPageCount - Page count from pdf-parse metadata, or 0 if unknown
 * @returns {string[]} Image URLs
 */
const buildPdfPageUrls = (media, knownPageCount) => {
  const pageCount = knownPageCount > 0
    ? knownPageCount
    : VISION_FALLBACK_PAGE_LIMIT;

  const urls = [];
  for (let page = 1; page <= pageCount; page++) {
    urls.push(generatePdfPageImageUrl(media.url, page));
  }
  return urls;
};

/** @param {string|null|undefined} text */
const isBlank = (text) => !text || text.trim().length === 0;

/**
 * The failure of the first failed page in page order (not the first to fail
 * in time — the report does not depend on timing). When there is more than
 * one page, its message names the page: "page 2 of 9: OpenRouter vision call
 * failed: 500 …".
 *
 * @param {PromiseSettledResult[]} settled - One result per page, in page order
 * @returns {*} The failure to throw, or null when every page succeeded
 */
const firstPageFailure = (settled) => {
  const index = settled.findIndex((result) => result.status === 'rejected');
  if (index === -1) return null;
  const { reason } = settled[index];
  if (settled.length === 1) return reason;
  return new Error(`page ${index + 1} of ${settled.length}: ${reason?.message ?? String(reason)}`, {
    cause: reason,
  });
};

/**
 * Read PDF pages as images: one vision call per page, all pages at once.
 *
 * One call for the whole document grew with the text of every page (Zalkind,
 * 9 pages: 27–32 s of the 60 s timeout, 2026-09-29) and did not always keep
 * the page order — the same Zalkind came back as pages 2, 3, 1, 4, 9, 5…, and
 * its card listed the menu in that order. A call per page keeps the order and
 * takes as long as the slowest page (≈ 7 s for those 9 pages).
 *
 * Every call is awaited to its end even when another fails (allSettled): the
 * job leaves no request running behind it — graceful shutdown waits for the
 * job, not for stray calls.
 *
 * @param {string[]} pageUrls - Page images, in page order
 * @returns {Promise<string[]>} Text of every page, in page order; a page with
 *   nothing to read (a cover, a picture) is blank
 * @throws {Error} the first failed page (firstPageFailure); 'vision OCR
 *   returned empty text' when every page came back blank
 */
const readPagesAsImages = async (pageUrls) => {
  const reads = await Promise.allSettled(
    pageUrls.map((url) => visionOcrAdapter.extractFromImages([url])),
  );
  const failure = firstPageFailure(reads);
  if (failure) throw failure;

  const pageTexts = reads.map((read) => read.value.rawText);
  if (pageTexts.every(isBlank)) {
    throw new Error('vision OCR returned empty text');
  }
  return pageTexts;
};

/**
 * Extract the text of a media record, page by page, by choosing the right
 * strategy.
 *
 * PDFs are read as page images first — with or without a text layer. A text
 * layer keeps the words but not the layout: where a menu sets its prices in a
 * column apart from the dish names, the text carries the prices as a separate
 * block, and the structurer can only guess which price is whose. Production,
 * September 2026: Charlie's PDF came out with no prices at all (28.09) and, on
 * another upload, with 15 prices of 35 on the wrong dishes (29.09); SFB Minsk
 * showed 17 wrong prices on an active card. Read as images, the same pages
 * gave the right prices on every file checked (29.09: Charlie 71/73 and 32/32,
 * SFB 47/47, MARBL 54/55, Charlie 9/9 against the verified image read).
 *
 * pdf-parse still runs first: its page count decides how many pages are
 * rendered (unknown → VISION_FALLBACK_PAGE_LIMIT, strategy
 * 'vision_pdf_no_metadata'), and its text layer is the last resort. An image
 * read that fails — an error or a timeout on any page, or every page blank —
 * fails the attempt like any other error, and the retry usually reads the
 * pages; only on the job's last attempt (`textLayerBackup`) does a usable text
 * layer stand in (strategy 'pdf_text_layer', the error in visionError, logged
 * as an error — its prices may sit on the wrong dishes). Without a text layer
 * the last attempt fails the job, as before.
 *
 * Accepted risks, not covered: the structurer on the image text has no backup
 * — a second round would break JOB_DURATION_BOUND_MS; it runs page by page
 * (structurePages), so its ceiling is the largest page, not the whole menu.
 * The text layer comes as one text for the whole PDF and is structured in one
 * call, which on a very big menu can still time out — it is the last
 * attempt's last resort.
 *
 * @param {Object} media - establishment_media row
 * @param {Object} [options]
 * @param {boolean} [options.textLayerBackup=false] - Last attempt: a failed
 *   image read of a PDF falls back to its text layer
 * @returns {Promise<{ pageTexts: string[], strategy: string, pagesCount?: number, visionError?: string }>}
 *   pageTexts — one text per page read as an image (a photo is one page), or
 *   the whole text layer as one text; pagesCount — PDFs only: the pages read
 *   as images, or the pages the text layer covers
 */
const extractPageTexts = async (media, { textLayerBackup = false } = {}) => {
  if (media.file_type === 'pdf') {
    let parseResult = null;
    try {
      parseResult = await pdfTextExtractor.extractText(media.url);
    } catch (error) {
      logger.warn('pdf-parse failed, reading PDF pages as images without the page count', {
        mediaId: media.id,
        error: error.message,
      });
    }

    const pageUrls = buildPdfPageUrls(media, parseResult?.pageCount || 0);
    try {
      return {
        pageTexts: await readPagesAsImages(pageUrls),
        strategy: parseResult?.pageCount > 0 ? 'vision_pdf' : 'vision_pdf_no_metadata',
        pagesCount: pageUrls.length,
      };
    } catch (error) {
      if (!textLayerBackup || !parseResult?.hasTextLayer) throw error;
      logger.error('Reading PDF pages as images failed on the last attempt — falling back to the text layer', {
        mediaId: media.id,
        pageCount: parseResult.pageCount,
        error: error.message,
      });
      return {
        pageTexts: [parseResult.text],
        strategy: 'pdf_text_layer',
        pagesCount: parseResult.pageCount,
        visionError: error.message,
      };
    }
  }

  if (media.file_type === 'image') {
    const visionResult = await visionOcrAdapter.extractFromImages([media.url]);
    return { pageTexts: [visionResult.rawText], strategy: 'vision_image' };
  }

  throw new Error(`Unsupported file_type for OCR: ${media.file_type}`);
};

/** A section name the structurer gave an item; null or a blank string is none. */
const hasCategory = (item) => typeof item.category_raw === 'string' && item.category_raw.trim().length > 0;

/**
 * Join the items of consecutive pages, carrying a section across a page break.
 *
 * A page structured on its own does not see the heading of a section that
 * began on an earlier page: the items at its top come back without a category
 * (category_raw null). On a menu whose sections run on across pages (Facktory
 * Bar, 6 pages, measured 2026-09-29) that was 12 items of 69; the one-call
 * structurer had put every one of them in the section they continue. So the
 * items at the top of a page without a category take the category of the last
 * item that had one before them — the section still open at the page break —
 * and the first item with a category of its own ends the carry. An item
 * without a category further down a page is the model's reading of that page
 * and stays; a menu without headings has nothing to carry.
 *
 * Not repaired: an item cut by the page break itself — its description at the
 * top of the next page can come back as an item of its own, without a price
 * (Facktory Bar: 1 of 69); and a heading left alone at the bottom of a page,
 * its first items on the next one — they take the section before that heading,
 * which only one call over both pages would have seen.
 *
 * @param {Object[][]} pages - Structured items of each page, in page order
 * @returns {{ items: Object[], categoriesCarried: number }}
 */
const carryCategoriesAcrossPages = (pages) => {
  const items = [];
  let openCategory = null;
  let categoriesCarried = 0;

  pages.forEach((pageItems, pageIndex) => {
    let atPageTop = pageIndex > 0;
    for (const item of pageItems) {
      if (hasCategory(item)) atPageTop = false;
      if (atPageTop && openCategory != null) {
        items.push({ ...item, category_raw: openCategory });
        categoriesCarried += 1;
      } else {
        items.push(item);
      }
      if (hasCategory(item)) openCategory = item.category_raw;
    }
  });

  return { items, categoriesCarried };
};

/**
 * Structure a menu page by page: one structurer call per page, all pages at
 * once, the items joined in page order (carryCategoriesAcrossPages).
 *
 * The structurer's time grows with the items it writes out — about 3 s per
 * call plus the JSON of every item — and one call for a whole big menu ran
 * into the 60 s timeout (Сорренто, 161 items, 2026-09-29; the same menu had
 * passed on 28.09 — the model's speed varies from day to day). Calls one
 * after another would not help: each brings its own few seconds, and Zalkind
 * took 60.5 s that way against 39.5 s in one call. At the same time the stage
 * lasts as long as its largest page (Zalkind 15 s, Сорренто 23 s).
 *
 * A blank page costs no call (structureMenu returns [] for it). As in the
 * image read, every call is awaited to its end, and the failure reported is
 * the first failed page.
 *
 * @param {string[]} pageTexts - Text of each page, in page order
 * @returns {Promise<{ items: Object[], categoriesCarried: number }>}
 */
const structurePages = async (pageTexts) => {
  const results = await Promise.allSettled(
    pageTexts.map((text) => llmStructurer.structureMenu(text)),
  );
  const failure = firstPageFailure(results);
  if (failure) throw failure;

  return carryCategoriesAcrossPages(results.map((result) => result.value));
};

/**
 * Compute result_summary metadata for admin observability.
 *
 * @param {Object[]} items - Items with sanity_flag applied
 * @param {string} strategy - Which extraction path was used
 * @param {Object} [details]
 * @param {string|null} [details.visionError] - Why the image read of a PDF
 *   failed, when its text layer was used instead (strategy 'pdf_text_layer')
 * @param {number} [details.pagesCount] - PDFs: pages read (extractPageTexts)
 * @param {number} [details.categoriesCarried] - PDFs: items whose section was
 *   carried over a page break (carryCategoriesAcrossPages)
 * @returns {Object} pages_count and categories_carried appear for PDFs only
 */
const buildResultSummary = (items, strategy, { visionError = null, pagesCount, categoriesCarried } = {}) => {
  const totalCount = items.length;
  const flaggedCount = items.filter((it) => it.sanity_flag !== null).length;

  const confidences = items
    .map((it) => (it.confidence == null ? null : Number(it.confidence)))
    .filter((c) => c != null);
  const confidenceAvg = confidences.length > 0
    ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3))
    : null;

  return {
    strategy,
    items_count: totalCount,
    flagged_count: flaggedCount,
    confidence_avg: confidenceAvg,
    ...(visionError && { vision_error: visionError.slice(0, 200) }),
    ...(pagesCount != null && { pages_count: pagesCount, categories_carried: categoriesCarried }),
  };
};

/**
 * Batch-level partner notification (Coordinator decision 2026-09-04, option «б»).
 *
 * A job is one menu file, but the partner uploads a menu: N files used to
 * yield N in-app rows and — once push arrived — N pushes spread over the
 * serial poller's run. Now the partner hears once, when the job that just
 * settled left no active (pending/processing) sibling for the establishment.
 *
 * A "batch" is therefore the set of jobs of one establishment that overlap in
 * the queue: whatever is still pending/processing while a job settles belongs
 * to the same batch. Files uploaded more than a poll cycle plus processing
 * time apart form separate batches and notify separately — by design, those
 * are separate uploads. A job that markFailed returned to 'pending' for a
 * retry keeps the batch open; whichever job settles last sends the
 * notification, and the text is computed from the whole menu at that moment
 * (notificationService). A 'processing' row older than
 * ocrJobModel.STALE_PROCESSING_INTERVAL is a zombie and does not hold the
 * batch open (see countActiveJobsForEstablishment); the poller's stale sweep
 * settles it later and, when that fails it permanently, closes the batch
 * through this same function (ocrJobPoller.sweepStaleJobs).
 *
 * The poller runs jobs one at a time, so the "no active jobs left" check that
 * follows markDone / markFailed cannot race with a sibling settling at the
 * same instant (ocrJobPoller header notes the multi-poller caveat).
 *
 * `failedJobId` marks the permanent-failure branch: the batch is reported only
 * if a batch mate was recognised while the failed job was alive (a 'done' job
 * completed after it was enqueued). A lone failed upload, or a batch that
 * failed entirely, stays silent — the retry flow covers it, as before.
 *
 * Known edge (accepted): deleting a menu file whose job is still pending
 * cascades the job away, so a sibling that already deferred never gets its
 * notification. The partner still sees the recognised items on the menu screen.
 *
 * Errors are logged and never reach the job outcome (callers attach .catch).
 *
 * @param {string} establishmentId - UUID
 * @param {Object} [options]
 * @param {string|null} [options.failedJobId] - Set when a permanent failure settled this job
 * @returns {Promise<boolean>} Whether the notification was sent
 */
const notifyPartnerIfBatchFinished = async (establishmentId, { failedJobId = null } = {}) => {
  const activeJobs = await ocrJobModel.countActiveJobsForEstablishment(establishmentId);
  if (activeJobs > 0) {
    logger.debug('menu_parsed notification deferred: batch still active', {
      establishmentId,
      activeJobs,
    });
    return false;
  }

  if (failedJobId) {
    const doneInBatch = await ocrJobModel.countDoneJobsSinceEnqueue({
      establishmentId,
      jobId: failedJobId,
    });
    if (doneInBatch === 0) {
      logger.debug('menu_parsed notification skipped: nothing recognised in the failed batch', {
        establishmentId,
        failedJobId,
      });
      return false;
    }
  }

  await NotificationService.notifyMenuParsed(establishmentId);
  return true;
};

/**
 * Run the full OCR pipeline for a job. Called by the poller after pickNextPending,
 * or directly in tests.
 *
 * On success: marks job 'done' and persists menu_items.
 * On any exception: marks job 'failed' (with retry if attempts < max_attempts).
 *
 * @param {string} jobId - UUID of a job in 'processing' status
 * @returns {Promise<{ success: boolean, jobId: string, itemCount?: number, error?: string }>}
 */
export const processJob = async (jobId) => {
  const job = await ocrJobModel.getJobStatus(jobId);
  if (!job) {
    logger.error('processJob called with unknown jobId', { jobId });
    return { success: false, jobId, error: 'job_not_found' };
  }

  try {
    const media = await MediaModel.findMediaById(job.media_id);
    if (!media) {
      throw new Error(`Media not found: ${job.media_id}`);
    }

    // The text layer of a PDF is the last resort: an image read that fails on
    // an earlier attempt goes back to the queue (markFailed) and is retried.
    const { pageTexts, strategy, pagesCount, visionError } = await extractPageTexts(media, {
      textLayerBackup: job.attempts >= job.max_attempts,
    });

    if (pageTexts.every(isBlank)) {
      throw new Error(`OCR produced empty text via strategy=${strategy}`);
    }

    const { items: rawItems, categoriesCarried } = await structurePages(pageTexts);

    if (rawItems.length === 0) {
      logger.warn('LLM structurer returned 0 items', {
        jobId,
        mediaId: media.id,
        strategy,
        rawTextLength: pageTexts.reduce((sum, text) => sum + (text?.length ?? 0), 0),
      });
    }

    const previousItems = await menuItemModel.getByEstablishmentId(job.establishment_id, {
      includeHidden: true,
    });
    const previousForThisMedia = previousItems.filter((it) => it.media_id === job.media_id);

    const flaggedItems = sanityChecker.check(rawItems, previousForThisMedia);

    await menuItemModel.replaceForMedia({
      establishmentId: job.establishment_id,
      mediaId: job.media_id,
      newItems: flaggedItems,
    });

    const summary = buildResultSummary(flaggedItems, strategy, { visionError, pagesCount, categoriesCarried });

    await ocrJobModel.markDone(jobId, summary);

    logger.info('OCR job completed', {
      jobId,
      mediaId: media.id,
      ...summary,
    });

    // Segment B: notify partner once the whole upload batch has settled.
    // The job outcome is already persisted above and never depends on this:
    // errors are caught and logged. It is awaited (not fire-and-forget) so the
    // poller's in-flight promise — which graceful shutdown waits for before
    // closing the pool — covers the notification; a redeploy landing on the
    // last job of a batch must not leave the partner without it.
    await notifyPartnerIfBatchFinished(job.establishment_id)
      .catch((err) => logger.error('notifyMenuParsed failed', {
        error: err.message,
        establishmentId: job.establishment_id,
      }));

    return { success: true, jobId, itemCount: flaggedItems.length };
  } catch (error) {
    logger.error('OCR job failed', {
      jobId,
      error: error.message,
      stack: error.stack,
    });

    const failedJob = await ocrJobModel.markFailed(jobId, error.message);

    // A permanent failure settles this job too: if it was the last active one,
    // the partner still hears what the rest of the batch produced. Awaited for
    // the same shutdown reason as above; errors stay in the log.
    if (failedJob && failedJob.status === 'failed') {
      await notifyPartnerIfBatchFinished(job.establishment_id, { failedJobId: jobId })
        .catch((err) => logger.error('notifyMenuParsed failed after permanent failure', {
          error: err.message,
          establishmentId: job.establishment_id,
        }));
    }

    return { success: false, jobId, error: error.message };
  }
};

export {
  buildPdfPageUrls,
  buildResultSummary,
  carryCategoriesAcrossPages,
  notifyPartnerIfBatchFinished,
  JOB_DURATION_BOUND_MS,
  VISION_FALLBACK_PAGE_LIMIT,
};
