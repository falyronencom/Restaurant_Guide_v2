/**
 * Unit — сторож расхода Cloudinary (scripts/cloudinary-usage/watch.js) и его
 * workflow (.github/workflows/cloudinary-usage.yml).
 *
 * Зачем (21.10.2026, директива D3 нитки «Нагрузка и расходы поставщиков»):
 * Cloudinary Plus покупается по сигналу сторожа. Сторож обязан краснеть при
 * расходе от 70 % кредитов тарифа; краснеть, когда ослеп (нет секретов, API
 * отказал, нет кредитов или даты в ответе, данные устарели) — иначе его
 * зелёный ничего не значит; не печатать ключ и секрет; запускаться только
 * по расписанию и вручную (репозиторий публичный).
 *
 * Ожидания — литералы. PROD_BODY — ответ GET /usage прода 21.10.2026
 * (тариф Free, 5,63 из 25 кредитов); порог 70 % — решение Координатора
 * 21.10.2026; 25 и 225 — кредиты Free и Plus. Сеть не вызывается: fetch и
 * sleep передаются аргументами.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { jest } from '@jest/globals';
import {
  API_BASE,
  BlindError,
  DEFAULT_ALARM_PERCENT,
  EXIT,
  SECRET_NAMES,
  STALE_DAYS,
  decideExit,
  evaluateUsage,
  fetchUsage,
  formatReport,
  parseAlarmPercent,
  readSecrets,
  redact,
  runWatch,
  usageLine,
} from '../../../scripts/cloudinary-usage/watch.js';
import { checkDeployWindow } from '../../../scripts/model-expiry/watch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = resolve(__dirname, '../../../../.github/workflows');
const WORKFLOW_FILE = resolve(WORKFLOWS, 'cloudinary-usage.yml');

const TODAY = new Date('2026-10-21T02:17:00Z');

const PROD_BODY = {
  plan: 'Free',
  last_updated: '2026-10-20',
  date_requested: '2026-10-21T00:00:00Z',
  transformations: { usage: 474, credits_usage: 0.47, breakdown: { transformation: 474 } },
  objects: { usage: 1889 },
  bandwidth: { usage: 4238276938, credits_usage: 3.95 },
  storage: { usage: 1303560386, credits_usage: 1.21 },
  impressions: { usage: 3629, credits_usage: 0 },
  credits: { usage: 5.63, limit: 25, used_percent: 22.52 },
  resources: 611,
  derived_resources: 1278,
  requests: 3644,
};

const withCredits = (usage, limit = 25, extra = {}) => ({
  ...PROD_BODY,
  credits: { usage, limit, used_percent: (usage / limit) * 100 },
  ...extra,
});

const SECRETS_ENV = {
  CLOUDINARY_WATCH_CLOUD_NAME: 'demo-cloud',
  CLOUDINARY_WATCH_API_KEY: '123456789012345',
  CLOUDINARY_WATCH_API_SECRET: 'sEcReT-value_xyz',
};

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('умолчания', () => {
  test('порог 70 % — решение Координатора 21.10.2026; данные старше 3 дней — слепота', () => {
    expect(DEFAULT_ALARM_PERCENT).toBe(70);
    expect(STALE_DAYS).toBe(3);
  });
});

describe('parseAlarmPercent — порог из формы или переменной репозитория', () => {
  test('пусто — 70; число, запятая, знак процента', () => {
    expect(parseAlarmPercent('')).toBe(70);
    expect(parseAlarmPercent(undefined)).toBe(70);
    expect(parseAlarmPercent(' 80 ')).toBe(80);
    expect(parseAlarmPercent('70,5')).toBe(70.5);
    expect(parseAlarmPercent('75 %')).toBe(75);
    expect(parseAlarmPercent('100')).toBe(100);
  });

  test('опечатка в пороге — слепота, а не тихое умолчание', () => {
    for (const raw of ['0', '-5', '101', 'семьдесят', '7O', '0x46', '1e1', '.5']) {
      expect(() => parseAlarmPercent(raw)).toThrow(BlindError);
    }
    expect(() => parseAlarmPercent('101')).toThrow(/порог «101» не прочитан/);
    // Ввод формы печатается в лог: одной строкой и не длиннее 20 знаков.
    expect(() => parseAlarmPercent('7\n::add-mask::abcdefghijklmnop')).toThrow('порог «7 ::add-mask::abcdef…» не прочитан');
  });
});

describe('readSecrets', () => {
  test('все три секрета — значения без пробелов по краям', () => {
    expect(readSecrets({ ...SECRETS_ENV, CLOUDINARY_WATCH_API_KEY: ' 123456789012345\n' })).toEqual({
      cloudName: 'demo-cloud', apiKey: '123456789012345', apiSecret: 'sEcReT-value_xyz',
    });
  });

  test('нет секрета (или он пустой) — слепота, названы имена, не значения', () => {
    const env = { ...SECRETS_ENV, CLOUDINARY_WATCH_API_SECRET: '  ' };
    delete env.CLOUDINARY_WATCH_CLOUD_NAME;
    let error;
    try {
      readSecrets(env);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BlindError);
    expect(error.message).toBe(
      'нет секретов (окружение cloudinary-watch): CLOUDINARY_WATCH_CLOUD_NAME, CLOUDINARY_WATCH_API_SECRET — без них расход не прочитать',
    );
    expect(error.message).not.toContain('123456789012345');
    expect(SECRET_NAMES).toEqual(['CLOUDINARY_WATCH_CLOUD_NAME', 'CLOUDINARY_WATCH_API_KEY', 'CLOUDINARY_WATCH_API_SECRET']);
  });
});

describe('fetchUsage — Admin API GET /usage', () => {
  const creds = { cloudName: 'demo-cloud', apiKey: '123456789012345', apiSecret: 'sEcReT-value_xyz' };
  const noSleep = jest.fn(async () => {});

  test('адрес /v1_1/<облако>/usage, ключ — заголовком Basic, не в адресе', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, PROD_BODY));
    await expect(fetchUsage({ ...creds, fetchImpl })).resolves.toEqual(PROD_BODY);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/usage');
    expect(API_BASE).toBe('https://api.cloudinary.com/v1_1');
    expect(url).not.toContain('123456789012345');
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from('123456789012345:sEcReT-value_xyz').toString('base64')}`,
    );
  });

  test('5xx и сбой сети — три попытки, затем слепота', async () => {
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(502, null))
      .mockResolvedValueOnce(jsonResponse(503, { error: { message: 'Service Unavailable' } }));
    const sleep = jest.fn(async () => {});
    await expect(fetchUsage({ ...creds, fetchImpl, sleep, retryDelaysMs: [10, 30] })).rejects.toThrow(
      'API расхода Cloudinary не ответило (https://api.cloudinary.com/v1_1/<облако>/usage) — '
        + 'попытка 1: fetch failed; попытка 2: HTTP 502; попытка 3: HTTP 503: Service Unavailable',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [30]]);
  });

  test('5xx, потом ответ — повтор помог', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse(500, null))
      .mockResolvedValueOnce(jsonResponse(200, PROD_BODY));
    await expect(fetchUsage({ ...creds, fetchImpl, sleep: noSleep })).resolves.toEqual(PROD_BODY);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('429 (предел частоты), потом ответ — повтор помог', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: 'Rate Limit Exceeded' } }))
      .mockResolvedValueOnce(jsonResponse(200, PROD_BODY));
    await expect(fetchUsage({ ...creds, fetchImpl, sleep: noSleep })).resolves.toEqual(PROD_BODY);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('сообщение API в несколько строк — одной строкой: «::» с начала строки стало бы командой GitHub', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(400, { error: { message: 'bad\n::add-mask::x\r\nend' } }));
    await expect(fetchUsage({ ...creds, fetchImpl, sleep: noSleep })).rejects.toThrow(
      'попытка 1: HTTP 400: bad ::add-mask::x end',
    );
  });

  test('401 — без повтора; ключ из ответа Cloudinary вырезан', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(401, { error: { message: 'Invalid api_key 123456789012345' } }));
    const promise = fetchUsage({ ...creds, fetchImpl, sleep: noSleep });
    await expect(promise).rejects.toThrow(BlindError);
    await expect(promise).rejects.toThrow('попытка 1: HTTP 401: Invalid api_key ***');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('ответ не объект — слепота', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, [1, 2]));
    await expect(fetchUsage({ ...creds, fetchImpl, sleep: noSleep, attempts: 1 })).rejects.toThrow('ответ не объект JSON');
  });
});

describe('evaluateUsage — порог и слепота', () => {
  const run = (body, alarmPercent = 70) => evaluateUsage({ body, today: TODAY, alarmPercent });

  test('ответ прода 21.10: 5,63 из 25 — порядок, процент из usage/limit', () => {
    const result = run(PROD_BODY);
    expect(result.blind).toBeNull();
    expect(result.alarm).toBe(false);
    expect(result.usage).toMatchObject({
      plan: 'Free',
      lastUpdated: '2026-10-20',
      credits: { used: 5.63, limit: 25 },
      storage: { usage: 1303560386, credits: 1.21 },
      bandwidth: { usage: 4238276938, credits: 3.95 },
      transformations: { usage: 474, credits: 0.47 },
    });
    expect(result.usage.credits.percent).toBeCloseTo(22.52, 10);
  });

  test('граница включительно: 17,5 из 25 = 70 % — тревога; 17,49 — порядок', () => {
    expect(run(withCredits(17.5)).alarm).toBe(true);
    expect(run(withCredits(17.49)).alarm).toBe(false);
  });

  test('предел берётся из ответа: на Plus (225) 157,5 — тревога, 157 — порядок', () => {
    expect(run(withCredits(157.5, 225)).alarm).toBe(true);
    expect(run(withCredits(157, 225)).alarm).toBe(false);
  });

  test('порог меняется: 22,52 % — тревога при пороге 20, порядок при 23; порог 1 — нарочно красный', () => {
    expect(run(PROD_BODY, 20).alarm).toBe(true);
    expect(run(PROD_BODY, 23).alarm).toBe(false);
    expect(run(PROD_BODY, 1).alarm).toBe(true);
  });

  test('used_percent не решает: врущее поле не глушит тревогу', () => {
    const body = { ...PROD_BODY, credits: { usage: 20, limit: 25, used_percent: 1 } };
    expect(run(body).alarm).toBe(true);
  });

  test('нет кредитов, кредиты не числом, предел 0 — слепота с причиной', () => {
    const { credits, ...noCredits } = PROD_BODY;
    expect(credits).toBeDefined();
    expect(run(noCredits).blind).toMatch(/^в ответе нет кредитов \(credits\)/);
    expect(run(withCredits('5.63')).blind).toBe('credits.usage не прочитан ("5.63") — нужно число не меньше 0');
    expect(run({ ...PROD_BODY, credits: { usage: 1 } }).blind).toMatch(/^credits\.limit не положительное число \(undefined\)/);
    expect(run(withCredits(1, 0)).blind).toMatch(/^credits\.limit не положительное число \(0\)/);
    expect(run(withCredits(-1)).blind).toMatch(/^credits\.usage не прочитан \(-1\)/);
    for (const r of [run(noCredits), run(withCredits(1, 0))]) {
      expect(r.alarm).toBe(false);
      expect(r.usage).toBeNull();
    }
  });

  test('дата данных: нет или не дата — слепота; старше 3 дней — слепота; 3 дня — порядок', () => {
    const { last_updated: lastUpdated, ...noDate } = PROD_BODY;
    expect(lastUpdated).toBe('2026-10-20');
    expect(run(noDate).blind).toMatch(/^дата данных \(last_updated\) не прочитана \(undefined\)/);
    expect(run({ ...PROD_BODY, last_updated: '20.10.2026' }).blind).toMatch(/^дата данных/);
    expect(run({ ...PROD_BODY, last_updated: '2026-02-30' }).blind).toMatch(/^дата данных/);
    expect(run({ ...PROD_BODY, last_updated: '2026-10-17' }).blind)
      .toBe('данные Cloudinary на 2026-10-17 — старше 3 дн. (4 дн.): расход перестал обновляться');
    expect(run({ ...PROD_BODY, last_updated: '2026-10-18' }).blind).toBeNull();
    expect(run({ ...PROD_BODY, last_updated: '2026-10-20T23:00:00Z' }).blind).toBeNull();
  });

  test('дата из будущего: на день вперёд — порядок (пояс), на два — слепота, а не зелёный', () => {
    expect(run({ ...PROD_BODY, last_updated: '2026-10-22' }).blind).toBeNull();
    expect(run({ ...PROD_BODY, last_updated: '2026-10-23' }).blind)
      .toBe('данные Cloudinary на 2026-10-23 — дата из будущего: ответ не о сегодняшнем расходе');
    expect(run({ ...PROD_BODY, last_updated: '2099-01-01' }).alarm).toBe(false);
    expect(run({ ...PROD_BODY, last_updated: '2099-01-01' }).blind).toMatch(/дата из будущего/);
  });

  test('нет составляющей — строка говорит «нет в ответе», кредиты решают сами', () => {
    const { storage, ...noStorage } = PROD_BODY;
    expect(storage).toBeDefined();
    const result = run(noStorage);
    expect(result.blind).toBeNull();
    expect(usageLine(result.usage)).toContain('хранение — нет в ответе');
  });
});

describe('usageLine — одна строка итога', () => {
  test('ответ прода 21.10: кредиты, хранение, трафик, преобразования (ГБ = 2^30 байт)', () => {
    const { usage } = evaluateUsage({ body: PROD_BODY, today: TODAY, alarmPercent: 70 });
    expect(usageLine(usage)).toBe(
      'Кредиты: 5,63 / 25 (22,5 %) · хранение 1,21 ГБ (1,21 кр.) · трафик 3,95 ГБ (3,95 кр.) · преобразования 474 (0,47 кр.)',
    );
  });
});

describe('decideExit', () => {
  test('порядок 0, тревога 1, слепота 2; отложено только при mayWait === true', () => {
    expect(decideExit({ blind: null, alarm: false, guard: null })).toEqual({ code: 0, wanted: 0, deferred: false });
    expect(decideExit({ blind: null, alarm: true, guard: null })).toEqual({ code: 1, wanted: 1, deferred: false });
    expect(decideExit({ blind: 'x', alarm: false, guard: null })).toEqual({ code: 2, wanted: 2, deferred: false });
    expect(decideExit({ blind: null, alarm: true, guard: { mayWait: true } })).toEqual({ code: 0, wanted: 1, deferred: true });
    expect(decideExit({ blind: null, alarm: true, guard: { error: 'HTTP 403' } })).toEqual({ code: 1, wanted: 1, deferred: false });
    expect(EXIT).toEqual({ OK: 0, ALARM: 1, BLIND: 2 });
  });
});

describe('formatReport', () => {
  test('тревога: строка итога, подсказка о Plus, аннотация error', () => {
    const evaluation = evaluateUsage({ body: withCredits(18), today: TODAY, alarmPercent: 70 });
    const verdict = decideExit({ ...evaluation, guard: null });
    const report = formatReport({ today: TODAY, alarmPercent: 70, evaluation, verdict, guard: null });
    expect(report.text.split('\n')[0]).toBe('Расход Cloudinary — 2026-10-21, тревога от 70 % кредитов тарифа');
    expect(report.text).toContain('Тариф Free, данные на 2026-10-20.');
    expect(report.text).toContain('❌ Кредиты: 18,00 / 25 (72,0 %)');
    expect(report.text).toContain('Cloudinary Plus');
    expect(report.text).toContain('Итог: ТРЕВОГА');
    expect(report.annotations).toHaveLength(1);
    expect(report.annotations[0]).toMatch(/^::error title=Расход Cloudinary у предела тарифа::Кредиты: 18,00 \/ 25/);
    expect(report.markdown.startsWith('## Расход Cloudinary — 2026-10-21')).toBe(true);
  });

  test('слепота: причина словами и в аннотации; служебные символы экранированы', () => {
    const evaluation = { blind: 'строка 1\nстрока 2, 100%', alarm: false, usage: null };
    const verdict = decideExit({ ...evaluation, guard: null });
    const report = formatReport({ today: TODAY, alarmPercent: null, evaluation, verdict, guard: null });
    expect(report.text.split('\n')[0]).toBe('Расход Cloudinary — 2026-10-21, порог не прочитан');
    expect(report.text).toContain('Итог: СТОРОЖ ОСЛЕП');
    expect(report.annotations).toEqual(['::error title=Сторож расхода Cloudinary ослеп::строка 1%0Aстрока 2, 100%25']);
  });
});

describe('redact', () => {
  test('вырезает каждое вхождение каждого значения; пустые значения пропускает', () => {
    expect(redact('a KEY b KEY c SEC', ['KEY', 'SEC', ''])).toBe('a *** b *** c ***');
  });
});

describe('runWatch — прогон целиком', () => {
  const env = { ...SECRETS_ENV };
  const base = { env, today: TODAY, fetchUsageImpl: async () => PROD_BODY };

  test('порядок — защиту выкатки не спрашивает, код 0, секреты переданы в запрос', async () => {
    const guard = jest.fn();
    const fetchUsageImpl = jest.fn(async () => PROD_BODY);
    const { code, report } = await runWatch({ ...base, fetchUsageImpl, checkDeployWindowImpl: guard });
    expect(code).toBe(EXIT.OK);
    expect(guard).not.toHaveBeenCalled();
    expect(fetchUsageImpl).toHaveBeenCalledWith({ cloudName: 'demo-cloud', apiKey: '123456789012345', apiSecret: 'sEcReT-value_xyz' });
    expect(report.text).toContain('✅ Кредиты: 5,63 / 25 (22,5 %)');
    expect(report.text).toContain('Итог: порядок');
  });

  test('порог из ALARM_PERCENT: 20 — тревога, код 1 вне Actions', async () => {
    const { code, report } = await runWatch({
      ...base,
      env: { ...env, ALARM_PERCENT: '20' },
      checkDeployWindowImpl: async () => ({ applicable: false }),
    });
    expect(code).toBe(EXIT.ALARM);
    expect(report.text.split('\n')[0]).toBe('Расход Cloudinary — 2026-10-21, тревога от 20 % кредитов тарифа');
  });

  test('тревога, а выкатка может ждать — код 0 и предупреждение', async () => {
    const { code, report } = await runWatch({
      ...base,
      fetchUsageImpl: async () => withCredits(20),
      checkDeployWindowImpl: async () => ({ applicable: true, mayWait: true, blocking: ['CI (in_progress)'] }),
    });
    expect(code).toBe(EXIT.OK);
    expect(report.annotations).toEqual([expect.stringMatching(/^::warning title=Расход Cloudinary у предела тарифа::/)]);
    expect(report.text).toContain('Итог: ТРЕВОГА — провал отложен защитой выкатки');
  });

  test('27.10: прошлый ручной прогон этого же сторожа закончился за 166 с — нарочно красный прогон краснеет (код 1), а не откладывается', async () => {
    // Прогоны коммита 85ec5265, видимые на старте прогона 40532559866 (порог 1),
    // — из GET /actions/runs?head_sha=, 28.10.2026, поля сокращены.
    const runs = [
      { id: 40532559866, workflow_id: 395098065, name: 'Расход Cloudinary', event: 'workflow_dispatch', status: 'in_progress', conclusion: null, created_at: '2026-10-27T15:35:55Z', run_started_at: '2026-10-27T15:35:55Z', updated_at: '2026-10-27T15:36:00Z' },
      { id: 40532044533, workflow_id: 395098065, name: 'Расход Cloudinary', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', created_at: '2026-10-27T15:32:49Z', run_started_at: '2026-10-27T15:32:49Z', updated_at: '2026-10-27T15:33:09Z' },
      { id: 40529862441, workflow_id: 395098065, name: 'Расход Cloudinary', event: 'workflow_dispatch', status: 'completed', conclusion: 'failure', created_at: '2026-10-27T15:19:42Z', run_started_at: '2026-10-27T15:19:42Z', updated_at: '2026-10-27T15:20:09Z' },
      { id: 40380382765, workflow_id: 341393655, name: 'CI', event: 'push', status: 'completed', conclusion: 'success', created_at: '2026-10-26T18:44:14Z', run_started_at: '2026-10-26T18:44:14Z', updated_at: '2026-10-26T18:51:51Z' },
    ];
    const actionsEnv = { GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'tkn', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'abc123' };
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ workflow_runs: runs }) }));
    const realGuard = ({ env: e }) => checkDeployWindow({ env: e, fetchImpl });

    const { code, report } = await runWatch({
      ...base,
      env: { ...env, ...actionsEnv, GITHUB_RUN_ID: '40532559866', ALARM_PERCENT: '1' },
      fetchUsageImpl: async () => withCredits(8.87),
      checkDeployWindowImpl: realGuard,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(code).toBe(EXIT.ALARM);
    expect(report.annotations).toEqual([expect.stringMatching(/^::error title=Расход Cloudinary у предела тарифа::/)]);
    expect(report.text).not.toContain('Провал отложен');

    // CI того же коммита, закончившийся за 5 минут до старта, по-прежнему откладывает провал.
    const ciInWindow = { ...runs[3], updated_at: '2026-10-27T15:30:55Z' };
    fetchImpl.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ workflow_runs: [...runs.slice(0, 3), ciInWindow] }) }));
    const deferred = await runWatch({
      ...base,
      env: { ...env, ...actionsEnv, GITHUB_RUN_ID: '40532559866', ALARM_PERCENT: '1' },
      fetchUsageImpl: async () => withCredits(8.87),
      checkDeployWindowImpl: realGuard,
    });
    expect(deferred.code).toBe(EXIT.OK);
    expect(deferred.report.text).toContain('Итог: ТРЕВОГА — провал отложен защитой выкатки');
    expect(deferred.report.text).toContain('CI (completed/success)');
    expect(deferred.report.text).not.toContain('Расход Cloudinary (completed');
  });

  test('нет секретов — код 2, API не зовётся', async () => {
    const fetchUsageImpl = jest.fn();
    const { code, report } = await runWatch({
      env: {},
      today: TODAY,
      fetchUsageImpl,
      checkDeployWindowImpl: async () => ({ applicable: false }),
    });
    expect(code).toBe(EXIT.BLIND);
    expect(fetchUsageImpl).not.toHaveBeenCalled();
    expect(report.text).toContain('❌ Сторож ослеп: нет секретов (окружение cloudinary-watch): CLOUDINARY_WATCH_CLOUD_NAME, CLOUDINARY_WATCH_API_KEY, CLOUDINARY_WATCH_API_SECRET');
  });

  test('порог не прочитан — код 2, API не зовётся', async () => {
    const fetchUsageImpl = jest.fn();
    const { code, report } = await runWatch({
      ...base,
      env: { ...env, ALARM_PERCENT: 'семьдесят' },
      fetchUsageImpl,
      checkDeployWindowImpl: async () => ({ applicable: false }),
    });
    expect(code).toBe(EXIT.BLIND);
    expect(fetchUsageImpl).not.toHaveBeenCalled();
    expect(report.text.split('\n')[0]).toBe('Расход Cloudinary — 2026-10-21, порог не прочитан');
  });

  test('API отказал — код 2 и отчёт, а не исключение; ключ и секрет не попадают ни в одну часть отчёта', async () => {
    const leaky = 'API расхода Cloudinary не ответило — HTTP 401: key 123456789012345 secret sEcReT-value_xyz';
    const { code, report } = await runWatch({
      ...base,
      fetchUsageImpl: async () => { throw new BlindError(leaky); },
      checkDeployWindowImpl: async () => ({ applicable: false }),
    });
    expect(code).toBe(EXIT.BLIND);
    for (const part of [report.text, report.markdown, ...report.annotations]) {
      expect(part).not.toContain('123456789012345');
      expect(part).not.toContain('sEcReT-value_xyz');
    }
    expect(report.text).toContain('HTTP 401: key *** secret ***');
  });

  test('неожиданное исключение (не слепота) не глотается', async () => {
    await expect(runWatch({
      ...base,
      fetchUsageImpl: async () => { throw new TypeError('bug'); },
    })).rejects.toThrow('bug');
  });
});

describe('workflow cloudinary-usage.yml', () => {
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
  // Все строки cron файла.
  const cronsOf = (yaml) => [...yaml.matchAll(/^\s+- cron: '([^']+)'/gm)].map((m) => m[1]);
  // Дни недели поля cron (0–6, 7 = воскресенье): *, списки, диапазоны, шаги.
  const weekdaysOf = (cron) => {
    const days = new Set();
    for (const part of cron.trim().split(/\s+/)[4].split(',')) {
      const [range, stepText] = part.split('/');
      const step = stepText ? Number(stepText) : 1;
      const [from, to] = range === '*' ? [0, 6] : range.split('-').map(Number);
      for (let d = from; d <= (to ?? (stepText ? 6 : from)); d += step) days.add(d % 7);
    }
    return days;
  };
  // Блок permissions: верхнего уровня — строки до следующего ключа без отступа.
  const permissionsOf = (yaml) => {
    const lines = yaml.split(/\r?\n/);
    const start = lines.findIndex((l) => /^permissions:\s*$/.test(l));
    if (start === -1) return null;
    const out = [];
    for (const line of lines.slice(start + 1)) {
      if (/^\S/.test(line)) break;
      if (line.trim()) out.push(line.trim());
    }
    return out;
  };
  const BARE_INPUTS = /\$\{\{[^}]*(?<![\w.])inputs\./;

  test('якоря разборщиков на литералах — иначе проверки ниже пусты', () => {
    expect(triggersOf('name: x\non:\n  pull_request:\n  schedule:\n    - cron: \'1 2 * * 3\'\njobs:\n')).toEqual(['pull_request', 'schedule']);
    expect(cronsOf("on:\n  schedule:\n    - cron: '1 2 * * 3'\n    - cron: '5 4 * * 1-2'\n")).toEqual(['1 2 * * 3', '5 4 * * 1-2']);
    expect([...weekdaysOf('17 2 * * 3')]).toEqual([3]);
    expect([...weekdaysOf('17 2 * * 1,3')]).toEqual([1, 3]);
    expect([...weekdaysOf('17 2 * * *')]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([...weekdaysOf('17 2 * * 2-4')]).toEqual([2, 3, 4]);
    expect([...weekdaysOf('17 2 * * */3')]).toEqual([0, 3, 6]);
    expect([...weekdaysOf('17 2 * * 7')]).toEqual([0]);
    expect(permissionsOf('name: x\npermissions:\n  contents: write\n\njobs:\n')).toEqual(['contents: write']);
    expect('X: ${{ inputs.alarm_percent }}').toMatch(BARE_INPUTS);
    expect('X: ${{ github.event.inputs.alarm_percent }}').not.toMatch(BARE_INPUTS);
  });

  const yaml = readFileSync(WORKFLOW_FILE, 'utf8');

  test('только расписание и ручной запуск: репозиторий публичный, секреты не для чужих веток', () => {
    expect(triggersOf(yaml)).toEqual(['schedule', 'workflow_dispatch']);
    expect(yaml).not.toMatch(BARE_INPUTS);
    expect(yaml).toContain('ALARM_PERCENT: ${{ github.event.inputs.alarm_percent || vars.CLOUDINARY_ALARM_PERCENT }}');
  });

  test('права — только чтение; actions: read нужен защите выкатки', () => {
    expect(permissionsOf(yaml)).toEqual(['contents: read', 'actions: read']);
  });

  test('секреты — из окружения cloudinary-watch (только main), переменными шага, под именами скрипта', () => {
    expect(yaml).toMatch(/^ {4}environment: cloudinary-watch\s*$/m);
    for (const name of SECRET_NAMES) {
      expect(yaml).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    expect(yaml).toMatch(/^ {10}persist-credentials: false\s*$/m);
    expect(yaml).toContain('run: node scripts/cloudinary-usage/check.js');
  });

  test('дни расписания не пересекаются со сторожем сроков моделей: соседи отложили бы провалы друг друга', () => {
    const own = cronsOf(yaml);
    const neighbour = cronsOf(readFileSync(resolve(WORKFLOWS, 'model-expiry.yml'), 'utf8'));
    expect(own).toEqual(['17 2 * * 3']);
    expect(neighbour.length).toBeGreaterThan(0);
    const neighbourDays = new Set(neighbour.flatMap((c) => [...weekdaysOf(c)]));
    for (const day of own.flatMap((c) => [...weekdaysOf(c)])) expect(neighbourDays.has(day)).toBe(false);
  });
});
