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
 *
 * Потолок распознавания (нитка «Потолок распознавания: малые правки»,
 * находка 3; выбор Координатора — вариант Б, 08.11.2026). Тот же ключ держит
 * общий суточный потолок страниц распознавания (backend/src/services/
 * ocrAllowance.js): когда он выбран, меню партнёров не распознаются до
 * следующих суток, а видно это было только в журнале сервера. Из того же
 * ответа сторож читает блок recognition (services/ocrCeilingHealth.js:
 * сегодня и семь дней до него) и даёт тревогу, если общий потолок хоть раз
 * не принял файл. Отказы по доле одной учётки — строкой в итоге, без
 * тревоги: так доля и работает. Нет блока, не прочитан формат или сервер не
 * спросил свой Redis (без него пределы распознавания не действуют) — сторож
 * ослеп. Неделя сторожа — восемь суток: отказ утром прошлой пятницы до его
 * прогона попадёт в два отчёта подряд, зато ни один не пропадёт.
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
 * Блоки model_key и recognition из проверки здоровья сервера, одним чтением.
 * Сервер отвечает 503, когда не здорова база, но блоки есть и тогда — они и
 * читаются. Сбой сети, 5xx без блока ключа и 429 — повтор; блок ключа с
 * проходящей причиной незнания (PASSING_REASONS) или блок распознавания,
 * чей Redis на миг не ответил, — тоже повтор; прочее — сразу ответ. Блока
 * распознавания нет — recognition: null, решает evaluateRecognition.
 *
 * @returns {Promise<{ keyBlock: object, recognition: object|null }>}
 * @throws {BlindError}
 */
export async function fetchHealthBlocks({
  url,
  fetchImpl = globalThis.fetch,
  attempts = ATTEMPTS,
  timeoutMs = TIMEOUT_MS,
  retryDelaysMs = RETRY_DELAYS_MS,
  sleep = sleepMs,
}) {
  const failures = [];
  let last = null;
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
        last = { keyBlock: block, recognition: body.data.recognition ?? null };
        if (block.status === 'unknown' && PASSING_REASONS.has(block.unknown_reason)) {
          throw new Error(`сервер ещё не прочитал ключ (${oneLine(block.unknown_reason, 40)})`);
        }
        if (last.recognition?.redis_ready === false) {
          throw new Error('сервер не спросил свой Redis о счётчиках распознавания');
        }
        return last;
      }
      retry = response.status >= 500 || response.status === 429;
      throw new Error(response.ok ? 'в ответе нет блока model_key — сервер до этой правки?' : `HTTP ${response.status}`);
    } catch (error) {
      failures.push(`попытка ${attempt}: ${oneLine(error.message)}`);
      if (!retry) break;
      if (attempt < attempts) await sleep(retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)]);
    }
  }
  if (last) return last;
  throw new BlindError(`проверка здоровья сервера не ответила (${url}) — ${failures.join('; ')}`);
}

/**
 * Блок model_key из проверки здоровья сервера (fetchHealthBlocks).
 *
 * @returns {Promise<object>} блок model_key
 * @throws {BlindError}
 */
export async function fetchKeyBlock(options) {
  return (await fetchHealthBlocks(options)).keyBlock;
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
 * Виды отказов блока recognition — REFUSAL_KINDS сервера
 * (backend/src/services/ocrAllowance.js; тест сверяет списки: сторож идёт без
 * зависимостей и код сервера не подключает). door_* — у двери: файл не
 * поставлен в очередь; reading_* — при первом запуске задания: файл не
 * прочитан. *_ceiling — общий потолок, *_share — доля учётки или пределы
 * неподтверждённых учёток, door_jobs — задания дня.
 */
export const REFUSAL_FIELDS = Object.freeze([
  'door_ceiling', 'door_share', 'door_jobs', 'reading_ceiling', 'reading_share',
]);

const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isMinskDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 2026-11-08 → 08.11 */
const shortDate = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/**
 * Оценка блока recognition: тревога — общий потолок распознавания не принял
 * файл хоть раз за дни блока; слепота — блока нет, формат не прочитан или
 * сервер не спросил свой Redis.
 *
 * @param {{ board: object|null }} input
 * @returns {{ blind: string|null, alarm: boolean, summary: object|null }}
 *   summary — потолок, число дней, дни с отказами общего потолка, отказы долей
 *   и заданий за все дни, самые занятые сутки
 */
export function evaluateRecognition({ board }) {
  const blind = (reason) => ({ blind: reason, alarm: false, summary: null });
  if (board === null || board === undefined) {
    return blind('в ответе нет блока recognition — сервер до этой правки?');
  }
  if (typeof board !== 'object' || Array.isArray(board)) {
    return blind(`блок recognition не прочитан (${oneLine(JSON.stringify(board), 60)})`);
  }
  if (!Number.isSafeInteger(board.ceiling_pages) || board.ceiling_pages <= 0) {
    return blind(`потолок (ceiling_pages) не прочитан (${oneLine(JSON.stringify(board.ceiling_pages), 40)})`);
  }
  if (board.redis_ready !== true || board.days === null) {
    return blind('сервер не прочитал счётчики распознавания: его Redis не ответил, а без Redis пределы распознавания не действуют');
  }
  if (!Array.isArray(board.days) || board.days.length === 0) {
    return blind(`дни (days) блока recognition не прочитаны (${oneLine(JSON.stringify(board.days), 60)})`);
  }
  for (const day of board.days) {
    const readable = day && isMinskDate(day.date) && isCount(day.pages_counted)
      && day.refusals && REFUSAL_FIELDS.every((field) => isCount(day.refusals[field]));
    if (!readable) return blind(`день блока recognition не прочитан (${oneLine(JSON.stringify(day), 80)})`);
  }

  const days = board.days;
  const byCeiling = days
    .map((day) => ({ date: day.date, door: day.refusals.door_ceiling, reading: day.refusals.reading_ceiling }))
    .filter(({ door, reading }) => door + reading > 0);
  const sum = (field) => days.reduce((total, day) => total + day.refusals[field], 0);
  const busiest = days.reduce((top, day) => (day.pages_counted > top.pages_counted ? day : top), days[0]);
  return {
    blind: null,
    alarm: byCeiling.length > 0,
    summary: {
      ceiling: board.ceiling_pages,
      dayCount: days.length,
      byCeiling,
      share: sum('door_share') + sum('reading_share'),
      jobs: sum('door_jobs'),
      busiest: { date: busiest.date, pages: busiest.pages_counted },
    },
  };
}

/** Строки итога о потолке распознавания: главная (с ✅ или ❌) и, если были, отказы долей и заданий. */
export function recognitionLines(summary) {
  const head = `Потолок распознавания (${summary.ceiling} страниц в сутки на всех)`;
  const lines = [];
  if (summary.byCeiling.length > 0) {
    const days = summary.byCeiling.map(({ date, door, reading }) => {
      const parts = [door > 0 && `у двери ${door}`, reading > 0 && `при чтении ${reading}`].filter(Boolean);
      return `${shortDate(date)} — ${door + reading} (${parts.join(', ')})`;
    });
    lines.push(`❌ ${head}: общий потолок не принял файлы — ${days.join('; ')}`);
  } else {
    lines.push(`✅ ${head}: за ${summary.dayCount} сут. общий потолок файлов не отклонял; `
      + `больше всего страниц за сутки — ${summary.busiest.pages} (${shortDate(summary.busiest.date)})`);
  }
  if (summary.share > 0 || summary.jobs > 0) {
    lines.push(`Отказов по доле одной учётки или пределам неподтверждённых — ${summary.share}, `
      + `по заданиям дня — ${summary.jobs}: так пределы и работают, тревоги нет.`);
  }
  return lines;
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

const RECOGNITION_ALARM_HINT = 'Что делать: открыть адрес проверки здоровья, блок recognition — дни, страницы и отказы. '
  + 'Партнёр с отказом перезапускает распознавание после полуночи по Минску; одобрение карточки модератором '
  + 'читает меню без потолка. День выбирают честные партнёры — поднять потолок (переменная OCR_DAILY_PAGE_CEILING '
  + 'на Railway, без выпуска); одна-две учётки — их видно в журнале сервера, строки «Recognition pages of the day …».';

const RECOGNITION_BLIND_HINT = 'Что делать: открыть адрес проверки здоровья в браузере и посмотреть блок recognition. '
  + 'Нет блока — на проде сервер до этой правки; redis_ready false — Redis сервера на Railway; формат изменился — '
  + 'править backend/scripts/openrouter-usage/watch.js и backend/src/services/ocrCeilingHealth.js.';

// Команды workflow GitHub: в данных экранируются %, CR, LF; в свойствах ещё : и ,.
const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const annotation = (level, title, message) => `::${level} title=${escapeProperty(title)}::${escapeData(message)}`;

/**
 * Отчёт: текст для лога, Markdown для страницы прогона (GITHUB_STEP_SUMMARY)
 * и аннотации GitHub (error — провал, warning — отложенный провал и
 * предупреждения). recognition — оценка блока recognition (evaluateRecognition)
 * или null, когда до него не дошло (порог не прочитан, сервер не ответил).
 */
export function formatReport({ now, alarmPercent, url, evaluation, recognition = null, verdict, guard }) {
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
  if (url) both(`Источник: ${url} (блоки model_key и recognition).`);

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

  if (recognition?.blind) {
    text.push('', `❌ Сторож не видит потолок распознавания: ${recognition.blind}`);
    md.push('', `❌ **Сторож не видит потолок распознавания:** ${recognition.blind}`);
    both('', RECOGNITION_BLIND_HINT);
    annotations.push(annotation(level, 'Сторож не видит потолок распознавания', recognition.blind));
  } else if (recognition) {
    const [head, ...rest] = recognitionLines(recognition.summary);
    both('', head, ...rest);
    if (recognition.alarm) {
      annotations.push(annotation(level, 'Потолок распознавания не принимал файлы', head));
      both('', RECOGNITION_ALARM_HINT);
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
 * Один прогон: порог и адрес → блоки model_key и recognition → оценки → при
 * провале — защита выкатки → код выхода и отчёт. Слепота любого блока —
 * слепота прогона, тревога любого — тревога. Защиту спрашивают только перед
 * провалом.
 *
 * @returns {Promise<{ code: number, report: { text: string, markdown: string, annotations: string[] } }>}
 */
export async function runWatch({
  env = process.env,
  now = new Date(),
  fetchHealthImpl = fetchHealthBlocks,
  checkDeployWindowImpl = checkDeployWindow,
} = {}) {
  let evaluation;
  let recognition = null;
  let alarmPercent = null;
  let url = null;
  try {
    alarmPercent = parseAlarmPercent(env.ALARM_PERCENT);
    url = parseHealthUrl(env.HEALTH_URL);
    const blocks = await fetchHealthImpl({ url });
    evaluation = evaluateKey({ block: blocks.keyBlock, now, alarmPercent });
    recognition = evaluateRecognition({ board: blocks.recognition });
  } catch (error) {
    if (!(error instanceof BlindError)) throw error;
    evaluation = { blind: error.message, alarm: false, key: null, warnings: [] };
  }

  const outcome = {
    blind: evaluation.blind ?? recognition?.blind ?? null,
    alarm: evaluation.alarm || recognition?.alarm === true,
  };
  let guard = null;
  let verdict = decideExit({ ...outcome, guard });
  if (verdict.code !== EXIT.OK) {
    guard = await checkDeployWindowImpl({ env });
    verdict = decideExit({ ...outcome, guard });
  }
  return {
    code: verdict.code,
    report: formatReport({ now, alarmPercent, url, evaluation, recognition, verdict, guard }),
  };
}
