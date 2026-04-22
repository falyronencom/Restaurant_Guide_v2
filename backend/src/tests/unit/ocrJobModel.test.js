/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: ocrJobModel.js
 *
 * Tests SQL construction with a mocked pool. Covers:
 *   - enqueue idempotency (active job returned instead of duplicate creation)
 *   - pickNextPending uses FOR UPDATE SKIP LOCKED (concurrency safety)
 *   - markFailed retry logic (returns to pending vs permanent failure)
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
