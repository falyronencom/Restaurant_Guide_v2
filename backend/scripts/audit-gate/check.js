/**
 * Сторож уязвимостей рабочих зависимостей backend — запуск:
 *
 *   cd backend
 *   node scripts/audit-gate/check.js                 # lock-файл backend
 *   node scripts/audit-gate/check.js --dir=<папка>   # другой package-lock.json
 *
 * Сначала якорь (anchor/ — lock-файл с multer 2.0.2: тревога обязана
 * подняться), затем проверяемый lock-файл. Исключения — allowlist.json,
 * у каждого причина. Нужна сеть: npm audit спрашивает базу реестра npm.
 *
 * Коды выхода: 0 — порядок; 1 — тревога (high/critical вне allowlist);
 * 2 — сторож ослеп (сеть, форма отчёта, allowlist, якорь не сработал).
 * Логика и причины — gate.js.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, runGate } from './gate.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function dirFlag(argv) {
  const arg = argv.find((a) => a.startsWith('--dir='));
  return arg ? path.resolve(arg.slice('--dir='.length)) : path.resolve(here, '..', '..');
}

async function main() {
  const { code, report } = await runGate({
    targetDir: dirFlag(process.argv.slice(2)),
    anchorDir: path.join(here, 'anchor'),
    allowlistRaw: JSON.parse(readFileSync(path.join(here, 'allowlist.json'), 'utf8')),
  });
  console.log(report.text);
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const annotation of report.annotations) console.log(annotation);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.markdown);
  process.exitCode = code;
}

main().catch((error) => {
  console.error('Сторож уязвимостей упал:', error);
  process.exitCode = EXIT.BLIND;
});
