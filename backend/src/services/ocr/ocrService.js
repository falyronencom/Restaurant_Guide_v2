/**
 * OCR Service — Orchestrator
 *
 * Executes the full OCR pipeline for a single job:
 *   1. Fetch job + associated media
 *   2. For PDFs: try pdf-parse text extraction; if no usable text layer, fall back
 *      to vision OCR on each page via Cloudinary pg_N URLs
 *   3. For photos (file_type='image' with type='menu'): go directly to vision OCR
 *   4. Run the LLM structurer on raw text → array of menu items
 *   5. Run sanity checker with previous items as context (delta comparison)
 *   6. Transactionally replace menu_items for this media
 *   7. Mark job done (with result_summary) or failed (with retry logic)
 *   8. Notify partner via notifyMenuParsed (fire-and-forget, Segment B)
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
 * @returns {Promise<{ rawText: string, confidenceOverall: number | null, strategy: string }>}
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
 * Compute result_summary metadata for admin observability.
 *
 * @param {Object[]} items - Items with sanity_flag applied
 * @param {string} strategy - Which extraction path was used
 * @returns {Object}
 */
const buildResultSummary = (items, strategy) => {
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
  };
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

    const { rawText, strategy } = await extractRawText(media);

    if (!rawText || rawText.trim().length === 0) {
      throw new Error(`OCR produced empty text via strategy=${strategy}`);
    }

    const rawItems = await llmStructurer.structureMenu(rawText);

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

    const summary = buildResultSummary(flaggedItems, strategy);

    await ocrJobModel.markDone(jobId, summary);

    logger.info('OCR job completed', {
      jobId,
      mediaId: media.id,
      ...summary,
    });

    // Segment B: notify partner that menu has been parsed. Fire-and-forget —
    // notification failure must never cause OCR job to be marked failed.
    NotificationService.notifyMenuParsed(job.establishment_id, flaggedItems.length)
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

    await ocrJobModel.markFailed(jobId, error.message);

    return { success: false, jobId, error: error.message };
  }
};

export { buildPdfPageUrls, buildResultSummary, VISION_FALLBACK_PAGE_LIMIT };
