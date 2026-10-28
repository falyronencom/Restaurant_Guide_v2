/**
 * Unit — сторож расхода OpenRouter (scripts/openrouter-usage/watch.js) и его
 * workflow (.github/workflows/openrouter-usage.yml).
 *
 * Зачем (28.10.2026, директива D8 нитки «Нагрузка и расходы», п. 12 списка
 * 28.10): у ключа сервера потолок трат; кончится он — умный поиск станет
 * обычным, меню перестанут распознаваться. Сторож обязан краснеть при
 * остатке меньше 30 %; краснеть, когда ослеп (сервер не ответил или не
 * прочитал ключ, нет полей, данные устарели) — иначе его зелёный ничего не
 * значит; запускаться только по расписанию и вручную; секретов не иметь.
 *
 * Ожидания — литералы. Блок model_key — форма ответа сервера
 * (services/openRouterKeyStatus.js); ключ 28.10 — $5, потрачено ≈ $0,003,
 * без сброса, то есть 99 %. Порог 30 % — решение Координатора 28.10.2026.
 * Сеть не вызывается: fetch и sleep передаются аргументами.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { jest } from '@jest/globals';
import {
  BlindError,
  DEFAULT_ALARM_PERCENT,
  DEFAULT_HEALTH_URL,
  EXIT,
  STALE_MS,
  decideExit,
  evaluateKey,
  fetchKeyBlock,
  formatReport,
  keyLine,
  parseAlarmPercent,
  parseHealthUrl,
  runWatch,
} from '../../../scripts/openrouter-usage/watch.js';
import { checkDeployWindow } from '../../../scripts/model-expiry/watch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = resolve(__dirname, '../../../../.github/workflows');
const WORKFLOW_FILE = resolve(WORKFLOWS, 'openrouter-usage.yml');

const NOW = new Date('2026-10-30T02:17:00Z');
const CHECKED = '2026-10-30T02:16:58.000Z';

const block = (extra = {}) => ({
  status: 'ok',
  remaining_percent: 99,
  limit_reset: null,
  checked_at: CHECKED,
  unknown_reason: null,
  ...extra,
});
const unknown = (reason) => ({ status: 'unknown', remaining_percent: null, limit_reset: null, checked_at: null, unknown_reason: reason });
const health = (status, modelKey) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({ success: status === 200, data: { healthy: status === 200, postgis: 'healthy', smart: {}, ...(modelKey && { model_key: modelKey }) } }),
});
const noSleep = async () => {};

describe('умолчания', () => {
  test('порог 30 % — решение Координатора 28.10.2026; адрес — проверка здоровья прода; данные старше часа — слепота', () => {
    expect(DEFAULT_ALARM_PERCENT).toBe(30);
    expect(DEFAULT_HEALTH_URL).toBe('https://restaurantguidev2-production.up.railway.app/api/v1/search/health');
    expect(STALE_MS).toBe(3600000);
  });
});

describe('parseAlarmPercent — порог из формы или переменной репозитория', () => {
  test('пусто — 30; целое число, знак процента; 100 — нарочно красный', () => {
    expect(parseAlarmPercent(undefined)).toBe(30);
    expect(parseAlarmPercent('  ')).toBe(30);
    expect(parseAlarmPercent('25')).toBe(25);
    expect(parseAlarmPercent('40 %')).toBe(40);
    expect(parseAlarmPercent('100')).toBe(100);
    expect(parseAlarmPercent('1')).toBe(1);
  });

  test.each(['0', '101', '30,5', '30.5', '-5', 'тридцать', '1e2'])('«%s» — слепота, а не тихое умолчание', (raw) => {
    expect(() => parseAlarmPercent(raw)).toThrow(BlindError);
    expect(() => parseAlarmPercent(raw)).toThrow(/порог .* не прочитан — нужно целое число от 1 до 100/);
  });
});

describe('parseHealthUrl', () => {
  test('пусто — прод; https принимается; http и мусор — слепота', () => {
    expect(parseHealthUrl('')).toBe(DEFAULT_HEALTH_URL);
    expect(parseHealthUrl('https://example.test/api/v1/search/health')).toBe('https://example.test/api/v1/search/health');
    expect(() => parseHealthUrl('http://example.test/x')).toThrow(BlindError);
    expect(() => parseHealthUrl('не адрес')).toThrow(BlindError);
  });
});

describe('fetchKeyBlock — блок model_key проверки здоровья', () => {
  const url = DEFAULT_HEALTH_URL;

  test('адрес без секретов, блок из data.model_key', async () => {
    const fetchImpl = jest.fn(async () => health(200, block()));
    expect(await fetchKeyBlock({ url, fetchImpl, sleep: noSleep })).toEqual(block());
    expect(fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({ headers: { Accept: 'application/json' } }));
    expect(JSON.stringify(fetchImpl.mock.calls[0][1].headers)).not.toMatch(/Authorization/i);
  });

  test('503 (база не здорова), а блок есть — он и читается, без повтора', async () => {
    const fetchImpl = jest.fn(async () => health(503, block({ remaining_percent: 12 })));
    expect((await fetchKeyBlock({ url, fetchImpl, sleep: noSleep })).remaining_percent).toBe(12);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('сбой сети и 5xx без блока — три попытки с паузами 10 и 30 с, затем слепота', async () => {
    const sleep = jest.fn(noSleep);
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new SyntaxError('html'); } })
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(fetchKeyBlock({ url, fetchImpl, sleep })).rejects.toThrow(BlindError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10000], [30000]]);
  });

  test('ответ без блока model_key — сразу слепота: сервер до этой правки', async () => {
    const fetchImpl = jest.fn(async () => health(200, null));
    await expect(fetchKeyBlock({ url, fetchImpl, sleep: noSleep })).rejects.toThrow(/нет блока model_key/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('сервер ещё читает ключ («checking») — повтор, и второй ответ решает', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(health(200, unknown('checking')))
      .mockResolvedValueOnce(health(200, block()));
    expect((await fetchKeyBlock({ url, fetchImpl, sleep: noSleep })).status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('проходящая причина не прошла за три попытки — последний блок, оценка его назовёт', async () => {
    const fetchImpl = jest.fn(async () => health(200, unknown('timeout')));
    expect(await fetchKeyBlock({ url, fetchImpl, sleep: noSleep })).toEqual(unknown('timeout'));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test('401 ключа — без повтора: повтор его не изменит', async () => {
    const fetchImpl = jest.fn(async () => health(200, unknown('http_401')));
    expect((await fetchKeyBlock({ url, fetchImpl, sleep: noSleep })).unknown_reason).toBe('http_401');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('текст ошибки в несколько строк — одной строкой: «::» с начала строки стало бы командой GitHub', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('a\n::error::fake'); });
    await expect(fetchKeyBlock({ url, fetchImpl, sleep: noSleep, attempts: 1 })).rejects.toThrow('a ::error::fake');
  });
});

describe('evaluateKey — порог и слепота', () => {
  const evaluate = (b, alarmPercent = 30) => evaluateKey({ block: b, now: NOW, alarmPercent });

  test('ключ 28.10: 99 % — порядок; лимит не сбрасывается — предупреждение', () => {
    const e = evaluate(block());
    expect(e).toMatchObject({ blind: null, alarm: false, key: { status: 'ok', remaining: 99, reset: null } });
    expect(e.warnings).toEqual([expect.stringMatching(/^лимит ключа не сбрасывается/)]);
  });

  test('граница: 29 % — тревога, 30 % — порядок (меньше 30 %, п. 12)', () => {
    expect(evaluate(block({ remaining_percent: 29 })).alarm).toBe(true);
    expect(evaluate(block({ remaining_percent: 30 })).alarm).toBe(false);
    expect(evaluate(block({ remaining_percent: 0 })).alarm).toBe(true);
  });

  test('порог 100 — нарочно красный при 99 %', () => {
    expect(evaluate(block(), 100).alarm).toBe(true);
  });

  test('ежемесячный сброс — без предупреждения', () => {
    expect(evaluate(block({ limit_reset: 'monthly' })).warnings).toEqual([]);
  });

  test('без лимита — порядок с предупреждением, не красный', () => {
    const e = evaluate({ ...block(), status: 'unlimited', remaining_percent: null });
    expect(e).toMatchObject({ blind: null, alarm: false, key: { status: 'unlimited', remaining: null } });
    expect(e.warnings).toEqual([expect.stringMatching(/нет лимита трат/)]);
  });

  test.each([
    ['http_401', /OpenRouter отклонил ключ сервера \(401\) — ключ отключён или удалён/],
    ['no_key', /у сервера нет ключа OpenRouter/],
    ['bad_answer', /формат изменился/],
    ['http_500', /OpenRouter ответил серверу ошибкой 500/],
    ['timeout', /не ответил серверу вовремя/],
    ['что-то новое', /причина «что-то новое»/],
  ])('unknown %s — слепота с причиной словами, не 0', (reason, text) => {
    const e = evaluate(unknown(reason));
    expect(e.alarm).toBe(false);
    expect(e.blind).toMatch(/^сервер не прочитал остаток ключа: /);
    expect(e.blind).toMatch(text);
  });

  test.each([
    ['нет статуса', { ...block(), status: undefined }],
    ['чужой статус', block({ status: 'great' })],
    ['остаток null', block({ remaining_percent: null })],
    ['остаток дробью', block({ remaining_percent: 29.5 })],
    ['остаток строкой', block({ remaining_percent: '99' })],
    ['остаток больше 100', block({ remaining_percent: 101 })],
    ['нет времени чтения', block({ checked_at: null })],
    ['признак сброса числом', block({ limit_reset: 30 })],
  ])('%s — слепота', (_label, b) => {
    const e = evaluate(b);
    expect(e.blind).toEqual(expect.any(String));
    expect(e.alarm).toBe(false);
  });

  test('прочитано больше часа назад — слепота; ровно час — порядок', () => {
    expect(evaluate(block({ checked_at: '2026-10-30T01:17:00.000Z' })).blind).toBeNull();
    expect(evaluate(block({ checked_at: '2026-10-30T01:16:59.000Z' })).blind).toMatch(/старше часа/);
  });
});

describe('keyLine и decideExit', () => {
  test('строка итога', () => {
    expect(keyLine({ status: 'ok', remaining: 99, reset: null, checkedAt: CHECKED }))
      .toBe(`Остаток ключа сервера: 99 % · лимит не сбрасывается · прочитано сервером ${CHECKED}`);
    expect(keyLine({ status: 'ok', remaining: 40, reset: 'monthly', checkedAt: CHECKED }))
      .toBe(`Остаток ключа сервера: 40 % · лимит сбрасывается ежемесячно · прочитано сервером ${CHECKED}`);
    expect(keyLine({ status: 'unlimited', remaining: null, reset: 'other', checkedAt: CHECKED }))
      .toBe(`Ключ сервера: без лимита · лимит сбрасывается (other) · прочитано сервером ${CHECKED}`);
  });

  test('порядок 0, тревога 1, слепота 2; отложено только при mayWait === true', () => {
    expect(decideExit({ blind: null, alarm: false, guard: null })).toEqual({ code: 0, wanted: 0, deferred: false });
    expect(decideExit({ blind: null, alarm: true, guard: null })).toEqual({ code: 1, wanted: 1, deferred: false });
    expect(decideExit({ blind: 'x', alarm: false, guard: { mayWait: false } })).toEqual({ code: 2, wanted: 2, deferred: false });
    expect(decideExit({ blind: null, alarm: true, guard: { mayWait: true } })).toEqual({ code: 0, wanted: 1, deferred: true });
    expect(decideExit({ blind: null, alarm: true, guard: { error: 'x' } })).toEqual({ code: 1, wanted: 1, deferred: false });
  });
});

describe('formatReport', () => {
  test('слепота: причина и в аннотации; служебные символы экранированы', () => {
    const report = formatReport({
      now: NOW,
      alarmPercent: 30,
      url: DEFAULT_HEALTH_URL,
      evaluation: { blind: 'a%b\nc', alarm: false, key: null, warnings: [] },
      verdict: { code: 2, wanted: 2, deferred: false },
      guard: null,
    });
    expect(report.annotations).toEqual(['::error title=Сторож расхода OpenRouter ослеп::a%25b%0Ac']);
  });
});

describe('runWatch — прогон целиком', () => {
  const base = { env: {}, now: NOW, fetchKeyBlockImpl: async () => block() };

  test('порядок — защиту выкатки не спрашивает, код 0; предупреждение о сбросе — аннотацией warning', async () => {
    const guard = jest.fn();
    const fetchKeyBlockImpl = jest.fn(async () => block());
    const { code, report } = await runWatch({ ...base, fetchKeyBlockImpl, checkDeployWindowImpl: guard });
    expect(code).toBe(EXIT.OK);
    expect(guard).not.toHaveBeenCalled();
    expect(fetchKeyBlockImpl).toHaveBeenCalledWith({ url: DEFAULT_HEALTH_URL });
    expect(report.text.split('\n')[0]).toBe('Расход OpenRouter — 2026-10-30, тревога при остатке меньше 30 %');
    expect(report.text).toContain('✅ Остаток ключа сервера: 99 %');
    expect(report.text).toContain('Баланс аккаунта сторож не читает');
    expect(report.text).toContain('Итог: порядок');
    expect(report.annotations).toEqual([expect.stringMatching(/^::warning title=Сторож расхода OpenRouter — предупреждение::лимит ключа не сбрасывается/)]);
  });

  test('ручной прогон с порогом 100 — тревога, код 1 вне Actions', async () => {
    const { code, report } = await runWatch({
      ...base,
      env: { ALARM_PERCENT: '100' },
      checkDeployWindowImpl: async () => ({ applicable: false }),
    });
    expect(code).toBe(EXIT.ALARM);
    expect(report.text).toContain('❌ Остаток ключа сервера: 99 %');
    expect(report.annotations).toContainEqual(expect.stringMatching(/^::error title=Ключ OpenRouter у предела::/));
    expect(report.text).toContain('Итог: ТРЕВОГА');
  });

  test('тревога, а выкатка может ждать — код 0 и предупреждение', async () => {
    const { code, report } = await runWatch({
      ...base,
      fetchKeyBlockImpl: async () => block({ remaining_percent: 10, limit_reset: 'monthly' }),
      checkDeployWindowImpl: async () => ({ applicable: true, mayWait: true, blocking: ['CI (in_progress)'] }),
    });
    expect(code).toBe(EXIT.OK);
    expect(report.annotations).toEqual([expect.stringMatching(/^::warning title=Ключ OpenRouter у предела::/)]);
    expect(report.text).toContain('Итог: ТРЕВОГА — провал отложен защитой выкатки');
  });

  test('прошлый прогон этого же сторожа на коммите не откладывает провал (защита после #146)', async () => {
    const runs = [
      { id: 2, workflow_id: 77, name: 'Расход OpenRouter', status: 'in_progress', conclusion: null, created_at: '2026-10-30T02:17:00Z', run_started_at: '2026-10-30T02:17:00Z', updated_at: '2026-10-30T02:17:05Z' },
      { id: 1, workflow_id: 77, name: 'Расход OpenRouter', status: 'completed', conclusion: 'success', created_at: '2026-10-30T02:14:00Z', run_started_at: '2026-10-30T02:14:00Z', updated_at: '2026-10-30T02:14:20Z' },
    ];
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ workflow_runs: runs }) }));
    const env = { GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'abc', GITHUB_RUN_ID: '2', ALARM_PERCENT: '100' };
    const { code } = await runWatch({ ...base, env, checkDeployWindowImpl: ({ env: e }) => checkDeployWindow({ env: e, fetchImpl }) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(code).toBe(EXIT.ALARM);
  });

  test('сервер не ответил — код 2 и отчёт, а не исключение', async () => {
    const { code, report } = await runWatch({
      ...base,
      fetchKeyBlockImpl: async () => { throw new BlindError('проверка здоровья сервера не ответила'); },
      checkDeployWindowImpl: async () => ({ applicable: false }),
    });
    expect(code).toBe(EXIT.BLIND);
    expect(report.text).toContain('❌ Сторож ослеп: проверка здоровья сервера не ответила');
  });

  test('ключ отклонён (401) — код 2 со словами «ключ отключён или удалён»', async () => {
    const { code, report } = await runWatch({
      ...base,
      fetchKeyBlockImpl: async () => unknown('http_401'),
      checkDeployWindowImpl: async () => ({ applicable: false }),
    });
    expect(code).toBe(EXIT.BLIND);
    expect(report.text).toContain('ключ отключён или удалён');
  });

  test('порог не прочитан — код 2, сервер не спрашивается', async () => {
    const fetchKeyBlockImpl = jest.fn();
    const { code, report } = await runWatch({
      ...base,
      env: { ALARM_PERCENT: 'тридцать' },
      fetchKeyBlockImpl,
      checkDeployWindowImpl: async () => ({ applicable: false }),
    });
    expect(code).toBe(EXIT.BLIND);
    expect(fetchKeyBlockImpl).not.toHaveBeenCalled();
    expect(report.text.split('\n')[0]).toBe('Расход OpenRouter — 2026-10-30, порог не прочитан');
  });

  test('неожиданное исключение (не слепота) не глотается', async () => {
    await expect(runWatch({ ...base, fetchKeyBlockImpl: async () => { throw new TypeError('bug'); } })).rejects.toThrow('bug');
  });
});

describe('workflow openrouter-usage.yml', () => {
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
    expect(cronsOf("on:\n  schedule:\n    - cron: '1 2 * * 5'\n")).toEqual(['1 2 * * 5']);
    expect([...weekdaysOf('17 2 * * 5')]).toEqual([5]);
    expect([...weekdaysOf('17 2 * * 1-5')]).toEqual([1, 2, 3, 4, 5]);
    expect(permissionsOf('name: x\npermissions:\n  contents: write\n\njobs:\n')).toEqual(['contents: write']);
    expect('X: ${{ inputs.alarm_percent }}').toMatch(BARE_INPUTS);
    expect('X: ${{ github.event.inputs.alarm_percent }}').not.toMatch(BARE_INPUTS);
  });

  const yaml = readFileSync(WORKFLOW_FILE, 'utf8');

  test('только расписание и ручной запуск: красный сторож на push сорвал бы выкатку', () => {
    expect(triggersOf(yaml)).toEqual(['schedule', 'workflow_dispatch']);
    expect(yaml).not.toMatch(BARE_INPUTS);
    expect(yaml).toContain('ALARM_PERCENT: ${{ github.event.inputs.alarm_percent || vars.OPENROUTER_ALARM_PERCENT }}');
    expect(yaml).toContain('run: node scripts/openrouter-usage/check.js');
  });

  test('права — только чтение; actions: read нужен защите выкатки', () => {
    expect(permissionsOf(yaml)).toEqual(['contents: read', 'actions: read']);
  });

  test('секретов нет: ни secrets., ни окружения — остаток читается с публичной проверки здоровья', () => {
    expect(yaml).not.toMatch(/secrets\./);
    expect(yaml).not.toMatch(/^\s+environment:/m);
    expect(yaml).toMatch(/^ {10}persist-credentials: false\s*$/m);
  });

  test('день расписания не совпадает с соседними сторожами: соседи отложили бы провалы друг друга', () => {
    const own = cronsOf(yaml);
    expect(own).toEqual(['17 2 * * 5']);
    for (const neighbourFile of ['model-expiry.yml', 'cloudinary-usage.yml']) {
      const neighbour = cronsOf(readFileSync(resolve(WORKFLOWS, neighbourFile), 'utf8'));
      expect(neighbour.length).toBeGreaterThan(0);
      const neighbourDays = new Set(neighbour.flatMap((c) => [...weekdaysOf(c)]));
      for (const day of own.flatMap((c) => [...weekdaysOf(c)])) expect(neighbourDays.has(day)).toBe(false);
    }
  });
});
