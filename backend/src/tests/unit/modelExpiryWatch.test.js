/**
 * Unit — сторож сроков моделей OpenRouter (scripts/model-expiry/watch.js) и
 * его workflow (.github/workflows/model-expiry.yml).
 *
 * Зачем (28.09.2026, сессия «модель OCR»): срок 2026-10-20 у обеих моделей
 * прода нашёлся 24.09 случайно. Сторож обязан краснеть на близком или
 * прошедшем сроке и на пропаже модели из каталога; краснеть, когда ослеп
 * (каталог недоступен, поле expiration_date пропало) — иначе его зелёный
 * ничего не значит; и не срывать выкатку Railway: «Wait for CI» пропускает
 * выкатку, если на коммите упал любой workflow.
 *
 * Ожидания — литералы: «сегодня» 2026-09-28, срок google/gemini-2.5-flash из
 * каталога 28.09 — 2026-10-20 (22 дня), порог — решение Координатора, 45 дней.
 * Сеть не вызывается: fetch и sleep передаются аргументами.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { jest } from '@jest/globals';
import { getConfig, getOcrConfig } from '../../config/openrouter.js';
import {
  ALARM_DAYS,
  BlindError,
  CATALOG_URL,
  EXIT,
  checkDeployWindow,
  collectTrackedModels,
  decideExit,
  deployMayWait,
  evaluateCatalog,
  fetchCatalog,
  formatReport,
  parseExtraModels,
  readCodeDefaults,
  runWatch,
} from '../../../scripts/model-expiry/watch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_FILE = resolve(__dirname, '../../../../.github/workflows/model-expiry.yml');

const TODAY = new Date('2026-09-28T09:00:00Z');
const tracked = (...ids) => ids.map((id) => ({ id, roles: ['роль'] }));
const resultFor = (evaluation, id) => evaluation.results.find((r) => r.id === id);

const CATALOG = [
  { id: 'google/gemini-3.8-flash', expiration_date: null },
  { id: 'google/gemini-2.5-flash', expiration_date: '2026-10-20' },
  { id: 'vendor/day-45', expiration_date: '2026-11-12' },
  { id: 'vendor/day-46', expiration_date: '2026-11-13' },
  { id: 'vendor/today', expiration_date: '2026-09-28' },
  { id: 'vendor/yesterday', expiration_date: '2026-09-27' },
  { id: 'vendor/with-time', expiration_date: '2026-10-20T00:00:00Z' },
  { id: 'vendor/dotted', expiration_date: '20.10.2026' },
  { id: 'vendor/feb-30', expiration_date: '2026-02-30' },
];

describe('порог', () => {
  test('45 дней — решение Координатора 28.09.2026', () => {
    expect(ALARM_DAYS).toBe(45);
  });
});

describe('readCodeDefaults — модели, на которых прод работает без переменных Railway', () => {
  const fakeConfig = {
    getConfig: () => ({ model: process.env.AI_MODEL || 'test/search-default' }),
    getOcrConfig: () => ({ model: process.env.AI_OCR_MODEL || 'test/ocr-default' }),
  };
  let saved;
  beforeEach(() => {
    saved = { AI_MODEL: process.env.AI_MODEL, AI_OCR_MODEL: process.env.AI_OCR_MODEL };
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('умолчания кода, даже когда переменные заданы (локально их подкладывает backend/.env); окружение возвращается', () => {
    const env = { AI_MODEL: 'test/env-search', AI_OCR_MODEL: 'test/env-ocr', OTHER: 'x' };
    const defaults = readCodeDefaults(
      {
        getConfig: () => ({ model: env.AI_MODEL || 'test/search-default' }),
        getOcrConfig: () => ({ model: env.AI_OCR_MODEL || 'test/ocr-default' }),
      },
      env,
    );
    expect(defaults.map((d) => d.id)).toEqual(['test/search-default', 'test/ocr-default']);
    expect(env).toEqual({ AI_MODEL: 'test/env-search', AI_OCR_MODEL: 'test/env-ocr', OTHER: 'x' });
  });

  test('модель не строкой — сторож ослеп, а не зелёный', () => {
    expect(() => readCodeDefaults({ ...fakeConfig, getConfig: () => ({}) }, {}))
      .toThrow(BlindError);
    expect(() => readCodeDefaults({ ...fakeConfig, getOcrConfig: () => ({ model: ' ' }) }, {}))
      .toThrow(/getOcrConfig\(\)\.model/);
  });

  test('настоящий config/openrouter.js: две модели с префиксом вендора, переменные не просачиваются', () => {
    process.env.AI_MODEL = 'test/env-search';
    process.env.AI_OCR_MODEL = 'test/env-ocr';
    const ids = readCodeDefaults({ getConfig, getOcrConfig }).map((d) => d.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+\/[a-z0-9.:-]+$/);
    expect(ids).not.toContain('test/env-search');
    expect(ids).not.toContain('test/env-ocr');
    expect(process.env.AI_MODEL).toBe('test/env-search');
  });
});

describe('collectTrackedModels', () => {
  test('умолчания + зеркало + добавленные; одна модель — одна строка со всеми ролями', () => {
    const list = collectTrackedModels({
      codeDefaults: [
        { id: 'a/search', role: 'поиск — умолчание' },
        { id: 'a/ocr', role: 'OCR — умолчание' },
      ],
      railway: { verifiedOn: '2026-09-28', variables: { AI_MODEL: 'a/search', AI_OCR_MODEL: 'b/ocr-env' } },
      extra: ['c/extra', 'a/ocr'],
    });
    expect(list).toEqual([
      { id: 'a/search', roles: ['поиск — умолчание', 'умный поиск — AI_MODEL на Railway (зеркало от 2026-09-28)'] },
      { id: 'a/ocr', roles: ['OCR — умолчание', 'добавлена при запуске'] },
      { id: 'b/ocr-env', roles: ['распознавание меню — AI_OCR_MODEL на Railway (зеркало от 2026-09-28)'] },
      { id: 'c/extra', roles: ['добавлена при запуске'] },
    ]);
  });

  test('пустое значение в зеркале — сторож ослеп', () => {
    expect(() => collectTrackedModels({
      codeDefaults: [],
      railway: { verifiedOn: '2026-09-28', variables: { AI_MODEL: '' } },
    })).toThrow(/AI_MODEL пусто/);
  });
});

describe('parseExtraModels', () => {
  test('запятые и пробелы, пустые куски отбрасываются, два источника', () => {
    expect(parseExtraModels(' a/b, c/d ,,', 'e/f\n', undefined)).toEqual(['a/b', 'c/d', 'e/f']);
    expect(parseExtraModels('', undefined)).toEqual([]);
  });
});

describe('evaluateCatalog', () => {
  const run = (...ids) => evaluateCatalog({ catalog: CATALOG, tracked: tracked(...ids), today: TODAY, alarmDays: 45 });

  test('срока нет — порядок', () => {
    expect(resultFor(run('google/gemini-3.8-flash'), 'google/gemini-3.8-flash')).toMatchObject({
      status: 'ok', alarm: false, expirationDate: null,
    });
  });

  test('срок через 22 дня (gemini-2.5-flash, каталог 28.09) — тревога', () => {
    expect(resultFor(run('google/gemini-2.5-flash'), 'google/gemini-2.5-flash')).toEqual({
      id: 'google/gemini-2.5-flash',
      roles: ['роль'],
      status: 'expiring',
      alarm: true,
      expirationDate: '2026-10-20',
      daysLeft: 22,
    });
  });

  test('граница: ровно 45 дней — тревога, 46 — ещё нет', () => {
    const evaluation = run('vendor/day-45', 'vendor/day-46');
    expect(resultFor(evaluation, 'vendor/day-45')).toMatchObject({ status: 'expiring', alarm: true, daysLeft: 45 });
    expect(resultFor(evaluation, 'vendor/day-46')).toMatchObject({ status: 'scheduled', alarm: false, daysLeft: 46 });
  });

  test('срок сегодня — тревога; вчера — «прошёл»', () => {
    const evaluation = run('vendor/today', 'vendor/yesterday');
    expect(resultFor(evaluation, 'vendor/today')).toMatchObject({ status: 'expiring', alarm: true, daysLeft: 0 });
    expect(resultFor(evaluation, 'vendor/yesterday')).toMatchObject({ status: 'expired', alarm: true, daysLeft: -1 });
  });

  test('модели нет в каталоге — тревога', () => {
    expect(resultFor(run('google/gemini-9-gone'), 'google/gemini-9-gone')).toMatchObject({ status: 'absent', alarm: true });
  });

  test('дату не прочесть — тревога, а не молчаливый «порядок»', () => {
    const evaluation = run('vendor/dotted', 'vendor/feb-30');
    expect(resultFor(evaluation, 'vendor/dotted')).toMatchObject({
      status: 'unreadable', alarm: true, expirationDate: '20.10.2026',
    });
    expect(resultFor(evaluation, 'vendor/feb-30')).toMatchObject({ status: 'unreadable', alarm: true });
  });

  test('срок с временем после даты читается как дата', () => {
    expect(resultFor(run('vendor/with-time'), 'vendor/with-time')).toMatchObject({
      status: 'expiring', expirationDate: '2026-10-20', daysLeft: 22,
    });
  });

  test('дни — по датам UTC: 23:59 и 00:01 по UTC дают разное «сегодня», пояс процесса не влияет', () => {
    // Различает UTC и местные часы только при поясе процесса ≠ UTC — гейт
    // гоняет backend под Europe/Minsk (ci.yml), локальный прогон тоже.
    const at = (iso) => resultFor(
      evaluateCatalog({ catalog: CATALOG, tracked: tracked('google/gemini-2.5-flash'), today: new Date(iso) }),
      'google/gemini-2.5-flash',
    ).daysLeft;
    expect(at('2026-09-28T23:59:00Z')).toBe(22);
    expect(at('2026-09-29T00:01:00Z')).toBe(21);
  });

  test('поля expiration_date нет ни у одной модели — сторож ослеп', () => {
    const evaluation = evaluateCatalog({
      catalog: [{ id: 'google/gemini-3.8-flash' }, { id: 'x/y' }],
      tracked: tracked('google/gemini-3.8-flash'),
      today: TODAY,
    });
    expect(evaluation.blind).toMatch(/expiration_date нет ни у одной модели/);
    expect(evaluation.results).toEqual([]);
  });

  test('пустой каталог или не массив — сторож ослеп', () => {
    for (const catalog of [[], { data: [] }, null]) {
      expect(evaluateCatalog({ catalog, tracked: tracked('a/b'), today: TODAY }).blind)
        .toMatch(/каталог OpenRouter пуст или не в ожидаемом формате/);
    }
  });

  test('статистика каталога: всего моделей и сколько со сроком', () => {
    expect(run('google/gemini-3.8-flash').stats).toEqual({ models: 9, withDate: 8 });
  });
});

describe('fetchCatalog', () => {
  const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });

  test('сбой сети и HTTP-ошибка — повтор; третья попытка отдаёт каталог', async () => {
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      // Тело похоже на каталог, но статус ошибочный: решает статус.
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce(ok([{ id: 'a/b', expiration_date: null }]));
    const sleep = jest.fn(async () => {});

    await expect(fetchCatalog({ fetchImpl, sleep })).resolves.toEqual([{ id: 'a/b', expiration_date: null }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe(CATALOG_URL);
    expect(sleep.mock.calls).toEqual([[10000], [30000]]);
  });

  test('ответ без массива data — повтор, а не каталог', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ error: 'maintenance' }) })
      .mockResolvedValueOnce(ok([{ id: 'a/b', expiration_date: null }]));
    await expect(fetchCatalog({ fetchImpl, sleep: async () => {} })).resolves.toEqual([{ id: 'a/b', expiration_date: null }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('три отказа — сторож ослеп, в причине все попытки', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const error = await fetchCatalog({ fetchImpl, sleep: async () => {} }).catch((e) => e);
    expect(error).toBeInstanceOf(BlindError);
    expect(error.message).toMatch(/попытка 1: ETIMEDOUT; попытка 2: ETIMEDOUT; попытка 3: ETIMEDOUT/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('защита выкатки', () => {
  // Свой прогон создан 2026-10-05 02:20 UTC; запас — 15 минут.
  const OWN = {
    id: 555, name: 'Сроки моделей OpenRouter', status: 'in_progress', conclusion: null,
    created_at: '2026-10-05T02:20:00Z', updated_at: '2026-10-05T02:20:30Z',
  };
  const ci = (fields) => ({ id: 1, name: 'CI', status: 'completed', conclusion: 'success', created_at: '2026-10-05T01:00:00Z', ...fields });
  const ACTIONS_ENV = {
    GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'tkn', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'abc123', GITHUB_RUN_ID: '555',
  };

  test('на коммите ещё идёт CI (даже начатый давно) — выкатка может ждать', () => {
    const verdict = deployMayWait({ runs: [OWN, ci({ status: 'in_progress', conclusion: null, updated_at: '2026-10-05T01:00:00Z' })], ownRunId: 555 });
    expect(verdict).toEqual({ mayWait: true, blocking: ['CI (in_progress)'] });
  });

  test('CI закончился за 5 минут до нашего старта — ещё может ждать; за 30 минут — уже нет', () => {
    expect(deployMayWait({ runs: [OWN, ci({ updated_at: '2026-10-05T02:15:00Z' })], ownRunId: 555 }).mayWait).toBe(true);
    expect(deployMayWait({ runs: [OWN, ci({ updated_at: '2026-10-05T01:50:00Z' })], ownRunId: 555 }).mayWait).toBe(false);
  });

  test('на коммите только свой прогон — выкатка не ждёт', () => {
    expect(deployMayWait({ runs: [OWN], ownRunId: '555' })).toEqual({ mayWait: false, blocking: [] });
  });

  test('вне GitHub Actions защита не применяется и в сеть не ходит', async () => {
    const fetchImpl = jest.fn();
    await expect(checkDeployWindow({ fetchImpl, env: {} })).resolves.toEqual({ applicable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('запрашивает прогоны именно своего коммита, с токеном', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ workflow_runs: [OWN] }) });
    await expect(checkDeployWindow({ fetchImpl, env: ACTIONS_ENV })).resolves.toEqual({
      applicable: true, mayWait: false, blocking: [],
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/o/r/actions/runs?head_sha=abc123&per_page=100');
    expect(init.headers.Authorization).toBe('Bearer tkn');
  });

  test('API отказал или своего прогона нет в ответе — ошибка защиты, а не «можно валить»', async () => {
    const denied = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    expect((await checkDeployWindow({ fetchImpl: denied, env: ACTIONS_ENV })).error).toMatch(/HTTP 403/);
    const foreign = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ workflow_runs: [ci({ updated_at: '2026-10-05T01:50:00Z' })] }) });
    expect((await checkDeployWindow({ fetchImpl: foreign, env: ACTIONS_ENV })).error).toMatch(/прогона 555 нет/);
    expect((await checkDeployWindow({ fetchImpl: denied, env: { GITHUB_ACTIONS: 'true' } })).error).toMatch(/нет GITHUB_TOKEN/);
  });
});

describe('decideExit', () => {
  const alarm = { blind: null, results: [{ alarm: true }] };
  const fine = { blind: null, results: [{ alarm: false }] };
  const blind = { blind: 'каталог недоступен', results: [] };

  test('без защиты: порядок — 0, тревога — 1, слепота — 2', () => {
    expect(decideExit({ ...fine, guard: null })).toEqual({ code: EXIT.OK, wanted: EXIT.OK, deferred: false });
    expect(decideExit({ ...alarm, guard: null })).toEqual({ code: EXIT.ALARM, wanted: EXIT.ALARM, deferred: false });
    expect(decideExit({ ...blind, guard: { applicable: false } })).toEqual({ code: EXIT.BLIND, wanted: EXIT.BLIND, deferred: false });
  });

  test('выкатка может ждать — провал отложен, и тревоги, и слепоты', () => {
    const guard = { applicable: true, mayWait: true, blocking: ['CI (in_progress)'] };
    expect(decideExit({ ...alarm, guard })).toEqual({ code: EXIT.OK, wanted: EXIT.ALARM, deferred: true });
    expect(decideExit({ ...blind, guard })).toEqual({ code: EXIT.OK, wanted: EXIT.BLIND, deferred: true });
  });

  test('ошибка защиты провал НЕ откладывает — иначе сломанная защита глушила бы сторожа', () => {
    expect(decideExit({ ...alarm, guard: { applicable: true, error: 'HTTP 403' } }))
      .toEqual({ code: EXIT.ALARM, wanted: EXIT.ALARM, deferred: false });
  });
});

describe('formatReport', () => {
  const evaluation = evaluateCatalog({
    catalog: CATALOG,
    tracked: [
      { id: 'google/gemini-3.8-flash', roles: ['распознавание меню — умолчание кода (без AI_OCR_MODEL)'] },
      { id: 'google/gemini-2.5-flash', roles: ['добавлена при запуске'] },
    ],
    today: TODAY,
  });

  test('красный прогон: модель, срок и что делать — в логе, в таблице страницы прогона и в аннотации error', () => {
    const report = formatReport({ today: TODAY, alarmDays: 45, evaluation, verdict: decideExit({ ...evaluation, guard: null }), guard: null });
    expect(report.text).toContain('❌ google/gemini-2.5-flash — срок 2026-10-20, осталось 22 дн.');
    expect(report.text).toContain('✅ google/gemini-3.8-flash — срока нет');
    expect(report.text).toContain('Что делать:');
    expect(report.text).toContain('Итог: ТРЕВОГА');
    expect(report.markdown).toContain('| ❌ | `google/gemini-2.5-flash` | добавлена при запуске | срок 2026-10-20, осталось 22 дн. |');
    expect(report.annotations).toEqual([
      '::error title=Модель OpenRouter google/gemini-2.5-flash::срок 2026-10-20, осталось 22 дн. (добавлена при запуске)',
    ]);
  });

  test('отложенный провал — warning, а не error, и объяснение почему прогон зелёный', () => {
    const guard = { applicable: true, mayWait: true, blocking: ['CI (in_progress)'] };
    const report = formatReport({ today: TODAY, alarmDays: 45, evaluation, verdict: decideExit({ ...evaluation, guard }), guard });
    expect(report.annotations[0]).toMatch(/^::warning title=/);
    expect(report.text).toContain('Провал отложен: на этом коммите ещё идёт или только что закончился другой прогон (CI (in_progress))');
    expect(report.text).toContain('Итог: ТРЕВОГА — провал отложен защитой выкатки');
  });

  test('слепота: причина и что проверить', () => {
    const blindEvaluation = { blind: 'каталог OpenRouter недоступен (https://x) — попытка 1: HTTP 503', results: [], stats: null };
    const report = formatReport({ today: TODAY, alarmDays: 45, evaluation: blindEvaluation, verdict: decideExit({ ...blindEvaluation, guard: null }), guard: null });
    expect(report.text).toContain('❌ Сторож ослеп: каталог OpenRouter недоступен');
    expect(report.text).toContain('Итог: СТОРОЖ ОСЛЕП');
    expect(report.annotations).toEqual([
      '::error title=Сторож сроков ослеп::каталог OpenRouter недоступен (https://x) — попытка 1: HTTP 503',
    ]);
  });

  test('защита не прочла прогоны — провал не отложен, и это сказано словами', () => {
    const guard = { applicable: true, error: 'прогоны коммита не прочитаны: HTTP 403' };
    const report = formatReport({ today: TODAY, alarmDays: 45, evaluation, verdict: decideExit({ ...evaluation, guard }), guard });
    expect(report.text).toContain('Защита выкатки не проверила коммит (прогоны коммита не прочитаны: HTTP 403) — провал не отложен.');
    expect(report.annotations[0]).toMatch(/^::error title=/);
  });

  test('аннотации экранируют служебные символы GitHub: «:» в заголовке, перевод строки и % в тексте', () => {
    // id с двоеточием бывают в каталоге (…:batch, …:free); ':' в заголовке
    // без экранирования ломает команду ::error.
    const colon = evaluateCatalog({ catalog: CATALOG, tracked: [{ id: 'vendor/x:free', roles: ['добавлена при запуске'] }], today: TODAY });
    const withColon = formatReport({ today: TODAY, alarmDays: 45, evaluation: colon, verdict: decideExit({ ...colon, guard: null }), guard: null });
    expect(withColon.annotations[0]).toMatch(/^::error title=Модель OpenRouter vendor\/x%3Afree::нет в каталоге/);

    const multiline = { blind: 'строка 1\nстрока 2, 100%', results: [], stats: null };
    const blindReport = formatReport({ today: TODAY, alarmDays: 45, evaluation: multiline, verdict: decideExit({ ...multiline, guard: null }), guard: null });
    expect(blindReport.annotations).toEqual(['::error title=Сторож сроков ослеп::строка 1%0Aстрока 2, 100%25']);
  });
});

describe('runWatch — прогон целиком: модели → каталог → решение → защита', () => {
  const config = {
    getConfig: () => ({ model: 'google/gemini-3.8-flash' }),
    getOcrConfig: () => ({ model: 'google/gemini-3.8-flash' }),
  };
  const railway = { verifiedOn: '2026-09-28', variables: {} };
  const base = { config, railway, env: {}, today: TODAY, fetchCatalogImpl: async () => CATALOG };

  test('порядок — защиту выкатки не спрашивает, код 0', async () => {
    const guard = jest.fn();
    const { code, report } = await runWatch({ ...base, checkDeployWindowImpl: guard });
    expect(code).toBe(EXIT.OK);
    expect(guard).not.toHaveBeenCalled();
    expect(report.text).toContain('Итог: порядок');
  });

  test('тревога — спрашивает защиту; выкатка может ждать — код 0 и предупреждение', async () => {
    const guard = jest.fn(async () => ({ applicable: true, mayWait: true, blocking: ['CI (in_progress)'] }));
    const { code, report } = await runWatch({ ...base, argv: ['--models=google/gemini-2.5-flash'], checkDeployWindowImpl: guard });
    expect(guard).toHaveBeenCalledTimes(1);
    expect(code).toBe(EXIT.OK);
    expect(report.annotations).toEqual([expect.stringMatching(/^::warning title=Модель OpenRouter google\/gemini-2\.5-flash::/)]);
  });

  test('тревога вне Actions — код 1; модели и из --models=, и из EXTRA_MODELS', async () => {
    const { code, report } = await runWatch({
      ...base,
      argv: ['--models=google/gemini-2.5-flash'],
      env: { EXTRA_MODELS: 'vendor/yesterday' },
      checkDeployWindowImpl: async () => ({ applicable: false }),
    });
    expect(code).toBe(EXIT.ALARM);
    expect(report.text).toContain('❌ google/gemini-2.5-flash — срок 2026-10-20, осталось 22 дн.');
    expect(report.text).toContain('❌ vendor/yesterday — срок 2026-09-27 прошёл 1 дн. назад');
  });

  test('каталог недоступен — код 2 и отчёт, а не исключение', async () => {
    const { code, report } = await runWatch({
      ...base,
      fetchCatalogImpl: async () => { throw new BlindError('каталог OpenRouter недоступен (x) — попытка 3: HTTP 503'); },
      checkDeployWindowImpl: async () => ({ applicable: false }),
    });
    expect(code).toBe(EXIT.BLIND);
    expect(report.text).toContain('Итог: СТОРОЖ ОСЛЕП');
  });
});

describe('workflow model-expiry.yml', () => {
  // Ключи блока `on:` верхнего уровня — события, по которым идёт прогон.
  const triggersOf = (yaml) => {
    const lines = yaml.split(/\r?\n/);
    const start = lines.findIndex((l) => /^on:\s*$/.test(l));
    if (start === -1) return null;
    const keys = [];
    for (const line of lines.slice(start + 1)) {
      if (/^\S/.test(line)) break;
      const key = /^ {2}([a-z_]+):/.exec(line);
      if (key) keys.push(key[1]);
    }
    return keys;
  };

  // Контекст inputs документирован только для ручного запуска и повторно
  // используемых workflow; по расписанию полей формы нет. github.event.inputs
  // тогда просто пуст — эта форма безопасна для обоих запусков.
  const BARE_INPUTS = /\$\{\{[^}]*(?<![\w.])inputs\./;

  test('разбор блока on: видит push, поиск inputs видит голую форму (якоря на литералах — иначе проверки ниже пусты)', () => {
    expect(triggersOf('name: x\non:\n  push:\n    branches: [main]\n  workflow_dispatch:\njobs:\n  a:\n')).toEqual(['push', 'workflow_dispatch']);
    expect('X: ${{ inputs.extra_models }}').toMatch(BARE_INPUTS);
    expect('X: ${{ github.event.inputs.extra_models }}').not.toMatch(BARE_INPUTS);
  });

  test('только расписание и ручной запуск: push / pull_request сорвали бы выкатку Railway и нагрузили гейт', () => {
    const yaml = readFileSync(WORKFLOW_FILE, 'utf8');
    expect(triggersOf(yaml)).toEqual(['schedule', 'workflow_dispatch']);
    // Без actions: read защита выкатки не прочтёт прогоны коммита.
    expect(yaml).toMatch(/^ {2}actions: read\s*$/m);
    // Поля формы — через github.event.inputs: прогон по расписанию их не имеет.
    expect(yaml).not.toMatch(BARE_INPUTS);
    expect(yaml).toContain('EXTRA_MODELS: ${{ github.event.inputs.extra_models }}');
  });
});
