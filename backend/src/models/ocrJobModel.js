/**
 * OCR Job Model
 *
 * Persistent background job queue for OCR menu processing.
 * Uses PostgreSQL with FOR UPDATE SKIP LOCKED for safe concurrent polling.
 *
 * Table: ocr_jobs
 * Status flow: pending → processing → (done | failed)
 * Retry: markFailed returns job to 'pending' if attempts < max_attempts (default 3),
 *        otherwise transitions to 'failed' permanently.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Enqueue an OCR job for a media file.
 *
 * Idempotency: if an active (pending/processing) job already exists for this media,
 * return it instead of creating a duplicate. This makes trigger logic in Segment B
 * safe against repeated calls (e.g., partner clicking "re-run OCR" twice).
 *
 * @param {Object} params
 * @param {string} params.establishmentId - UUID
 * @param {string} params.mediaId - UUID of establishment_media row
 * @returns {Promise<Object>} Job row (either newly created or pre-existing active)
 */
export const enqueue = async ({ establishmentId, mediaId }) => {
  const existing = await pool.query(
    `SELECT * FROM ocr_jobs
     WHERE media_id = $1 AND status IN ('pending', 'processing')
     ORDER BY created_at DESC
     LIMIT 1`,
    [mediaId],
  );

  if (existing.rows.length > 0) {
    logger.debug('OCR job already active for media, returning existing', {
      jobId: existing.rows[0].id,
      mediaId,
      status: existing.rows[0].status,
    });
    return existing.rows[0];
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
     SET status = CASE
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
         END
     WHERE id = $1
     RETURNING *`,
    [jobId, errorMessage],
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
