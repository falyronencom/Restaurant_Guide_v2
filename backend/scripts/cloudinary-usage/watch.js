/**
 * Сторож расхода Cloudinary — логика. Запуск — check.js, расписание —
 * .github/workflows/cloudinary-usage.yml.
 *
 * Зачем (21.10.2026, нитка «Нагрузка и расходы поставщиков», директива D3).
 * Телеметрии нет; на бесплатном тарифе Cloudinary о расходе приходит только
 * месячный отчёт, и порог узнаётся из письма поставщика. Решение Координатора
 * 21.10.2026 (SDL CAT-C-4.5 п. 6): платный тариф Plus покупать по сигналу
 * этого сторожа. Free — 25 кредитов за скользящие 30 дней, Plus — 225;
 * 1 кредит = 1 ГБ хранения, или 1 ГБ трафика, или 1 000 преобразований.
 *
 * Источник — Admin API, GET /v1_1/<cloud>/usage
 * (https://cloudinary.com/documentation/admin_api_usage). Ответ бесплатного
 * тарифа сверен на проде 21.10.2026: credits = { usage: 5.63, limit: 25,
 * used_percent: 22.52 }; storage, bandwidth, transformations — { usage,
 * credits_usage } (хранение и трафик в байтах); last_updated = '2026-10-20'
 * (данные отстают на день). Предел берётся из ответа, поэтому после перехода
 * на Plus порог сам считается от 225.
 *
 * Два рода отказа, оба валят прогон, но разными словами:
 * - тревога (EXIT.ALARM): израсходовано не меньше порога (по умолчанию 70 %)
 *   кредитов тарифа;
 * - сторож ослеп (EXIT.BLIND): нет секретов, порог не прочитан, API не
 *   ответил или отказал, в ответе нет кредитов или даты данных, данные
 *   старше STALE_DAYS. Зелёный прогон слепого сторожа ничего бы не значил.
 *
 * Защита выкатки — та же, что у сторожа сроков моделей (checkDeployWindow из
 * model-expiry/watch.js): если на коммите ещё идёт другой прогон, красный
 * сторож сорвал бы выкатку Railway, и провал откладывается до следующего
 * запуска.
 */

import { checkDeployWindow } from '../model-expiry/watch.js';

/** Порог тревоги по умолчанию, % кредитов тарифа (решение Координатора 21.10.2026). */
export const DEFAULT_ALARM_PERCENT = 70;

/** Данные старше этого — сторож ослеп: Cloudinary перестал их обновлять. */
export const STALE_DAYS = 3;

export const EXIT = { OK: 0, ALARM: 1, BLIND: 2 };

/** Имена секретов (окружение cloudinary-watch); значения не печатаются никогда. */
export const SECRET_NAMES = ['CLOUDINARY_WATCH_CLOUD_NAME', 'CLOUDINARY_WATCH_API_KEY', 'CLOUDINARY_WATCH_API_SECRET'];

export const API_BASE = 'https://api.cloudinary.com/v1_1';

const DAY_MS = 24 * 60 * 60 * 1000;
const GIB = 1024 ** 3;
const ATTEMPTS = 3;
const TIMEOUT_MS = 30000;
const RETRY_DELAYS_MS = [10000, 30000];

/** Сторож не может сказать, каков расход, — провал, не зелёный. */
export class BlindError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlindError';
  }
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Значения ключа и секрета вырезаются из любого текста отчёта: ответ
 * Cloudinary на неверный ключ называет его («Invalid api_key …»), а маска
 * GitHub — последняя линия, не единственная.
 */
export function redact(text, secrets) {
  let out = String(text);
  for (const s of secrets) if (s) out = out.split(s).join('***');
  return out;
}

/**
 * Чужой текст (ввод формы, сообщение API) — одной строкой и не длиннее max:
 * лог печатается как есть, и строка, начатая с «::», стала бы командой
 * GitHub (ревью 21.10.2026).
 */
export function oneLine(text, max = 200) {
  const flat = String(text).replace(/[\r\n]+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Порог из ручного запуска или переменной репозитория: пусто — по умолчанию;
 * десятичное число больше 0 и не больше 100 (запятая и знак % допускаются).
 * Иное — слепота, а не тихое умолчание: опечатка в пороге не должна
 * выглядеть порядком.
 *
 * @returns {number}
 * @throws {BlindError}
 */
export function parseAlarmPercent(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return DEFAULT_ALARM_PERCENT;
  const normalized = text.replace(',', '.').replace(/\s*%$/, '');
  const value = /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw new BlindError(
      `порог «${oneLine(text, 20)}» не прочитан — нужно число больше 0 и не больше 100 (процент кредитов тарифа)`,
    );
  }
  return value;
}

/**
 * Секреты из окружения прогона.
 *
 * @returns {{ cloudName: string, apiKey: string, apiSecret: string }}
 * @throws {BlindError} без какого-либо секрета — называет имена, не значения
 */
export function readSecrets(env) {
  const missing = SECRET_NAMES.filter((name) => !String(env[name] ?? '').trim());
  if (missing.length > 0) {
    throw new BlindError(`нет секретов (окружение cloudinary-watch): ${missing.join(', ')} — без них расход не прочитать`);
  }
  return {
    cloudName: env.CLOUDINARY_WATCH_CLOUD_NAME.trim(),
    apiKey: env.CLOUDINARY_WATCH_API_KEY.trim(),
    apiSecret: env.CLOUDINARY_WATCH_API_SECRET.trim(),
  };
}

/**
 * Отчёт о расходе из Admin API. Ключ — заголовком Basic, не в адресе.
 * Сбой сети, 5xx и 429 — повтор; прочие 4xx (неверный ключ, облако) — сразу
 * слепота: повтор ответ не изменит. Текст ошибки — без ключа и секрета.
 *
 * @returns {Promise<object>} тело ответа
 * @throws {BlindError}
 */
export async function fetchUsage({
  cloudName,
  apiKey,
  apiSecret,
  fetchImpl = globalThis.fetch,
  attempts = ATTEMPTS,
  timeoutMs = TIMEOUT_MS,
  retryDelaysMs = RETRY_DELAYS_MS,
  sleep = sleepMs,
}) {
  const url = `${API_BASE}/${encodeURIComponent(cloudName)}/usage`;
  const authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let retry = true;
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: authorization, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        let detail = '';
        try {
          const body = await response.json();
          if (body?.error?.message) detail = `: ${oneLine(body.error.message)}`;
        } catch {
          // тело не JSON — достаточно кода
        }
        retry = response.status >= 500 || response.status === 429;
        throw new Error(`HTTP ${response.status}${detail}`);
      }
      const body = await response.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('ответ не объект JSON');
      return body;
    } catch (error) {
      failures.push(`попытка ${attempt}: ${oneLine(error.message)}`);
      if (!retry) break;
      if (attempt < attempts) await sleep(retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)]);
    }
  }
  const message = `API расхода Cloudinary не ответило (${API_BASE}/<облако>/usage) — ${failures.join('; ')}`;
  throw new BlindError(redact(message, [apiKey, apiSecret]));
}

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** Составляющая расхода: { usage, credits } или null, если в ответе её нет. */
function component(body, key) {
  const part = body?.[key];
  if (!part || !isNumber(part.usage)) return null;
  return { usage: part.usage, credits: isNumber(part.credits_usage) ? part.credits_usage : null };
}

/** Дата YYYY-MM-DD (допускается со временем после) → полночь UTC или null. */
function parseDay(value) {
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
 * Оценка ответа. Процент считается из usage и limit, а не берётся из
 * used_percent: сравнение usage·100 ≥ порог·limit обходит деление (17,5 из
 * 25 при 70 % — ровно граница; погрешность умножения — на порядки меньше
 * сотой кредита), а поле, которого нет или которое врёт, не решает.
 * Дата данных из будущего — тоже слепота: такой ответ не о сегодняшнем
 * расходе.
 *
 * @param {{ body: object, today: Date, alarmPercent: number, staleDays?: number }} input
 * @returns {{ blind: string|null, alarm: boolean, usage: object|null }}
 */
export function evaluateUsage({ body, today, alarmPercent, staleDays = STALE_DAYS }) {
  const blind = (reason) => ({ blind: reason, alarm: false, usage: null });
  const credits = body?.credits;
  if (!credits || typeof credits !== 'object') {
    return blind('в ответе нет кредитов (credits) — тариф не на кредитах или Cloudinary изменил формат; порог не проверить');
  }
  if (!isNumber(credits.usage) || credits.usage < 0) {
    return blind(`credits.usage не прочитан (${JSON.stringify(credits.usage)}) — нужно число не меньше 0`);
  }
  if (!isNumber(credits.limit) || credits.limit <= 0) {
    return blind(`credits.limit не положительное число (${JSON.stringify(credits.limit)}) — предел тарифа не прочитан`);
  }
  const updated = parseDay(body.last_updated);
  if (!updated) {
    return blind(`дата данных (last_updated) не прочитана (${JSON.stringify(body.last_updated)}) — не видно, свежие ли цифры`);
  }
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const ageDays = Math.round((todayUtc - updated.utc) / DAY_MS);
  if (ageDays > staleDays) {
    return blind(`данные Cloudinary на ${updated.iso} — старше ${staleDays} дн. (${ageDays} дн.): расход перестал обновляться`);
  }
  // День вперёд допустим: Cloudinary может считать дату в другом поясе.
  if (ageDays < -1) {
    return blind(`данные Cloudinary на ${updated.iso} — дата из будущего: ответ не о сегодняшнем расходе`);
  }

  const usage = {
    plan: typeof body.plan === 'string' ? body.plan : null,
    lastUpdated: updated.iso,
    credits: { used: credits.usage, limit: credits.limit, percent: (credits.usage / credits.limit) * 100 },
    storage: component(body, 'storage'),
    bandwidth: component(body, 'bandwidth'),
    transformations: component(body, 'transformations'),
  };
  const alarm = credits.usage * 100 >= alarmPercent * credits.limit;
  return { blind: null, alarm, usage };
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

const num = (v, digits = 2) => v.toFixed(digits).replace('.', ',');
const credit = (c) => (c?.credits == null ? '' : ` (${num(c.credits)} кр.)`);

/** Одна строка итога: кредиты, хранение, трафик, преобразования. */
export function usageLine(usage) {
  const { credits, storage, bandwidth, transformations } = usage;
  const parts = [`Кредиты: ${num(credits.used)} / ${num(credits.limit, 0)} (${num(credits.percent, 1)} %)`];
  parts.push(storage ? `хранение ${num(storage.usage / GIB)} ГБ${credit(storage)}` : 'хранение — нет в ответе');
  parts.push(bandwidth ? `трафик ${num(bandwidth.usage / GIB)} ГБ${credit(bandwidth)}` : 'трафик — нет в ответе');
  parts.push(transformations
    ? `преобразования ${transformations.usage}${credit(transformations)}`
    : 'преобразования — нет в ответе');
  return parts.join(' · ');
}

const VERDICT_TEXT = { [EXIT.OK]: 'порядок', [EXIT.ALARM]: 'ТРЕВОГА', [EXIT.BLIND]: 'СТОРОЖ ОСЛЕП' };

const ALARM_HINT = 'Что делать: решение Координатора 21.10.2026 — сигнал к покупке Cloudinary Plus '
  + '(225 кредитов). Сначала — панель Cloudinary (Dashboard → Usage): что растёт — хранение, трафик или '
  + 'преобразования; кредиты считаются за скользящие 30 дней.';

const BLIND_HINT = 'Что делать: нет секретов — добавить их в окружение cloudinary-watch (Settings → Environments); '
  + 'HTTP 401/403 — ключ сторожа отозван или неверен, выпустить новый в Cloudinary (Settings → API Keys); '
  + 'разовый сбой сети — следующий запуск покажет; формат ответа изменился — править '
  + 'backend/scripts/cloudinary-usage/watch.js.';

// Команды workflow GitHub: в данных экранируются %, CR, LF; в свойствах ещё : и ,.
const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const annotation = (level, title, message) => `::${level} title=${escapeProperty(title)}::${escapeData(message)}`;

/**
 * Отчёт: текст для лога, Markdown для страницы прогона (GITHUB_STEP_SUMMARY)
 * и аннотации GitHub (error — провал, warning — отложенный провал).
 */
export function formatReport({ today, alarmPercent, evaluation, verdict, guard }) {
  const threshold = alarmPercent == null
    ? 'порог не прочитан'
    : `тревога от ${String(alarmPercent).replace('.', ',')} % кредитов тарифа`;
  const header = `Расход Cloudinary — ${today.toISOString().slice(0, 10)}, ${threshold}`;
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
    annotations.push(annotation(level, 'Сторож расхода Cloudinary ослеп', evaluation.blind));
  } else {
    const { usage } = evaluation;
    const line = `${evaluation.alarm ? '❌' : '✅'} ${usageLine(usage)}`;
    both(`Тариф ${usage.plan ?? '— не назван'}, данные на ${usage.lastUpdated}.`, '', line);
    if (evaluation.alarm) {
      annotations.push(annotation(level, 'Расход Cloudinary у предела тарифа', usageLine(usage)));
      both('', ALARM_HINT);
    }
  }

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
 * Один прогон: секреты и порог → отчёт API → оценка → при провале — защита
 * выкатки → код выхода и отчёт. Защиту спрашивают только перед провалом.
 *
 * @returns {Promise<{ code: number, report: { text: string, markdown: string, annotations: string[] } }>}
 */
export async function runWatch({
  env = process.env,
  today = new Date(),
  fetchUsageImpl = fetchUsage,
  checkDeployWindowImpl = checkDeployWindow,
} = {}) {
  let evaluation;
  let alarmPercent = null;
  try {
    alarmPercent = parseAlarmPercent(env.ALARM_PERCENT);
    const secrets = readSecrets(env);
    evaluation = evaluateUsage({ body: await fetchUsageImpl(secrets), today, alarmPercent });
  } catch (error) {
    if (!(error instanceof BlindError)) throw error;
    evaluation = { blind: error.message, alarm: false, usage: null };
  }

  let guard = null;
  let verdict = decideExit({ ...evaluation, guard });
  if (verdict.code !== EXIT.OK) {
    guard = await checkDeployWindowImpl({ env });
    verdict = decideExit({ ...evaluation, guard });
  }
  const report = formatReport({ today, alarmPercent, evaluation, verdict, guard });
  const hidden = [env.CLOUDINARY_WATCH_API_KEY, env.CLOUDINARY_WATCH_API_SECRET].map((s) => String(s ?? '').trim());
  return {
    code: verdict.code,
    report: {
      text: redact(report.text, hidden),
      markdown: redact(report.markdown, hidden),
      annotations: report.annotations.map((a) => redact(a, hidden)),
    },
  };
}
