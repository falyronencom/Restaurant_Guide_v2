/**
 * OCR Service — Orchestrator
 *
 * Executes the full OCR pipeline for a single job:
 *   1. Fetch job + associated media
 *   2. For PDFs: try pdf-parse text extraction; if no usable text layer, fall back
 *      to vision OCR on each page via Cloudinary pg_N URLs
 *   3. For photos (file_type='image' with type='menu'): go directly to vision OCR
 *   4. Run the LLM structurer on raw text → array of menu items
 *   4a. A text layer whose items came out almost without prices is read again as
 *      page images, and the result with more prices is kept (readPricesFromPageImages)
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
 * download (pdfTextExtractor.PDF_FETCH_TIMEOUT_MS), one vision call — all
 * pages go in a single request — and one structurer call; pdf-parse and the
 * DB writes are seconds at most. A download timeout falls back to vision OCR
 * (extractRawText — hence the sum includes the fallback path); a vision or
 * structurer timeout fails the job right there (markFailed) — except inside
 * the price fallback of a text-layer PDF, which keeps the text-layer items
 * instead. That fallback (download + structurer, then vision + a second
 * structurer call) fits the same sum only because it starts no later than
 * PRICE_FALLBACK_START_DEADLINE_MS into the job. Either way a job
 * settles — done or failed — within this bound. server.js measures the
 * graceful-shutdown budget against it
 * (config/shutdown.js): ocrJobPoller.stop() waits for the job in flight, and
 * a job that outlives the budget dies with the process as a 'processing'
 * zombie for the stale sweep. Observed on production, July–August 2026
 * (84 jobs): p50 6.7 s, p99 30 s, max 38 s.
 */
const JOB_DURATION_BOUND_MS = pdfTextExtractor.PDF_FETCH_TIMEOUT_MS +
  visionOcrAdapter.REQUEST_TIMEOUT_MS +
  llmStructurer.REQUEST_TIMEOUT_MS;

/**
 * A PDF with a text layer whose structured items carry a price in fewer than
 * this share of positions is read again as page images (readPricesFromPageImages).
 *
 * Why (2026-09-28, re-OCR on gemini-3.8-flash): Charlie's PDF keeps its prices
 * in a separate column of the text layer, apart from the dish names. The text
 * came out as 73 items without a single price; the same pages read as images
 * gave 41 + 35 items, all priced. The model it replaced had paired the column
 * with the names at an offset — 57 prices, and all 50 that could be checked
 * against the images were wrong — so "no prices" is the honest reading of
 * that text, and only the image carries the layout.
 *
 * Why 0.5, from the data of 28.09: healthy text-layer PDFs on production carry
 * a price in 84–100 % of their items (the lowest, Zalkind at 84 %, is set menus
 * whose dishes have no price of their own), the broken one in 0 %; read as
 * images the same PDFs give 90–100 %. The cut sits more than 30 points from
 * either side and still catches a PDF broken on most of its pages.
 * Coordinator decision 2026-09-29, option A of three (B — only when no item
 * has a price: misses a PDF broken on one page of two; C — below 80 %: set
 * menus at 84 % sit on the edge). Change it only with the same kind of data.
 */
const PDF_TEXT_MIN_PRICED_SHARE = 0.5;

/**
 * The price fallback — one vision call plus a second structurer call — starts
 * only if the job has run no longer than this, so that the whole job still
 * fits JOB_DURATION_BOUND_MS. Later than that the text-layer items are kept
 * (outcome 'no_budget'). The text path takes 5–17 s on production (28.09).
 */
const PRICE_FALLBACK_START_DEADLINE_MS = JOB_DURATION_BOUND_MS -
  visionOcrAdapter.REQUEST_TIMEOUT_MS -
  llmStructurer.REQUEST_TIMEOUT_MS;

/**
 * @param {Object[]} items - Structurer output
 * @returns {number} How many items carry a price
 */
const countPriced = (items) => items.filter((it) => it.price_byn != null).length;

/**
 * Whether structured text-layer items are "almost without prices" — below
 * PDF_TEXT_MIN_PRICED_SHARE. An empty result is not: nothing to price-check,
 * and no evidence yet that a text layer yields no items at all.
 *
 * @param {Object[]} items - Structurer output for the text layer
 * @returns {boolean}
 */
const lacksPrices = (items) => items.length > 0 &&
  countPriced(items) < items.length * PDF_TEXT_MIN_PRICED_SHARE;

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

/**
 * Extract raw text from a media record by choosing the right strategy.
 *
 * @param {Object} media - establishment_media row
 * @returns {Promise<{ rawText: string, confidenceOverall: number | null, strategy: string, pageCount?: number }>}
 *   pageCount — only for 'pdf_text_layer': the price fallback renders these pages
 */
const extractRawText = async (media) => {
  if (media.file_type === 'pdf') {
    let parseResult = null;
    try {
      parseResult = await pdfTextExtractor.extractText(media.url);
    } catch (error) {
      logger.warn('pdf-parse failed, falling back to vision OCR', {
        mediaId: media.id,
        error: error.message,
      });
    }

    if (parseResult && parseResult.hasTextLayer) {
      return {
        rawText: parseResult.text,
        confidenceOverall: 0.95,
        strategy: 'pdf_text_layer',
        pageCount: parseResult.pageCount,
      };
    }

    const pageUrls = buildPdfPageUrls(media, parseResult?.pageCount || 0);
    const visionResult = await visionOcrAdapter.extractFromImages(pageUrls);
    return {
      rawText: visionResult.rawText,
      confidenceOverall: visionResult.confidenceOverall,
      strategy: parseResult ? 'vision_pdf_fallback' : 'vision_pdf_no_metadata',
    };
  }

  if (media.file_type === 'image') {
    const visionResult = await visionOcrAdapter.extractFromImages([media.url]);
    return {
      rawText: visionResult.rawText,
      confidenceOverall: visionResult.confidenceOverall,
      strategy: 'vision_image',
    };
  }

  throw new Error(`Unsupported file_type for OCR: ${media.file_type}`);
};

/**
 * Price fallback of a text-layer PDF (see PDF_TEXT_MIN_PRICED_SHARE): the
 * same pages go through vision OCR and the structurer again, and the result
 * with more priced items is kept. Equal or fewer — the text-layer items stay:
 * a menu without prices ("по запросу") reads no better as an image, and the
 * text layer spells names exactly. The text-layer items are already a valid
 * result, so the fallback never fails the job: a vision or structurer error
 * keeps them, as does a job too far into its time bound to afford the calls.
 *
 * Every outcome lands in result_summary.price_fallback and in the log:
 *   'vision'            — page images gave more prices; strategy becomes
 *                         'vision_pdf_price_fallback'
 *   'vision_not_better' — images gave no more prices; text-layer items kept
 *   'vision_failed'     — vision or structurer call threw; text-layer items kept
 *   'no_budget'         — past PRICE_FALLBACK_START_DEADLINE_MS; not attempted
 *
 * @param {Object} params
 * @param {Object} params.media - establishment_media row (file_type='pdf')
 * @param {number} params.pageCount - Page count from pdf-parse
 * @param {Object[]} params.textItems - Structurer output for the text layer
 * @param {number} params.jobStartedAt - Date.now() at the start of processJob
 * @param {string} params.jobId - For the log
 * @returns {Promise<{ items: Object[], strategy: string, priceFallback: Object }>}
 */
const readPricesFromPageImages = async ({ media, pageCount, textItems, jobStartedAt, jobId }) => {
  const textLayer = { items_count: textItems.length, priced_count: countPriced(textItems) };
  const keepTextLayer = (outcome, details) => ({
    items: textItems,
    strategy: 'pdf_text_layer',
    priceFallback: { outcome, text_layer: textLayer, ...details },
  });

  logger.warn('PDF text layer is almost without prices — price fallback via page images', {
    jobId,
    mediaId: media.id,
    pageCount,
    ...textLayer,
  });

  const elapsedMs = Date.now() - jobStartedAt;
  if (elapsedMs > PRICE_FALLBACK_START_DEADLINE_MS) {
    logger.warn('Price fallback skipped: no time left in the job bound', {
      jobId,
      mediaId: media.id,
      elapsedMs,
      deadlineMs: PRICE_FALLBACK_START_DEADLINE_MS,
    });
    return keepTextLayer('no_budget', { elapsed_ms: elapsedMs });
  }

  let visionItems;
  try {
    const visionResult = await visionOcrAdapter.extractFromImages(buildPdfPageUrls(media, pageCount));
    visionItems = await llmStructurer.structureMenu(visionResult.rawText);
  } catch (error) {
    logger.warn('Price fallback failed, text-layer items kept', {
      jobId,
      mediaId: media.id,
      error: error.message,
    });
    return keepTextLayer('vision_failed', { error: error.message.slice(0, 200) });
  }

  const vision = { items_count: visionItems.length, priced_count: countPriced(visionItems) };
  if (vision.priced_count > textLayer.priced_count) {
    return {
      items: visionItems,
      strategy: 'vision_pdf_price_fallback',
      priceFallback: { outcome: 'vision', text_layer: textLayer, vision },
    };
  }
  return keepTextLayer('vision_not_better', { vision });
};

/**
 * Compute result_summary metadata for admin observability.
 *
 * @param {Object[]} items - Items with sanity_flag applied
 * @param {string} strategy - Which extraction path was used
 * @param {Object|null} [priceFallback] - readPricesFromPageImages outcome, when it ran
 * @returns {Object}
 */
const buildResultSummary = (items, strategy, priceFallback = null) => {
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
    ...(priceFallback && { price_fallback: priceFallback }),
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
  const jobStartedAt = Date.now();
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

    const extracted = await extractRawText(media);
    const { rawText } = extracted;
    let { strategy } = extracted;

    if (!rawText || rawText.trim().length === 0) {
      throw new Error(`OCR produced empty text via strategy=${strategy}`);
    }

    let rawItems = await llmStructurer.structureMenu(rawText);
    let priceFallback = null;

    if (strategy === 'pdf_text_layer' && lacksPrices(rawItems)) {
      ({ items: rawItems, strategy, priceFallback } = await readPricesFromPageImages({
        media,
        pageCount: extracted.pageCount,
        textItems: rawItems,
        jobStartedAt,
        jobId,
      }));
    }

    if (rawItems.length === 0) {
      logger.warn('LLM structurer returned 0 items', {
        jobId,
        mediaId: media.id,
        strategy,
        rawTextLength: rawText.length,
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

    const summary = buildResultSummary(flaggedItems, strategy, priceFallback);

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
  lacksPrices,
  notifyPartnerIfBatchFinished,
  JOB_DURATION_BOUND_MS,
  PRICE_FALLBACK_START_DEADLINE_MS,
  VISION_FALLBACK_PAGE_LIMIT,
};
