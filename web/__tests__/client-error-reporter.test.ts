/*
 * Client-error reporter (OSB-P6, вариант B) — the boundary-side half of the
 * beacon. Pins the payload contract (message/digest/stack + location.pathname,
 * never the query string) and the never-throw guarantee: reporting failures
 * must not break the error UI they run inside.
 */

import { reportClientError } from '@/lib/client-error-reporter';

describe('reportClientError', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    // jsdom has no global Response; the reporter never reads the result anyway
    fetchMock = jest.fn().mockResolvedValue({ status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;
    window.history.pushState({}, '', '/minsk/cafe-x?query=секретный+текст');
  });

  it('POSTs message/digest/stack with pathname only — query string never leaves the page', () => {
    const error = Object.assign(new Error('boom'), { digest: 'd42' });
    reportClientError(error);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/client-error');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);

    const payload = JSON.parse(init.body);
    expect(payload.message).toBe('boom');
    expect(payload.digest).toBe('d42');
    expect(payload.stack).toEqual(expect.stringContaining('boom'));
    expect(payload.path).toBe('/minsk/cafe-x');
    expect(payload.path).not.toContain('query');
  });

  it('falls back to a placeholder message when the error has none', () => {
    reportClientError(new Error(''));

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.message).toBe('Unknown client error');
  });

  it('pre-slices oversized fields to keep the keepalive body deliverable', () => {
    const error = new Error('m'.repeat(10_000));
    error.stack = 's'.repeat(100_000);
    reportClientError(error);

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.message).toHaveLength(500);
    expect(payload.stack).toHaveLength(4000);
  });

  it('never throws when fetch itself is broken', () => {
    global.fetch = (() => {
      throw new Error('fetch exploded');
    }) as unknown as typeof fetch;

    expect(() => reportClientError(new Error('boom'))).not.toThrow();
  });

  it('swallows an async fetch rejection (no unhandled rejection)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    expect(() => reportClientError(new Error('boom'))).not.toThrow();
    await Promise.resolve(); // let the .catch(() => {}) settle
  });
});
