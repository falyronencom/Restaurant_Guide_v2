/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: qualityHealthService.js — поведение снимка под кэшем.
 *
 * Живёт отдельно от `integration/admin-quality-health.test.js` по одной причине:
 * здесь расставляется ГОНКА. Сборка снимка идёт восемью запросами, и та, что
 * стартовала раньше, может ответить позже; на живой базе моменты завершения не
 * подчинить, а с подменённой моделью — по шагам.
 *
 * Модель подменяется целиком, база не поднимается.
 */

import { jest } from '@jest/globals';

const model = {
  getUnreachableEstablishments: jest.fn(),
  getOffCanonCounts: jest.fn(),
  getMenuCompleteness: jest.fn(),
  getOutOfBoundsEstablishments: jest.fn(),
  getInvalidHours: jest.fn(),
  getAttributeKeyCensus: jest.fn(),
  getHangingFlags: jest.fn(),
  getPriceDistributionAnomalies: jest.fn(),
};

jest.unstable_mockModule('../../models/qualityHealthModel.js', () => model);

const service = await import('../../services/qualityHealthService.js');

/** Все сигналы отвечают мгновенно и одинаково, кроме флагов — их и двигаем. */
function stubQuiet() {
  model.getUnreachableEstablishments.mockResolvedValue({ count: 0, samples: [] });
  model.getOffCanonCounts.mockResolvedValue({
    category_offcanon_count: 0,
    cuisine_offcanon_count: 0,
  });
  model.getMenuCompleteness.mockResolvedValue({
    empty_menus_count: 0,
    empty_menus_samples: [],
    ocr_failed_count: 0,
    ocr_stuck_count: 0,
  });
  model.getOutOfBoundsEstablishments.mockResolvedValue({ count: 0, samples: [] });
  model.getInvalidHours.mockResolvedValue({
    malformed_count: 0,
    all_closed_count: 0,
    samples: [],
  });
  model.getAttributeKeyCensus.mockResolvedValue({ keys: [], non_object_count: 0 });
  model.getPriceDistributionAnomalies.mockResolvedValue({ status: 'deferred' });
}

const flags = (count) => ({
  hanging_count: count,
  aged_over_7d: 0,
  aged_over_30d: 0,
});

/** Уступает управление, чтобы уже начатая сборка успела дойти до своего await. */
const tick = () => new Promise((resolve) => { setImmediate(resolve); });

beforeEach(() => {
  jest.clearAllMocks();
  stubQuiet();
  service.invalidateCache();
});

describe('порядок записи в кэш', () => {
  test('ранняя сборка, ответившая позже, НЕ затирает свежий снимок', async () => {
    let releaseEarly;
    const early = new Promise((resolve) => { releaseEarly = resolve; });

    // Первый вызов зависает, второй отвечает сразу.
    model.getHangingFlags
      .mockImplementationOnce(async () => { await early; return flags(111); })
      .mockImplementationOnce(async () => flags(222));

    // Различает сборки МОНОТОННЫЙ СЧЁТЧИК внутри сервиса, а не часы: первый
    // вызов получает меньший номер по построению. Пока порядок решался
    // `Date.now()`, дискриминатором был зазор в миллисекунду между этими двумя
    // строками — ничем не обеспеченный: в прогретом процессе обе сборки
    // укладывались в одну миллисекунду в 170 случаях из 200, и тест был бы
    // флейком, зелёным примерно в 15% прогонов.
    const earlyStarted = service.getQualityHealth({ force: true });
    await tick(); // ранняя сборка ушла в ожидание
    const lateStarted = await service.getQualityHealth({ force: true });
    expect(lateStarted.hanging_flags.hanging_count).toBe(222);

    releaseEarly();
    await earlyStarted;

    // Ключевое утверждение: в кэше остался снимок ПОЗЖЕ СТАРТОВАВШЕЙ сборки,
    // хотя ответила она раньше. Без условной записи здесь было бы 111 — данные,
    // прочитанные до того, как мир изменился, и сбросить их было бы нечем.
    const cached = await service.getQualityHealth();
    expect(cached.hanging_flags.hanging_count).toBe(222);
  });

  test('обычная последовательная сборка кэш обновляет', async () => {
    // Обратная сторона: условие не должно запирать кэш навсегда. Тест на
    // порядок прошёл бы и у реализации «после первой записи не писать никогда».
    model.getHangingFlags
      .mockResolvedValueOnce(flags(1))
      .mockResolvedValueOnce(flags(2));

    const first = await service.getQualityHealth({ force: true });
    expect(first.hanging_flags.hanging_count).toBe(1);

    const second = await service.getQualityHealth({ force: true });
    expect(second.hanging_flags.hanging_count).toBe(2);

    const cached = await service.getQualityHealth();
    expect(cached.hanging_flags.hanging_count).toBe(2);
  });

  test('сброс кэша не отменяется сборкой, стартовавшей до него', async () => {
    // Дефект самой правки. `invalidateCache()` ставит cache = null, а условие
    // записи начиналось с `!cache` — значит летящая сборка беспрепятственно
    // возвращала дореформенный снимок и получала на него полную аренду.
    // Модератор снимал флаг, рейл показывал новое число, карточка «Флаги без
    // реакции» — старое, и вычистить его было нечем: модерация заведений этот
    // кэш не трогает.
    let releaseSlow;
    const slow = new Promise((resolve) => { releaseSlow = resolve; });
    model.getHangingFlags
      .mockImplementationOnce(async () => { await slow; return flags(12); })
      .mockImplementationOnce(async () => flags(11));

    const inFlight = service.getQualityHealth();
    await tick();

    service.invalidateCache(); // модератор снял флаг

    releaseSlow();
    await inFlight;

    // Следующее чтение обязано пойти в модель, а не получить возвращённый
    // устаревший снимок.
    const after = await service.getQualityHealth();
    expect(after.hanging_flags.hanging_count).toBe(11);
  });

  test('часы, переведённые назад, не замораживают снимок', async () => {
    // Отрицательный возраст — не «очень свежо». Без явной проверки шаг часов
    // назад читался как бесконечно свежий кэш, и снимок замирал для всех, пока
    // часы не догонят.
    const realNow = Date.now;
    let clock = 5_000_000;
    Date.now = () => clock;

    try {
      model.getHangingFlags.mockResolvedValueOnce(flags(100));
      await service.getQualityHealth();

      clock -= 3_600_000; // час назад
      model.getHangingFlags.mockResolvedValueOnce(flags(200));
      const after = await service.getQualityHealth();
      expect(after.hanging_flags.hanging_count).toBe(200);
    } finally {
      Date.now = realNow;
    }
  });

  test('ошибка сборки не кладёт в кэш испорченный снимок', async () => {
    model.getHangingFlags.mockResolvedValueOnce(flags(7));
    const good = await service.getQualityHealth({ force: true });
    expect(good.hanging_flags.hanging_count).toBe(7);

    model.getHangingFlags.mockRejectedValueOnce(new Error('DB down'));
    await expect(service.getQualityHealth({ force: true })).rejects.toThrow('DB down');

    const cached = await service.getQualityHealth();
    expect(cached.hanging_flags.hanging_count).toBe(7);
  });
});

describe('срок жизни снимка', () => {
  test('второе чтение внутри TTL модель не трогает', async () => {
    model.getHangingFlags.mockResolvedValue(flags(3));

    await service.getQualityHealth();
    const callsAfterFirst = model.getHangingFlags.mock.calls.length;
    await service.getQualityHealth();

    expect(model.getHangingFlags.mock.calls.length).toBe(callsAfterFirst);
  });

  test('force читает заново даже внутри TTL', async () => {
    model.getHangingFlags.mockResolvedValue(flags(3));

    await service.getQualityHealth();
    const callsAfterFirst = model.getHangingFlags.mock.calls.length;
    await service.getQualityHealth({ force: true });

    expect(model.getHangingFlags.mock.calls.length).toBe(callsAfterFirst + 1);
  });

  test('срок отсчитывается от момента сборки, а не от начала запроса', async () => {
    // Сборка, занявшая три секунды, обязана прожить полный CACHE_TTL_MS, а не
    // CACHE_TTL_MS минус собственное время сборки.
    const realNow = Date.now;
    let clock = 1_000_000;
    Date.now = () => clock;

    try {
      model.getHangingFlags.mockImplementationOnce(async () => {
        clock += 3_000; // сборка «шла» три секунды
        return flags(5);
      });
      await service.getQualityHealth();

      // Проматываем ровно до границы, считая ОТ КОНЦА сборки.
      clock += service.CACHE_TTL_MS - 1;
      model.getHangingFlags.mockResolvedValueOnce(flags(9));
      const stillCached = await service.getQualityHealth();
      expect(stillCached.hanging_flags.hanging_count).toBe(5);

      clock += 2;
      const expired = await service.getQualityHealth();
      expect(expired.hanging_flags.hanging_count).toBe(9);
    } finally {
      Date.now = realNow;
    }
  });
});
