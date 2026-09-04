/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: ocrJobModel.js
 *
 * Tests SQL construction with a mocked pool. Covers:
 *   - enqueue idempotency (active job returned instead of duplicate creation)
 *   - pickNextPending uses FOR UPDATE SKIP LOCKED (concurrency safety)
 *   - markFailed retry logic (returns to pending vs permanent failure)
 *   - reapStaleProcessingJobs stale sweep (age compared in SQL, same retry rule)
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

const mockQuery = jest.fn();

jest.unstable_mockModule('../../config/database.js', () => ({
  default: { query: mockQuery },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const Model = await import('../../models/ocrJobModel.js');

const ESTABLISHMENT_ID = uuidv4();
const MEDIA_ID = uuidv4();
const JOB_ID = uuidv4();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('enqueue', () => {
  test('returns existing active job instead of creating duplicate', async () => {
    const existing = {
      id: JOB_ID,
      establishment_id: ESTABLISHMENT_ID,
      media_id: MEDIA_ID,
      status: 'pending',
      attempts: 0,
    };
    mockQuery.mockResolvedValueOnce({ rows: [existing] });

    const result = await Model.enqueue({
      establishmentId: ESTABLISHMENT_ID,
      mediaId: MEDIA_ID,
    });

    expect(result).toEqual(existing);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('SELECT * FROM ocr_jobs');
    expect(sql).toContain("status IN ('pending', 'processing')");
    expect(params).toEqual([MEDIA_ID]);
  });

  test('creates new job when no active job exists', async () => {
    const created = {
      id: JOB_ID,
      establishment_id: ESTABLISHMENT_ID,
      media_id: MEDIA_ID,
      status: 'pending',
      attempts: 0,
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [created] });

    const result = await Model.enqueue({
      establishmentId: ESTABLISHMENT_ID,
      mediaId: MEDIA_ID,
    });

    expect(result).toEqual(created);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [insertSql, insertParams] = mockQuery.mock.calls[1];
    expect(insertSql).toContain('INSERT INTO ocr_jobs');
    expect(insertParams).toEqual([ESTABLISHMENT_ID, MEDIA_ID]);
  });

  test('treats processing status as active (idempotent even when mid-processing)', async () => {
    const processing = {
      id: JOB_ID,
      establishment_id: ESTABLISHMENT_ID,
      media_id: MEDIA_ID,
      status: 'processing',
      attempts: 1,
    };
    mockQuery.mockResolvedValueOnce({ rows: [processing] });

    const result = await Model.enqueue({
      establishmentId: ESTABLISHMENT_ID,
      mediaId: MEDIA_ID,
    });

    expect(result).toEqual(processing);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('pickNextPending', () => {
  test('uses FOR UPDATE SKIP LOCKED for safe concurrent polling', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await Model.pickNextPending();

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("SET status = 'processing'");
    expect(sql).toContain('attempts = attempts + 1');
    expect(sql).toContain('started_at = NOW()');
  });

  test('returns the picked job', async () => {
    const picked = {
      id: JOB_ID,
      status: 'processing',
      attempts: 1,
    };
    mockQuery.mockResolvedValueOnce({ rows: [picked] });

    const result = await Model.pickNextPending();
    expect(result).toEqual(picked);
  });

  test('returns null when no pending jobs', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await Model.pickNextPending();
    expect(result).toBeNull();
  });

  test('orders by created_at ASC (FIFO)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await Model.pickNextPending();

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('ORDER BY created_at ASC');
    expect(sql).toContain('LIMIT 1');
  });
});

describe('markDone', () => {
  test('sets status, result_summary, completed_at; clears error_message', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: JOB_ID, status: 'done' }] });

    const summary = { items_count: 10, confidence_avg: 0.9 };
    await Model.markDone(JOB_ID, summary);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'done'");
    expect(sql).toContain('result_summary = $2');
    expect(sql).toContain('completed_at = NOW()');
    expect(sql).toContain('error_message = NULL');
    expect(params).toEqual([JOB_ID, summary]);
  });
});

describe('markFailed — retry logic', () => {
  test('uses CASE to retry when attempts < max_attempts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await Model.markFailed(JOB_ID, 'network timeout');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('CASE');
    expect(sql).toContain('attempts >= max_attempts');
    expect(sql).toContain("THEN 'failed'");
    expect(sql).toContain("ELSE 'pending'");
    expect(sql).toContain('error_message = $2');
    expect(params).toEqual([JOB_ID, 'network timeout']);
  });

  test('resets started_at only on retry, preserves on permanent failure', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await Model.markFailed(JOB_ID, 'error');

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('started_at = CASE');
    expect(sql).toContain('THEN started_at');
    expect(sql).toContain('ELSE NULL');
  });

  test('sets completed_at only on permanent failure', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await Model.markFailed(JOB_ID, 'error');

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('completed_at = CASE');
    expect(sql).toContain('THEN NOW()');
    expect(sql).toContain('ELSE NULL');
  });
});

describe('getJobStatus', () => {
  test('returns job by id', async () => {
    const job = { id: JOB_ID, status: 'done' };
    mockQuery.mockResolvedValueOnce({ rows: [job] });

    const result = await Model.getJobStatus(JOB_ID);
    expect(result).toEqual(job);
  });

  test('returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await Model.getJobStatus(JOB_ID);
    expect(result).toBeNull();
  });
});

describe('getJobsByEstablishment', () => {
  test('orders jobs by created_at DESC for admin monitoring', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await Model.getJobsByEstablishment(ESTABLISHMENT_ID);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('WHERE establishment_id = $1');
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(params).toEqual([ESTABLISHMENT_ID]);
  });
});

describe('countActiveJobsForEstablishment — batch detection', () => {
  test('counts pending jobs and fresh processing jobs of the establishment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 2 }] });

    const result = await Model.countActiveJobsForEstablishment(ESTABLISHMENT_ID);

    expect(result).toBe(2);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('FROM ocr_jobs');
    expect(sql).toContain('establishment_id = $1');
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("status = 'processing'");
    // Zombie guard: a processing row older than the interval is not active.
    // Age compared in SQL — started_at is a DB-generated naive timestamp.
    expect(sql).toContain('COALESCE(started_at, created_at) > NOW() - $2::interval');
    expect(params).toEqual([ESTABLISHMENT_ID, Model.STALE_PROCESSING_INTERVAL]);
    expect(Model.STALE_PROCESSING_INTERVAL).toBe('1 hour');
  });

  test('returns 0 when the query yields no row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    expect(await Model.countActiveJobsForEstablishment(ESTABLISHMENT_ID)).toBe(0);
  });
});

describe('countDoneJobsSinceEnqueue — batch mates of a failed job', () => {
  test('counts done jobs completed since the reference job was enqueued, compared in SQL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const result = await Model.countDoneJobsSinceEnqueue({
      establishmentId: ESTABLISHMENT_ID,
      jobId: JOB_ID,
    });

    expect(result).toBe(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('establishment_id = $1');
    expect(sql).toContain("status = 'done'");
    // Both timestamps are DB-generated naive values — the comparison must stay in SQL.
    expect(sql).toContain('completed_at >= (SELECT created_at FROM ocr_jobs WHERE id = $2)');
    expect(params).toEqual([ESTABLISHMENT_ID, JOB_ID]);
  });

  test('returns 0 when the query yields no row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    expect(await Model.countDoneJobsSinceEnqueue({
      establishmentId: ESTABLISHMENT_ID,
      jobId: JOB_ID,
    })).toBe(0);
  });
});

describe('reapStaleProcessingJobs — stale sweep', () => {
  test('settles processing rows older than STALE_PROCESSING_INTERVAL with the markFailed retry rule', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await Model.reapStaleProcessingJobs();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('UPDATE ocr_jobs');
    expect(sql).toContain("WHERE status = 'processing'");
    // Age compared in SQL — started_at / created_at are DB-generated naive timestamps.
    expect(sql).toContain('COALESCE(started_at, created_at) < NOW() - $1::interval');
    // Same retry semantics as markFailed.
    expect(sql).toContain("WHEN attempts >= max_attempts THEN 'failed'");
    expect(sql).toContain("ELSE 'pending'");
    expect(sql).toContain('error_message = $2');
    expect(sql).toContain('completed_at = CASE');
    expect(sql).toContain('started_at = CASE');
    expect(sql).toContain('RETURNING *');
    expect(sql).toContain('ORDER BY created_at ASC');
    expect(params).toEqual([Model.STALE_PROCESSING_INTERVAL, Model.STALE_REAP_ERROR_MESSAGE]);
  });

  test('error message names the interval', () => {
    expect(Model.STALE_REAP_ERROR_MESSAGE).toBe('stale processing reaped after 1 hour');
  });

  test('returns the reaped rows', async () => {
    const rows = [
      { id: JOB_ID, status: 'pending', attempts: 1 },
      { id: uuidv4(), status: 'failed', attempts: 3 },
    ];
    mockQuery.mockResolvedValueOnce({ rows });

    expect(await Model.reapStaleProcessingJobs()).toEqual(rows);
  });

  test('markFailed and the reaper share one retry clause', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await Model.markFailed(JOB_ID, 'x');
    await Model.reapStaleProcessingJobs();

    // Indentation differs between the two queries — compare the tokens, not the whitespace.
    const setClauseOf = (sql) => sql
      .slice(sql.indexOf('SET status = CASE'), sql.indexOf('WHERE'))
      .replace(/\s+/g, ' ')
      .trim();
    const [markFailedSql] = mockQuery.mock.calls[0];
    const [reaperSql] = mockQuery.mock.calls[1];
    expect(setClauseOf(markFailedSql).length).toBeGreaterThan(100);
    expect(setClauseOf(reaperSql)).toBe(setClauseOf(markFailedSql));
  });
});
