/**
 * @jest-environment node
 */
/*
 * Which slugs the detail page may ask the API about (thread «Расходы
 * посторонних», point 5, 03.11.2026): a made-up path must not spend the
 * site's budget on the API, and a card approved a moment ago must still open.
 */
jest.mock('@/lib/api/endpoints/establishments', () => ({ getCatalog: jest.fn() }));

import { getCatalog } from '@/lib/api/endpoints/establishments';
import { MISSES_PER_HOUR, _resetForTests, hasSlugForm, mayAskForSlug } from '@/lib/known-slugs';

const mockCatalog = getCatalog as jest.Mock;

const page = (slugs: string[], hasNext = false) => ({
  establishments: slugs.map((slug) => ({ slug })),
  pagination: { hasNext },
});

beforeEach(() => {
  _resetForTests();
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-11-03T12:00:00Z') });
  mockCatalog.mockResolvedValue(page(['kofe-taym', 'pizza-2']));
});

afterEach(() => jest.useRealTimers());

describe('the form of a slug', () => {
  it.each(['kofe-taym', 'a', 'pizza-2', 'a'.repeat(150)])('%s — a slug', (slug) => {
    expect(hasSlugForm(slug)).toBe(true);
  });

  it.each(['Kofe', 'kofe--taym', '-kofe', 'kofe-', 'кофе', 'wp-login.php', 'a'.repeat(151), ''])(
    '%s — not a slug, the API is not asked',
    async (slug) => {
      expect(await mayAskForSlug(slug)).toBe(false);
      expect(mockCatalog).not.toHaveBeenCalled();
    },
  );
});

describe('the catalogue', () => {
  it('a card of the catalogue — asked; the list is read once, in pages', async () => {
    mockCatalog
      .mockResolvedValueOnce(page(['kofe-taym'], true))
      .mockResolvedValueOnce(page(['pizza-2']));

    expect(await mayAskForSlug('kofe-taym')).toBe(true);
    expect(await mayAskForSlug('pizza-2')).toBe(true);
    expect(mockCatalog).toHaveBeenCalledTimes(2);
    expect(mockCatalog).toHaveBeenNthCalledWith(2, { limit: 100, page: 2 });
  });

  it('a card approved after the list was read opens at once (the list is read anew)', async () => {
    expect(await mayAskForSlug('kofe-taym')).toBe(true);
    mockCatalog.mockResolvedValue(page(['kofe-taym', 'novaya-kofeynya']));
    jest.advanceTimersByTime(61 * 1000);

    expect(await mayAskForSlug('novaya-kofeynya')).toBe(true);
    expect(mockCatalog).toHaveBeenCalledTimes(2);
  });

  it('made-up slugs: the list is read at most once a minute', async () => {
    for (let i = 0; i < 50; i += 1) await mayAskForSlug(`net-takogo-${i}`);

    expect(mockCatalog).toHaveBeenCalledTimes(1);
  });

  it(`made-up slugs: ${MISSES_PER_HOUR} asks an hour, then «not found» unasked; the next hour — again`, async () => {
    const answers = [];
    for (let i = 0; i < MISSES_PER_HOUR + 5; i += 1) answers.push(await mayAskForSlug(`net-takogo-${i}`));

    expect(answers.filter(Boolean)).toHaveLength(MISSES_PER_HOUR);
    expect(answers.slice(-5)).toEqual([false, false, false, false, false]);
    expect(await mayAskForSlug('kofe-taym')).toBe(true);

    jest.advanceTimersByTime(60 * 60 * 1000);
    expect(await mayAskForSlug('net-takogo-novyy')).toBe(true);
  });

  it('the list could not be read — every well-formed slug is asked, as before', async () => {
    mockCatalog.mockRejectedValue(new Error('API down'));

    for (let i = 0; i < MISSES_PER_HOUR + 5; i += 1) {
      expect(await mayAskForSlug(`lyuboy-${i}`)).toBe(true);
    }
    expect(mockCatalog).toHaveBeenCalledTimes(1);
  });
});
