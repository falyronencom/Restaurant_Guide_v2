/**
 * Unit — сторож уязвимостей рабочих зависимостей (scripts/audit-gate/gate.js).
 *
 * Зачем (06.10.2026, пункт #21 внешнего обзора): multer 2.0.2 с шестью high
 * пролежал в lock-файле с марта по октябрь. Сторож обязан краснеть на
 * high/critical вне allowlist; краснеть, когда ослеп (npm audit не ответил,
 * форма отчёта уехала, allowlist без причин, якорь не сработал) — иначе его
 * зелёный ничего не значит.
 *
 * Сеть не вызывается: отчёты npm audit — литералы в форме auditReportVersion 2
 * (поля и вложенность сняты с настоящего `npm audit --omit=dev --json`
 * 06.10.2026), запуск npm подменяется аргументом.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  ANCHOR_PACKAGE,
  BlindError,
  EXIT,
  assertAnchorFired,
  evaluate,
  extractFindings,
  parseAllowlist,
  runGate,
  runNpmAudit,
} from '../../../scripts/audit-gate/gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATE_DIR = resolve(__dirname, '../../../scripts/audit-gate');

const advisory = (name, ghsa, severity, title = `${name} advisory`) => ({
  source: 1,
  name,
  dependency: name,
  title,
  url: `https://github.com/advisories/${ghsa}`,
  severity,
  range: '<9.9.9',
});

const report = (vulnerabilities, counts) => ({
  auditReportVersion: 2,
  vulnerabilities,
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...counts } },
});

// multer 2.0.2 — так его показывает npm audit: свои уведомления в via объектами.
const MULTER = {
  multer: {
    name: 'multer',
    severity: 'high',
    isDirect: true,
    via: [
      advisory('multer', 'GHSA-wc9g-mqfw-jrwm', 'high'),
      advisory('multer', 'GHSA-535w-7cp7-47q4', 'high'),
      advisory('multer', 'GHSA-qvfw-j98x-7q72', 'low'),
    ],
    nodes: ['node_modules/multer'],
  },
};

// Цепочка установки argon2: уведомления у tar, выше — только имена строками.
const TAR_CHAIN = {
  tar: {
    name: 'tar',
    severity: 'critical',
    via: [
      advisory('tar', 'GHSA-23hp-3jrh-7fpw', 'critical'),
      advisory('tar', 'GHSA-34x7-hfp2-rc4v', 'high'),
      advisory('tar', 'GHSA-vmf3-w455-68vh', 'moderate'),
    ],
    nodes: ['node_modules/tar'],
  },
  '@mapbox/node-pre-gyp': { name: '@mapbox/node-pre-gyp', severity: 'high', via: ['tar'], nodes: ['node_modules/@mapbox/node-pre-gyp'] },
  argon2: { name: 'argon2', severity: 'high', isDirect: true, via: ['@mapbox/node-pre-gyp'], nodes: ['node_modules/argon2'] },
};

const TAR_ALLOW = {
  'GHSA-23hp-3jrh-7fpw': { package: 'tar', reason: 'только установка argon2, сервер tar не грузит', reviewed: '2026-10-06' },
  'GHSA-34x7-hfp2-rc4v': { package: 'tar', reason: 'только установка argon2, сервер tar не грузит', reviewed: '2026-10-06' },
};

describe('extractFindings', () => {
  test('берёт high и critical из via-объектов, moderate/low и транзитивные строки — нет', () => {
    const findings = extractFindings(report({ ...MULTER, ...TAR_CHAIN }, { low: 1, moderate: 1, high: 4, critical: 1 }));
    expect(findings.map((f) => `${f.package} ${f.ghsa} ${f.severity}`).sort()).toEqual([
      'multer GHSA-535w-7cp7-47q4 high',
      'multer GHSA-wc9g-mqfw-jrwm high',
      'tar GHSA-23hp-3jrh-7fpw critical',
      'tar GHSA-34x7-hfp2-rc4v high',
    ]);
  });

  test('ослеп: npm насчитал high, а уведомлений в via нет (форма отчёта уехала)', () => {
    const drifted = report({ multer: { ...MULTER.multer, via: ['something'] } }, { high: 1 });
    expect(() => extractFindings(drifted)).toThrow(BlindError);
  });

  test('ослеп: другая версия отчёта или нет vulnerabilities', () => {
    expect(() => extractFindings({ ...report(MULTER, { high: 1 }), auditReportVersion: 1 })).toThrow(BlindError);
    expect(() => extractFindings({ auditReportVersion: 2, metadata: { vulnerabilities: {} } })).toThrow(BlindError);
  });

  test('чистый отчёт — пусто, не слепота', () => {
    expect(extractFindings(report({}, {}))).toEqual([]);
  });
});

describe('parseAllowlist', () => {
  test('исключение без причины, пакета или даты разбора — слепота, не «разрешено»', () => {
    const base = TAR_ALLOW['GHSA-23hp-3jrh-7fpw'];
    expect(() => parseAllowlist({ 'GHSA-23hp-3jrh-7fpw': { ...base, reason: '' } })).toThrow(BlindError);
    expect(() => parseAllowlist({ 'GHSA-23hp-3jrh-7fpw': { ...base, reason: 'временно' } })).toThrow(BlindError);
    expect(() => parseAllowlist({ 'GHSA-23hp-3jrh-7fpw': { ...base, package: '' } })).toThrow(BlindError);
    expect(() => parseAllowlist({ 'GHSA-23hp-3jrh-7fpw': { ...base, reviewed: 'вчера' } })).toThrow(BlindError);
    expect(() => parseAllowlist({ 'CVE-2026-1': base })).toThrow(BlindError);
  });

  test('allowlist.json в репозитории разбирается', () => {
    const raw = JSON.parse(readFileSync(resolve(GATE_DIR, 'allowlist.json'), 'utf8'));
    expect(() => parseAllowlist(raw)).not.toThrow();
  });
});

describe('evaluate', () => {
  const findings = extractFindings(report({ ...MULTER, ...TAR_CHAIN }, { high: 4, critical: 1 }));

  test('записанное исключение снимает тревогу только у своего пакета', () => {
    const { blocking, allowed } = evaluate(findings, parseAllowlist(TAR_ALLOW));
    expect(allowed.map((f) => f.ghsa).sort()).toEqual(['GHSA-23hp-3jrh-7fpw', 'GHSA-34x7-hfp2-rc4v']);
    expect(blocking.map((f) => f.package)).toEqual(['multer', 'multer']);
  });

  test('то же уведомление у другого пакета не снимается', () => {
    const wrongPackage = { 'GHSA-wc9g-mqfw-jrwm': { package: 'busboy', reason: 'записано не для того пакета', reviewed: '2026-10-06' } };
    const { blocking, stale } = evaluate(findings, parseAllowlist(wrongPackage));
    expect(blocking.map((f) => f.ghsa)).toContain('GHSA-wc9g-mqfw-jrwm');
    expect(stale).toEqual(['GHSA-wc9g-mqfw-jrwm']);
  });

  test('запись, которой ничего не соответствует, — устарела', () => {
    const { stale } = evaluate([], parseAllowlist(TAR_ALLOW));
    expect(stale.sort()).toEqual(['GHSA-23hp-3jrh-7fpw', 'GHSA-34x7-hfp2-rc4v']);
  });
});

describe('якорь', () => {
  test('сработал — тревога по multer есть', () => {
    const hits = assertAnchorFired(evaluate(extractFindings(report(MULTER, { high: 2, low: 1 })), new Map()));
    expect(ANCHOR_PACKAGE).toBe('multer');
    expect(hits).toBe(2);
  });

  test('не сработал — слепота', () => {
    expect(() => assertAnchorFired({ blocking: [], allowed: [], stale: [] })).toThrow(BlindError);
  });

  test('литерал якоря: multer 2.0.2, имена файлов — не манифест для графа зависимостей', () => {
    const lock = JSON.parse(readFileSync(resolve(GATE_DIR, 'anchor/anchor.lock.json'), 'utf8'));
    const pkg = JSON.parse(readFileSync(resolve(GATE_DIR, 'anchor/anchor.package.json'), 'utf8'));
    expect(lock.packages['node_modules/multer'].version).toBe('2.0.2');
    expect(pkg.dependencies).toEqual({ multer: '2.0.2' });
  });
});

describe('runNpmAudit', () => {
  test('npm с кодом 1 и JSON отчёта — это ответ, не сбой', async () => {
    const exec = async () => ({ stdout: JSON.stringify(report(MULTER, { high: 2 })), stderr: '', spawnError: null });
    expect((await runNpmAudit('x', { exec })).auditReportVersion).toBe(2);
  });

  // Ответ npm 10.2.4 при недоступном реестре, снят 06.10.2026 (код выхода 1 —
  // тот же, что при найденных уязвимостях): не отчёт, а одно поле message.
  test('реестр не ответил: вместо отчёта {message} — повторы, затем слепота с причиной', async () => {
    let calls = 0;
    const exec = async () => {
      calls += 1;
      return {
        stdout: JSON.stringify({
          message: 'request to http://127.0.0.1:9/-/npm/v1/security/audits/quick failed, reason: connect ECONNREFUSED 127.0.0.1:9',
        }),
        stderr: '',
        spawnError: null,
      };
    };
    await expect(runNpmAudit('x', { exec, attempts: 3, delaysMs: [0] })).rejects.toThrow(/не вернул отчёт: request to .* ECONNREFUSED/);
    expect(calls).toBe(3);
  });

  // Ответ npm 10.2.4 без lock-файла, снят 06.10.2026.
  test('npm отказался ({error}, как без lock-файла) — слепота с кодом отказа', async () => {
    let calls = 0;
    const exec = async () => {
      calls += 1;
      return {
        stdout: JSON.stringify({ error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.' } }),
        stderr: '',
        spawnError: null,
      };
    };
    await expect(runNpmAudit('x', { exec, attempts: 2, delaysMs: [0] })).rejects.toThrow(/ENOLOCK This command requires an existing lockfile/);
    expect(calls).toBe(2);
  });

  test('ответ не JSON — слепота', async () => {
    const exec = async () => ({ stdout: 'npm ERR! something', stderr: 'boom', spawnError: null });
    await expect(runNpmAudit('x', { exec, attempts: 1 })).rejects.toThrow(BlindError);
  });
});

describe('runGate', () => {
  const TARGET = '/target-lockfile-dir';
  const gate = (target, { anchor = report(MULTER, { high: 2 }), allowlistRaw = TAR_ALLOW } = {}) => runGate({
    targetDir: TARGET,
    anchorDir: resolve(GATE_DIR, 'anchor'),
    allowlistRaw,
    audit: async (dir) => (dir === TARGET ? target : anchor),
  });

  test('порядок: якорь сработал, у проверяемого всё high/critical в allowlist', async () => {
    const { code, report: out } = await gate(report(TAR_CHAIN, { high: 2, critical: 1 }));
    expect(code).toBe(EXIT.OK);
    expect(out.text).toContain('Итог: порядок');
  });

  test('тревога: уведомление вне allowlist (lock-файл с multer 2.0.2)', async () => {
    const { code, report: out } = await gate(report({ ...MULTER, ...TAR_CHAIN }, { high: 4, critical: 1 }));
    expect(code).toBe(EXIT.ALARM);
    expect(out.text).toContain('ТРЕВОГА high     multer GHSA-wc9g-mqfw-jrwm');
  });

  test('слепота: якорь без тревоги — красный даже при чистом проверяемом', async () => {
    const { code } = await gate(report({}, {}), { anchor: report({}, {}) });
    expect(code).toBe(EXIT.BLIND);
  });

  test('слепота: испорченный allowlist', async () => {
    const { code } = await gate(report({}, {}), { allowlistRaw: { 'GHSA-23hp-3jrh-7fpw': { package: 'tar' } } });
    expect(code).toBe(EXIT.BLIND);
  });

  test('аннотация для Actions — одна строка, даже если причина многострочная', async () => {
    const { code, report: out } = await runGate({
      targetDir: TARGET,
      anchorDir: resolve(GATE_DIR, 'anchor'),
      allowlistRaw: TAR_ALLOW,
      audit: async () => { throw new BlindError('npm не запустился: Command failed\nnpm ERR! code E500'); },
    });
    expect(code).toBe(EXIT.BLIND);
    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0]).toBe('::error title=Сторож уязвимостей ослеп::npm не запустился: Command failed npm ERR! code E500');
  });
});
