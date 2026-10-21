/**
 * OCR Job Model
 *
 * Persistent background job queue for OCR menu processing.
 * Uses PostgreSQL with FOR UPDATE SKIP LOCKED for safe concurrent polling.
 *
 * Table: ocr_jobs
 * Status flow: pending → processing → (done | failed)
 * Retry: markFailed returns job to 'pending' if attempts < max_attempts (default 3),
 *        otherwise transitions to 'failed' permanently; markFailedPermanently
 *        fails it at once (a PDF whose parse broke its limits).
 * Reaper: reapStaleProcessingJobs settles 'processing' rows older than
 *         STALE_PROCESSING_INTERVAL — a process that ended mid-attempt never
 *         settles its own row; ocrJobPoller sweeps them. Such a row is failed
 *         for good, not retried, unless a planned shutdown marked it
 *         (markInterruptedByShutdown): then the markFailed rule applies.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * The active (pending/processing) job of a media file, the newest one, or null.
 *
 * @param {string} mediaId - UUID of establishment_media row
 * @returns {Promise<Object|null>}
 */
export const findActiveJob = async (mediaId) => {
  const result = await pool.query(
    `SELECT * FROM ocr_jobs
     WHERE media_id = $1 AND status IN ('pending', 'processing')
     ORDER BY created_at DESC
     LIMIT 1`,
    [mediaId],
  );
  return result.rows[0] || null;
};

/**
 * Enqueue an OCR job for a media file.
 *
 * Idempotency: if an active (pending/processing) job already exists for this media,
 * return it instead of creating a duplicate. This makes trigger logic in Segment B
 * safe against repeated calls (e.g., partner clicking "re-run OCR" twice).
 * A 'processing' row orphaned by a dead process would satisfy this check forever;
 * the poller's stale sweep (reapStaleProcessingJobs) settles it within about an hour.
 *
 * Called directly only by the allowance (services/ocrAllowance.js — every
 * job a partner's request queues) and by the moderator's approval
 * (adminService); tests/unit/ocrEnqueueDoors.test.js holds that list.
 *
 * @param {Object} params
 * @param {string} params.establishmentId - UUID
 * @param {string} params.mediaId - UUID of establishment_media row
 * @returns {Promise<Object>} Job row (either newly created or pre-existing active)
 */
export const enqueue = async ({ establishmentId, mediaId }) => {
  const existing = await findActiveJob(mediaId);

  if (existing) {
    logger.debug('OCR job already active for media, returning existing', {
      jobId: existing.id,
      mediaId,
      status: existing.status,
    });
    return existing;
  }

  const result = await pool.query(
    `INSERT INTO ocr_jobs (establishment_id, media_id, status, attempts)
     VALUES ($1, $2, 'pending', 0)
     RETURNING *`,
    [establishmentId, mediaId],
  );

  logger.info('OCR job enqueued', {
    jobId: result.rows[0].id,
    establishmentId,
    mediaId,
  });

  return result.rows[0];
};

/**
 * Atomically pick the next pending job and mark it as processing.
 *
 * Uses FOR UPDATE SKIP LOCKED so multiple pollers (if we ever run several) never
 * grab the same job. Increments attempts counter as part of the pick — markFailed
 * then checks attempts >= max_attempts to decide final 'failed' vs retry 'pending'.
 *
 * @returns {Promise<Object|null>} Job row or null if no pending jobs
 */
export const pickNextPending = async () => {
  const result = await pool.query(
    `UPDATE ocr_jobs
     SET status = 'processing',
         started_at = NOW(),
         attempts = attempts + 1
     WHERE id = (
       SELECT id FROM ocr_jobs
       WHERE status = 'pending'
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
  );

  return result.rows[0] || null;
};

/**
 * Mark a job as successfully completed.
 *
 * @param {string} jobId - UUID
 * @param {Object} resultSummary - Metadata (items_count, confidence_avg, etc.) for admin observability
 * @returns {Promise<Object|null>} Updated job row or null if not found
 */
export const markDone = async (jobId, resultSummary) => {
  const result = await pool.query(
    `UPDATE ocr_jobs
     SET status = 'done',
         result_summary = $2,
         completed_at = NOW(),
         error_message = NULL
     WHERE id = $1
     RETURNING *`,
    [jobId, resultSummary],
  );

  return result.rows[0] || null;
};

/**
 * SET clause that settles a failed attempt — markFailed's retry rule: back to
 * 'pending' while attempts remain (started_at cleared for the next pick),
 * 'failed' with completed_at once the last attempt is spent (started_at kept
 * for forensics). attempts was incremented by pickNextPending, so the
 * comparison is >= max_attempts. Placeholder contract: $2 = error message.
 */
const SETTLE_FAILED_ATTEMPT_SET = `SET status = CASE
           WHEN attempts >= max_attempts THEN 'failed'
           ELSE 'pending'
         END,
         error_message = $2,
         completed_at = CASE
           WHEN attempts >= max_attempts THEN NOW()
           ELSE NULL
         END,
         started_at = CASE
           WHEN attempts >= max_attempts THEN started_at
           ELSE NULL
         END`;

/**
 * Mark a job as failed. Retries if attempts < max_attempts, permanently fails otherwise.
 *
 * Note: attempts counter is incremented in pickNextPending, so by the time markFailed
 * runs, attempts already reflects the current try. The comparison is >= max_attempts.
 *
 * @param {string} jobId - UUID
 * @param {string} errorMessage - Human-readable failure reason
 * @returns {Promise<Object|null>} Updated job row or null if not found
 */
export const markFailed = async (jobId, errorMessage) => {
  const result = await pool.query(
    `UPDATE ocr_jobs
     ${SETTLE_FAILED_ATTEMPT_SET}
     WHERE id = $1
     RETURNING *`,
    [jobId, errorMessage],
  );

  return result.rows[0] || null;
};

/**
 * Fail a job for good, whatever attempts remain — the outcome the file itself
 * decides: its PDF parse broke the time or memory limit
 * (ocrService.processJob), and the same file breaks it on every attempt.
 * attempts stays as counted; completed_at is set, started_at kept, as for a
 * last attempt spent. The partner restarts recognition from the menu screen.
 *
 * @param {string} jobId - UUID
 * @param {string} errorMessage - Human-readable failure reason
 * @returns {Promise<Object|null>} Updated job row or null if not found
 */
export const markFailedPermanently = async (jobId, errorMessage) => {
  const result = await pool.query(
    `UPDATE ocr_jobs
     SET status = 'failed',
         error_message = $2,
         completed_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [jobId, errorMessage],
  );

  return result.rows[0] || null;
};

/**
 * error_message a planned shutdown writes on the job in flight
 * (markInterruptedByShutdown). Only that function writes it, and every
 * outcome of the attempt — markDone, markFailed, markFailedPermanently, the
 * reaper — overwrites it, so it never survives into the next attempt.
 */
export const SHUTDOWN_INTERRUPT_MARK = 'attempt in flight at a planned shutdown';

/**
 * Mark the job in flight as caught by a planned shutdown (SIGTERM of a
 * deploy, SIGINT) — ocrJobPoller.stop() writes it as the stop begins. The
 * row stays 'processing'. When the attempt still settles in this process,
 * its outcome overwrites the mark. When the process is killed first (the
 * shutdown budget ran out), the reaper finds the mark and returns the job
 * for another attempt, if one is left: a deploy is not the file's fault. A
 * row a process left without the mark — it ended mid-attempt with no planned
 * stop — is failed for good instead.
 *
 * Touches only the attempt this process runs: a 'processing' row whose
 * attempts still equal the attempt's number. A job that settled a moment
 * earlier keeps its outcome; a job that settled, went back to the queue and
 * was picked again — by the next process, during the deploy overlap — is
 * another attempt (pickNextPending counted it), and its row is left alone.
 * attempts serves as the fence because only returnUnstartedJob ever lowers
 * it, for a job its process picked and never started — a job it holds no
 * mark or outcome for.
 *
 * @param {string} jobId - UUID
 * @param {number} attempts - The attempt's number: attempts of the row pickNextPending returned
 * @returns {Promise<Object|null>} The marked row, or null when that attempt had already settled
 */
export const markInterruptedByShutdown = async (jobId, attempts) => {
  const result = await pool.query(
    `UPDATE ocr_jobs
     SET error_message = $2
     WHERE id = $1 AND status = 'processing' AND attempts = $3
     RETURNING *`,
    [jobId, SHUTDOWN_INTERRUPT_MARK, attempts],
  );

  return result.rows[0] || null;
};

/**
 * error_message of an attempt whose outcome its own, still running process
 * could not write (a database error at the job's first read or at its
 * outcome) — settled later by that process's poller (settleAbandonedAttempt).
 */
export const ABANDONED_ATTEMPT_MESSAGE = 'attempt ended without a recorded outcome; settled by its poller';

/**
 * Settle an attempt whose processJob rejected before writing an outcome,
 * under markFailed's retry rule: back to 'pending' while attempts remain,
 * 'failed' on the last one. The process is alive — the attempt did not end
 * it — so the stale sweep's "failed for good" does not apply. Fenced like
 * markInterruptedByShutdown: only the same attempt of a row still
 * 'processing'; a row that did settle meanwhile is left alone.
 *
 * @param {string} jobId - UUID
 * @param {number} attempts - The attempt's number (attempts of the picked row)
 * @param {string} errorMessage
 * @returns {Promise<Object|null>} The settled row, or null when that attempt had settled
 */
export const settleAbandonedAttempt = async (jobId, attempts, errorMessage) => {
  const result = await pool.query(
    `UPDATE ocr_jobs
     ${SETTLE_FAILED_ATTEMPT_SET}
     WHERE id = $1 AND status = 'processing' AND attempts = $3
     RETURNING *`,
    [jobId, errorMessage, attempts],
  );

  return result.rows[0] || null;
};

/**
 * Return a job picked but never started — the stop was requested while the
 * pick ran (ocrJobPoller.runTick) — to the queue with its attempt given
 * back: nothing ran, so nothing is spent. The only place attempts goes down;
 * fenced to the same attempt of a row still 'processing'.
 *
 * @param {string} jobId - UUID
 * @param {number} attempts - attempts of the picked row
 * @returns {Promise<Object|null>} The returned row, or null when the row had moved on
 */
export const returnUnstartedJob = async (jobId, attempts) => {
  const result = await pool.query(
    `UPDATE ocr_jobs
     SET status = 'pending',
         attempts = attempts - 1,
         started_at = NULL
     WHERE id = $1 AND status = 'processing' AND attempts = $2
     RETURNING *`,
    [jobId, attempts],
  );

  return result.rows[0] || null;
};

/**
 * Get job status by ID.
 *
 * @param {string} jobId - UUID
 * @returns {Promise<Object|null>} Job row or null
 */
export const getJobStatus = async (jobId) => {
  const result = await pool.query(
    'SELECT * FROM ocr_jobs WHERE id = $1',
    [jobId],
  );
  return result.rows[0] || null;
};

/**
 * Get all jobs for an establishment, newest first.
 * Used for admin monitoring dashboards (Segment B).
 *
 * @param {string} establishmentId - UUID
 * @returns {Promise<Object[]>} Array of jobs
 */
export const getJobsByEstablishment = async (establishmentId) => {
  const result = await pool.query(
    `SELECT * FROM ocr_jobs
     WHERE establishment_id = $1
     ORDER BY created_at DESC`,
    [establishmentId],
  );
  return result.rows;
};

/**
 * Check whether a media file has any completed (done) OCR job.
 * Used by the admin-approve backfill trigger — if establishment is being approved
 * and has PDF menus without a 'done' job, enqueue fresh ones.
 *
 * @param {string} mediaId - UUID
 * @returns {Promise<boolean>}
 */
export const hasCompletedJobForMedia = async (mediaId) => {
  const result = await pool.query(
    `SELECT 1 FROM ocr_jobs
     WHERE media_id = $1 AND status = 'done'
     LIMIT 1`,
    [mediaId],
  );
  return result.rowCount > 0;
};

/**
 * The media of an establishment that have a completed (done) OCR job — the
 * files already recognised. The partner's restart queues the others first
 * (partnerMenuItemService.retryOcr), so that a daily allowance with a few
 * places left goes to files never recognised, not to re-reading done ones.
 *
 * @param {string} establishmentId - UUID
 * @returns {Promise<Set<string>>} media ids
 */
export const getMediaIdsWithCompletedJob = async (establishmentId) => {
  const result = await pool.query(
    `SELECT DISTINCT media_id FROM ocr_jobs
     WHERE establishment_id = $1 AND status = 'done'`,
    [establishmentId],
  );
  return new Set(result.rows.map((row) => row.media_id));
};

/**
 * Page counts of PDF menu files, from the latest finished recognition job of
 * each (walkthrough of the moderator panel, 2026-10-20, A1-22): the panel
 * shows «стр. 3 из 7». The document's own count is `pages_total` when the job
 * read only the first PDF_PAGE_LIMIT pages, otherwise `pages_count`. A job
 * that could not read the PDF's metadata (`vision_pdf_no_metadata`) tried a
 * fixed number of pages and knows no count — such a file, and a file never
 * recognised, are absent from the map.
 *
 * @param {string[]} mediaIds - establishment_media ids
 * @returns {Promise<Map<string, number>>} media id → page count
 */
export const getPdfPageCounts = async (mediaIds) => {
  if (!Array.isArray(mediaIds) || mediaIds.length === 0) return new Map();
  const result = await pool.query(
    `SELECT DISTINCT ON (media_id) media_id, result_summary
       FROM ocr_jobs
      WHERE media_id = ANY($1::uuid[]) AND status = 'done'
      ORDER BY media_id, completed_at DESC NULLS LAST, created_at DESC`,
    [mediaIds],
  );
  const counts = new Map();
  for (const row of result.rows) {
    const summary = row.result_summary ?? {};
    if (summary.strategy === 'vision_pdf_no_metadata') continue;
    const count = Number(summary.pages_total ?? summary.pages_count);
    if (Number.isInteger(count) && count > 0) counts.set(row.media_id, count);
  }
  return counts;
};

/**
 * A 'processing' row older than this is a zombie: the process died mid-job
 * (SIGKILL / OOM / redeploy without a graceful stop) and nothing else will
 * ever settle it. A legitimate job is minutes at most: its PDF download,
 * vision and structurer calls each abort after 60 s, the PDF parse after
 * 20 s (pdfTextExtractor.PDF_PARSE_TIMEOUT_MS), and the job as a whole stays
 * within ocrService.JOB_DURATION_BOUND_MS = 180 s plus that parse.
 * Two consumers: countActiveJobsForEstablishment ignores such rows so a
 * zombie cannot mute the batch notification, and reapStaleProcessingJobs
 * (driven by ocrJobPoller's sweep) settles them. PostgreSQL interval literal.
 */
export const STALE_PROCESSING_INTERVAL = '1 hour';

/**
 * error_message the reaper writes on a job it fails. English like the
 * exception messages markFailed stores; the column is not surfaced to
 * partners or moderators — they see the job's status.
 */
export const STALE_REAP_ERROR_MESSAGE = `stale processing reaped after ${STALE_PROCESSING_INTERVAL}`;

/** error_message the reaper writes on a job it returns to the queue. */
export const STALE_REAP_REQUEUE_MESSAGE =
  `stale processing requeued after ${STALE_PROCESSING_INTERVAL}: a planned shutdown interrupted the attempt`;

/**
 * The reaper's test for "give it another attempt": a planned shutdown marked
 * the row, and an attempt is left. Placeholder contract: $3 =
 * SHUTDOWN_INTERRUPT_MARK. A NULL error_message compares to NULL — false.
 */
const REQUEUE_INTERRUPTED = 'error_message = $3 AND attempts < max_attempts';

/**
 * Settle every zombie: 'processing' rows older than STALE_PROCESSING_INTERVAL.
 *
 * A zombie is an attempt that ended with no outcome written because its
 * process ended in the middle of it: killed by the platform, crashed, out of
 * memory, or a planned stop that could not write its mark. (A process that
 * lives on but could not write an attempt's outcome settles it itself —
 * settleAbandonedAttempt, from ocrJobPoller.) Such a job is failed for good,
 * not returned to the queue — the rule of this change (M1, 17.10.2026): an
 * attempt that ended its process could end the next one the same way, up to
 * max_attempts times. Not every such end is the file's doing — since the PDF
 * parse runs in a process of its own (pdfParseRunner), a file's cost is
 * bounded there — and the way back is the partner's restart from the menu
 * screen (within the daily allowance); the moderator sees the failed job
 * among the quality signals. The exception is a row a planned shutdown
 * marked (SHUTDOWN_INTERRUPT_MARK — a deploy whose shutdown budget ran out
 * before the attempt settled): while an attempt is left it goes back to
 * 'pending' for the next process (started_at cleared, set again by
 * pickNextPending); on the last attempt it fails like any other. The reaper
 * never gives an attempt back: max_attempts stays the ceiling.
 *
 * Left alone, a zombie makes enqueue treat the media as active forever and
 * keeps the establishment out of the admin health signals' "empty menus"
 * anti-join. The age is compared inside the database — started_at /
 * created_at are DB-generated naive timestamps — with the interval bound as a
 * literal, exactly like countActiveJobsForEstablishment. Every CASE reads the
 * row as it was before the UPDATE, so the four columns follow one decision.
 *
 * Called by ocrJobPoller.sweepStaleJobs, which logs each row and closes the
 * batch of a permanently failed one. Rows come back oldest first so the
 * poller closes one batch per establishment deterministically.
 *
 * @returns {Promise<Object[]>} Reaped rows, now 'pending' or 'failed'
 */
export const reapStaleProcessingJobs = async () => {
  const result = await pool.query(
    `WITH reaped AS (
       UPDATE ocr_jobs
       SET status = CASE WHEN ${REQUEUE_INTERRUPTED} THEN 'pending' ELSE 'failed' END,
           error_message = CASE WHEN ${REQUEUE_INTERRUPTED} THEN $4 ELSE $2 END,
           completed_at = CASE WHEN ${REQUEUE_INTERRUPTED} THEN NULL ELSE NOW() END,
           started_at = CASE WHEN ${REQUEUE_INTERRUPTED} THEN NULL ELSE started_at END
       WHERE status = 'processing'
         AND COALESCE(started_at, created_at) < NOW() - $1::interval
       RETURNING *
     )
     SELECT * FROM reaped ORDER BY created_at ASC`,
    [STALE_PROCESSING_INTERVAL, STALE_REAP_ERROR_MESSAGE, SHUTDOWN_INTERRUPT_MARK, STALE_REAP_REQUEUE_MESSAGE],
  );
  return result.rows;
};

/**
 * Count active OCR jobs of an establishment: every 'pending' job plus the
 * 'processing' jobs younger than STALE_PROCESSING_INTERVAL.
 *
 * Batch detection for the partner notification (Coordinator decision
 * 2026-09-04, option «б» — one menu_parsed per upload batch, not per file):
 * ocrService notifies only when the job that just settled left no active
 * sibling behind. A job returned to 'pending' by markFailed for a retry still
 * counts as active, so the batch stays open until its last attempt settles.
 * A zombie 'processing' row is ignored — counting it would mute the
 * notification for this establishment for good. The age is compared inside
 * the database (started_at is DB-generated, naive timestamp).
 *
 * @param {string} establishmentId - UUID
 * @returns {Promise<number>}
 */
export const countActiveJobsForEstablishment = async (establishmentId) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ocr_jobs
     WHERE establishment_id = $1
       AND (
         status = 'pending'
         OR (status = 'processing'
             AND COALESCE(started_at, created_at) > NOW() - $2::interval)
       )`,
    [establishmentId, STALE_PROCESSING_INTERVAL],
  );
  return result.rows[0]?.count ?? 0;
};

/**
 * Count jobs of an establishment that finished successfully since a given job
 * was enqueued — the "batch mates" of that job that yielded a result.
 *
 * Used when a permanent failure closes a batch: the partner is told what the
 * other files produced only if at least one of them was recognised while the
 * failed job was alive. A lone failed upload, or a batch that failed entirely,
 * stays silent (as it did before batch notifications existed).
 *
 * The comparison runs inside the database on two DB-generated naive
 * timestamps — nothing crosses the driver's timezone boundary.
 *
 * @param {Object} params
 * @param {string} params.establishmentId - UUID
 * @param {string} params.jobId - UUID of the reference (failed) job
 * @returns {Promise<number>}
 */
export const countDoneJobsSinceEnqueue = async ({ establishmentId, jobId }) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ocr_jobs
     WHERE establishment_id = $1
       AND status = 'done'
       AND completed_at >= (SELECT created_at FROM ocr_jobs WHERE id = $2)`,
    [establishmentId, jobId],
  );
  return result.rows[0]?.count ?? 0;
};
