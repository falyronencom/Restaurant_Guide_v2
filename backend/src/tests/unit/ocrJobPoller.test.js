/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: ocrJobPoller.js — stale processing sweep.
 *
 * The model and the orchestrator are mocked; these tests cover what the
 * integration suite cannot see: per-row warn logging, batch closing only for
 * permanently failed rows (once per establishment, oldest first), error
 * isolation, the sweep cadence inside tick(), and stop() waiting for a sweep.
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const mockReap = jest.fn();
const mockPickNextPending = jest.fn();
const mockNotify = jest.fn();
const mockNotifyFailed = jest.fn();
const mockProcessJob = jest.fn();
const mockMarkInterrupted = jest.fn();
const mockSettleAbandoned = jest.fn();
const mockReturnUnstarted = jest.fn();

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: mockLogger,
}));

jest.unstable_mockModule('../../models/ocrJobModel.js', () => ({
  reapStaleProcessingJobs: mockReap,
  pickNextPending: mockPickNextPending,
  markInterruptedByShutdown: mockMarkInterrupted,
  settleAbandonedAttempt: mockSettleAbandoned,
  returnUnstartedJob: mockReturnUnstarted,
  ABANDONED_ATTEMPT_MESSAGE: 'attempt ended without a recorded outcome; settled by its poller',
  STALE_PROCESSING_INTERVAL: '1 hour',
}));

jest.unstable_mockModule('../../services/ocr/ocrService.js', () => ({
  notifyPartnerIfBatchFinished: mockNotify,
  notifyPartnerOfFailedJob: mockNotifyFailed,
  processJob: mockProcessJob,
}));

const Poller = await import('../../services/ocr/ocrJobPoller.js');

const ESTABLISHMENT_A = uuidv4();
const ESTABLISHMENT_B = uuidv4();

const row = (overrides = {}) => ({
  id: uuidv4(),
  establishment_id: ESTABLISHMENT_A,
  media_id: uuidv4(),
  status: 'pending',
  attempts: 1,
  max_attempts: 3,
  ...overrides,
});

// resetMocks wipes implementations before every test — re-arm the defaults.
beforeEach(() => {
  mockReap.mockResolvedValue([]);
  mockNotify.mockResolvedValue(true);
  mockNotifyFailed.mockResolvedValue(true);
  mockPickNextPending.mockResolvedValue(null);
  mockProcessJob.mockResolvedValue({ success: true });
  mockMarkInterrupted.mockResolvedValue({ status: 'processing' });
  mockSettleAbandoned.mockResolvedValue(null);
  mockReturnUnstarted.mockResolvedValue({ status: 'pending' });
});

/**
 * The sweep cadence is module state (lastSweepAt). Each cadence test pins
 * Date.now far enough ahead of every earlier test to be "due" again.
 */
const farFuture = (multiplier) => Date.now() + multiplier * Poller.STALE_SWEEP_INTERVAL_MS;

describe('sweepStaleJobs', () => {
  test('returns an empty list and stays silent when nothing is stale', async () => {
    expect(await Poller.sweepStaleJobs()).toEqual([]);

    expect(mockReap).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockNotifyFailed).not.toHaveBeenCalled();
  });

  // Finding 3 of the Railway incident (24.10.2026): the partner hears every
  // job failed for good — not once per establishment like the batch notice.
  // After the batch notice: the failure is the newest notice the partner sees
  // (review of 24.10.2026 — «распознано» on top hid the failure).
  test('tells the partner of every permanently failed row, after the batch notice; requeued rows are not told', async () => {
    const requeued = row({ status: 'pending' });
    const older = row({ status: 'failed', attempts: 3 });
    const newer = row({ status: 'failed', attempts: 3 });
    const other = row({ status: 'failed', attempts: 3, establishment_id: ESTABLISHMENT_B });
    mockReap.mockResolvedValue([requeued, older, newer, other]);
    const order = [];
    mockNotifyFailed.mockImplementation(async (job) => { order.push(`failed:${job.id}`); return true; });
    mockNotify.mockImplementation(async (establishmentId) => { order.push(`batch:${establishmentId}`); return true; });

    await Poller.sweepStaleJobs();

    expect(mockNotifyFailed.mock.calls.map(([job]) => job.id)).toEqual([older.id, newer.id, other.id]);
    expect(order.indexOf(`failed:${older.id}`)).toBeGreaterThan(order.indexOf(`batch:${ESTABLISHMENT_A}`));
    expect(order.indexOf(`failed:${other.id}`)).toBeGreaterThan(order.indexOf(`batch:${ESTABLISHMENT_B}`));
  });

  test('a failing failure notice is logged and does not stop the sweep or the batch notice', async () => {
    const first = row({ status: 'failed', attempts: 3 });
    const second = row({ status: 'failed', attempts: 3, establishment_id: ESTABLISHMENT_B });
    mockReap.mockResolvedValue([first, second]);
    mockNotifyFailed.mockRejectedValueOnce(new Error('db blip'));

    await expect(Poller.sweepStaleJobs()).resolves.toEqual([first, second]);

    expect(mockNotifyFailed).toHaveBeenCalledTimes(2);
    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'failure notice failed after stale job reaped',
      expect.objectContaining({ error: 'db blip', establishmentId: ESTABLISHMENT_A, jobId: first.id }),
    );
  });

  test('logs every reaped job at warn level with its outcome', async () => {
    const requeued = row({ status: 'pending' });
    const failed = row({ status: 'failed', attempts: 3 });
    mockReap.mockResolvedValue([requeued, failed]);

    const result = await Poller.sweepStaleJobs();

    expect(result).toEqual([requeued, failed]);
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'OCR poller: stale processing job reaped',
      expect.objectContaining({
        jobId: requeued.id,
        establishmentId: ESTABLISHMENT_A,
        mediaId: requeued.media_id,
        outcome: 'pending',
        attempts: 1,
        maxAttempts: 3,
        staleAfter: '1 hour',
      }),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'OCR poller: stale processing job reaped',
      expect.objectContaining({ jobId: failed.id, outcome: 'failed', attempts: 3 }),
    );
  });

  test('closes the batch only for permanently failed rows, as processJob does', async () => {
    const requeued = row({ status: 'pending' });
    const failed = row({ status: 'failed', attempts: 3, establishment_id: ESTABLISHMENT_B });
    mockReap.mockResolvedValue([requeued, failed]);

    await Poller.sweepStaleJobs();

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(ESTABLISHMENT_B, { failedJobId: failed.id });
  });

  test('closes one batch per establishment, from the oldest failed row', async () => {
    // The model returns rows oldest first.
    const older = row({ status: 'failed', attempts: 3 });
    const newer = row({ status: 'failed', attempts: 3 });
    const other = row({ status: 'failed', attempts: 3, establishment_id: ESTABLISHMENT_B });
    mockReap.mockResolvedValue([older, newer, other]);

    await Poller.sweepStaleJobs();

    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect(mockNotify).toHaveBeenNthCalledWith(1, ESTABLISHMENT_A, { failedJobId: older.id });
    expect(mockNotify).toHaveBeenNthCalledWith(2, ESTABLISHMENT_B, { failedJobId: other.id });
  });

  test('a failing notification is logged and does not abort the sweep', async () => {
    const first = row({ status: 'failed', attempts: 3 });
    const second = row({ status: 'failed', attempts: 3, establishment_id: ESTABLISHMENT_B });
    mockReap.mockResolvedValue([first, second]);
    mockNotify.mockRejectedValueOnce(new Error('push down'));

    await expect(Poller.sweepStaleJobs()).resolves.toEqual([first, second]);

    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'notifyMenuParsed failed after stale job reaped',
      expect.objectContaining({
        error: 'push down',
        establishmentId: ESTABLISHMENT_A,
        jobId: first.id,
      }),
    );
  });
});

describe('tick — sweep cadence', () => {
  test('sweeps on a due tick, then not again until STALE_SWEEP_INTERVAL_MS has passed', async () => {
    const base = farFuture(10);
    const now = jest.spyOn(Date, 'now').mockReturnValue(base);

    await Poller.tick();
    expect(mockReap).toHaveBeenCalledTimes(1);
    expect(mockPickNextPending).toHaveBeenCalledTimes(1);

    now.mockReturnValue(base + Poller.STALE_SWEEP_INTERVAL_MS - 1);
    await Poller.tick();
    expect(mockReap).toHaveBeenCalledTimes(1);
    expect(mockPickNextPending).toHaveBeenCalledTimes(2);

    now.mockReturnValue(base + Poller.STALE_SWEEP_INTERVAL_MS);
    await Poller.tick();
    expect(mockReap).toHaveBeenCalledTimes(2);
    expect(mockPickNextPending).toHaveBeenCalledTimes(3);
  });

  test('a sweep failure is logged and the tick still picks a job', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(farFuture(100));
    mockReap.mockRejectedValue(new Error('db gone'));

    await Poller.tick();

    expect(mockLogger.error).toHaveBeenCalledWith('OCR poller: stale sweep failed', { error: 'db gone' });
    expect(mockPickNextPending).toHaveBeenCalledTimes(1);
    expect(Poller.status().sweeping).toBe(false);
  });

  test('the sweep runs even while a job is in flight; the pick does not', async () => {
    const base = farFuture(1000);
    const now = jest.spyOn(Date, 'now').mockReturnValue(base);
    let finishJob;
    mockProcessJob.mockReturnValue(new Promise((resolve) => {
      finishJob = resolve;
    }));
    mockPickNextPending.mockResolvedValueOnce({ id: uuidv4() });

    await Poller.tick();
    expect(mockReap).toHaveBeenCalledTimes(1);
    expect(Poller.status().busy).toBe(true);

    now.mockReturnValue(base + Poller.STALE_SWEEP_INTERVAL_MS);
    await Poller.tick();
    expect(mockReap).toHaveBeenCalledTimes(2);
    expect(mockPickNextPending).toHaveBeenCalledTimes(1);

    finishJob({ success: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(Poller.status().busy).toBe(false);
  });

  test('overlapping ticks join the running cycle — a long sweep never yields two concurrent picks', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(farFuture(5000));
    let finishReap;
    mockReap.mockReturnValue(new Promise((resolve) => {
      finishReap = resolve;
    }));

    // Two interval firings while the sweep is still running.
    const first = Poller.tick();
    const second = Poller.tick();
    expect(mockReap).toHaveBeenCalledTimes(1);

    finishReap([]);
    await Promise.all([first, second]);

    // Serial processing is the invariant the batch notification relies on.
    expect(mockPickNextPending).toHaveBeenCalledTimes(1);
  });

  // stop() latches "stop requested" and start() clears it: a test that calls
  // tick() directly must not follow a stop() without a start() in between.
  test('stop() waits for an in-flight sweep and the cycle starts no new job afterwards', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(farFuture(10000));
    let finishReap;
    mockReap.mockReturnValue(new Promise((resolve) => {
      finishReap = resolve;
    }));

    const ticking = Poller.tick();
    expect(Poller.status().sweeping).toBe(true);

    let stopped = false;
    const stopping = Poller.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stopped).toBe(false);

    finishReap([]);
    await stopping;
    await ticking;
    expect(stopped).toBe(true);
    expect(Poller.status().sweeping).toBe(false);
    // Graceful shutdown must not pick a job that closePool() would then cut off.
    expect(mockPickNextPending).not.toHaveBeenCalled();
  });

  test('start() sweeps immediately; stop() clears the interval', async () => {
    // «Clears the interval» — the timer itself, not only the status flag: every
    // interval start() set is handed to clearInterval by stop().
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    Poller.start({ intervalMs: 60000 });
    const intervals = setIntervalSpy.mock.results.map((result) => result.value);
    expect(intervals.length).toBeGreaterThan(0);

    expect(Poller.status().running).toBe(true);
    expect(mockReap).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith('OCR poller started', {
      intervalMs: 60000,
      staleSweepIntervalMs: Poller.STALE_SWEEP_INTERVAL_MS,
    });

    await Poller.stop();
    expect(Poller.status()).toEqual({ running: false, busy: false, sweeping: false });
    for (const interval of intervals) {
      expect(clearIntervalSpy).toHaveBeenCalledWith(interval);
    }
  });
});

describe('stop() and the job in flight — the parse is cut, a planned stop marks the job', () => {
  /** The job a test holds in flight, released after the test whatever its outcome. */
  let held = null;

  /** A job held in flight until the test releases it; records the signal it was given. */
  const holdJob = () => {
    held = {};
    const current = held;
    mockProcessJob.mockImplementation((jobId, options) => {
      current.jobId = jobId;
      current.signal = options?.signal;
      return new Promise((resolve) => {
        current.finish = resolve;
      });
    });
    return current;
  };

  // A failed assertion must not leave its job in flight for the next test:
  // the next start would find the poller busy and pick nothing.
  afterEach(async () => {
    held?.finish?.({ success: true });
    held = null;
    await Poller.stop();
  });

  /** start() clears the stop latch a previous test left; its immediate sweep finds nothing. */
  const startWithJobInFlight = async () => {
    const held = holdJob();
    const jobId = uuidv4();
    mockPickNextPending.mockResolvedValueOnce({ id: jobId, attempts: 2 });
    Poller.start({ intervalMs: 60000 });
    await Poller.tick();
    expect(Poller.status().busy).toBe(true);
    return { held, jobId };
  };

  const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('every job gets a live signal of its own', async () => {
    const first = await startWithJobInFlight();

    expect(mockProcessJob).toHaveBeenCalledWith(first.jobId, { signal: expect.any(AbortSignal) });
    expect(first.held.signal.aborted).toBe(false);
    first.held.finish({ success: true });
    await nextTurn();

    const second = holdJob();
    const secondId = uuidv4();
    mockPickNextPending.mockResolvedValueOnce({ id: secondId, attempts: 1 });
    await Poller.tick();

    expect(second.jobId).toBe(secondId);
    expect(second.signal).toBeInstanceOf(AbortSignal);
    expect(second.signal).not.toBe(first.held.signal);
    expect(second.signal.aborted).toBe(false);
  });

  test('a planned stop aborts the job\'s signal, marks the job, and still waits for it to settle', async () => {
    const { held, jobId } = await startWithJobInFlight();

    let stopped = false;
    const stopping = Poller.stop({ planned: true }).then(() => {
      stopped = true;
    });
    await nextTurn();

    expect(held.signal.aborted).toBe(true);
    expect(mockMarkInterrupted).toHaveBeenCalledTimes(1);
    // The attempt's number fences the mark: a later attempt of the same job is not marked.
    expect(mockMarkInterrupted).toHaveBeenCalledWith(jobId, 2);
    expect(stopped).toBe(false);

    held.finish({ success: false });
    await stopping;
    expect(stopped).toBe(true);
    expect(Poller.status()).toEqual({ running: false, busy: false, sweeping: false });
  });

  test('a crash stop (not planned) aborts the parse but leaves no mark', async () => {
    const { held } = await startWithJobInFlight();

    const stopping = Poller.stop();
    await nextTurn();

    expect(held.signal.aborted).toBe(true);
    expect(mockMarkInterrupted).not.toHaveBeenCalled();

    held.finish({ success: false });
    await stopping;
  });

  test('a mark that cannot be written is logged; the stop goes on and waits for the job', async () => {
    const { held, jobId } = await startWithJobInFlight();
    mockMarkInterrupted.mockRejectedValue(new Error('connection terminated'));

    let stopped = false;
    const stopping = Poller.stop({ planned: true }).then(() => {
      stopped = true;
    });
    await nextTurn();

    expect(mockLogger.error).toHaveBeenCalledWith(
      'OCR poller: could not mark the job in flight at shutdown',
      { jobId, error: 'connection terminated' },
    );
    expect(stopped).toBe(false);

    held.finish({ success: true });
    await stopping;
    expect(stopped).toBe(true);
  });

  test('nothing in flight — nothing to mark', async () => {
    Poller.start({ intervalMs: 60000 });

    await Poller.stop({ planned: true });

    expect(mockMarkInterrupted).not.toHaveBeenCalled();
  });
});

describe('an attempt left without an outcome is settled by the live poller, not failed by the sweep', () => {
  const ESTABLISHMENT = uuidv4();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** One cycle that picks `job` and whose processJob rejects — its outcome write failed. */
  const rejectedAttempt = async (job) => {
    mockPickNextPending.mockResolvedValueOnce(job);
    mockProcessJob.mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));
    Poller.start({ intervalMs: 60000 });
    await Poller.tick();
    await flush();
    expect(Poller.status().busy).toBe(false);
  };

  afterEach(async () => {
    await Poller.stop();
  });

  test('the next cycle settles it, fenced to its attempt; a pending outcome leaves the batch open', async () => {
    const job = { id: uuidv4(), attempts: 2, establishment_id: ESTABLISHMENT };
    await rejectedAttempt(job);
    expect(mockSettleAbandoned).not.toHaveBeenCalled();

    mockSettleAbandoned.mockResolvedValueOnce({ ...job, status: 'pending' });
    await Poller.tick();

    expect(mockSettleAbandoned).toHaveBeenCalledTimes(1);
    expect(mockSettleAbandoned).toHaveBeenCalledWith(
      job.id,
      2,
      'attempt ended without a recorded outcome; settled by its poller',
    );
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockNotifyFailed).not.toHaveBeenCalled();

    // Settled — forgotten: the next cycle does not try again.
    await Poller.tick();
    expect(mockSettleAbandoned).toHaveBeenCalledTimes(1);
  });

  test('a settle that fails is kept for the next cycle', async () => {
    const job = { id: uuidv4(), attempts: 1, establishment_id: ESTABLISHMENT };
    await rejectedAttempt(job);

    mockSettleAbandoned.mockRejectedValueOnce(new Error('still down'));
    await Poller.tick();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'OCR poller: could not settle an attempt without a recorded outcome — next cycle',
      { jobId: job.id, attempts: 1, error: 'still down' },
    );

    mockSettleAbandoned.mockResolvedValueOnce(null);
    await Poller.tick();
    expect(mockSettleAbandoned).toHaveBeenCalledTimes(2);

    await Poller.tick();
    expect(mockSettleAbandoned).toHaveBeenCalledTimes(2);
  });

  test('settled on its last attempt — failed — it closes the batch, as processJob would have', async () => {
    const job = { id: uuidv4(), attempts: 3, establishment_id: ESTABLISHMENT };
    await rejectedAttempt(job);

    mockSettleAbandoned.mockResolvedValueOnce({ ...job, status: 'failed' });
    await Poller.tick();

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(ESTABLISHMENT, { failedJobId: job.id });
    // ...and then the partner hears the failure itself — the newest notice.
    expect(mockNotifyFailed).toHaveBeenCalledTimes(1);
    expect(mockNotifyFailed).toHaveBeenCalledWith({ ...job, status: 'failed' });
    expect(mockNotifyFailed.mock.invocationCallOrder[0])
      .toBeGreaterThan(mockNotify.mock.invocationCallOrder[0]);
  });

  test('stop() gives it one more try before the pool closes', async () => {
    const job = { id: uuidv4(), attempts: 1, establishment_id: ESTABLISHMENT };
    await rejectedAttempt(job);

    await Poller.stop();

    expect(mockSettleAbandoned).toHaveBeenCalledWith(job.id, 1, expect.any(String));
  });
});

describe('a stop requested while the pick runs — the job goes back unstarted', () => {
  afterEach(async () => {
    await Poller.stop();
  });

  test('the picked job is returned with its attempt, and processJob never runs', async () => {
    const job = { id: uuidv4(), attempts: 2 };
    let finishPick;
    mockPickNextPending.mockReturnValueOnce(new Promise((resolve) => {
      finishPick = resolve;
    }));
    Poller.start({ intervalMs: 60000 });

    const ticking = Poller.tick();
    // The cycle is inside the pick when the stop comes.
    while (mockPickNextPending.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const stopping = Poller.stop({ planned: true });
    finishPick(job);
    await Promise.all([ticking, stopping]);

    expect(mockReturnUnstarted).toHaveBeenCalledTimes(1);
    expect(mockReturnUnstarted).toHaveBeenCalledWith(job.id, 2);
    expect(mockProcessJob).not.toHaveBeenCalled();
    expect(mockMarkInterrupted).not.toHaveBeenCalled();
  });

  test('a return that fails is logged; the stop completes', async () => {
    const job = { id: uuidv4(), attempts: 1 };
    let finishPick;
    mockPickNextPending.mockReturnValueOnce(new Promise((resolve) => {
      finishPick = resolve;
    }));
    mockReturnUnstarted.mockRejectedValueOnce(new Error('connection lost'));
    Poller.start({ intervalMs: 60000 });

    const ticking = Poller.tick();
    // The cycle is inside the pick when the stop comes.
    while (mockPickNextPending.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const stopping = Poller.stop({ planned: true });
    finishPick(job);
    await Promise.all([ticking, stopping]);

    expect(mockLogger.error).toHaveBeenCalledWith(
      'OCR poller: could not return an unstarted job at shutdown',
      { jobId: job.id, error: 'connection lost' },
    );
    expect(mockProcessJob).not.toHaveBeenCalled();
  });
});
