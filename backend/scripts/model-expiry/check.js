/**
 * Сторож сроков моделей OpenRouter — запуск. По понедельникам его зовёт
 * .github/workflows/model-expiry.yml; вручную:
 *
 *   cd backend
 *   node scripts/model-expiry/check.js                                  # модели прода
 *   node scripts/model-expiry/check.js --models=google/gemini-2.5-flash # и ещё модели
 *
 * Модели прода = умолчания config/openrouter.js (getConfig — умный поиск,
 * getOcrConfig — распознавание меню) + зеркало переменных Railway
 * (railway-models.js) + дополнительные из --models= или EXTRA_MODELS (через
 * запятую). Ключ OpenRouter не нужен и не отправляется: каталог публичный.
 *
 * Коды выхода: 0 — порядок (или провал отложен защитой выкатки);
 * 1 — тревога; 2 — сторож ослеп. Логика, причины и тесты — watch.js
 * (runWatch); здесь только вывод.
 */

import { appendFileSync } from 'fs';
import { getConfig, getOcrConfig } from '../../src/config/openrouter.js';
import { RAILWAY_MODELS } from './railway-models.js';
import { EXIT, runWatch } from './watch.js';

async function main() {
  const { code, report } = await runWatch({
    config: { getConfig, getOcrConfig },
    railway: RAILWAY_MODELS,
    argv: process.argv.slice(2),
  });
  console.log(report.text);
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const line of report.annotations) console.log(line);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.markdown);
  process.exitCode = code;
}

main().catch((error) => {
  console.error('Сторож сроков упал:', error);
  process.exitCode = EXIT.BLIND;
});
