/**
 * @jest-environment node
 */
/*
 * Client-error beacon Route Handler (OSB-P6, вариант B). Verifies: the
 * same-origin guard runs first (parity with every other Route Handler), the
 * Content-Length precheck rejects undeclared/oversized bodies BEFORE any
 * buffering, the payload is validated and field-capped before the single
 * console.error, no IP-derived data is logged, and the instance-wide
 * throttle caps a storm.
 *
 * NOTE: the handler keeps its throttle window in module state, so the 429
 * test must stay LAST in the shared-module block — it deliberately exhausts
 * the window. The window's own numbers (30 per minute, reset after 60 s) are
 * pinned on a fresh copy of the module with a controlled clock, below.
 *
 * Expected numbers are the route's documented contract (header comments of
 * route.ts): a 32 768-byte body cap, field caps message 500 / stack 4000 /
 * digest 100 / path 200 / user-agent 200, 30 reports per 60-second window.
 */

import { POST as clientErrorPost } from '@/app/api/client-error/route';

const SAME = { origin: 'http://localhost:3000', host: 'localhost:3000' };
const CROSS = { origin: 'http://evil.example', host: 'localhost:3000' };

type FakeRequest = Request & { json: jest.Mock };

function makeRequest(
  headers: Record<string, string>,
  body?: unknown,
  opts: { contentLength?: string | null } = {},
): FakeRequest {
  const merged: Record<string, string> = { ...headers };
  // Mirror a real browser fetch: a string body always carries Content-Length.
  if (opts.contentLength === undefined) {
    if (body !== undefined) {
      merged['content-length'] = String(
        Buffer.byteLength(JSON.stringify(body)),
      );
    }
  } else if (opts.contentLength !== null) {
    merged['content-length'] = opts.contentLength;
  }

  return {
    headers: { get: (k: string) => merged[k.toLowerCase()] ?? null },
    // A mock, so "before buffering" is observable: reading the body is the
    // buffering step, and the 413 cases assert it never happened.
    json: jest.fn(async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    }),
  } as unknown as FakeRequest;
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('client-error beacon', () => {
  it('blocks a cross-origin POST with 403 before logging anything', async () => {
    const res = await clientErrorPost(makeRequest(CROSS, { message: 'x' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: 'CSRF' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('rejects a request without Content-Length with 413 before buffering', async () => {
    const req = makeRequest(SAME, { message: 'x' }, { contentLength: null });
    const res = await clientErrorPost(req);
    expect(res.status).toBe(413);
    expect(req.json).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('rejects an oversized or non-numeric declared body with 413', async () => {
    const bigReq = makeRequest(SAME, { message: 'x' }, { contentLength: '10000000' });
    const junkReq = makeRequest(SAME, { message: 'x' }, { contentLength: 'chunked' });
    const big = await clientErrorPost(bigReq);
    const junk = await clientErrorPost(junkReq);
    expect(big.status).toBe(413);
    expect(junk.status).toBe(413);
    // Refused before buffering: the body was never read.
    expect(bigReq.json).not.toHaveBeenCalled();
    expect(junkReq.json).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('the body cap is 32 768 bytes: exactly the cap is read, one byte more is 413', async () => {
    const atCapReq = makeRequest(SAME, { message: 'at cap' }, { contentLength: '32768' });
    const overReq = makeRequest(SAME, { message: 'over' }, { contentLength: '32769' });
    expect((await clientErrorPost(atCapReq)).status).toBe(204);
    expect((await clientErrorPost(overReq)).status).toBe(413);
    expect(overReq.json).not.toHaveBeenCalled();
  });

  it('rejects a malformed JSON body with 400 without logging', async () => {
    // Declared small length, but json() throws (invalid JSON on the wire)
    const res = await clientErrorPost(
      makeRequest(SAME, undefined, { contentLength: '10' }),
    );
    expect(res.status).toBe(400);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('rejects a body without a message with 400', async () => {
    const res = await clientErrorPost(makeRequest(SAME, { stack: 'no msg' }));
    expect(res.status).toBe(400);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs a capped single-line JSON report and returns 204', async () => {
    // Proxy address headers are present, as behind Railway's edge: the
    // record must not carry them (PII, 99-З).
    const res = await clientErrorPost(
      makeRequest(
        {
          ...SAME,
          'user-agent': 'TestBrowser/1.0',
          'x-forwarded-for': '203.0.113.7',
          'x-real-ip': '203.0.113.7',
        },
        {
          message: 'boom',
          digest: 'd1',
          path: '/minsk/cafe-x',
          stack: 'Error: boom\n  at render',
        },
      ),
    );
    expect(res.status).toBe(204);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    const [prefix, json] = errorSpy.mock.calls[0];
    expect(prefix).toBe('[client-error]');
    expect(JSON.parse(json)).toEqual({
      message: 'boom',
      digest: 'd1',
      path: '/minsk/cafe-x',
      stack: 'Error: boom\n  at render',
      userAgent: 'TestBrowser/1.0',
    });
    expect(json).not.toContain('203.0.113.7');
  });

  it('caps oversized fields instead of logging them verbatim', async () => {
    const res = await clientErrorPost(
      makeRequest(
        { ...SAME, 'user-agent': 'u'.repeat(1_000) },
        {
          message: 'm'.repeat(10_000),
          stack: 's'.repeat(15_000),
          digest: 'd'.repeat(1_000),
          path: `/${'p'.repeat(1_000)}`,
        },
      ),
    );
    expect(res.status).toBe(204);

    const logged = JSON.parse(errorSpy.mock.calls[0][1]);
    expect(logged.message).toHaveLength(500);
    expect(logged.stack).toHaveLength(4000);
    expect(logged.digest).toHaveLength(100);
    expect(logged.path).toHaveLength(200);
    expect(logged.userAgent).toHaveLength(200);
  });

  it('drops non-string fields rather than logging junk', async () => {
    await clientErrorPost(
      makeRequest(SAME, { message: 'ok', digest: 42, path: { evil: true } }),
    );

    const logged = JSON.parse(errorSpy.mock.calls[0][1]);
    expect(logged.message).toBe('ok');
    expect(logged.digest).toBeUndefined();
    expect(logged.path).toBeUndefined();
  });

  it('throttles a report storm with 429 (instance-wide window) — keep last', async () => {
    let sawTooMany = false;
    for (let i = 0; i < 40; i += 1) {
      const res = await clientErrorPost(makeRequest(SAME, { message: `e${i}` }));
      if (res.status === 429) {
        sawTooMany = true;
        break;
      }
    }
    expect(sawTooMany).toBe(true);
    // The throttle must cut in at the 30/min window, not merely at loop end.
    expect(errorSpy.mock.calls.length).toBeLessThanOrEqual(30);
  });
});

describe('client-error beacon — the throttle window on a fresh module', () => {
  const T0 = 1_000_000_000;
  let nowSpy: jest.SpyInstance;

  /** A fresh copy of the handler: its window starts empty. */
  function freshPost(): typeof clientErrorPost {
    let post!: typeof clientErrorPost;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      post = require('@/app/api/client-error/route').POST;
    });
    return post;
  }

  async function statuses(post: typeof clientErrorPost, n: number): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) {
      out.push((await post(makeRequest(SAME, { message: `w${i}` }))).status);
    }
    return out;
  }

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(T0);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('lets exactly 30 reports through in one minute; the 31st is 429', async () => {
    const post = freshPost();
    const seen = await statuses(post, 31);
    expect(seen.slice(0, 30)).toEqual(Array(30).fill(204));
    expect(seen[30]).toBe(429);
  });

  it('the window resets after 60 s — not earlier, and not never', async () => {
    const post = freshPost();
    await statuses(post, 30);
    nowSpy.mockReturnValue(T0 + 59_999);
    expect(await statuses(post, 1)).toEqual([429]);
    nowSpy.mockReturnValue(T0 + 60_000);
    expect(await statuses(post, 1)).toEqual([204]);
  });
});
