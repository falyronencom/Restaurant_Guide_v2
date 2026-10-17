/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Суточный предел загрузок — решение модуля по значениям счётчиков
 * (services/uploadAllowance.js). Redis и база подменены, часы стоят.
 *
 * Интеграционный тест (daily-upload-allowance) держит границы через настоящий
 * Redis; здесь — то, что через приложение не видно или видно лишь с
 * вероятностью: решение берётся по значению ПОСЛЕ увеличения (резерв до
 * проверки — поэтому одновременные загрузки не проходят все), база не
 * спрашивается ниже обычного предела, сбой её ответа — обычные пределы, возврат
 * — своими шагами и один раз, ключи и срок — по минским суткам.
 *
 * Ожидаемые числа — литералы рекомендации 17.10.2026: обычная учётка 100
 * файлов и 300 МБ, дом сида 1000 файлов и 3 ГБ.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../config/redis.js', () => ({
  incrementWithExpiry: jest.fn(),
  decrement: jest.fn(),
}));

jest.unstable_mockModule('../../config/database.js', () => {
  const pool = { query: jest.fn() };
  return { default: pool, pool };
});

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { incrementWithExpiry, decrement } = await import('../../config/redis.js');
const { default: pool } = await import('../../config/database.js');
const { default: logger } = await import('../../utils/logger.js');
const { reserveDailyUpload, sendWithinDailyAllowance, DailyUploadLimitError } = await import('../../services/uploadAllowance.js');

const MB = 1024 * 1024;
const USER = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
/** Полдень в Минске, 17.10.2026. */
const NOON = Date.parse('2026-10-17T09:00:00.000Z');
const FILES_KEY = `uploads:daily:${USER}:2026-10-17:files`;
const BYTES_KEY = `uploads:daily:${USER}:2026-10-17:bytes`;

/** Счётчики после увеличения: сначала файлы, потом байты. */
const countersAfter = (files, bytes) => {
  incrementWithExpiry.mockResolvedValueOnce(files).mockResolvedValueOnce(bytes);
};

const seedHouse = (flag) => {
  pool.query.mockResolvedValue({ rows: [{ is_service_account: flag }] });
};

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOON);
  incrementWithExpiry.mockReset();
  decrement.mockReset();
  pool.query.mockReset();
  logger.error.mockClear();
  logger.warn.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('резерв: ключи, шаги и срок — по минским суткам', () => {
  test('файлы — шагом 1, байты — размером файла; срок — до полуночи Минска', async () => {
    countersAfter(1, 2048);

    await reserveDailyUpload(USER, 2048);

    expect(incrementWithExpiry.mock.calls).toEqual([
      [FILES_KEY, 43200],
      [BYTES_KEY, 43200, 2048],
    ]);
  });

  test('после полуночи Минска — ключи нового дня и полные сутки впереди', async () => {
    Date.now.mockReturnValue(Date.parse('2026-10-17T21:00:00.000Z'));
    countersAfter(1, 10);

    await reserveDailyUpload(USER, 10);

    expect(incrementWithExpiry.mock.calls).toEqual([
      [`uploads:daily:${USER}:2026-10-18:files`, 86400],
      [`uploads:daily:${USER}:2026-10-18:bytes`, 86400, 10],
    ]);
  });
});

describe('обычная учётка: решение по значению после увеличения', () => {
  test('ниже предела — разрешено, база не спрашивается, ничего не возвращается', async () => {
    countersAfter(37, 5 * MB);

    const result = await reserveDailyUpload(USER, 2048);

    expect(result.granted).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
    expect(decrement).not.toHaveBeenCalled();
  });

  test('ровно 100 файлов и ровно 300 МБ — разрешено, без запроса к базе', async () => {
    countersAfter(100, 300 * MB);

    const result = await reserveDailyUpload(USER, 2048);

    expect(result.granted).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('101-й файл — отказ; оба резерва возвращены своими шагами; база спрошена один раз', async () => {
    countersAfter(101, 7 * MB);
    seedHouse(false);

    const result = await reserveDailyUpload(USER, 2048);

    expect(result).toEqual({
      granted: false,
      limits: { files: 100, bytes: 300 * MB },
      retryAfter: 43200,
      resetAt: '2026-10-17T21:00:00.000Z',
    });
    expect(decrement.mock.calls).toEqual([[FILES_KEY], [BYTES_KEY, 2048]]);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][1]).toEqual([USER]);
    expect(logger.warn).toHaveBeenCalledWith('Daily upload allowance spent', expect.objectContaining({ userId: USER, files: 101 }));
  });

  test('300 МБ и один байт — отказ', async () => {
    countersAfter(12, 300 * MB + 1);
    seedHouse(false);

    expect((await reserveDailyUpload(USER, 1)).granted).toBe(false);
  });

  test('поиск признака дома сида упал — обычные пределы, отказ', async () => {
    countersAfter(101, 7 * MB);
    pool.query.mockRejectedValue(new Error('connection terminated'));

    const result = await reserveDailyUpload(USER, 2048);

    expect(result.granted).toBe(false);
    expect(result.limits).toEqual({ files: 100, bytes: 300 * MB });
    expect(logger.error).toHaveBeenCalledWith(
      'Upload allowance: service flag lookup failed, regular limits apply',
      expect.objectContaining({ userId: USER }),
    );
  });
});

describe('дом сида: свои пределы', () => {
  test('101-й файл разрешён; 1000-й тоже, без возврата', async () => {
    seedHouse(true);
    countersAfter(101, 200 * MB);
    expect((await reserveDailyUpload(USER, 2048)).granted).toBe(true);

    countersAfter(1000, 3 * 1024 * MB);
    expect((await reserveDailyUpload(USER, 2048)).granted).toBe(true);
    expect(decrement).not.toHaveBeenCalled();
  });

  test('1001-й файл — отказ с пределами дома сида', async () => {
    seedHouse(true);
    countersAfter(1001, 10 * MB);

    const result = await reserveDailyUpload(USER, 2048);

    expect(result.granted).toBe(false);
    expect(result.limits).toEqual({ files: 1000, bytes: 3 * 1024 * MB });
  });
});

describe('возврат резерва', () => {
  test('один раз, сколько ни зови', async () => {
    countersAfter(5, 4096);

    const result = await reserveDailyUpload(USER, 4096);
    await result.giveBack();
    await result.giveBack();

    expect(decrement.mock.calls).toEqual([[FILES_KEY], [BYTES_KEY, 4096]]);
  });

  test('пустой файл: счётчик байтов не трогается (DECRBY 0 вернул бы истёкший ключ без срока)', async () => {
    countersAfter(5, 0);

    const result = await reserveDailyUpload(USER, 0);
    await result.giveBack();

    expect(decrement.mock.calls).toEqual([[FILES_KEY]]);
  });
});

describe('sendWithinDailyAllowance — общий путь всех загрузчиков в облако', () => {
  const TEXT = 'Лимит загрузок на сегодня исчерпан. Продолжите завтра.';
  const upload = { userId: USER, bytes: 2048, message: TEXT };

  test('предел исчерпан — DailyUploadLimitError: 429, код, текст вызывающего, подробности, срок; облако не зовётся', async () => {
    countersAfter(101, 7 * MB);
    seedHouse(false);
    const send = jest.fn();

    const refusal = await sendWithinDailyAllowance(upload, send).catch((error) => error);

    expect(refusal).toBeInstanceOf(DailyUploadLimitError);
    expect(refusal.statusCode).toBe(429);
    expect(refusal.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(refusal.message).toBe(TEXT);
    expect(refusal.isOperational).toBe(true);
    expect(refusal.details).toEqual({
      files_limit: 100,
      bytes_limit: 300 * MB,
      retry_after: 43200,
      reset_at: '2026-10-17T21:00:00.000Z',
    });
    expect(refusal.retryAfter).toBe(43200);
    expect(send).not.toHaveBeenCalled();
  });

  test('облако приняло — результат как есть, резерв не возвращается', async () => {
    countersAfter(5, 4096);
    const stored = { public_id: 'establishments/x/interior/abc' };

    await expect(sendWithinDailyAllowance(upload, async () => stored)).resolves.toBe(stored);
    expect(decrement).not.toHaveBeenCalled();
  });

  test('облако отказало явно (ответ 400) — резерв возвращается, ошибка та же', async () => {
    countersAfter(5, 4096);
    const refused = Object.assign(new Error('Failed to upload image: Invalid image file'), { httpCode: 400 });

    await expect(sendWithinDailyAllowance(upload, async () => { throw refused; })).rejects.toBe(refused);
    expect(decrement.mock.calls).toEqual([[FILES_KEY], [BYTES_KEY, 2048]]);
  });

  test.each([
    ['ответ 502', 502],
    ['таймаут SDK (499)', 499],
    ['обрыв соединения — кода нет', undefined],
  ])('исход неизвестен (%s) — резерв остаётся, ошибка та же', async (_label, httpCode) => {
    countersAfter(5, 4096);
    const failed = Object.assign(new Error('Failed to upload image: …'), { httpCode });

    await expect(sendWithinDailyAllowance(upload, async () => { throw failed; })).rejects.toBe(failed);
    expect(decrement).not.toHaveBeenCalled();
  });
});
