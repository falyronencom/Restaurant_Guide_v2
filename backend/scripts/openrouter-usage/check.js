/**
 * Сторож расхода OpenRouter — запуск. По пятницам его зовёт
 * .github/workflows/openrouter-usage.yml; вручную (секретов не нужно —
 * читается публичная проверка здоровья сервера):
 *
 *   cd backend
 *   node scripts/openrouter-usage/check.js
 *
 * ALARM_PERCENT — порог в процентах остатка ключа (пусто — 30);
 * HEALTH_URL — адрес проверки здоровья (пусто — прод).
 * Коды выхода: 0 — порядок (или провал отложен защитой выкатки);
 * 1 — тревога; 2 — сторож ослеп. Логика, причины и тесты — watch.js
 * (runWatch); здесь только вывод.
 */

import { appendFileSync } from 'fs';
import { EXIT, runWatch } from './watch.js';

async function main() {
  const { code, report } = await runWatch();
  console.log(report.text);
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const line of report.annotations) console.log(line);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.markdown);
  process.exitCode = code;
}

main().catch((error) => {
  // Неожиданное исключение — только имя: сообщение и стек не нужны логу публичного репозитория.
  console.error(`Сторож расхода OpenRouter упал: ${error?.name ?? 'Error'}`);
  process.exitCode = EXIT.BLIND;
});
