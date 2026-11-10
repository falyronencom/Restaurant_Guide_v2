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

  // Партнёр с подтверждённой почтой и карточкой в каталоге: общих потолков
  // нет — ни неподтверждённых, ни новых учёток (свои случаи ниже).
  beforeEach(() => {
    pool.query.mockResolvedValue({ rows: [{ confirmed: true, known: true }] });
  });

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

describe('sendWithinDailyAllowance — учётка без подтверждённой почты (нитка «Расходы посторонних», п. 3)', () => {
  const TEXT = 'Лимит загрузок на сегодня исчерпан. Продолжите завтра.';
  const UNCONFIRMED_TEXT = 'Загрузки для учётных записей без подтверждённой почты на сегодня закончились. '
    + 'Подтвердите почту в профиле — и продолжите.';
  const upload = { userId: USER, bytes: 2048, message: TEXT };
  const SHARED_FILES = 'unconfirmed:daily:2026-10-17:files';
  const SHARED_BYTES = 'unconfirmed:daily:2026-10-17:bytes';
  const OWN_FILES = `unconfirmed:daily:2026-10-17:account:${USER}:files`;
  const OWN_BYTES = `unconfirmed:daily:2026-10-17:account:${USER}:bytes`;

  /** After the account's own counters: the shared ones, then the account's share. */
  const sharedAfter = (files, bytes, ownFiles, ownBytes) => {
    incrementWithExpiry
      .mockResolvedValueOnce(files).mockResolvedValueOnce(bytes)
      .mockResolvedValueOnce(ownFiles).mockResolvedValueOnce(ownBytes);
  };

  beforeEach(() => {
    pool.query.mockResolvedValue({ rows: [{ confirmed: false }] });
  });

  test('ниже потолка и доли — загрузка идёт; тратятся свои, общие и долевые счётчики', async () => {
    countersAfter(5, 4096);
    sharedAfter(100, 300 * MB, 40, 120 * MB);
    const stored = { public_id: 'x' };

    await expect(sendWithinDailyAllowance(upload, async () => stored)).resolves.toBe(stored);
    expect(incrementWithExpiry.mock.calls.slice(2)).toEqual([
      [SHARED_FILES, 43200],
      [SHARED_BYTES, 43200, 2048],
      [OWN_FILES, 43200],
      [OWN_BYTES, 43200, 2048],
    ]);
    expect(decrement).not.toHaveBeenCalled();
  });

  test('101-й файл на всех неподтверждённых — отказ со своим текстом и общими пределами; все резервы возвращены', async () => {
    countersAfter(5, 4096);
    sharedAfter(101, MB, 3, MB);
    const send = jest.fn();

    const refusal = await sendWithinDailyAllowance(upload, send).catch((error) => error);

    expect(refusal).toBeInstanceOf(DailyUploadLimitError);
    expect([refusal.statusCode, refusal.code, refusal.message]).toEqual([429, 'RATE_LIMIT_EXCEEDED', UNCONFIRMED_TEXT]);
    expect(refusal.details).toEqual({
      files_limit: 100,
      bytes_limit: 300 * MB,
      retry_after: 43200,
      reset_at: '2026-10-17T21:00:00.000Z',
      unconfirmed: true,
    });
    expect(send).not.toHaveBeenCalled();
    expect(decrement.mock.calls).toEqual([
      [SHARED_FILES], [OWN_FILES], [SHARED_BYTES, 2048], [OWN_BYTES, 2048], [FILES_KEY], [BYTES_KEY, 2048],
    ]);
  });

  test('300 МБ и один байт на всех — тоже отказ', async () => {
    countersAfter(5, 4096);
    sharedAfter(3, 300 * MB + 1, 3, MB);

    await expect(sendWithinDailyAllowance(upload, jest.fn())).rejects.toBeInstanceOf(DailyUploadLimitError);
  });

  test('41-й файл одной учётки — отказ с её долей, хотя общий потолок не выбран', async () => {
    countersAfter(41, 4096);
    sharedAfter(41, MB, 41, MB);

    const refusal = await sendWithinDailyAllowance(upload, jest.fn()).catch((error) => error);

    expect(refusal.message).toBe(UNCONFIRMED_TEXT);
    expect(refusal.details).toEqual(expect.objectContaining({ files_limit: 40, bytes_limit: 120 * MB }));
  });

  test('120 МБ и один байт одной учётки — отказ', async () => {
    countersAfter(3, 4096);
    sharedAfter(3, MB, 3, 120 * MB + 1);

    await expect(sendWithinDailyAllowance(upload, jest.fn())).rejects.toBeInstanceOf(DailyUploadLimitError);
  });

  test('облако отказало явно — возвращаются свой, общий и долевой резервы', async () => {
    countersAfter(5, 4096);
    sharedAfter(7, MB, 7, MB);
    const refused = Object.assign(new Error('Invalid image file'), { httpCode: 400 });

    await expect(sendWithinDailyAllowance(upload, async () => { throw refused; })).rejects.toBe(refused);
    expect(decrement.mock.calls).toEqual([
      [FILES_KEY], [BYTES_KEY, 2048], [SHARED_FILES], [OWN_FILES], [SHARED_BYTES, 2048], [OWN_BYTES, 2048],
    ]);
  });

  test('сбой поиска учётки — считается неподтверждённой (строже), строка в журнал', async () => {
    pool.query.mockRejectedValue(new Error('connection terminated'));
    countersAfter(5, 4096);
    sharedAfter(101, MB, 3, MB);

    await expect(sendWithinDailyAllowance(upload, jest.fn())).rejects.toBeInstanceOf(DailyUploadLimitError);
    expect(logger.error).toHaveBeenCalledWith(
      'Unconfirmed accounts allowance: account lookup failed, the shared ceiling applies',
      expect.objectContaining({ userId: USER }),
    );
  });
});

/*
 * Нитка «2Г: общие пределы», п. 1.05 (10.11.2026). Учётка с подтверждённой
 * почтой выходила из общего потолка сразу и держала только свои 100 файлов и
 * 300 МБ в сутки: подтверждённая учётка стоит одного ящика, и несколько
 * десятков таких выбирали бесплатный тариф облака за сутки-двое. Теперь новые
 * подтверждённые учётки — без карточки в каталоге — делят потолок дня:
 * 200 файлов и 600 МБ, доля одной учётки — 40 файлов и 120 МБ (литералы выбора
 * исполнителя, обоснование — services/newcomerUploadCeiling.js); аватары —
 * отдельный счёт тех же размеров.
 */
describe('sendWithinDailyAllowance — новая подтверждённая учётка: общий потолок новых учёток', () => {
  const TEXT = 'Лимит загрузок на сегодня исчерпан. Продолжите завтра.';
  const upload = { userId: USER, bytes: 2048, message: TEXT };
  const CEILING_FILES = 'uploads:newcomers:2026-10-17:card:files';
  const CEILING_BYTES = 'uploads:newcomers:2026-10-17:card:bytes';
  const REFUSALS = 'uploads:newcomers:2026-10-17:card:refusals';
  const OWN_FILES = `uploads:newcomers:2026-10-17:card:account:${USER}:files`;
  const OWN_BYTES = `uploads:newcomers:2026-10-17:card:account:${USER}:bytes`;
  const originalEnv = { ...process.env };

  /**
   * После своих счётчиков учётки: файлы и байты потолка, файлы и байты доли
   * учётки в нём, затем — при отказе потолка — счёт отказов дня.
   */
  const ceilingAfter = (files, bytes, { own = [1, 2048], refusals } = {}) => {
    incrementWithExpiry
      .mockResolvedValueOnce(files).mockResolvedValueOnce(bytes)
      .mockResolvedValueOnce(own[0]).mockResolvedValueOnce(own[1]);
    if (refusals !== undefined) incrementWithExpiry.mockResolvedValueOnce(refusals);
  };

  beforeEach(() => {
    pool.query.mockResolvedValue({ rows: [{ confirmed: true, known: false }] });
    logger.warn.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('200-й файл дня на все новые учётки — загрузка идёт; счётчики потолка и доли — по минским суткам', async () => {
    countersAfter(5, 4096);
    ceilingAfter(200, 10 * MB);
    const stored = { public_id: 'x' };

    await expect(sendWithinDailyAllowance(upload, async () => stored)).resolves.toBe(stored);
    expect(incrementWithExpiry.mock.calls.slice(2)).toEqual([
      [CEILING_FILES, 43200],
      [CEILING_BYTES, 43200, 2048],
      [OWN_FILES, 43200],
      [OWN_BYTES, 43200, 2048],
    ]);
    expect(decrement).not.toHaveBeenCalled();
  });

  test('201-й — отказ: текст вызывающего, подробности потолка, все резервы возвращены, облако не зовётся; первый отказ дня — ошибка в журнале', async () => {
    countersAfter(5, 4096);
    ceilingAfter(201, 10 * MB, { refusals: 1 });
    const send = jest.fn();

    const refusal = await sendWithinDailyAllowance(upload, send).catch((error) => error);

    expect(refusal).toBeInstanceOf(DailyUploadLimitError);
    expect([refusal.statusCode, refusal.code, refusal.message]).toEqual([429, 'RATE_LIMIT_EXCEEDED', TEXT]);
    expect(refusal.details).toEqual({
      files_limit: 200,
      bytes_limit: 600 * MB,
      retry_after: 43200,
      reset_at: '2026-10-17T21:00:00.000Z',
      ceiling: true,
    });
    expect(refusal.retryAfter).toBe(43200);
    expect(send).not.toHaveBeenCalled();
    expect(decrement.mock.calls).toEqual([
      [CEILING_FILES], [OWN_FILES], [CEILING_BYTES, 2048], [OWN_BYTES, 2048], [FILES_KEY], [BYTES_KEY, 2048],
    ]);
    expect(incrementWithExpiry).toHaveBeenLastCalledWith(REFUSALS, 43200);
    expect(logger.error).toHaveBeenCalledWith(
      'New accounts\' daily upload ceiling spent',
      expect.objectContaining({ userId: USER, refusalsToday: 1 }),
    );
  });

  test('600 МБ ровно — проходит; байт сверху — отказ, уже не первый за день — предупреждение', async () => {
    countersAfter(5, 4096);
    ceilingAfter(10, 600 * MB);
    await expect(sendWithinDailyAllowance(upload, async () => ({}))).resolves.toEqual({});

    countersAfter(6, 6144);
    ceilingAfter(11, 600 * MB + 1, { refusals: 2 });
    await expect(sendWithinDailyAllowance(upload, jest.fn())).rejects.toBeInstanceOf(DailyUploadLimitError);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'New accounts\' daily upload ceiling spent',
      expect.objectContaining({ refusalsToday: 2 }),
    );
  });

  test('доля одной учётки: 40-й файл проходит, 41-й — отказ с её долей, хотя потолок не выбран; день других не тронут', async () => {
    countersAfter(40, 4096);
    ceilingAfter(60, 10 * MB, { own: [40, 40 * 2048] });
    await expect(sendWithinDailyAllowance(upload, async () => ({}))).resolves.toEqual({});

    countersAfter(41, 6144);
    ceilingAfter(61, 10 * MB, { own: [41, 41 * 2048] });
    const refusal = await sendWithinDailyAllowance(upload, jest.fn()).catch((error) => error);

    expect(refusal).toBeInstanceOf(DailyUploadLimitError);
    expect(refusal.message).toBe(TEXT);
    expect(refusal.details).toEqual(expect.objectContaining({
      files_limit: 40, bytes_limit: 120 * MB, ceiling: true,
    }));
    // Отказ доли не считается отказом потолка: счёта отказов дня нет, ошибки в журнале нет.
    expect(incrementWithExpiry.mock.calls.map(([key]) => key)).not.toContain(REFUSALS);
    expect(logger.error).not.toHaveBeenCalled();
    expect(decrement.mock.calls).toEqual([
      [CEILING_FILES], [OWN_FILES], [CEILING_BYTES, 2048], [OWN_BYTES, 2048], [FILES_KEY], [BYTES_KEY, 2048],
    ]);
  });

  test('120 МБ одной учётки — проходит, байт сверху — отказ её долей', async () => {
    countersAfter(5, 4096);
    ceilingAfter(10, 10 * MB, { own: [5, 120 * MB] });
    await expect(sendWithinDailyAllowance(upload, async () => ({}))).resolves.toEqual({});

    countersAfter(6, 6144);
    ceilingAfter(11, 10 * MB, { own: [6, 120 * MB + 1] });
    const refusal = await sendWithinDailyAllowance(upload, jest.fn()).catch((error) => error);
    expect(refusal.details).toEqual(expect.objectContaining({ files_limit: 40, bytes_limit: 120 * MB }));
  });

  test('облако отказало явно — возвращаются свой резерв, резерв потолка и доли', async () => {
    countersAfter(5, 4096);
    ceilingAfter(7, MB);
    const refused = Object.assign(new Error('Invalid image file'), { httpCode: 400 });

    await expect(sendWithinDailyAllowance(upload, async () => { throw refused; })).rejects.toBe(refused);
    expect(decrement.mock.calls).toEqual([
      [FILES_KEY], [BYTES_KEY, 2048], [CEILING_FILES], [OWN_FILES], [CEILING_BYTES, 2048], [OWN_BYTES, 2048],
    ]);
  });

  test('аватар — свой счёт потолка новых: гостевые аватары не тратят день карточек новых партнёров', async () => {
    countersAfter(5, 4096);
    ceilingAfter(201, MB, { refusals: 1 });

    const refusal = await sendWithinDailyAllowance({ ...upload, pool: 'avatar' }, jest.fn()).catch((error) => error);

    expect(incrementWithExpiry.mock.calls.slice(2).map(([key]) => key)).toEqual([
      'uploads:newcomers:2026-10-17:avatar:files',
      'uploads:newcomers:2026-10-17:avatar:bytes',
      `uploads:newcomers:2026-10-17:avatar:account:${USER}:files`,
      `uploads:newcomers:2026-10-17:avatar:account:${USER}:bytes`,
      'uploads:newcomers:2026-10-17:avatar:refusals',
    ]);
    expect(refusal.details).toEqual(expect.objectContaining({ files_limit: 200, ceiling: true }));
  });

  test('карточка в каталоге, панель, дом сида (known) — потолка новых нет: только свои счётчики', async () => {
    pool.query.mockResolvedValue({ rows: [{ confirmed: true, known: true }] });
    countersAfter(5, 4096);

    await expect(sendWithinDailyAllowance(upload, async () => ({}))).resolves.toEqual({});
    expect(incrementWithExpiry).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['500', '1000', 500, 1000],
    ['abc', '0', 200, 600],
    [' 250 ', '-5', 250, 600],
  ])('UPLOAD_NEWCOMERS_DAILY_FILES=%p, _MB=%p — потолок %i файлов и %i МБ', async (files, mb, ceilingFiles, ceilingMb) => {
    process.env.UPLOAD_NEWCOMERS_DAILY_FILES = files;
    process.env.UPLOAD_NEWCOMERS_DAILY_MB = mb;
    countersAfter(5, 4096);
    ceilingAfter(ceilingFiles + 1, MB, { refusals: 1 });

    const refusal = await sendWithinDailyAllowance(upload, jest.fn()).catch((error) => error);

    expect(refusal.details).toEqual(expect.objectContaining({
      files_limit: ceilingFiles, bytes_limit: ceilingMb * MB, ceiling: true,
    }));
  });
});
