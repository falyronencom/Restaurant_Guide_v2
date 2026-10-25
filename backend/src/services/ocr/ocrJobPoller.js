/**
 * OCR Job Poller
 *
 * Background loop that periodically picks up pending OCR jobs from the database
 * and feeds them to the orchestrator. Serial processing (one job at a time) —
 * sufficient for Phase 1 volumes, easy to scale horizontally later by simply
 * running multiple pollers (FOR UPDATE SKIP LOCKED handles concurrency).
 *
 * Caveat before adding pollers: the batch-level partner notification in
 * ocrService (one menu_parsed per upload batch, 2026-09-04) relies on serial
 * processing — with several pollers two jobs of one establishment settling at
 * the same instant could both see "no active jobs left" and notify twice
 * (a duplicate, never silence). Serialise the check per establishment first.
 *
 * Stale-job sweep (reaper, 2026-09-04): a 'processing' row whose process died
 * mid-job (SIGKILL / OOM / redeploy without a graceful stop) is settled by
 * nobody — pickNextPending only takes 'pending' rows. Left alone it makes
 * ocrJobModel.enqueue treat the media as "already in flight" forever (re-run
 * OCR silently returns the zombie) and hides the establishment from the admin
 * "empty menus" signal. The sweep runs once at start() — the previous process
 * is the usual source of zombies — and then every STALE_SWEEP_INTERVAL_MS from
 * within the poll cycle, whether or not a job is in flight: a long backlog
 * must not starve it. Rows older than ocrJobModel.STALE_PROCESSING_INTERVAL
 * are failed for good — an attempt that ended its process is not retried —
 * unless a planned shutdown marked them (stop() below): those go back to
 * 'pending' while an attempt is left (ocrJobModel.reapStaleProcessingJobs). A
 * permanent failure closes the upload batch exactly as processJob does. An
 * attempt whose outcome this process failed to write (a database error) is
 * not left to the sweep: the poller settles it itself on the next cycles
 * (settleUnsettledAttempts). The job in flight in this process is never
 * that old (the PDF download and every vision and structurer call abort
 * after 60 s — ocrService.JOB_DURATION_BOUND_MS is 180 s, far below the
 * interval; see STALE_PROCESSING_INTERVAL in the model), so the sweep and the
 * running job touch disjoint rows.
 *
 * Lifecycle:
 *   - start() runs one sweep immediately and begins the polling interval
 *   - stop() stops new pickups and waits for the cycle in progress, the
 *     current job and the current sweep (if any) to finish — the job and the
 *     sweep both await the batch notification, so closePool() in server.js
 *     cannot cut it off. It does not wait for a PDF parse: the job's signal
 *     kills the parse at once, and the job settles under the retry rule. A
 *     planned stop (a deploy) also marks the job in flight, so that if the
 *     process is killed before the job settles, the reaper retries it rather
 *     than failing it
 *
 * The poller must NOT start in NODE_ENV=test — tests invoke ocrService.processJob
 * and sweepStaleJobs directly to avoid timing dependencies.
 */

import logger from '../../utils/logger.js';
import * as ocrJobModel from '../../models/ocrJobModel.js';
import * as ocrService from './ocrService.js';

const DEFAULT_INTERVAL_MS = 10000;

/**
 * How often the poll cycle re-runs the stale sweep. A zombie is at least
 * STALE_PROCESSING_INTERVAL old before it qualifies, so minutes of extra
 * latency change nothing; the value keeps the extra UPDATE off the
 * 10-second poll path.
 */
const STALE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let intervalId = null;
let currentJobPromise = null;
let currentJobId = null;
/** The attempt's number (attempts of the picked row) — the fence of the shutdown mark. */
let currentJobAttempts = null;
/** Aborted by stop(): cuts the PDF download and parse of the job in flight (processJob's signal). */
let currentJobAbort = null;
/**
 * Attempts whose processJob rejected before writing an outcome — a database
 * error at the job's first read or at its outcome write — jobId → attempts.
 * The row is still 'processing', and this process is alive: the next cycles
 * (and stop()) settle it under the retry rule (settleUnsettledAttempts), so
 * the stale sweep does not fail it an hour later as if the attempt had ended
 * the process.
 */
const unsettledAttempts = new Map();
let sweepPromise = null;
let lastSweepAt = 0;
let tickPromise = null;
let stopRequested = false;

/**
 * Settle every 'processing' row older than STALE_PROCESSING_INTERVAL.
 *
 * Each reaped job is logged at warn level. A job the sweep failed permanently
 * closes its upload batch the way processJob's permanent failure does:
 * notifyPartnerIfBatchFinished with failedJobId, awaited, errors logged only.
 * When several permanently failed rows of one establishment are reaped in the
 * same pass, the batch is closed once, from the oldest of them (the widest
 * "recognised since enqueue" window). Then every such job is told to its
 * partner (ocrService.notifyPartnerOfFailedJob: one notice per upload batch,
 * none for a re-read of a file recognised before) — after the batch notice,
 * as in processJob. Rows reaped back to 'pending' keep the batch open — the
 * retry settles it, as with markFailed.
 *
 * Exported for tests and diagnostics; the poller schedules it itself.
 *
 * @returns {Promise<Object[]>} The reaped job rows, now 'pending' or 'failed'
 */
export const sweepStaleJobs = async () => {
  const reaped = await ocrJobModel.reapStaleProcessingJobs();

  for (const job of reaped) {
    logger.warn('OCR poller: stale processing job reaped', {
      jobId: job.id,
      establishmentId: job.establishment_id,
      mediaId: job.media_id,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      outcome: job.status,
      staleAfter: ocrJobModel.STALE_PROCESSING_INTERVAL,
    });
  }

  const closedBatches = new Set();
  for (const job of reaped) {
    if (job.status !== 'failed' || closedBatches.has(job.establishment_id)) {
      continue;
    }
    closedBatches.add(job.establishment_id);
    await ocrService.notifyPartnerIfBatchFinished(job.establishment_id, { failedJobId: job.id })
      .catch((error) => logger.error('notifyMenuParsed failed after stale job reaped', {
        error: error.message,
        establishmentId: job.establishment_id,
        jobId: job.id,
      }));
  }

  // Every job failed here is told to its partner (notificationService keeps
  // it to one notice per upload batch) — after the batch notice, as in
  // processJob: the failure is the newest notice.
  for (const job of reaped) {
    if (job.status !== 'failed') continue;
    await ocrService.notifyPartnerOfFailedJob(job)
      .catch((error) => logger.error('failure notice failed after stale job reaped', {
        error: error.message,
        establishmentId: job.establishment_id,
        jobId: job.id,
      }));
  }

  return reaped;
};

/**
 * Settle the attempts processJob left without an outcome (unsettledAttempts):
 * ocrJobModel.settleAbandonedAttempt, fenced to the same attempt. Settled or
 * found already settled — forgotten; a failure — kept for the next cycle. A
 * permanent failure closes the upload batch, as processJob's would have.
 * Errors are logged and never reach the caller.
 *
 * @returns {Promise<void>}
 */
const settleUnsettledAttempts = async () => {
  for (const [jobId, attempts] of [...unsettledAttempts]) {
    let row;
    try {
      row = await ocrJobModel.settleAbandonedAttempt(jobId, attempts, ocrJobModel.ABANDONED_ATTEMPT_MESSAGE);
    } catch (error) {
      logger.error('OCR poller: could not settle an attempt without a recorded outcome — next cycle', {
        jobId,
        attempts,
        error: error.message,
      });
      continue;
    }
    unsettledAttempts.delete(jobId);
    logger.warn('OCR poller: settled an attempt that ended without a recorded outcome', {
      jobId,
      attempts,
      outcome: row ? row.status : 'already settled',
    });
    if (row?.status === 'failed') {
      await ocrService.notifyPartnerIfBatchFinished(row.establishment_id, { failedJobId: jobId })
        .catch((error) => logger.error('notifyMenuParsed failed after an abandoned attempt was settled', {
          error: error.message,
          establishmentId: row.establishment_id,
          jobId,
        }));
      await ocrService.notifyPartnerOfFailedJob(row)
        .catch((error) => logger.error('failure notice failed after an abandoned attempt was settled', {
          error: error.message,
          establishmentId: row.establishment_id,
          jobId,
        }));
    }
  }
};

/**
 * Run the sweep when STALE_SWEEP_INTERVAL_MS has passed since the last one.
 * Never overlaps with itself; errors are logged and never reach the caller.
 *
 * @returns {Promise<void>|null} The in-flight sweep, or null when not due
 */
const runStaleSweepIfDue = () => {
  if (sweepPromise) {
    return sweepPromise;
  }
  if (Date.now() - lastSweepAt < STALE_SWEEP_INTERVAL_MS) {
    return null;
  }

  lastSweepAt = Date.now();
  sweepPromise = sweepStaleJobs()
    .catch((error) => {
      logger.error('OCR poller: stale sweep failed', { error: error.message });
    })
    .finally(() => {
      sweepPromise = null;
    });
  return sweepPromise;
};

/**
 * One poll cycle: run the stale sweep when due, then process exactly one
 * pending job if available. Never runs twice at once — see tick().
 */
const runTick = async () => {
  await runStaleSweepIfDue();
  await settleUnsettledAttempts();

  // stop() may have been requested while the sweep ran: graceful shutdown
  // must not start a job that closePool() would then cut off.
  if (stopRequested || currentJobPromise) {
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

  // The stop came while the pick ran: nothing has started, so the job goes
  // back to the queue with its attempt given back, for the next process.
  if (stopRequested) {
    try {
      const returned = await ocrJobModel.returnUnstartedJob(job.id, job.attempts);
      logger.info('OCR poller: stop requested during the pick — job returned unstarted', {
        jobId: job.id,
        returned: returned !== null,
      });
    } catch (error) {
      logger.error('OCR poller: could not return an unstarted job at shutdown', {
        jobId: job.id,
        error: error.message,
      });
    }
    return;
  }

  currentJobId = job.id;
  currentJobAttempts = job.attempts;
  currentJobAbort = new AbortController();
  currentJobPromise = ocrService.processJob(job.id, { signal: currentJobAbort.signal })
    .catch((error) => {
      // processJob writes every outcome itself; a rejection means the write
      // (or the job's first read) failed, and the row is still 'processing'.
      unsettledAttempts.set(job.id, job.attempts);
      logger.error('OCR poller: unexpected error bubbled from processJob — the attempt is settled from here', {
        jobId: job.id,
        attempts: job.attempts,
        error: error.message,
      });
    })
    .finally(() => {
      currentJobPromise = null;
      currentJobId = null;
      currentJobAttempts = null;
      currentJobAbort = null;
    });
};

/**
 * Interval callback. Overlapping calls — the interval firing while the
 * previous cycle still awaits the sweep or the pick — join the running cycle
 * instead of starting a second one: two concurrent picks would run two jobs
 * at once and break the serial-processing invariant the batch notification
 * relies on (Phase 3.5 review, 2026-09-04). The job itself runs on past the
 * cycle (currentJobPromise), so later cycles still sweep while it is in
 * flight; they only skip the pick.
 *
 * @returns {Promise<void>}
 */
const tick = () => {
  if (tickPromise) {
    return tickPromise;
  }
  tickPromise = runTick().finally(() => {
    tickPromise = null;
  });
  return tickPromise;
};

/**
 * Start the polling interval. Idempotent — calling start() twice has no effect.
 * Sweeps stale jobs immediately: the process that just died is the usual
 * source of them, and a reset job is then picked by the first cycle.
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

  stopRequested = false;
  intervalId = setInterval(() => {
    tick().catch((error) => {
      logger.error('OCR poller: tick error', { error: error.message });
    });
  }, resolvedInterval);

  logger.info('OCR poller started', {
    intervalMs: resolvedInterval,
    staleSweepIntervalMs: STALE_SWEEP_INTERVAL_MS,
  });

  lastSweepAt = 0;
  runStaleSweepIfDue();
};

/**
 * Stop the poller. Waits for the cycle in progress, the currently processing
 * job and the in-flight stale sweep (if any) to finish. Called during
 * graceful shutdown.
 *
 * The job in flight is not waited for in its PDF parse: its signal is
 * aborted, the parse child is killed, and processJob settles the attempt
 * under the retry rule — the next process picks it up. Past the parse the job
 * runs on to its own stage timeouts (ocrService.JOB_DURATION_BOUND_MS).
 *
 * `planned` — the stop is a deploy or Ctrl+C (gracefulShutdown's planned
 * reasons), not a crash: the job in flight is marked
 * (ocrJobModel.markInterruptedByShutdown) before the wait, so that a process
 * killed at the end of its shutdown budget leaves a row the reaper returns
 * to the queue instead of failing it. A crash shutdown leaves no mark.
 *
 * Last, the attempts left without an outcome (unsettledAttempts) get one
 * more try to be settled before the pool closes.
 *
 * @param {Object} [options]
 * @param {boolean} [options.planned=false]
 * @returns {Promise<void>}
 */
export const stop = async ({ planned = false } = {}) => {
  stopRequested = true;

  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('OCR poller interval cleared');
  }

  // A cycle caught mid-sweep starts no job (stopRequested); one caught
  // mid-pick returns the job it picked unstarted (runTick).
  if (tickPromise) {
    try {
      await tickPromise;
    } catch (_err) {
      // Errors already logged inside runTick() / the interval callback
    }
  }

  if (currentJobPromise) {
    const jobId = currentJobId;
    const attempts = currentJobAttempts;
    currentJobAbort?.abort();
    if (planned) {
      try {
        await ocrJobModel.markInterruptedByShutdown(jobId, attempts);
      } catch (error) {
        logger.error('OCR poller: could not mark the job in flight at shutdown', {
          jobId,
          error: error.message,
        });
      }
    }
    logger.info('OCR poller: waiting for in-flight job to complete', { jobId, planned });
    try {
      await currentJobPromise;
    } catch (_err) {
      // Errors already logged inside runTick()
    }
  }

  if (sweepPromise) {
    logger.info('OCR poller: waiting for in-flight stale sweep to complete');
    // Errors already logged inside runStaleSweepIfDue()
    await sweepPromise;
  }

  await settleUnsettledAttempts();
};

/**
 * Introspection helper for tests and diagnostics.
 *
 * @returns {{ running: boolean, busy: boolean, sweeping: boolean }}
 */
export const status = () => ({
  running: intervalId !== null,
  busy: currentJobPromise !== null,
  sweeping: sweepPromise !== null,
});

export { DEFAULT_INTERVAL_MS, STALE_SWEEP_INTERVAL_MS, tick };
