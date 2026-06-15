/**
 * Geocode proxy (Phase C Slice 1, Segment B — Decision 3). Nominatim response
 * parsing + guards. Throttle/cache are per-instance module state (not unit-tested
 * here); the first call within the test does not wait (lastCallAt starts at 0).
 */
// next/server's NextResponse does not load under jsdom; the route only uses
// NextResponse.json, so stub it to a minimal { json() } response.
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown) => ({ json: async () => body }),
  },
}));

import { GET } from '@/app/api/geocode/route';

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

// jsdom has no global Request; the route only reads request.url, so stub it.
function req(q: string): Request {
  return {
    url: `http://localhost/api/geocode?q=${encodeURIComponent(q)}`,
  } as unknown as Request;
}

describe('geocode GET', () => {
  it('returns null for a too-short query without calling Nominatim', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await GET(req('ab'));

    expect(await res.json()).toEqual({ result: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses the first Nominatim hit into {lat, lng}', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { lat: '53.9', lon: '27.56', display_name: 'Минск, Беларусь' },
      ],
    }) as unknown as typeof fetch;

    const res = await GET(req('Минск проспект Независимости 1'));
    const body = (await res.json()) as { result: { lat: number; lng: number } };

    expect(body.result).toMatchObject({ lat: 53.9, lng: 27.56 });
  });

  it('returns null when Nominatim yields no rows', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;

    const res = await GET(req('несуществующий адрес 9999 zzz'));

    expect((await res.json()).result).toBeNull();
  });

  it('returns null (non-fatal) when the upstream call throws', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network')) as unknown as typeof fetch;

    const res = await GET(req('Гомель улица Советская 5 abc'));

    expect((await res.json()).result).toBeNull();
  });
});
