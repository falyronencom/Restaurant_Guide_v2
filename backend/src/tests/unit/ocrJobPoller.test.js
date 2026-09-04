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
const mockProcessJob = jest.fn();

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: mockLogger,
}));

jest.unstable_mockModule('../../models/ocrJobModel.js', () => ({
  reapStaleProcessingJobs: mockReap,
  pickNextPending: mockPickNextPending,
  STALE_PROCESSING_INTERVAL: '1 hour',
}));

jest.unstable_mockModule('../../services/ocr/ocrService.js', () => ({
  notifyPartnerIfBatchFinished: mockNotify,
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
  mockPickNextPending.mockResolvedValue(null);
  mockProcessJob.mockResolvedValue({ success: true });
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
    Poller.start({ intervalMs: 60000 });

    expect(Poller.status().running).toBe(true);
    expect(mockReap).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith('OCR poller started', {
      intervalMs: 60000,
      staleSweepIntervalMs: Poller.STALE_SWEEP_INTERVAL_MS,
    });

    await Poller.stop();
    expect(Poller.status()).toEqual({ running: false, busy: false, sweeping: false });
  });
});
