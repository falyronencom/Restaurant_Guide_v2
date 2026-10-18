/**
 * @jest-environment node
 */
/**
 * The term of a refused upload reaches the cabinet (lib/partner/upload.ts).
 *
 * The backend's daily upload allowance (PR #54, #56) refuses with 429
 * RATE_LIMIT_EXCEEDED and names when it renews — seconds in
 * error.details.retry_after and in the Retry-After header, the moment in
 * error.details.reset_at; the request limiter's 429 carries the same two
 * fields. The proxy passes them on (partner-media-proxy.test); the upload
 * helper carries them in its failure as retryAfter / resetAt, for the cabinet
 * to show.
 *
 * The term cases only require a message; its wording — the site's phrase
 * with the term, the server's Russian text as is — has its own cases below
 * (сверка находок тестировщика с сайтом, 18.10, пункт С5).
 *
 * Expected values are literals: the backend's envelopes as it sends them.
 */
import { uploadMedia, uploadMediaToEstablishment } from '@/lib/partner/upload';

const upstream = jest.fn();
const realFetch = global.fetch;

const RESET_AT = '2026-10-17T21:00:00.000Z';
const anyMessage = expect.any(String);

function refusal(
  status: number,
  error: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ success: false, message: 'текст сервера', error }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** The daily upload allowance's 429 (services/uploadAllowance.js). */
const allowanceSpent = (headers: Record<string, string> = { 'retry-after': '43200' }) =>
  refusal(
    429,
    {
      code: 'RATE_LIMIT_EXCEEDED',
      details: {
        files_limit: 100,
        bytes_limit: 314572800,
        retry_after: 43200,
        reset_at: RESET_AT,
      },
    },
    headers,
  );

const photo = () =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], 'hall.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  upstream.mockReset();
  global.fetch = upstream as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

describe('uploadMedia (the wizard, /api/partner/media)', () => {
  it('429 of the daily allowance: the failure carries retryAfter and resetAt', async () => {
    upstream.mockResolvedValueOnce(allowanceSpent());

    expect(await uploadMedia(photo(), 'interior')).toStrictEqual({
      ok: false,
      message: anyMessage,
      retryAfter: 43200,
      resetAt: RESET_AT,
    });
    expect(upstream).toHaveBeenCalledWith(
      '/api/partner/media',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('429 of the request limiter (a minute window) carries its term the same way', async () => {
    upstream.mockResolvedValueOnce(
      refusal(429, {
        code: 'RATE_LIMIT_EXCEEDED',
        details: { limit: 100, window: '1 minute', retry_after: 37, reset_at: '2026-10-17T09:01:00.000Z' },
      }),
    );

    expect(await uploadMedia(photo(), 'interior')).toStrictEqual({
      ok: false,
      message: anyMessage,
      retryAfter: 37,
      resetAt: '2026-10-17T09:01:00.000Z',
    });
  });

  it('the body wins over the header', async () => {
    upstream.mockResolvedValueOnce(allowanceSpent({ 'retry-after': '60' }));

    expect(await uploadMedia(photo(), 'interior')).toMatchObject({
      ok: false,
      retryAfter: 43200,
      resetAt: RESET_AT,
    });
  });

  it('a body without details: the term comes from Retry-After alone', async () => {
    upstream.mockResolvedValueOnce(
      refusal(429, { code: 'RATE_LIMIT_EXCEEDED' }, { 'retry-after': '120' }),
    );

    expect(await uploadMedia(photo(), 'interior')).toStrictEqual({
      ok: false,
      message: anyMessage,
      retryAfter: 120,
    });
  });

  it.each([
    ['not a number', 'soon'],
    ['zero', '0'],
    ['a fraction', '1.5'],
    ['negative', '-5'],
    ['in exponent form', '1e3'],
    ['an HTTP-date', 'Fri, 17 Oct 2026 21:00:00 GMT'],
  ])('Retry-After %s and no details — no term', async (_label, header) => {
    upstream.mockResolvedValueOnce(
      refusal(429, { code: 'RATE_LIMIT_EXCEEDED' }, { 'retry-after': header }),
    );

    expect(await uploadMedia(photo(), 'interior')).toStrictEqual({
      ok: false,
      message: anyMessage,
    });
  });

  it('a details term of the wrong type is not taken', async () => {
    upstream.mockResolvedValueOnce(
      refusal(429, {
        code: 'RATE_LIMIT_EXCEEDED',
        details: { retry_after: '43200', reset_at: 1760734800 },
      }),
    );

    expect(await uploadMedia(photo(), 'interior')).toStrictEqual({
      ok: false,
      message: anyMessage,
    });
  });

  it('any other refusal carries no term — exactly as before', async () => {
    upstream.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, message: 'File too large', error: { code: 'FILE_TOO_LARGE' } }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      ),
    );

    expect(await uploadMedia(photo(), 'interior')).toStrictEqual({
      ok: false,
      message: 'Файл слишком большой.',
    });
  });

  /*
   * The wording (сверка находок тестировщика с сайтом, 18.10, пункт С5): the
   * server's Russian text, which errorHandler puts at the TOP level of the
   * body, is shown as is; the daily allowance gets the site's phrase with its
   * term; the request limiter — its own.
   */
  it('a Russian server text (top-level message) is shown as is', async () => {
    upstream.mockResolvedValueOnce(
      refusal(422, { code: 'INVALID_FILE_TYPE' }),
    );

    expect(await uploadMedia(photo(), 'interior')).toStrictEqual({
      ok: false,
      message: 'текст сервера',
    });
  });

  it("the daily allowance: the site's phrase with its term", async () => {
    upstream.mockResolvedValueOnce(allowanceSpent());

    expect(await uploadMedia(photo(), 'interior')).toMatchObject({
      ok: false,
      message:
        'Лимит загрузок на сегодня исчерпан. Загрузить снова можно через 12 ч — после полуночи.',
    });
  });

  it('the request limiter: its own phrase with its term', async () => {
    upstream.mockResolvedValueOnce(
      refusal(429, {
        code: 'RATE_LIMIT_EXCEEDED',
        details: { limit: 100, window: '1 minute', retry_after: 37 },
      }),
    );

    expect(await uploadMedia(photo(), 'interior')).toMatchObject({
      ok: false,
      message: 'Слишком много запросов подряд. Попробуйте через 37 сек.',
    });
  });

  it('success — unchanged', async () => {
    const media = {
      url: 'https://res.cloudinary.com/x/image/upload/a.jpg',
      thumbnail_url: 'https://res.cloudinary.com/x/image/upload/t.jpg',
      preview_url: 'https://res.cloudinary.com/x/image/upload/p.jpg',
      public_id: 'establishments/temp/u/interior/a',
      file_type: 'image',
    };
    upstream.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: media }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(await uploadMedia(photo(), 'interior')).toStrictEqual({ ok: true, media });
  });
});

describe('uploadMediaToEstablishment (the card in edit mode, /api/partner/establishments/:id/media)', () => {
  it('429 of the daily allowance: the same term', async () => {
    upstream.mockResolvedValueOnce(allowanceSpent());
    const menu = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'menu.pdf', {
      type: 'application/pdf',
    });

    expect(await uploadMediaToEstablishment(menu, 'card-1', 'menu')).toStrictEqual({
      ok: false,
      message: anyMessage,
      retryAfter: 43200,
      resetAt: RESET_AT,
    });
    expect(upstream).toHaveBeenCalledWith(
      '/api/partner/establishments/card-1/media',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
