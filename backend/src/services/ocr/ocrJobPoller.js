/**
 * OCR Job Poller
 *
 * Background loop that periodically picks up pending OCR jobs from the database
 * and feeds them to the orchestrator. Serial processing (one job at a time) —
 * sufficient for Phase 1 volumes, easy to scale horizontally later by simply
 * running multiple pollers (FOR UPDATE SKIP LOCKED handles concurrency).
 *
 * Lifecycle:
 *   - start() begins the polling interval
 *   - stop() stops new pickups and waits for the current job (if any) to finish
 *
 * The poller must NOT start in NODE_ENV=test — tests invoke ocrService.processJob
 * directly to avoid timing dependencies.
 */

import logger from '../../utils/logger.js';
import * as ocrJobModel from '../../models/ocrJobModel.js';
import * as ocrService from './ocrService.js';

const DEFAULT_INTERVAL_MS = 10000;

let intervalId = null;
let currentJobPromise = null;

/**
 * Process exactly one pending job if available. Safe to call concurrently — the
 * early-return when currentJobPromise is set prevents overlapping execution.
 */
const tick = async () => {
  if (currentJobPromise) {
    return;
  }

  let job;
  try {
    job = await ocrJobModel.pickNextPending();
  } catch (error) {
    logger.error('OCR poller: pickNextPending failed', { error: error.message });
    return;
  }

  if (!job) {
    return;
  }

  currentJobPromise = ocrService.processJob(job.id)
    .catch((error) => {
      logger.error('OCR poller: unexpected error bubbled from processJob', {
        jobId: job.id,
        error: error.message,
      });
    })
    .finally(() => {
      currentJobPromise = null;
    });
};

/**
 * Start the polling interval. Idempotent — calling start() twice has no effect.
 *
 * @param {Object} options
 * @param {number} options.intervalMs - Poll interval (default from POLLER_INTERVAL_MS env or 10000)
 */
export const start = ({ intervalMs } = {}) => {
  if (intervalId !== null) {
    logger.warn('OCR poller already running — start() ignored');
    return;
  }

  const envInterval = parseInt(process.env.POLLER_INTERVAL_MS || '', 10);
  const resolvedInterval = intervalMs
    || (Number.isFinite(envInterval) && envInterval > 0 ? envInterval : DEFAULT_INTERVAL_MS);

  intervalId = setInterval(() => {
    tick().catch((error) => {
      logger.error('OCR poller: tick error', { error: error.message });
    });
  }, resolvedInterval);

  logger.info('OCR poller started', { intervalMs: resolvedInterval });
};

/**
 * Stop the poller. Waits for the currently processing job (if any) to finish.
 * Called during graceful shutdown.
 *
 * @returns {Promise<void>}
 */
export const stop = async () => {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('OCR poller interval cleared');
  }

  if (currentJobPromise) {
    logger.info('OCR poller: waiting for in-flight job to complete');
    try {
      await currentJobPromise;
    } catch (_err) {
      // Errors already logged inside tick()
    }
  }
};

/**
 * Introspection helper for tests and diagnostics.
 *
 * @returns {{ running: boolean, busy: boolean }}
 */
export const status = () => ({
  running: intervalId !== null,
  busy: currentJobPromise !== null,
});

export { DEFAULT_INTERVAL_MS, tick };
