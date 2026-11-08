/**
 * working-hours — the schedule parser behind the "Открыто / Закрыто" badge.
 *
 * ~140 of this module's lines are a port of mobile's parseDayHours /
 * isCurrentlyOpen. It decides, for every card and every establishment page,
 * whether a place is called open right now — a verdict a reader acts on by
 * getting into a car. Nothing downstream re-derives it.
 *
 * Honesty-audit boundary (2026-09-08). Before this file the function was
 * EXECUTED transitively — favorites-list.test.tsx renders real
 * EstablishmentCard → OpenStatusBadge and enters the statusFallback branch —
 * but no assertion anywhere looked at its result, and the overnight-rollover
 * branch was executed by no test at all. Pilot mutation M45 broke that branch
 * ("open past midnight" → always closed) and left all 481 tests green. The
 * strings «Открыто»/«Закрыто» live only in open-status-badge.test.tsx, which
 * mocks this module.
 *
 * TIME FIXTURES — component-wise local constructor, never an ISO string with
 * `Z`. computeOpenStatus takes `now` as a parameter (no fake timers needed),
 * but reads it with LOCAL getters: getDay(), getHours(), getMinutes(). A
 * component-wise `new Date(2026, 8, 7, 14, 30)` cancels out against local
 * getters and yields the same verdict in any zone; `'2026-09-07T14:30:00Z'`
 * would pin the fixture to the runner's offset and drift between this machine
 * and the gate (feedback_timezone_axis_naive_timestamps).
 *
 * NOT covered here on purpose: normalizeCategory / normalizeCuisine and their
 * legacy maps at the bottom of the module. Pilot finding 14 — dead against
 * production data, removed only after migration 030 lands and in all three
 * copies at once. Separate decision, not this chip's.
 */
import { computeOpenStatus, parseDayHours } from '@/lib/working-hours';

// 2026-09-07 is a Monday (getDay() === 1), 2026-09-06 a Sunday (getDay() === 0).
// Month is 0-based: 8 = September.
const monday = (h: number, m: number) => new Date(2026, 8, 7, h, m);
const sunday = (h: number, m: number) => new Date(2026, 8, 6, h, m);

describe('parseDayHours', () => {
  it('parses the "HH:MM-HH:MM" string form and trims the halves', () => {
    expect(parseDayHours('10:00-22:00')).toEqual({
      open: '10:00',
      close: '22:00',
      isOpen: true,
    });
    expect(parseDayHours(' 10:00 - 22:00 ')).toEqual({
      open: '10:00',
      close: '22:00',
      isOpen: true,
    });
  });

  it('rejects a string that is not exactly two proper times', () => {
    expect(parseDayHours('10:00')).toBeNull(); // one part
    expect(parseDayHours('10-22-00')).toBeNull(); // three parts
    expect(parseDayHours('-22:00')).toBeNull(); // empty open
    expect(parseDayHours('10:00-')).toBeNull(); // empty close
    expect(parseDayHours('10:00-   ')).toBeNull(); // whitespace-only close
    expect(parseDayHours('25:99-abc')).toBeNull(); // not times at all
    expect(parseDayHours('10:00-25:99')).toBeNull(); // close out of range
  });

  it('brings a time to one form: «9:00» and seconds read, «09:00» comes out', () => {
    expect(parseDayHours({ open: '9:00', close: '22:00:00' })).toEqual({
      open: '09:00',
      close: '22:00',
      isOpen: true,
    });
    expect(parseDayHours('9:05-1:30')).toEqual({
      open: '09:05',
      close: '01:30',
      isOpen: true,
    });
  });

  it('reads { is_open: false } as the closed marker, even beside times', () => {
    expect(parseDayHours({ is_open: false })).toEqual({
      open: null,
      close: null,
      isOpen: false,
    });
    // The flag wins over strings that are still present in the JSONB.
    expect(
      parseDayHours({ is_open: false, open: '10:00', close: '22:00' }),
    ).toEqual({ open: null, close: null, isOpen: false });
  });

  it('normalizes the object form, with or without an explicit is_open', () => {
    const normalized = { open: '09:00', close: '18:00', isOpen: true };
    expect(parseDayHours({ open: '09:00', close: '18:00' })).toEqual(
      normalized,
    );
    expect(
      parseDayHours({ is_open: true, open: '09:00', close: '18:00' }),
    ).toEqual(normalized);
    // Anything but a proper time is dropped, the day stays "open" — that is the
    // day computeOpenStatus calls unknown and the cabinet shows as unfinished.
    expect(parseDayHours({ open: 900, close: null })).toEqual({
      open: null,
      close: null,
      isOpen: true,
    });
    expect(parseDayHours({ is_open: true, open: '', close: '' })).toEqual({
      open: null,
      close: null,
      isOpen: true,
    });
    expect(parseDayHours({ open: '10:00', close: '25:99' })).toEqual({
      open: '10:00',
      close: null,
      isOpen: true,
    });
  });

  it('returns null for null, undefined and non string/object entries', () => {
    expect(parseDayHours(null)).toBeNull();
    expect(parseDayHours(undefined)).toBeNull();
    expect(parseDayHours(42)).toBeNull();
    expect(parseDayHours(true)).toBeNull();
    expect(parseDayHours([1, 2])).toBeNull();
  });
});

const open = (closingTime: string) => ({ state: 'open', closingTime });
const closed = { state: 'closed', closingTime: null };
const unknown = { state: 'unknown', closingTime: null };

const everyDay = (hours: unknown) =>
  Object.fromEntries(
    [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ].map((day) => [day, hours]),
  );

// 2026-09-07 (Monday) … 2026-09-13 (Sunday), the same week the app's tests use.
const at = (daysFromMonday: number, h: number, m = 0) =>
  new Date(2026, 8, 7 + daysFromMonday, h, m);

describe('computeOpenStatus', () => {
  it('keeps an overnight schedule open across midnight (18:00-02:00)', () => {
    // The M45 branch. Three points, not one: before midnight, after midnight,
    // and midday — a mutant that hard-codes "closed" survives any single
    // "open" point that happens to sit outside the window. The night belongs
    // to yesterday's shift, so the schedule covers the whole week.
    const hours = everyDay('18:00-02:00');

    expect(computeOpenStatus(hours, 'active', monday(23, 0))).toEqual(
      open('02:00'),
    );
    expect(computeOpenStatus(hours, 'active', monday(1, 0))).toEqual(
      open('02:00'),
    );
    expect(computeOpenStatus(hours, 'active', monday(12, 0))).toEqual(closed);
    // The boundaries of the night window are a branch of their own.
    expect(computeOpenStatus(hours, 'active', monday(1, 59)).state).toBe('open');
    expect(computeOpenStatus(hours, 'active', monday(2, 0)).state).toBe('closed');
    expect(computeOpenStatus(hours, 'active', monday(18, 0)).state).toBe('open');
    expect(computeOpenStatus(hours, 'active', monday(17, 59)).state).toBe(
      'closed',
    );
  });

  it('reads close equal to open as 24 hours from the opening, not a zero-width window', () => {
    // Pins `closeMin <= openMin` against `closeMin < openMin`, which would send
    // 12:00-12:00 down the plain-day branch and report the place closed at every
    // minute of the day.
    const hours = {
      sunday: { is_open: false },
      monday: '12:00-12:00',
      tuesday: { is_open: false },
    };

    expect(computeOpenStatus(hours, 'active', at(0, 11, 59))).toEqual(closed);
    expect(computeOpenStatus(hours, 'active', at(0, 12))).toEqual(open('12:00'));
    expect(computeOpenStatus(hours, 'active', at(1, 11, 59))).toEqual(
      open('12:00'),
    );
    expect(computeOpenStatus(hours, 'active', at(1, 12))).toEqual(closed);
  });

  it('00:00-00:00 is exactly that day, and every hour of a week of them', () => {
    const oneDay = { monday: '00:00-00:00', tuesday: { is_open: false } };
    for (const h of [0, 1, 12, 23]) {
      expect(computeOpenStatus(oneDay, 'active', at(0, h)).state).toBe('open');
    }
    expect(computeOpenStatus(oneDay, 'active', at(1, 0))).toEqual(closed);

    const week = everyDay('00:00-00:00');
    for (let day = 0; day < 7; day++) {
      for (let h = 0; h < 24; h++) {
        expect(computeOpenStatus(week, 'active', at(day, h)).state).toBe('open');
      }
    }
  });

  it('reports a plain day with its close time, a closed verdict without one', () => {
    const hours = { monday: { open: '10:00', close: '22:00' } };

    expect(computeOpenStatus(hours, 'active', monday(14, 30))).toEqual(
      open('22:00'),
    );
    // `status: 'active'` does not overrule the schedule.
    expect(computeOpenStatus(hours, 'active', monday(9, 59))).toEqual(closed);
    expect(computeOpenStatus(hours, 'active', monday(22, 30))).toEqual(closed);
  });

  it('opens on the opening minute and closes on the closing minute', () => {
    // Two separate points: they pin `>=` on open and `<` on close. A midday
    // point sees neither.
    const hours = { monday: '10:00-22:00' };

    expect(computeOpenStatus(hours, 'active', monday(10, 0)).state).toBe('open');
    expect(computeOpenStatus(hours, 'active', monday(9, 59)).state).toBe(
      'closed',
    );
    expect(computeOpenStatus(hours, 'active', monday(21, 59)).state).toBe(
      'open',
    );
    expect(computeOpenStatus(hours, 'active', monday(22, 0)).state).toBe(
      'closed',
    );
  });

  it('maps Sunday to the last DAY_KEYS slot, not to the first', () => {
    // DAY_KEYS runs Mon..Sun while getDay() runs Sun=0..Sat=6, so Sunday needs
    // index 6 and every other day shifts down by one. A map open ONLY on
    // Sunday: the Sunday point catches an unshifted index (it would read
    // Monday), the Monday point catches a Monday lookup landing on Sunday:
    // Monday has no record of its own, so it reads unknown.
    const sundayOnly = { sunday: '10:00-22:00' };

    expect(computeOpenStatus(sundayOnly, 'active', sunday(14, 0))).toEqual(
      open('22:00'),
    );
    expect(computeOpenStatus(sundayOnly, 'active', monday(14, 0))).toEqual(
      unknown,
    );
  });

  it('treats is_open: false as a schedule verdict, not as a missing day', () => {
    expect(
      computeOpenStatus(
        { monday: { is_open: false } },
        'active',
        monday(14, 0),
      ),
    ).toEqual(closed);
  });

  describe('the night belongs to yesterday\'s shift', () => {
    it('Friday 01:00: Thursday closed at 23:00, Friday opens at 12:00', () => {
      // Finding 2 of the check of 06.11.2026: it read «Открыто · до 02:00».
      const hours = { thursday: '12:00-23:00', friday: '12:00-02:00' };
      expect(computeOpenStatus(hours, 'active', at(4, 1))).toEqual(closed);
    });

    it('Sunday 01:00: Saturday\'s shift till 02:00 is still on', () => {
      // The reverse of the same finding: it read «Закрыто».
      const hours = { saturday: '12:00-02:00', sunday: '12:00-23:00' };
      expect(computeOpenStatus(hours, 'active', at(6, 1))).toEqual(open('02:00'));
    });

    it('crosses from Sunday to Monday', () => {
      const hours = { sunday: '18:00-03:00', monday: { is_open: false } };
      expect(computeOpenStatus(hours, 'active', at(0, 2, 59))).toEqual(
        open('03:00'),
      );
      expect(computeOpenStatus(hours, 'active', at(0, 3))).toEqual(closed);
    });

    it('a day off today does not cut yesterday\'s shift short', () => {
      const hours = { friday: '18:00-02:00', saturday: { is_open: false } };
      expect(computeOpenStatus(hours, 'active', at(5, 1))).toEqual(open('02:00'));
      expect(computeOpenStatus(hours, 'active', at(5, 2))).toEqual(closed);
      expect(computeOpenStatus(hours, 'active', at(5, 13))).toEqual(closed);
    });

    it('a day off yesterday: today\'s overnight record does not open the night', () => {
      const hours = { sunday: { is_open: false }, monday: '18:00-02:00' };
      expect(computeOpenStatus(hours, 'active', at(0, 1))).toEqual(closed);
      expect(computeOpenStatus(hours, 'active', at(0, 19))).toEqual(open('02:00'));
    });

    it('no data for yesterday: today\'s record decides', () => {
      const hours = { monday: '18:00-02:00' };
      expect(computeOpenStatus(hours, 'active', at(0, 1))).toEqual(closed);
      expect(computeOpenStatus(hours, 'active', at(0, 18))).toEqual(open('02:00'));
    });

    it('a broken record yesterday: today\'s record decides', () => {
      const hours = {
        sunday: { is_open: true, open: '', close: '' },
        monday: '10:00-22:00',
      };
      expect(computeOpenStatus(hours, 'active', at(0, 1))).toEqual(closed);
      expect(computeOpenStatus(hours, 'active', at(0, 12))).toEqual(open('22:00'));
    });

    it('no data for today: open while yesterday\'s shift runs, then unknown', () => {
      const hours = { monday: '18:00-02:00' };
      expect(computeOpenStatus(hours, 'active', at(1, 1))).toEqual(open('02:00'));
      expect(computeOpenStatus(hours, 'active', at(1, 2))).toEqual(unknown);
    });

    it('a plain day yesterday does not run on into the night', () => {
      const hours = { monday: '10:00-22:00', tuesday: '10:00-22:00' };
      expect(computeOpenStatus(hours, 'active', at(1, 1))).toEqual(closed);
    });
  });

  describe('hours that cannot be read: unknown, not «Открыто»', () => {
    it.each<[string, unknown]>([
      ['empty strings (what the cabinet used to send)', { is_open: true, open: '', close: '' }],
      ['one time empty', { is_open: true, open: '10:00', close: '' }],
      ['no times at all', { is_open: true }],
      ['a time that does not exist', { open: '25:99', close: '22:00' }],
      ['minutes that do not exist', { open: '10:60', close: '22:00' }],
      ['seconds that do not exist', { open: '10:00:99', close: '22:00' }],
      ['letters', { open: 'ab:cd', close: 'ef:gh' }],
      ['a tail after the time', { open: '10:00abc', close: '22:00' }],
      ['a time that is not a string', { open: 10, close: 22 }],
      ['a string without a dash', 'abc'],
      ['an empty string', ''],
      ['garbage in a string', '25:99-abc'],
      ['a number', 42],
      ['a list', [1, 2]],
      ['null', null],
    ])('%s', (_name, entry) => {
      for (let h = 0; h < 24; h++) {
        expect(
          computeOpenStatus({ monday: entry }, 'active', monday(h, 0)),
        ).toEqual(unknown);
      }
    });

    it('no usable week at all, or no record for today', () => {
      expect(computeOpenStatus(null, 'active', monday(14, 0))).toEqual(unknown);
      expect(computeOpenStatus({}, 'active', monday(14, 0))).toEqual(unknown);
      expect(computeOpenStatus('10:00-22:00', 'active', monday(14, 0))).toEqual(
        unknown,
      );
      expect(
        computeOpenStatus({ tuesday: '10:00-22:00' }, 'active', monday(14, 0)),
      ).toEqual(unknown);
    });

    it('a card off the catalog is closed, not unknown', () => {
      expect(computeOpenStatus(null, 'pending', monday(14, 0))).toEqual(closed);
      expect(
        computeOpenStatus(
          { monday: { is_open: true, close: '22:00' } },
          'suspended',
          monday(14, 0),
        ),
      ).toEqual(closed);
    });
  });

  describe('a card off the catalog reads «Закрыто» whatever its hours say', () => {
    // A favourite keeps showing a paused card or one under moderation, and its
    // schedule may say open now. Coordinator, 08.11.2026 («Да на 1–4»).
    it.each(['suspended', 'pending', 'draft', 'rejected', 'archived'])(
      '%s',
      (status) => {
        expect(
          computeOpenStatus(everyDay('00:00-00:00'), status, monday(14, 0)),
        ).toEqual(closed);
        // Yesterday's shift running into the night does not open it either.
        expect(
          computeOpenStatus(everyDay('18:00-02:00'), status, monday(1, 0)),
        ).toEqual(closed);
      },
    );
  });
});
