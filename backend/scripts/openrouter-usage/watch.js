/**
 * Сторож расхода OpenRouter — логика. Запуск — check.js, расписание —
 * .github/workflows/openrouter-usage.yml.
 *
 * Зачем (28.10.2026, нитка «Нагрузка и расходы», директива D8, п. 12 списка
 * 28.10). Умный поиск и распознавание меню ходят к моделям одним ключом, а у
 * ключа потолок трат. Кончится он — умный поиск тихо станет обычным, а меню
 * перестанут распознаваться. Счётчики /search/health (model_key_limit, #143)
 * покажут отказ уже после; сторож краснеет заранее: остаток ключа меньше
 * порога (по умолчанию 30 % — решение Координатора, п. 12).
 *
 * Источник — блок model_key публичного GET /api/v1/search/health
 * (backend/src/services/openRouterKeyStatus.js): сервер сам спрашивает
 * OpenRouter о своём ключе (GET /api/v1/key) и отдаёт только доли — процент
 * остатка, сбрасывается ли лимит, когда прочитано. Секрета у сторожа нет:
 * ключ не выходит из Railway (решение Trunk 28.10.2026). Баланс аккаунта
 * сторож не читает: для этого нужен ключ управления, а его утечка — это весь
 * баланс и ключ сервера (там же; отступление от п. 12, условие «баланс меньше
 * остатка ключа» снято).
 *
 * Три исхода:
 * - тревога (EXIT.ALARM): остаток меньше порога;
 * - сторож ослеп (EXIT.BLIND): сервер не ответил, в ответе нет блока или
 *   полей, сервер не смог прочитать ключ (нет ключа, OpenRouter отказал —
 *   401 значит, что ключ отключён или удалён и модели уже стоят), данные
 *   старше STALE_MS. Зелёный прогон слепого сторожа ничего бы не значил;
 * - порядок — с предупреждением, если у ключа нет лимита или лимит не
 *   сбрасывается (п. 10 списка — ежемесячный сброс включает Координатор).
 *
 * Защита выкатки — та же, что у соседних сторожей (checkDeployWindow из
 * model-expiry/watch.js): если на коммите ещё идёт другой прогон, красный
 * сторож сорвал бы выкатку Railway, и провал откладывается.
 */

import { checkDeployWindow } from '../model-expiry/watch.js';

/** Порог тревоги по умолчанию, % остатка ключа (решение Координатора 28.10.2026, п. 12). */
export const DEFAULT_ALARM_PERCENT = 30;

/** Адрес проверки здоровья сервера на проде (память reference_production). */
export const DEFAULT_HEALTH_URL = 'https://restaurantguidev2-production.up.railway.app/api/v1/search/health';

/** Прочитанное сервером раньше этого — сторож ослеп: кэш сервера живёт 10 минут. */
export const STALE_MS = 60 * 60 * 1000;

export const EXIT = { OK: 0, ALARM: 1, BLIND: 2 };

const ATTEMPTS = 3;
const TIMEOUT_MS = 30000;
const RETRY_DELAYS_MS = [10000, 30000];

/**
 * Коды unknown_reason, при которых стоит спросить ещё раз: сервер только
 * начал читать ключ или разово не достучался до OpenRouter. Кэш отказа на
 * сервере — минута, поэтому паузы 10 и 30 с — до двух новых чтений.
 */
const PASSING_REASONS = new Set(['checking', 'timeout', 'network']);

/** Сторож не может сказать, каков остаток, — провал, не зелёный. */
export class BlindError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlindError';
  }
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Чужой текст (ввод формы, ответ сервера) — одной строкой и не длиннее max:
 * строка лога, начатая с «::», стала бы командой GitHub.
 */
export function oneLine(text, max = 200) {
  const flat = String(text).replace(/[\r\n]+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Порог из ручного запуска или переменной репозитория: пусто — по умолчанию;
 * целое число от 1 до 100 (знак % допускается). Сервер отдаёт остаток целым
 * процентом, округлённым вниз, поэтому порог тоже целый. 100 — нарочно
 * красный прогон, пока потрачен хоть цент. Иное — слепота, а не тихое
 * умолчание.
 *
 * @returns {number}
 * @throws {BlindError}
 */
export function parseAlarmPercent(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return DEFAULT_ALARM_PERCENT;
  const normalized = text.replace(/\s*%$/, '');
  const value = /^\d{1,3}$/.test(normalized) ? Number(normalized) : NaN;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new BlindError(
      `порог «${oneLine(text, 20)}» не прочитан — нужно целое число от 1 до 100 (процент остатка ключа)`,
    );
  }
  return value;
}

/**
 * Адрес проверки здоровья: переменная или прод. Только https — ответ решает,
 * красный ли прогон.
 *
 * @returns {string}
 * @throws {BlindError}
 */
export function parseHealthUrl(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return DEFAULT_HEALTH_URL;
  let url;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:') {
    throw new BlindError(`адрес проверки здоровья «${oneLine(text, 80)}» не прочитан — нужен адрес https`);
  }
  return url.toString();
}

/**
 * Блок model_key из проверки здоровья сервера. Сервер отвечает 503, когда
 * не здорова база, но блок ключа есть и тогда — он и читается. Сбой сети,
 * 5xx без блока и 429 — повтор; блок с проходящей причиной незнания
 * (PASSING_REASONS) — тоже повтор; прочее — сразу ответ.
 *
 * @returns {Promise<object>} блок model_key
 * @throws {BlindError}
 */
export async function fetchKeyBlock({
  url,
  fetchImpl = globalThis.fetch,
  attempts = ATTEMPTS,
  timeoutMs = TIMEOUT_MS,
  retryDelaysMs = RETRY_DELAYS_MS,
  sleep = sleepMs,
}) {
  const failures = [];
  let lastBlock = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let retry = true;
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        // не JSON — ниже решает код ответа
      }
      const block = body?.data?.model_key;
      if (block && typeof block === 'object' && !Array.isArray(block)) {
        lastBlock = block;
        if (block.status === 'unknown' && PASSING_REASONS.has(block.unknown_reason)) {
          throw new Error(`сервер ещё не прочитал ключ (${oneLine(block.unknown_reason, 40)})`);
        }
        return block;
      }
      retry = response.status >= 500 || response.status === 429;
      throw new Error(response.ok ? 'в ответе нет блока model_key — сервер до этой правки?' : `HTTP ${response.status}`);
    } catch (error) {
      failures.push(`попытка ${attempt}: ${oneLine(error.message)}`);
      if (!retry) break;
      if (attempt < attempts) await sleep(retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)]);
    }
  }
  if (lastBlock) return lastBlock;
  throw new BlindError(`проверка здоровья сервера не ответила (${url}) — ${failures.join('; ')}`);
}

const UNKNOWN_TEXT = {
  no_key: 'у сервера нет ключа OpenRouter (OPENROUTER_API_KEY) — умный поиск обычный, меню не распознаются',
  http_401: 'OpenRouter отклонил ключ сервера (401) — ключ отключён или удалён: умный поиск обычный, меню не распознаются',
  checking: 'сервер так и не дочитал ключ за три попытки',
  timeout: 'OpenRouter не ответил серверу вовремя',
  network: 'сервер не достучался до OpenRouter',
  bad_answer: 'OpenRouter ответил без лимита ключа в понятном виде — формат изменился?',
};

const isWholePercent = (v) => Number.isInteger(v) && v >= 0 && v <= 100;

/**
 * Оценка блока model_key.
 *
 * @param {{ block: object, now: Date, alarmPercent: number, staleMs?: number }} input
 * @returns {{ blind: string|null, alarm: boolean, key: object|null, warnings: string[] }}
 */
export function evaluateKey({ block, now, alarmPercent, staleMs = STALE_MS }) {
  const blind = (reason) => ({ blind: reason, alarm: false, key: null, warnings: [] });
  const status = block?.status;
  if (status === 'unknown') {
    const reason = String(block.unknown_reason ?? '');
    const text = UNKNOWN_TEXT[reason]
      ?? (/^http_\d{3}$/.test(reason) ? `OpenRouter ответил серверу ошибкой ${reason.slice(5)}` : `причина «${oneLine(reason, 40)}»`);
    return blind(`сервер не прочитал остаток ключа: ${text}`);
  }
  if (status !== 'ok' && status !== 'unlimited') {
    return blind(`статус ключа «${oneLine(String(status), 40)}» не прочитан — ждали ok, unlimited или unknown`);
  }
  const checked = Date.parse(block.checked_at);
  if (!Number.isFinite(checked)) {
    return blind(`время чтения (checked_at) не прочитано (${oneLine(JSON.stringify(block.checked_at), 40)})`);
  }
  if (now.getTime() - checked > staleMs) {
    return blind(`сервер прочитал ключ ${block.checked_at} — старше часа: кэш сервера перестал обновляться`);
  }
  const reset = block.limit_reset;
  if (reset !== null && typeof reset !== 'string') {
    return blind(`признак сброса (limit_reset) не прочитан (${oneLine(JSON.stringify(reset), 40)})`);
  }

  const warnings = [];
  if (status === 'unlimited') {
    warnings.push('у ключа сервера нет лимита трат — остаток не измерить, предел — только баланс аккаунта');
    return { blind: null, alarm: false, key: { status, remaining: null, reset, checkedAt: block.checked_at }, warnings };
  }
  if (!isWholePercent(block.remaining_percent)) {
    return blind(`остаток (remaining_percent) не прочитан (${oneLine(JSON.stringify(block.remaining_percent), 40)}) — нужно целое от 0 до 100`);
  }
  if (reset === null) {
    warnings.push('лимит ключа не сбрасывается: потраченное не вернётся само (п. 10 списка 28.10 — ежемесячный сброс в панели OpenRouter)');
  }
  return {
    blind: null,
    alarm: block.remaining_percent < alarmPercent,
    key: { status, remaining: block.remaining_percent, reset, checkedAt: block.checked_at },
    warnings,
  };
}

/**
 * Код выхода. Провал откладывается только при подтверждённом mayWait
 * защиты выкатки; ошибка защиты провал не откладывает.
 *
 * @returns {{ code: number, wanted: number, deferred: boolean }}
 */
export function decideExit({ blind, alarm, guard }) {
  let wanted = EXIT.OK;
  if (blind) wanted = EXIT.BLIND;
  else if (alarm) wanted = EXIT.ALARM;
  if (wanted !== EXIT.OK && guard?.mayWait === true) return { code: EXIT.OK, wanted, deferred: true };
  return { code: wanted, wanted, deferred: false };
}

const RESET_TEXT = { daily: 'ежедневно', weekly: 'еженедельно', monthly: 'ежемесячно' };

/** Одна строка итога: остаток и сброс. */
export function keyLine(key) {
  const reset = key.reset === null
    ? 'лимит не сбрасывается'
    : `лимит сбрасывается ${RESET_TEXT[key.reset] ?? `(${oneLine(key.reset, 20)})`}`;
  const remaining = key.status === 'unlimited' ? 'Ключ сервера: без лимита' : `Остаток ключа сервера: ${key.remaining} %`;
  return `${remaining} · ${reset} · прочитано сервером ${key.checkedAt}`;
}

const VERDICT_TEXT = { [EXIT.OK]: 'порядок', [EXIT.ALARM]: 'ТРЕВОГА', [EXIT.BLIND]: 'СТОРОЖ ОСЛЕП' };

const ALARM_HINT = 'Что делать: панель OpenRouter (Settings → API Keys → ключ сервера) — поднять лимит или '
  + 'дождаться сброса; заодно проверить баланс аккаунта (Credits): он общий для всех ключей, и сторож его не видит. '
  + 'Кончится остаток — умный поиск станет обычным, меню перестанут распознаваться.';

const BLIND_HINT = 'Что делать: открыть адрес проверки здоровья в браузере и посмотреть блок model_key. '
  + 'Нет блока — на проде сервер до этой правки; unknown_reason http_401 или no_key — ключ сервера в панели '
  + 'OpenRouter и переменная OPENROUTER_API_KEY на Railway; разовый сбой сети — следующий запуск покажет; '
  + 'формат изменился — править backend/scripts/openrouter-usage/watch.js и backend/src/services/openRouterKeyStatus.js.';

// Команды workflow GitHub: в данных экранируются %, CR, LF; в свойствах ещё : и ,.
const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const annotation = (level, title, message) => `::${level} title=${escapeProperty(title)}::${escapeData(message)}`;

/**
 * Отчёт: текст для лога, Markdown для страницы прогона (GITHUB_STEP_SUMMARY)
 * и аннотации GitHub (error — провал, warning — отложенный провал и
 * предупреждения).
 */
export function formatReport({ now, alarmPercent, url, evaluation, verdict, guard }) {
  const threshold = alarmPercent == null ? 'порог не прочитан' : `тревога при остатке меньше ${alarmPercent} %`;
  const header = `Расход OpenRouter — ${now.toISOString().slice(0, 10)}, ${threshold}`;
  const text = [header];
  const md = [`## ${header}`, ''];
  const annotations = [];
  const level = verdict.deferred ? 'warning' : 'error';
  const both = (...lines) => {
    text.push(...lines);
    md.push(...lines);
  };
  if (url) both(`Источник: ${url} (блок model_key).`);

  if (evaluation.blind) {
    text.push('', `❌ Сторож ослеп: ${evaluation.blind}`);
    md.push('', `❌ **Сторож ослеп:** ${evaluation.blind}`);
    both('', BLIND_HINT);
    annotations.push(annotation(level, 'Сторож расхода OpenRouter ослеп', evaluation.blind));
  } else {
    const line = keyLine(evaluation.key);
    both('', `${evaluation.alarm ? '❌' : '✅'} ${line}`);
    for (const warning of evaluation.warnings) {
      both(`⚠️ ${warning}`);
      annotations.push(annotation('warning', 'Сторож расхода OpenRouter — предупреждение', warning));
    }
    if (evaluation.alarm) {
      annotations.push(annotation(level, 'Ключ OpenRouter у предела', line));
      both('', ALARM_HINT);
    }
  }
  both('', 'Баланс аккаунта сторож не читает: для этого нужен ключ управления (решение Trunk 28.10.2026).');

  if (guard?.error) {
    both('', `Защита выкатки не проверила коммит (${guard.error}) — провал не отложен.`);
  }
  if (verdict.deferred) {
    both(
      '',
      `Провал отложен: на этом коммите ещё идёт или только что закончился другой прогон (${guard.blocking.join(', ')}), `
        + 'и выкатка могла ждать исхода сторожа — красный прогон пропустил бы её. Прогон зелёный намеренно и '
        + 'письма не будет; по расписанию тревога повторится через неделю — раньше её покажет ручной запуск '
        + 'через 15 минут.',
    );
  }
  both('', `Итог: ${VERDICT_TEXT[verdict.wanted]}${verdict.deferred ? ' — провал отложен защитой выкатки' : ''}`);

  return { text: text.join('\n'), markdown: `${md.join('\n')}\n`, annotations };
}

/**
 * Один прогон: порог и адрес → блок model_key → оценка → при провале —
 * защита выкатки → код выхода и отчёт. Защиту спрашивают только перед
 * провалом.
 *
 * @returns {Promise<{ code: number, report: { text: string, markdown: string, annotations: string[] } }>}
 */
export async function runWatch({
  env = process.env,
  now = new Date(),
  fetchKeyBlockImpl = fetchKeyBlock,
  checkDeployWindowImpl = checkDeployWindow,
} = {}) {
  let evaluation;
  let alarmPercent = null;
  let url = null;
  try {
    alarmPercent = parseAlarmPercent(env.ALARM_PERCENT);
    url = parseHealthUrl(env.HEALTH_URL);
    evaluation = evaluateKey({ block: await fetchKeyBlockImpl({ url }), now, alarmPercent });
  } catch (error) {
    if (!(error instanceof BlindError)) throw error;
    evaluation = { blind: error.message, alarm: false, key: null, warnings: [] };
  }

  let guard = null;
  let verdict = decideExit({ ...evaluation, guard });
  if (verdict.code !== EXIT.OK) {
    guard = await checkDeployWindowImpl({ env });
    verdict = decideExit({ ...evaluation, guard });
  }
  return { code: verdict.code, report: formatReport({ now, alarmPercent, url, evaluation, verdict, guard }) };
}
