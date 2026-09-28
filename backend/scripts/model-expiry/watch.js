/**
 * Сторож сроков моделей OpenRouter — логика. Запуск — check.js, расписание —
 * .github/workflows/model-expiry.yml.
 *
 * Зачем (28.09.2026, сессия «модель OCR»). Модели на OpenRouter живут
 * месяцы: 24.09 срок 2026-10-20 нашёлся сразу у обеих моделей прода —
 * google/gemini-2.5-flash и 2.5-flash-lite — и нашёлся случайно, из
 * диагностики умного поиска. Публичный каталог отдаёт у модели поле
 * expiration_date: строку YYYY-MM-DD или null (28.09 — у 27 моделей из 458,
 * все сроки не дальше 44 дней вперёд; модели со сроком «сегодня» ещё в
 * каталоге). Что станет с вызовами после даты, не наблюдалось, поэтому
 * тревога поднимается и на близкий срок, и на прошедший, и на исчезновение
 * модели из каталога.
 *
 * Два рода отказа, оба валят прогон, но разными словами:
 * - тревога (EXIT.ALARM): у модели прода срок ближе ALARM_DAYS, срок прошёл,
 *   модели нет в каталоге или её дату нельзя прочесть;
 * - сторож ослеп (EXIT.BLIND): каталог недоступен или пуст, поля
 *   expiration_date нет ни у одной модели, умолчания кода или зеркало
 *   Railway не прочитаны. Зелёный прогон слепого сторожа ничего бы не значил,
 *   поэтому слепота — тоже провал.
 *
 * Защита выкатки. «Wait for CI» у Railway смотрит на все проверки коммита, и
 * упавший workflow пропускает выкатку (документация Railway). Расписание
 * запускает сторожа на последнем коммите main; если там ещё идёт CI свежего
 * push, красный сторож сорвал бы его выкатку — как раз в неделю тревоги,
 * когда пушат замену модели. Тогда провал откладывается: прогон зелёный,
 * тревога — предупреждением, при следующем запуске она повторится
 * (deployMayWait). Если прогоны коммита прочитать не удалось, провал НЕ
 * откладывается: защита, которая при своей поломке глушит тревогу, выключала
 * бы сторожа незаметно.
 */

export const CATALOG_URL = 'https://openrouter.ai/api/v1/models';

/**
 * Тревога — за столько дней до срока (решение Координатора 28.09.2026).
 * 28.09 все сроки в каталоге были не дальше 44 дней: при 45 тревога
 * поднимается в первый же запуск после появления даты, а срок, объявленный
 * за полгода, не краснит прогон каждую неделю все полгода.
 */
export const ALARM_DAYS = 45;

/** Прогон коммита, закончившийся ближе этого к нашему старту, мог держать выкатку. */
export const DEPLOY_WAIT_MARGIN_MS = 15 * 60 * 1000;

export const EXIT = { OK: 0, ALARM: 1, BLIND: 2 };

const DAY_MS = 24 * 60 * 60 * 1000;
const CATALOG_ATTEMPTS = 3;
const CATALOG_TIMEOUT_MS = 30000;
const CATALOG_RETRY_DELAYS_MS = [10000, 30000];
const GITHUB_TIMEOUT_MS = 30000;

/** Назначение переменных модели — для подписи «где используется». */
const MODEL_VARIABLES = {
  AI_MODEL: 'умный поиск',
  AI_OCR_MODEL: 'распознавание меню',
};

/** Сторож не может сказать, в порядке ли модели, — провал, не зелёный. */
export class BlindError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlindError';
  }
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Умолчания кода — модели, на которых прод работает без переменных Railway.
 * Переменные на время вызова снимаются: logger.js грузит backend/.env при
 * импорте config/openrouter.js, и локальный запуск иначе вернул бы значения
 * из .env, а не из кода.
 *
 * @param {{ getConfig: Function, getOcrConfig: Function }} config - из config/openrouter.js
 * @param {object} [env] - process.env
 * @returns {Array<{ id: string, role: string }>}
 * @throws {BlindError} если функция конфигурации не вернула модель строкой
 */
export function readCodeDefaults({ getConfig, getOcrConfig }, env = process.env) {
  const saved = { AI_MODEL: env.AI_MODEL, AI_OCR_MODEL: env.AI_OCR_MODEL };
  delete env.AI_MODEL;
  delete env.AI_OCR_MODEL;
  try {
    const defaults = [
      { source: 'getConfig', id: getConfig().model, role: `${MODEL_VARIABLES.AI_MODEL} — умолчание кода (без AI_MODEL)` },
      { source: 'getOcrConfig', id: getOcrConfig().model, role: `${MODEL_VARIABLES.AI_OCR_MODEL} — умолчание кода (без AI_OCR_MODEL)` },
    ];
    for (const d of defaults) {
      if (typeof d.id !== 'string' || d.id.trim() === '') {
        throw new BlindError(`${d.source}().model — не строка с id модели (${JSON.stringify(d.id)}): неизвестно, на чём работает прод`);
      }
    }
    return defaults.map(({ id, role }) => ({ id, role }));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

/**
 * Список проверяемых моделей: умолчания кода, зеркало Railway и добавленные
 * при запуске. Одна модель в нескольких ролях — одна строка со всеми ролями.
 *
 * @param {{ codeDefaults: Array<{id, role}>, railway: { verifiedOn: string, variables: object }, extra?: string[] }} sources
 * @returns {Array<{ id: string, roles: string[] }>}
 * @throws {BlindError} на пустом значении в зеркале
 */
export function collectTrackedModels({ codeDefaults, railway, extra = [] }) {
  const byId = new Map();
  const add = (id, role) => {
    if (!byId.has(id)) byId.set(id, { id, roles: [] });
    const entry = byId.get(id);
    if (!entry.roles.includes(role)) entry.roles.push(role);
  };
  for (const d of codeDefaults) add(d.id, d.role);
  for (const [name, id] of Object.entries(railway.variables)) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new BlindError(`зеркало Railway (railway-models.js): ${name} пусто`);
    }
    const purpose = MODEL_VARIABLES[name] ? `${MODEL_VARIABLES[name]} — ` : '';
    add(id, `${purpose}${name} на Railway (зеркало от ${railway.verifiedOn})`);
  }
  for (const id of extra) add(id, 'добавлена при запуске');
  return [...byId.values()];
}

/** id моделей из флага --models= и переменной EXTRA_MODELS: через запятую или пробел. */
export function parseExtraModels(...sources) {
  return sources.flatMap((s) => String(s ?? '').split(/[\s,]+/)).filter(Boolean);
}

/** Значение флага --models=… из аргументов командной строки ('' без флага). */
export function modelsFlag(argv) {
  const flag = argv.find((a) => a.startsWith('--models='));
  return flag ? flag.slice('--models='.length) : '';
}

/**
 * Публичный каталог моделей OpenRouter (ключ не нужен и не отправляется).
 * Отказ сети, HTTP-ошибка или ответ без массива data — повтор, после
 * последней попытки — слепота.
 *
 * @returns {Promise<object[]>} массив data каталога
 * @throws {BlindError}
 */
export async function fetchCatalog({
  fetchImpl = globalThis.fetch,
  url = CATALOG_URL,
  attempts = CATALOG_ATTEMPTS,
  timeoutMs = CATALOG_TIMEOUT_MS,
  retryDelaysMs = CATALOG_RETRY_DELAYS_MS,
  sleep = sleepMs,
} = {}) {
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body?.data)) throw new Error('в ответе нет массива data');
      return body.data;
    } catch (error) {
      failures.push(`попытка ${attempt}: ${error.message}`);
      if (attempt < attempts) await sleep(retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)]);
    }
  }
  throw new BlindError(`каталог OpenRouter недоступен (${url}) — ${failures.join('; ')}`);
}

/**
 * Дата срока: YYYY-MM-DD, допускается и с временем после (…T… или пробел).
 * @returns {{ utc: number, iso: string } | null} null — прочесть нельзя
 */
export function parseExpirationDate(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1, 4).map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const back = new Date(utc);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return { utc, iso: match.slice(1, 4).join('-') };
}

/**
 * Сверка моделей с каталогом. Дни считаются по датам UTC (пояс срока
 * OpenRouter не называет; раннер GitHub — UTC, ci.yml гоняет тесты в Минске).
 *
 * Статусы: ok — срока нет; scheduled — срок дальше alarmDays; expiring —
 * срок через alarmDays дней или ближе (включая сегодня); expired — прошёл;
 * absent — модели нет в каталоге; unreadable — дату не прочесть.
 * Последние четыре — тревога.
 *
 * @param {{ catalog: object[], tracked: Array<{id, roles}>, today: Date, alarmDays?: number }} input
 * @returns {{ blind: string|null, results: object[], stats: { models: number, withDate: number } | null }}
 */
export function evaluateCatalog({ catalog, tracked, today, alarmDays = ALARM_DAYS }) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return { blind: 'каталог OpenRouter пуст или не в ожидаемом формате', results: [], stats: null };
  }
  if (!catalog.some((m) => m && typeof m === 'object' && Object.hasOwn(m, 'expiration_date'))) {
    return {
      blind: 'поля expiration_date нет ни у одной модели каталога — OpenRouter изменил формат, сроки не видны',
      results: [],
      stats: null,
    };
  }

  const byId = new Map(catalog.filter((m) => typeof m?.id === 'string').map((m) => [m.id, m]));
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  const results = tracked.map(({ id, roles }) => {
    const base = { id, roles, expirationDate: null, daysLeft: null };
    const entry = byId.get(id);
    if (!entry) return { ...base, status: 'absent', alarm: true };
    const raw = entry.expiration_date;
    // Ключа нет у этой модели, а у других он есть, — тоже «срока нет»:
    // правдоподобная перемена API — не отдавать пустые поля. Переименование
    // или снятие поля ловит проверка выше (ключа нет ни у одной модели).
    if (raw === null || raw === undefined) return { ...base, status: 'ok', alarm: false };
    const parsed = parseExpirationDate(raw);
    if (!parsed) return { ...base, expirationDate: String(raw), status: 'unreadable', alarm: true };
    const daysLeft = Math.round((parsed.utc - todayUtc) / DAY_MS);
    const dated = { ...base, expirationDate: parsed.iso, daysLeft };
    if (daysLeft < 0) return { ...dated, status: 'expired', alarm: true };
    if (daysLeft <= alarmDays) return { ...dated, status: 'expiring', alarm: true };
    return { ...dated, status: 'scheduled', alarm: false };
  });

  const stats = { models: catalog.length, withDate: catalog.filter((m) => m?.expiration_date != null).length };
  return { blind: null, results, stats };
}

/**
 * Может ли выкатка этого коммита ждать исхода нашего прогона. Railway ждёт
 * все проверки коммита: если другой прогон на нашем коммите ещё идёт или
 * закончился позже, чем за marginMs до создания нашего, выкатка могла
 * застать наш прогон незавершённым и теперь ждёт его — провал её пропустит.
 * Прогон, закончившийся раньше, Railway учёл без нас.
 *
 * @param {{ runs: object[], ownRunId: string|number, marginMs?: number }} input - runs из GET /actions/runs?head_sha=
 * @returns {{ mayWait: boolean, blocking: string[] }}
 * @throws {Error} если своего прогона нет в списке
 */
export function deployMayWait({ runs, ownRunId, marginMs = DEPLOY_WAIT_MARGIN_MS }) {
  const own = runs.find((r) => String(r.id) === String(ownRunId));
  if (!own) throw new Error(`прогона ${ownRunId} нет среди прогонов коммита`);
  const ownCreated = Date.parse(own.created_at);
  const blocking = runs
    .filter((r) => String(r.id) !== String(ownRunId))
    .filter((r) => r.status !== 'completed' || Date.parse(r.updated_at) > ownCreated - marginMs);
  return {
    mayWait: blocking.length > 0,
    blocking: blocking.map((r) => `${r.name} (${r.status}${r.conclusion ? `/${r.conclusion}` : ''})`),
  };
}

/**
 * Защита выкатки: читает прогоны своего коммита через API GitHub (права
 * workflow: actions: read). Вне Actions неприменима.
 *
 * @returns {Promise<{ applicable: false } | { applicable: true, mayWait: boolean, blocking: string[] } | { applicable: true, error: string }>}
 */
export async function checkDeployWindow({ fetchImpl = globalThis.fetch, env = process.env, marginMs } = {}) {
  if (env.GITHUB_ACTIONS !== 'true') return { applicable: false };
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_SHA: sha, GITHUB_RUN_ID: runId } = env;
  if (!token || !repo || !sha || !runId) {
    return { applicable: true, error: 'нет GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA или GITHUB_RUN_ID' };
  }
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  try {
    const response = await fetchImpl(`${api}/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'restaurant-guide-model-expiry',
      },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body?.workflow_runs)) throw new Error('в ответе нет workflow_runs');
    return { applicable: true, ...deployMayWait({ runs: body.workflow_runs, ownRunId: runId, marginMs }) };
  } catch (error) {
    return { applicable: true, error: `прогоны коммита не прочитаны: ${error.message}` };
  }
}

/**
 * Код выхода. Провал откладывается только при подтверждённом mayWait;
 * ошибка защиты провал не откладывает.
 *
 * @returns {{ code: number, wanted: number, deferred: boolean }} wanted — код без защиты
 */
export function decideExit({ blind, results, guard }) {
  let wanted = EXIT.OK;
  if (blind) wanted = EXIT.BLIND;
  else if (results.some((r) => r.alarm)) wanted = EXIT.ALARM;
  if (wanted !== EXIT.OK && guard?.mayWait === true) return { code: EXIT.OK, wanted, deferred: true };
  return { code: wanted, wanted, deferred: false };
}

const STATUS_TEXT = {
  ok: () => 'срока нет',
  scheduled: (r, alarmDays) => `срок ${r.expirationDate}, осталось ${r.daysLeft} дн. — тревога начнётся за ${alarmDays} дн.`,
  expiring: (r) => (r.daysLeft === 0
    ? `срок ${r.expirationDate} — сегодня`
    : `срок ${r.expirationDate}, осталось ${r.daysLeft} дн.`),
  expired: (r) => `срок ${r.expirationDate} прошёл ${-r.daysLeft} дн. назад`,
  absent: () => 'нет в каталоге OpenRouter — вызовы, вероятно, уже падают (или id записан не так: сверить с каталогом вместе с префиксом вендора)',
  unreadable: (r) => `срок не прочитан: «${r.expirationDate}»`,
};

const VERDICT_TEXT = { [EXIT.OK]: 'порядок', [EXIT.ALARM]: 'ТРЕВОГА', [EXIT.BLIND]: 'СТОРОЖ ОСЛЕП' };

const ALARM_HINT = 'Что делать: подобрать замену до срока (OCR — стенд backend/scripts/ocr-benchmark, '
  + 'умный поиск — замер разбора), затем переменная на Railway, умолчание в backend/src/config/openrouter.js '
  + 'и зеркало backend/scripts/model-expiry/railway-models.js.';

const BLIND_HINT = `Что делать: открыть ${CATALOG_URL} в браузере. Отвечает и у моделей есть expiration_date — `
  + 'сбой был разовый, следующий запуск покажет; формат изменился — править backend/scripts/model-expiry/watch.js.';

// Команды workflow GitHub: в данных экранируются %, CR, LF; в свойствах ещё : и ,.
const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const annotation = (level, title, message) => `::${level} title=${escapeProperty(title)}::${escapeData(message)}`;

/**
 * Отчёт: текст для лога, Markdown для страницы прогона (GITHUB_STEP_SUMMARY)
 * и аннотации GitHub (error — провал, warning — отложенный провал).
 */
export function formatReport({ today, alarmDays, evaluation, verdict, guard }) {
  const header = `Сроки моделей OpenRouter — ${today.toISOString().slice(0, 10)}, тревога за ${alarmDays} дн. до срока`;
  const text = [header];
  const md = [`## ${header}`, ''];
  const annotations = [];
  const level = verdict.deferred ? 'warning' : 'error';
  const both = (...lines) => {
    text.push(...lines);
    md.push(...lines);
  };

  if (evaluation.blind) {
    text.push('', `❌ Сторож ослеп: ${evaluation.blind}`);
    md.push(`❌ **Сторож ослеп:** ${evaluation.blind}`);
    both('', BLIND_HINT);
    annotations.push(annotation(level, 'Сторож сроков ослеп', evaluation.blind));
  } else {
    const catalogLine = `Каталог: ${evaluation.stats.models} моделей, срок назначен у ${evaluation.stats.withDate}.`;
    text.push(catalogLine, '');
    md.push(catalogLine, '', '| | Модель | Где используется | Срок |', '|---|---|---|---|');
    for (const r of evaluation.results) {
      const mark = r.alarm ? '❌' : '✅';
      const status = STATUS_TEXT[r.status](r, alarmDays);
      text.push(`${mark} ${r.id} — ${status}`, `   ${r.roles.join('; ')}`);
      md.push(`| ${mark} | \`${r.id}\` | ${r.roles.join('<br>')} | ${status} |`);
      if (r.alarm) annotations.push(annotation(level, `Модель OpenRouter ${r.id}`, `${status} (${r.roles.join('; ')})`));
    }
    if (evaluation.results.some((r) => r.alarm)) both('', ALARM_HINT);
  }

  if (guard?.error) {
    both('', `Защита выкатки не проверила коммит (${guard.error}) — провал не отложен.`);
  }
  if (verdict.deferred) {
    both(
      '',
      `Провал отложен: на этом коммите ещё идёт или только что закончился другой прогон (${guard.blocking.join(', ')}), `
        + 'и выкатка могла ждать исхода сторожа — красный прогон пропустил бы её. Прогон зелёный намеренно; '
        + 'тревога повторится при следующем запуске.',
    );
  }
  both('', `Итог: ${VERDICT_TEXT[verdict.wanted]}${verdict.deferred ? ' — провал отложен защитой выкатки' : ''}`);

  return { text: text.join('\n'), markdown: `${md.join('\n')}\n`, annotations };
}

/**
 * Один прогон сторожа: список моделей → каталог → оценка → при провале —
 * защита выкатки → код выхода и отчёт. Защиту спрашивают только перед
 * провалом: зелёному прогону откладывать нечего.
 *
 * @param {object} input
 * @param {{ getConfig: Function, getOcrConfig: Function }} input.config - из config/openrouter.js
 * @param {{ verifiedOn: string, variables: object }} input.railway - railway-models.js
 * @param {string[]} [input.argv] - аргументы командной строки (--models=…)
 * @param {object} [input.env] - process.env (EXTRA_MODELS, переменные GitHub Actions)
 * @returns {Promise<{ code: number, report: { text: string, markdown: string, annotations: string[] } }>}
 */
export async function runWatch({
  config,
  railway,
  argv = [],
  env = process.env,
  today = new Date(),
  fetchCatalogImpl = fetchCatalog,
  checkDeployWindowImpl = checkDeployWindow,
}) {
  let evaluation;
  try {
    const tracked = collectTrackedModels({
      codeDefaults: readCodeDefaults(config, env),
      railway,
      extra: parseExtraModels(modelsFlag(argv), env.EXTRA_MODELS),
    });
    evaluation = evaluateCatalog({ catalog: await fetchCatalogImpl(), tracked, today, alarmDays: ALARM_DAYS });
  } catch (error) {
    if (!(error instanceof BlindError)) throw error;
    evaluation = { blind: error.message, results: [], stats: null };
  }

  let guard = null;
  let verdict = decideExit({ ...evaluation, guard });
  if (verdict.code !== EXIT.OK) {
    guard = await checkDeployWindowImpl({ env });
    verdict = decideExit({ ...evaluation, guard });
  }
  return { code: verdict.code, report: formatReport({ today, alarmDays: ALARM_DAYS, evaluation, verdict, guard }) };
}
