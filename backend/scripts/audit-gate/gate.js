/**
 * Сторож уязвимостей рабочих зависимостей backend — логика. Запуск — check.js.
 *
 * Зачем (06.10.2026, пункт #21 внешнего обзора). multer 2.0.2 с шестью high
 * пролежал в lock-файле с марта по октябрь: разбор #10a 30.09 смотрел только
 * то, о чём спрашивали (jws, next), а сверки всего lock-файла с базой
 * уведомлений не было ни в одном прогоне. Сторож делает её на каждом запуске:
 * `npm audit --omit=dev --json` → уведомления high и critical → каждое либо
 * закрыто обновлением, либо записано в allowlist.json С ПРИЧИНОЙ.
 *
 * Три исхода, как у сторожа сроков моделей (scripts/model-expiry):
 * - порядок (EXIT.OK): ни одного high/critical вне allowlist;
 * - тревога (EXIT.ALARM): есть уведомление high/critical, которого нет в
 *   allowlist для этого пакета;
 * - сторож ослеп (EXIT.BLIND): npm audit не ответил или ответил не в той
 *   форме, allowlist испорчен, ЛИБО якорь не сработал. Зелёный прогон слепого
 *   сторожа ничего бы не значил, поэтому слепота — тоже провал.
 *
 * Якорь. Сканирующий сторож зеленеет двумя способами: нарушений нет — или
 * сломан сам поиск (база не ответила, npm сменил форму JSON, фильтр
 * перестал видеть severity). Второй беззвучен. Поэтому перед настоящим
 * lock-файлом тот же путь (npm audit → разбор → allowlist → решение)
 * проходит литерал anchor/: lock-файл с multer 2.0.2, у которого
 * уведомления high есть заведомо. Если на якоре сторож НЕ поднял тревогу по
 * multer — он слеп, и прогон красный, что бы ни показал настоящий lock-файл.
 * Файлы якоря названы не package.json / package-lock.json, чтобы граф
 * зависимостей GitHub не принял их за манифест; на время проверки они
 * копируются во временную папку под настоящими именами.
 */

import { execFile } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const EXIT = { OK: 0, ALARM: 1, BLIND: 2 };

/** Уровни, которые валят прогон. moderate и low — только в отчёте npm. */
export const BLOCKING_SEVERITIES = ['critical', 'high'];

/** Пакет якоря: у его зафиксированной версии high есть заведомо. */
export const ANCHOR_PACKAGE = 'multer';

const GHSA_RE = /^GHSA(-[0-9a-z]{4}){3}$/;
const AUDIT_ATTEMPTS = 3;
const AUDIT_RETRY_DELAYS_MS = [10000, 30000];
const AUDIT_TIMEOUT_MS = 120000;

/** Сторож не может сказать, чисто ли, — провал, не зелёный. */
export class BlindError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlindError';
  }
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `npm audit --omit=dev --json` в папке с lock-файлом. Код выхода ничего не
 * решает: 1 бывает и при найденных уязвимостях, и при сбое. Решает форма
 * ответа: отчёт несёт auditReportVersion. Без него это сбой — реестр не
 * ответил (npm 10.2.4 пишет {"message": "request … failed, reason: …"}) или
 * npm отказался ({"error": {"code": "ENOLOCK", …}}) — повтор, затем слепота.
 * Отчёт другой версии возвращается как есть: его отвергнет extractFindings.
 *
 * @param {string} dir - папка с package.json и package-lock.json
 * @param {{ attempts?: number, delaysMs?: number[], exec?: Function }} [opts]
 * @returns {Promise<object>} разобранный отчёт npm audit
 * @throws {BlindError}
 */
export async function runNpmAudit(dir, {
  attempts = AUDIT_ATTEMPTS,
  delaysMs = AUDIT_RETRY_DELAYS_MS,
  exec = execNpmAudit,
} = {}) {
  let lastProblem = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { stdout, stderr, spawnError } = await exec(dir);
    if (spawnError) {
      lastProblem = `npm не запустился: ${spawnError}`;
    } else {
      try {
        const report = JSON.parse(stdout);
        if (report && report.auditReportVersion !== undefined) return report;
        const reason = (report && report.error && [report.error.code, report.error.summary].filter(Boolean).join(' '))
          || (report && report.message)
          || String(stdout).slice(0, 300);
        lastProblem = `npm audit не вернул отчёт: ${reason}`;
      } catch {
        lastProblem = `ответ npm audit — не JSON (stderr: ${String(stderr).slice(0, 300)})`;
      }
    }
    if (attempt < attempts) await sleepMs(delaysMs[attempt - 1] ?? delaysMs[delaysMs.length - 1] ?? 0);
  }
  throw new BlindError(`${lastProblem} — после ${attempts} попыток`);
}

function execNpmAudit(dir) {
  return new Promise((resolve) => {
    execFile(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['audit', '--omit=dev', '--json'],
      { cwd: dir, timeout: AUDIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' },
      (error, stdout, stderr) => {
        // Код 1 при найденных уязвимостях — штатный; сбой запуска — нет.
        const spawnError = error && typeof error.code !== 'number' ? (error.code || error.message) : null;
        resolve({ stdout, stderr, spawnError });
      },
    );
  });
}

/**
 * Уведомления high/critical из отчёта npm audit (auditReportVersion 2).
 * Уведомление живёт в `via` того пакета, в котором уязвимость; пакеты,
 * затронутые транзитивно, несут в `via` только имя (строку) — их закрывает
 * то же уведомление у источника, отдельной записи не нужно.
 *
 * Сверка с итогом npm: если metadata насчитала high/critical, а разбор не
 * нашёл ни одного, — форма JSON уехала, и это слепота, а не «чисто».
 *
 * @param {object} report
 * @returns {Array<{ ghsa: string, package: string, severity: string, title: string, range: string, url: string }>}
 * @throws {BlindError}
 */
export function extractFindings(report) {
  if (!report || typeof report !== 'object') throw new BlindError('отчёт npm audit пуст');
  if (report.auditReportVersion !== 2) {
    throw new BlindError(`неизвестная форма отчёта npm audit: auditReportVersion=${report.auditReportVersion}`);
  }
  const counts = report.metadata && report.metadata.vulnerabilities;
  if (!report.vulnerabilities || typeof report.vulnerabilities !== 'object' || !counts) {
    throw new BlindError('в отчёте npm audit нет vulnerabilities/metadata');
  }

  const findings = [];
  const seen = new Set();
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    for (const via of vulnerability.via || []) {
      if (typeof via !== 'object' || via === null) continue;
      if (!BLOCKING_SEVERITIES.includes(via.severity)) continue;
      const ghsa = String(via.url || '').split('/').pop();
      if (!GHSA_RE.test(ghsa)) {
        throw new BlindError(`уведомление без GHSA-идентификатора: ${via.url || JSON.stringify(via).slice(0, 200)}`);
      }
      const key = `${via.name}|${ghsa}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        ghsa,
        package: via.name,
        severity: via.severity,
        title: via.title,
        range: via.range,
        url: via.url,
      });
    }
  }

  const announced = BLOCKING_SEVERITIES.reduce((sum, level) => sum + (Number(counts[level]) || 0), 0);
  if (announced > 0 && findings.length === 0) {
    throw new BlindError(`npm насчитал high/critical: ${announced}, а разбор не нашёл ни одного уведомления — форма отчёта изменилась`);
  }
  return findings;
}

/**
 * allowlist.json: { "GHSA-…": { "package": "…", "reason": "…", "reviewed": "YYYY-MM-DD" } }.
 * Исключение без причины — приглашение вписать туда что угодно, лишь бы
 * прогон позеленел; поэтому причина и пакет обязательны, иначе слепота.
 *
 * @param {object} raw
 * @returns {Map<string, { package: string, reason: string, reviewed: string }>}
 * @throws {BlindError}
 */
export function parseAllowlist(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BlindError('allowlist.json — не объект');
  const entries = new Map();
  for (const [ghsa, entry] of Object.entries(raw)) {
    if (!GHSA_RE.test(ghsa)) throw new BlindError(`allowlist.json: «${ghsa}» — не GHSA-идентификатор`);
    if (!entry || typeof entry.package !== 'string' || !entry.package.trim()) {
      throw new BlindError(`allowlist.json: у ${ghsa} не указан пакет`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      throw new BlindError(`allowlist.json: у ${ghsa} нет причины (не короче 20 знаков)`);
    }
    if (typeof entry.reviewed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewed)) {
      throw new BlindError(`allowlist.json: у ${ghsa} нет даты разбора reviewed (YYYY-MM-DD)`);
    }
    entries.set(ghsa, { package: entry.package, reason: entry.reason.trim(), reviewed: entry.reviewed });
  }
  return entries;
}

/**
 * Исключение действует только для того пакета, для которого записано: одно и
 * то же уведомление бывает у нескольких пакетов (lodash и lodash-es).
 * Записи, которым ничего не соответствует, — «устарели»: их стоит убрать,
 * но прогон из-за них не краснеет.
 *
 * @returns {{ blocking: object[], allowed: object[], stale: string[] }}
 */
export function evaluate(findings, allowlist) {
  const blocking = [];
  const allowed = [];
  const used = new Set();
  for (const finding of findings) {
    const entry = allowlist.get(finding.ghsa);
    if (entry && entry.package === finding.package) {
      allowed.push({ ...finding, reason: entry.reason });
      used.add(finding.ghsa);
    } else {
      blocking.push(finding);
    }
  }
  const stale = [...allowlist.keys()].filter((ghsa) => !used.has(ghsa));
  return { blocking, allowed, stale };
}

/**
 * Якорь сработал, если на нём есть тревога по ANCHOR_PACKAGE. Иначе — слепота.
 *
 * @throws {BlindError}
 */
export function assertAnchorFired(anchorEvaluation) {
  const fired = anchorEvaluation.blocking.filter((f) => f.package === ANCHOR_PACKAGE);
  if (fired.length === 0) {
    throw new BlindError(`якорь не сработал: на lock-файле с ${ANCHOR_PACKAGE} 2.0.2 нет тревоги по ${ANCHOR_PACKAGE} — сторож слеп`);
  }
  return fired.length;
}

/**
 * Копирует литерал якоря во временную папку под именами, которые читает npm.
 *
 * @param {string} anchorDir - папка с anchor.package.json и anchor.lock.json
 * @returns {{ dir: string, cleanup: Function }}
 */
export function materializeAnchor(anchorDir) {
  const dir = mkdtempSync(path.join(tmpdir(), 'audit-gate-anchor-'));
  copyFileSync(path.join(anchorDir, 'anchor.package.json'), path.join(dir, 'package.json'));
  copyFileSync(path.join(anchorDir, 'anchor.lock.json'), path.join(dir, 'package-lock.json'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const line = (f) => `${f.severity.padEnd(8)} ${f.package} ${f.ghsa} — ${f.title}`;

/** Аннотация GitHub берёт только первую строку — переводы строк в пробелы. */
const oneLine = (text) => String(text).replace(/\s*\r?\n\s*/g, ' ');

/**
 * @returns {{ text: string, markdown: string, annotations: string[] }}
 */
export function formatReport({ target, anchorHits, evaluation, blind, code }) {
  const out = [];
  const md = ['### Сторож уязвимостей зависимостей backend', ''];
  const annotations = [];
  const both = (text, markdown = text) => { out.push(text); md.push(markdown); };

  if (blind) {
    both(`СТОРОЖ ОСЛЕП: ${blind}`, `**Сторож ослеп:** ${blind}`);
    annotations.push(`::error title=Сторож уязвимостей ослеп::${oneLine(blind)}`);
  } else {
    both(`Якорь: тревог по ${ANCHOR_PACKAGE} на lock-файле с 2.0.2 — ${anchorHits} (сторож видит).`);
    both(`Проверено: ${target}.`);
    both(`high/critical: вне allowlist — ${evaluation.blocking.length}, в allowlist — ${evaluation.allowed.length}.`);
    for (const f of evaluation.blocking) {
      both(`  ТРЕВОГА ${line(f)}`, `- ❌ ${line(f)}`);
      annotations.push(`::error title=${f.package} ${f.ghsa}::${f.severity}: ${oneLine(f.title)}`);
    }
    for (const f of evaluation.allowed) both(`  исключение ${line(f)} | ${f.reason}`, `- ⚪ ${line(f)} — ${f.reason}`);
    for (const ghsa of evaluation.stale) {
      both(`  устарело в allowlist: ${ghsa} — уведомления больше нет, запись можно убрать`, `- устарело в allowlist: ${ghsa}`);
      annotations.push(`::warning title=allowlist::${ghsa} больше не встречается — запись можно убрать`);
    }
  }
  const verdict = { [EXIT.OK]: 'порядок', [EXIT.ALARM]: 'тревога', [EXIT.BLIND]: 'сторож ослеп' }[code];
  both('', '');
  both(`Итог: ${verdict}`, `**Итог: ${verdict}**`);
  return { text: out.join('\n'), markdown: `${md.join('\n')}\n`, annotations };
}

/**
 * Полный прогон: якорь, затем настоящий lock-файл.
 *
 * @param {{ targetDir: string, anchorDir: string, allowlistRaw: object, audit?: Function }} params
 *   audit(dir) → отчёт npm audit; в тестах подменяется.
 * @returns {Promise<{ code: number, report: object }>}
 */
export async function runGate({ targetDir, anchorDir, allowlistRaw, audit = runNpmAudit }) {
  let anchorHits = 0;
  let evaluation = null;
  try {
    const allowlist = parseAllowlist(allowlistRaw);

    const anchor = materializeAnchor(anchorDir);
    try {
      anchorHits = assertAnchorFired(evaluate(extractFindings(await audit(anchor.dir)), allowlist));
    } finally {
      anchor.cleanup();
    }

    evaluation = evaluate(extractFindings(await audit(targetDir)), allowlist);
  } catch (error) {
    if (!(error instanceof BlindError)) throw error;
    const code = EXIT.BLIND;
    return { code, report: formatReport({ target: targetDir, blind: error.message, code }) };
  }
  const code = evaluation.blocking.length > 0 ? EXIT.ALARM : EXIT.OK;
  return { code, report: formatReport({ target: targetDir, anchorHits, evaluation, code }) };
}
