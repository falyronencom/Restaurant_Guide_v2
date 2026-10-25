/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * The smart search's model budget (services/smartSearchBudget.js, D5
 * 25.10.2026): caps by hour and Minsk day, new phrases per person, «0 turns
 * a threshold off», calls rather than phrases, refusals that take back their
 * reservation, and no model without Redis.
 *
 * Redis is an in-memory stand-in with the commands the module uses, MULTI
 * included; hours and days are chosen by passing `now`.
 */
import { jest } from '@jest/globals';

const store = new Map();
const hashes = new Map();
const fake = {
  isReady: true,
  hangMulti: false,
  failMulti: false,
  multiCalls: 0,
};

const num = (key) => Number(store.get(key) ?? 0);

const makeMulti = () => {
  const ops = [];
  const chain = {
    set: (key, value, { NX } = {}) => {
      ops.push(() => {
        if (NX && store.has(key)) return null;
        store.set(key, String(value));
        return 'OK';
      });
      return chain;
    },
    incr: (key) => chain.incrBy(key, 1),
    incrBy: (key, amount) => {
      ops.push(() => { store.set(key, String(num(key) + amount)); return num(key); });
      return chain;
    },
    decrBy: (key, amount) => {
      ops.push(() => { store.set(key, String(num(key) - amount)); return num(key); });
      return chain;
    },
    hIncrBy: (key, field, amount) => {
      ops.push(() => {
        const hash = hashes.get(key) ?? {};
        hash[field] = String(Number(hash[field] ?? 0) + amount);
        hashes.set(key, hash);
        return Number(hash[field]);
      });
      return chain;
    },
    expire: () => { ops.push(() => 1); return chain; },
    exec: () => {
      fake.multiCalls += 1;
      if (fake.hangMulti) return new Promise(() => {});
      if (fake.failMulti) return Promise.reject(new Error('READONLY'));
      return Promise.resolve(ops.map((op) => op()));
    },
  };
  return chain;
};

const client = {
  get isReady() { return fake.isReady; },
  multi: makeMulti,
  get: async (key) => store.get(key) ?? null,
  hGetAll: async (key) => ({ ...(hashes.get(key) ?? {}) }),
};

jest.unstable_mockModule('../../config/redis.js', () => ({
  default: client,
  withRedisDeadline: (command, ms = 500) => {
    command.catch(() => {});
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms}ms`)), ms);
    });
    return Promise.race([command, deadline]).finally(() => clearTimeout(timer));
  },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const budget = await import('../../services/smartSearchBudget.js');
const { default: logger } = await import('../../utils/logger.js');

const VARIABLES = ['SMART_SEARCH_LLM_HOURLY_CAP', 'SMART_SEARCH_LLM_DAILY_CAP', 'SMART_SEARCH_NEW_PHRASES_PER_HOUR'];
const saved = {};

// 25.10.2026 12:30 UTC = 15:30 Minsk.
const T0 = new Date('2026-10-25T12:30:00Z');
const plusMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60 * 1000);

const ALICE = { tier: 'ip', identifier: '203.0.113.1' };
const BOB = { tier: 'ip', identifier: '203.0.113.2' };

/** Reserve and settle one call — a phrase whose first answer was usable. */
const onePhrase = async (requester, now) => {
  const decision = await budget.reserveModelCalls({ requester, now });
  if (decision.allowed) await decision.settle(['ok']);
  return decision;
};

beforeEach(() => {
  store.clear();
  hashes.clear();
  Object.assign(fake, { isReady: true, hangMulti: false, failMulti: false, multiCalls: 0 });
  for (const name of VARIABLES) saved[name] = process.env[name];
  budget.resetBudgetProcessState();
});

afterEach(() => {
  for (const name of VARIABLES) process.env[name] = saved[name];
});

describe('resolveBudgetCaps', () => {
  test('unset or empty — 600 an hour, 5000 a day, 20 new phrases an hour', () => {
    expect(budget.resolveBudgetCaps({})).toEqual({ hourly: 600, daily: 5000, newPhrasesPerHour: 20 });
    expect(budget.resolveBudgetCaps({
      SMART_SEARCH_LLM_HOURLY_CAP: '', SMART_SEARCH_LLM_DAILY_CAP: ' ', SMART_SEARCH_NEW_PHRASES_PER_HOUR: '',
    })).toEqual({ hourly: 600, daily: 5000, newPhrasesPerHour: 20 });
  });

  test('0 is taken — it turns that threshold off', () => {
    expect(budget.resolveBudgetCaps({ SMART_SEARCH_LLM_HOURLY_CAP: '0' }).hourly).toBe(0);
  });

  test.each(['-1', '2.5', '10/h', 'abc'])('%p — the default, with a warning once', (raw) => {
    expect(budget.resolveBudgetCaps({ SMART_SEARCH_LLM_DAILY_CAP: raw }).daily).toBe(5000);
    budget.resolveBudgetCaps({ SMART_SEARCH_LLM_DAILY_CAP: raw });
    expect(logger.warn.mock.calls.filter(([message]) => message.includes(raw))).toHaveLength(1);
  });
});

describe('isJunkPhrase', () => {
  test.each([
    ['7', true],
    ['!!!', true],
    ['12345', true],
    ['а', true],
    ['', true],
    ['один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать тринадцать', true],
    ['пицца', false],
    ['кафе 24', false],
    ['суши', false],
    ['ёж', false],
    ['один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать', false],
    ['latte', false],
  ])('%p → %p', (phrase, junk) => {
    expect(budget.isJunkPhrase(phrase)).toBe(junk);
  });
});

describe('the hour', () => {
  test('the cap holds in calls: 4 a hour lets two phrases through, not a third', async () => {
    process.env.SMART_SEARCH_LLM_HOURLY_CAP = '4';
    const first = await budget.reserveModelCalls({ requester: ALICE, now: T0 });
    const second = await budget.reserveModelCalls({ requester: BOB, now: T0 });
    const third = await budget.reserveModelCalls({ requester: ALICE, now: T0 });
    expect([first.allowed, second.allowed, third]).toEqual([true, true, { allowed: false, reason: 'hourly_cap' }]);
  });

  test('a call not made is given back: settled with one call, a phrase leaves room for more', async () => {
    process.env.SMART_SEARCH_LLM_HOURLY_CAP = '4';
    expect((await onePhrase(ALICE, T0)).allowed).toBe(true);
    expect((await onePhrase(BOB, T0)).allowed).toBe(true);
    // Two calls made, two free: one more phrase fits (it reserves two).
    expect((await onePhrase(ALICE, T0)).allowed).toBe(true);
    expect(await budget.reserveModelCalls({ requester: BOB, now: T0 })).toEqual({ allowed: false, reason: 'hourly_cap' });
  });

  test('a retry is a second paid call: two phrases with retries fill a cap of 4', async () => {
    process.env.SMART_SEARCH_LLM_HOURLY_CAP = '4';
    for (const requester of [ALICE, BOB]) {
      const decision = await budget.reserveModelCalls({ requester, now: T0 });
      await decision.settle(['schema', 'ok']);
    }
    expect(await budget.reserveModelCalls({ requester: ALICE, now: T0 })).toEqual({ allowed: false, reason: 'hourly_cap' });
  });

  test('the next hour starts afresh', async () => {
    process.env.SMART_SEARCH_LLM_HOURLY_CAP = '2';
    expect((await onePhrase(ALICE, T0)).allowed).toBe(true);
    expect((await budget.reserveModelCalls({ requester: BOB, now: plusMinutes(T0, 29) })).allowed).toBe(false);
    expect((await onePhrase(BOB, plusMinutes(T0, 30))).allowed).toBe(true);
  });

  test('0 turns the hour off', async () => {
    process.env.SMART_SEARCH_LLM_HOURLY_CAP = '0';
    process.env.SMART_SEARCH_NEW_PHRASES_PER_HOUR = '0';
    for (let i = 0; i < 50; i += 1) {
      expect((await onePhrase(ALICE, T0)).allowed).toBe(true);
    }
  });
});

describe('the Minsk day', () => {
  test('the day cap holds across hours and renews at Minsk midnight, not UTC', async () => {
    process.env.SMART_SEARCH_LLM_HOURLY_CAP = '0';
    process.env.SMART_SEARCH_LLM_DAILY_CAP = '2';
    // 20:30 UTC = 23:30 Minsk, 25.10.
    const lateEvening = new Date('2026-10-25T20:30:00Z');
    expect((await onePhrase(ALICE, lateEvening)).allowed).toBe(true);
    // 20:59 UTC — still the 25th in Minsk.
    expect(await budget.reserveModelCalls({ requester: BOB, now: new Date('2026-10-25T20:59:00Z') }))
      .toEqual({ allowed: false, reason: 'daily_cap' });
    // 21:00 UTC = 00:00 Minsk, 26.10 — a new day, while UTC still says the 25th.
    expect((await onePhrase(BOB, new Date('2026-10-25T21:00:00Z'))).allowed).toBe(true);
  });
});

describe('new phrases per person', () => {
  test('a person\'s 21st phrase of the hour is refused, another person goes on', async () => {
    process.env.SMART_SEARCH_NEW_PHRASES_PER_HOUR = '20';
    for (let i = 0; i < 20; i += 1) {
      expect((await onePhrase(ALICE, T0)).allowed).toBe(true);
    }
    expect(await budget.reserveModelCalls({ requester: ALICE, now: T0 })).toEqual({ allowed: false, reason: 'new_phrases' });
    expect((await onePhrase(BOB, T0)).allowed).toBe(true);
    expect((await onePhrase(ALICE, plusMinutes(T0, 30))).allowed).toBe(true);
  });

  test('a person\'s refusal takes back the hour\'s and the day\'s calls it reserved', async () => {
    process.env.SMART_SEARCH_NEW_PHRASES_PER_HOUR = '1';
    process.env.SMART_SEARCH_LLM_HOURLY_CAP = '4';
    await onePhrase(ALICE, T0);
    for (let i = 0; i < 5; i += 1) {
      expect((await budget.reserveModelCalls({ requester: ALICE, now: T0 })).reason).toBe('new_phrases');
    }
    // Alice's refusals did not spend the hour: Bob's phrase still fits.
    expect((await onePhrase(BOB, T0)).allowed).toBe(true);
  });

  test('a refusal by the hour does not spend the person\'s phrases', async () => {
    process.env.SMART_SEARCH_LLM_HOURLY_CAP = '2';
    process.env.SMART_SEARCH_NEW_PHRASES_PER_HOUR = '2';
    await onePhrase(BOB, T0);
    expect((await budget.reserveModelCalls({ requester: ALICE, now: T0 })).reason).toBe('hourly_cap');
    expect((await budget.reserveModelCalls({ requester: ALICE, now: T0 })).reason).toBe('hourly_cap');
    process.env.SMART_SEARCH_LLM_HOURLY_CAP = '0';
    expect((await onePhrase(ALICE, T0)).allowed).toBe(true);
    expect((await onePhrase(ALICE, T0)).allowed).toBe(true);
  });
});

describe('without Redis the model is not called', () => {
  test('client not ready — no_redis, no command sent', async () => {
    fake.isReady = false;
    expect(await budget.reserveModelCalls({ requester: ALICE, now: T0 })).toEqual({ allowed: false, reason: 'no_redis' });
    expect(fake.multiCalls).toBe(0);
  });

  test('MULTI fails — no_redis', async () => {
    fake.failMulti = true;
    expect(await budget.reserveModelCalls({ requester: ALICE, now: T0 })).toEqual({ allowed: false, reason: 'no_redis' });
  });

  test('MULTI never answers — no_redis within the call deadline', async () => {
    fake.hangMulti = true;
    const started = Date.now();
    expect(await budget.reserveModelCalls({ requester: ALICE, now: T0 })).toEqual({ allowed: false, reason: 'no_redis' });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  test('refusals without Redis are counted in the process and named in the health block', async () => {
    fake.isReady = false;
    await budget.reserveModelCalls({ requester: ALICE, now: T0 });
    await budget.reserveModelCalls({ requester: BOB, now: T0 });
    const health = await budget.getBudgetHealth({ modelAvailable: true, now: T0 });
    expect(health).toMatchObject({
      redis_ready: false, hour: null, day: null, denied_no_redis_since_start: 2, degraded: true,
    });
  });
});

describe('the health block', () => {
  test('counts calls, cache hits, refusals by reason, failures and the key\'s limit', async () => {
    process.env.SMART_SEARCH_LLM_HOURLY_CAP = '5';
    const a = await budget.reserveModelCalls({ requester: ALICE, now: T0 });
    await a.settle(['ok']);
    const b = await budget.reserveModelCalls({ requester: BOB, now: T0 });
    await b.settle(['schema', 'ok']);
    const c = await budget.reserveModelCalls({ requester: BOB, now: T0 });
    await c.settle(['http_402']);
    await budget.recordCacheHit(T0);
    await budget.recordCacheHit(T0);
    await budget.recordDenial('junk', T0);
    await budget.reserveModelCalls({ requester: ALICE, now: T0 }); // 4 + 2 > 5: hourly_cap

    const health = await budget.getBudgetHealth({ modelAvailable: true, now: T0 });
    expect(health.hour).toEqual({
      llm_calls: 4,
      cache_hits: 2,
      denied_junk: 1,
      denied_new_phrases: 0,
      denied_hourly_cap: 1,
      denied_daily_cap: 0,
      model_failed: 2,
      model_key_limit: 1,
    });
    expect(health.day).toEqual(health.hour);
    expect(health.caps).toEqual({ llm_calls_per_hour: 5, llm_calls_per_day: 5000, new_phrases_per_hour: 20 });
    expect(health.degraded).toBe(true);
  });

  test('within the caps and Redis ready — not degraded; without a key never degraded', async () => {
    await onePhrase(ALICE, T0);
    expect((await budget.getBudgetHealth({ modelAvailable: true, now: T0 })).degraded).toBe(false);
    fake.isReady = false;
    expect((await budget.getBudgetHealth({ modelAvailable: false, now: T0 })).degraded).toBe(false);
  });

  test('settle counts once, however often it is called', async () => {
    const decision = await budget.reserveModelCalls({ requester: ALICE, now: T0 });
    await decision.settle(['ok']);
    await decision.settle(['ok']);
    expect((await budget.getBudgetHealth({ modelAvailable: true, now: T0 })).hour.llm_calls).toBe(1);
  });
});

describe('the hourly line', () => {
  test('written by the first decision of a new hour, for the hour that ended', async () => {
    await onePhrase(ALICE, T0);
    await budget.recordCacheHit(plusMinutes(T0, 10));
    expect(logger.info.mock.calls.filter(([message]) => message === 'smart_search_budget_hourly')).toHaveLength(0);

    await budget.recordCacheHit(plusMinutes(T0, 31));
    await new Promise((resolve) => setImmediate(resolve));
    const lines = logger.info.mock.calls.filter(([message]) => message === 'smart_search_budget_hourly');
    expect(lines).toHaveLength(1);
    expect(lines[0][1]).toMatchObject({ hourStartedAt: '2026-10-25T12:00:00.000Z', llm_calls: 1, cache_hits: 1 });
  });
});

describe('refusals in the log', () => {
  test('a reason, never a phrase — once in five minutes a reason', async () => {
    fake.isReady = false;
    await budget.reserveModelCalls({ requester: ALICE, now: T0 });
    await budget.reserveModelCalls({ requester: ALICE, now: T0 });
    const lines = logger.warn.mock.calls.filter(([message]) => message.startsWith('Smart search model call refused'));
    expect(lines).toHaveLength(1);
    expect(lines[0][1]).toMatchObject({ reason: 'no_redis' });
  });
});
