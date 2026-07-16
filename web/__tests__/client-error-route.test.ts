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
 * test must stay LAST in this file — it deliberately exhausts the window.
 */

import { POST as clientErrorPost } from '@/app/api/client-error/route';

const SAME = { origin: 'http://localhost:3000', host: 'localhost:3000' };
const CROSS = { origin: 'http://evil.example', host: 'localhost:3000' };

function makeRequest(
  headers: Record<string, string>,
  body?: unknown,
  opts: { contentLength?: string | null } = {},
): Request {
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
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  } as unknown as Request;
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
    const res = await clientErrorPost(
      makeRequest(SAME, { message: 'x' }, { contentLength: null }),
    );
    expect(res.status).toBe(413);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('rejects an oversized or non-numeric declared body with 413', async () => {
    const big = await clientErrorPost(
      makeRequest(SAME, { message: 'x' }, { contentLength: '10000000' }),
    );
    const junk = await clientErrorPost(
      makeRequest(SAME, { message: 'x' }, { contentLength: 'chunked' }),
    );
    expect(big.status).toBe(413);
    expect(junk.status).toBe(413);
    expect(errorSpy).not.toHaveBeenCalled();
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
    const res = await clientErrorPost(
      makeRequest(
        { ...SAME, 'user-agent': 'TestBrowser/1.0' },
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
  });

  it('caps oversized fields instead of logging them verbatim', async () => {
    const res = await clientErrorPost(
      makeRequest(SAME, {
        message: 'm'.repeat(10_000),
        stack: 's'.repeat(15_000),
      }),
    );
    expect(res.status).toBe(204);

    const logged = JSON.parse(errorSpy.mock.calls[0][1]);
    expect(logged.message).toHaveLength(500);
    expect(logged.stack).toHaveLength(4000);
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
