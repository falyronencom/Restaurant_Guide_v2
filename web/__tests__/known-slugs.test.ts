/**
 * @jest-environment node
 */
/*
 * What the card page does with an address before asking the API (thread
 * «Расходы посторонних», point 5, 03.11.2026): a made-up path or a card under
 * a foreign address must not spend the site's budget on the API, and a card
 * approved or moved a moment ago must still open.
 */
jest.mock('@/lib/api/endpoints/establishments', () => ({ getCatalog: jest.fn() }));

import { getCatalog } from '@/lib/api/endpoints/establishments';
import { MISSES_PER_HOUR, _resetForTests, hasSlugForm, noteCardAddress, slugVerdict } from '@/lib/known-slugs';

const mockCatalog = getCatalog as jest.Mock;

const est = (slug: string, city_slug = 'minsk', category_slug = 'restaurants') => ({ slug, city_slug, category_slug });
const page = (cards: ReturnType<typeof est>[], hasNext = false) => ({
  establishments: cards,
  pagination: { hasNext },
});
const own = (slug: string) => `/minsk/restaurants/${slug}`;
const ASK = { kind: 'ask' };
const NOT_FOUND = { kind: 'not-found' };

beforeEach(() => {
  _resetForTests();
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date('2026-11-03T12:00:00Z') });
  mockCatalog.mockResolvedValue(page([est('kofe-taym'), est('pizza-2', 'grodno', 'pizzerias')]));
});

afterEach(() => jest.useRealTimers());

/** Spend the hour's allowance of asks outside the list. */
async function spendAllowance() {
  for (let i = 0; i < MISSES_PER_HOUR; i += 1) await slugVerdict(`net-takogo-${i}`, own(`net-takogo-${i}`));
}

describe('the form of a slug', () => {
  it.each(['kofe-taym', 'a', 'pizza-2', 'a'.repeat(150)])('%s — a slug', (slug) => {
    expect(hasSlugForm(slug)).toBe(true);
  });

  it.each(['Kofe', 'kofe--taym', '-kofe', 'kofe-', 'кофе', 'wp-login.php', 'a'.repeat(151), ''])(
    '%s — «not found», the catalogue is not even read',
    async (slug) => {
      expect(await slugVerdict(slug, own(slug))).toEqual(NOT_FOUND);
      expect(mockCatalog).not.toHaveBeenCalled();
    },
  );
});

describe('the catalogue', () => {
  it('a card at its own address — asked; the list is read once, in pages', async () => {
    mockCatalog
      .mockResolvedValueOnce(page([est('kofe-taym')], true))
      .mockResolvedValueOnce(page([est('pizza-2', 'grodno', 'pizzerias')]));

    expect(await slugVerdict('kofe-taym', own('kofe-taym'))).toEqual(ASK);
    expect(await slugVerdict('pizza-2', '/grodno/pizzerias/pizza-2')).toEqual(ASK);
    expect(mockCatalog).toHaveBeenCalledTimes(2);
    expect(mockCatalog).toHaveBeenNthCalledWith(2, { limit: 100, page: 2 });
  });

  it('a card approved after the list was read opens at once (the list is read anew)', async () => {
    await slugVerdict('kofe-taym', own('kofe-taym'));
    mockCatalog.mockResolvedValue(page([est('kofe-taym'), est('novaya-kofeynya')]));
    jest.advanceTimersByTime(61 * 1000);

    expect(await slugVerdict('novaya-kofeynya', own('novaya-kofeynya'))).toEqual(ASK);
    expect(mockCatalog).toHaveBeenCalledTimes(2);
  });

  it('made-up slugs: the list is read at most once a minute', async () => {
    for (let i = 0; i < 50; i += 1) await slugVerdict(`net-takogo-${i}`, own(`net-takogo-${i}`));

    expect(mockCatalog).toHaveBeenCalledTimes(1);
  });

  it(`made-up slugs: ${MISSES_PER_HOUR} asks an hour, then «not found» unasked; the next hour — again`, async () => {
    const answers = [];
    for (let i = 0; i < MISSES_PER_HOUR + 5; i += 1) answers.push(await slugVerdict(`net-${i}`, own(`net-${i}`)));

    expect(answers.filter((a) => a.kind === 'ask')).toHaveLength(MISSES_PER_HOUR);
    expect(answers.slice(-5)).toEqual(Array(5).fill(NOT_FOUND));
    expect(await slugVerdict('kofe-taym', own('kofe-taym'))).toEqual(ASK);

    jest.advanceTimersByTime(60 * 60 * 1000);
    expect(await slugVerdict('net-novyy', own('net-novyy'))).toEqual(ASK);
  });

  it('a card under a foreign address: asked while the allowance lasts, then redirected to its own unasked', async () => {
    expect(await slugVerdict('kofe-taym', '/grodno/bars/kofe-taym')).toEqual(ASK);

    await spendAllowance();

    expect(await slugVerdict('kofe-taym', '/grodno/bars/kofe-taym'))
      .toEqual({ kind: 'redirect', path: own('kofe-taym') });
    expect(await slugVerdict('pizza-2', '/minsk/restaurants/pizza-2'))
      .toEqual({ kind: 'redirect', path: '/grodno/pizzerias/pizza-2' });
    expect(await slugVerdict('kofe-taym', own('kofe-taym'))).toEqual(ASK);
  });

  it('the list could not be read — every well-formed slug is asked, as before', async () => {
    mockCatalog.mockRejectedValue(new Error('API down'));

    for (let i = 0; i < MISSES_PER_HOUR + 5; i += 1) {
      expect(await slugVerdict(`lyuboy-${i}`, own(`lyuboy-${i}`))).toEqual(ASK);
    }
    expect(mockCatalog).toHaveBeenCalledTimes(1);
  });
});

describe('a card moved from the cabinet (Phase 4.5, MEDIUM 3)', () => {
  const OLD = own('kofe-taym');
  const NEW = '/minsk/cafes/kofe-taym';

  it('the list learns the new address at once: the new address is asked, the old one redirects to it — no loop, no call', async () => {
    expect(await slugVerdict('kofe-taym', OLD)).toEqual(ASK); // the list is read
    await spendAllowance();

    noteCardAddress('kofe-taym', NEW);
    const reads = mockCatalog.mock.calls.length;
    expect(await slugVerdict('kofe-taym', NEW)).toEqual(ASK);
    expect(await slugVerdict('kofe-taym', OLD)).toEqual({ kind: 'redirect', path: NEW });
    expect(mockCatalog.mock.calls.length).toBe(reads);
  });

  it('without the note, the list older than the move sends the new address back to the old one', async () => {
    expect(await slugVerdict('kofe-taym', OLD)).toEqual(ASK);
    await spendAllowance();

    expect(await slugVerdict('kofe-taym', NEW)).toEqual({ kind: 'redirect', path: OLD });
  });

  it('no list yet — nothing to correct: the list read later is the catalogue\'s', async () => {
    noteCardAddress('kofe-taym', NEW);
    expect(mockCatalog).not.toHaveBeenCalled();
    expect(await slugVerdict('kofe-taym', OLD)).toEqual(ASK); // the list is read now
    expect(mockCatalog).toHaveBeenCalledTimes(1);
    await spendAllowance();
    expect(await slugVerdict('kofe-taym', OLD)).toEqual(ASK);
  });
});

describe('one list for the whole process: the page and the cabinet are bundled apart (stand, 23.11.2026)', () => {
  it('a note made through another copy of the module reaches this one', async () => {
    const OLD = own('kofe-taym');
    const NEW = '/minsk/cafes/kofe-taym';
    expect(await slugVerdict('kofe-taym', OLD)).toEqual(ASK); // this copy (the page) reads the list
    await spendAllowance();

    // The cabinet's Route Handler: a copy of the module of its own.
    let cabinetCopy: typeof import('@/lib/known-slugs') | undefined;
    await jest.isolateModulesAsync(async () => {
      cabinetCopy = await import('@/lib/known-slugs');
    });
    expect(cabinetCopy).toBeDefined();
    expect(cabinetCopy!.noteCardAddress).not.toBe(noteCardAddress);
    cabinetCopy!.noteCardAddress('kofe-taym', NEW);

    expect(await slugVerdict('kofe-taym', NEW)).toEqual(ASK);
    expect(await slugVerdict('kofe-taym', OLD)).toEqual({ kind: 'redirect', path: NEW });
  });
});

describe('a note made while the list is being read (Phase 4.5, regular)', () => {
  it('is laid over what the read brings', async () => {
    const OLD = own('kofe-taym');
    const NEW = '/minsk/cafes/kofe-taym';
    let release!: (v: unknown) => void;
    mockCatalog.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const first = slugVerdict('kofe-taym', OLD); // the read begins
    await Promise.resolve();
    noteCardAddress('kofe-taym', NEW); // the cabinet, meanwhile
    release(page([est('kofe-taym')])); // the read brings the address of before
    await first;
    await spendAllowance();

    expect(await slugVerdict('kofe-taym', NEW)).toEqual(ASK);
    expect(await slugVerdict('kofe-taym', OLD)).toEqual({ kind: 'redirect', path: NEW });
  });
});
