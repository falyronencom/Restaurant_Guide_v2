/**
 * Сторож расхода Cloudinary — запуск. По средам его зовёт
 * .github/workflows/cloudinary-usage.yml; вручную (ключ — отдельный ключ
 * сторожа, не ключ прода):
 *
 *   cd backend
 *   CLOUDINARY_WATCH_CLOUD_NAME=… CLOUDINARY_WATCH_API_KEY=… CLOUDINARY_WATCH_API_SECRET=… \
 *     node scripts/cloudinary-usage/check.js
 *
 * ALARM_PERCENT — порог в процентах кредитов тарифа (пусто — 70).
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
  // Неожиданное исключение — только имя и сообщение: стек и поля объекта
  // ошибки fetch могли бы унести заголовки запроса.
  console.error(`Сторож расхода Cloudinary упал: ${error?.name ?? 'Error'}`);
  process.exitCode = EXIT.BLIND;
});
