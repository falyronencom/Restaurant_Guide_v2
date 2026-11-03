/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Суточный предел писем проекта (services/mailAllowance.js; нитка «Расходы
 * посторонних», п. 2): у почтового сервиса 100 писем в день на всех, поэтому
 * у кодов подтверждения и у ссылок сброса пароля — свои пределы, 50 и 40.
 * Redis подменён, часы стоят. Ожидаемые числа — литералы.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../config/redis.js', () => ({
  incrementWithExpiry: jest.fn(),
  decrement: jest.fn(),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { incrementWithExpiry, decrement } = await import('../../config/redis.js');
const { default: logger } = await import('../../utils/logger.js');
const { reserveDailyMail, dailyMailLimit } = await import('../../services/mailAllowance.js');

/** Полдень в Минске, 03.11.2026. */
const NOON = Date.parse('2026-11-03T09:00:00.000Z');

beforeEach(() => {
  jest.useFakeTimers({ now: NOON, doNotFake: ['nextTick', 'setImmediate'] });
  incrementWithExpiry.mockReset();
  decrement.mockReset();
  logger.error.mockClear();
  logger.warn.mockClear();
  delete process.env.EMAIL_DAILY_CODE_LIMIT;
  delete process.env.EMAIL_DAILY_RESET_LIMIT;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('пределы', () => {
  test('коды — 50, ссылки сброса — 40: вместе меньше 100 писем почтового сервиса', () => {
    expect(dailyMailLimit('code', {})).toBe(50);
    expect(dailyMailLimit('reset', {})).toBe(40);
  });

  test('переменные поднимают предел; не целое число больше нуля — умолчание', () => {
    expect(dailyMailLimit('code', { EMAIL_DAILY_CODE_LIMIT: '900' })).toBe(900);
    expect(dailyMailLimit('reset', { EMAIL_DAILY_RESET_LIMIT: ' 300 ' })).toBe(300);
    for (const raw of ['0', '-5', '1.5', 'много', '', '1e3']) {
      expect(dailyMailLimit('code', { EMAIL_DAILY_CODE_LIMIT: raw })).toBe(50);
    }
  });
});

describe('резерв', () => {
  test('ключ — вид письма и минские сутки; срок — до полуночи Минска', async () => {
    incrementWithExpiry.mockResolvedValue(1);

    await reserveDailyMail('code');
    await reserveDailyMail('reset');

    expect(incrementWithExpiry.mock.calls).toEqual([
      ['mail:daily:code:2026-11-03', 43200],
      ['mail:daily:reset:2026-11-03', 43200],
    ]);
  });

  test('50-й код — разрешено; 51-й — отказ, резерв возвращён, ошибка в журнал (первый отказ дня)', async () => {
    incrementWithExpiry.mockResolvedValueOnce(50).mockResolvedValueOnce(51);

    expect((await reserveDailyMail('code')).granted).toBe(true);
    expect(await reserveDailyMail('code', { userId: 'u-1' })).toEqual({ granted: false, limit: 50 });
    expect(decrement.mock.calls).toEqual([['mail:daily:code:2026-11-03']]);
    expect(logger.error).toHaveBeenCalledWith('Daily mail allowance spent: letter not sent', {
      kind: 'code', limit: 50, userId: 'u-1', reason: 'DAILY_LIMIT',
    });
  });

  test('следующие отказы дня — предупреждения, не ошибки', async () => {
    incrementWithExpiry.mockResolvedValueOnce(52);

    await reserveDailyMail('code');

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('41-я ссылка сброса — отказ, при любом числе кодов', async () => {
    incrementWithExpiry.mockResolvedValueOnce(41);

    expect((await reserveDailyMail('reset')).granted).toBe(false);
  });

  test('возврат — один раз, сколько ни зови', async () => {
    incrementWithExpiry.mockResolvedValueOnce(3);
    const { giveBack } = await reserveDailyMail('reset');

    await giveBack();
    await giveBack();

    expect(decrement.mock.calls).toEqual([['mail:daily:reset:2026-11-03']]);
  });
});
