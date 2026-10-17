/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Сторож: задание распознавания от имени партнёра ставится только через
 * суточный предел учётки (services/ocrAllowance.js; находка 1 ревью PR #56).
 *
 * Распознавание платное и идёт одной очередью на всех. Предел держит, только
 * пока каждая дверь, которой партнёр ставит задание, идёт через него: дверь,
 * зовущая очередь напрямую, открывает учётке свежий предел — так правка
 * карточки и обходила всё до 17.10.2026. Поэтому в коде приложения очередь
 * зовут напрямую только файлы списка ниже, каждый — с причиной. Прямым
 * считается любой путь в очередь: вызов `enqueue` модели под любым именем
 * модуля, её `enqueue`, взятая по имени, и запись `INSERT INTO ocr_jobs`
 * мимо модели (ревью Phase 3.5 этой правки: сторож видел только первое).
 *
 * Что поиск не ослеп, держит якорь: тот же разбор обязан найти каждый путь в
 * образце, где он заведомо есть. Как выключить сторож, не изменив итог
 * прогона? Только дописав файл в список исключений — правка видна рядом с
 * правилом и несёт причину.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, relative, sep } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..');

/** Сама очередь: определяет enqueue и пишет строки заданий. */
const QUEUE_MODEL = 'models/ocrJobModel.js';

/** Файлы, которым можно звать очередь напрямую, — с причиной. */
const DIRECT_QUEUE_ALLOWED = new Map([
  ['services/ocrAllowance.js', 'сам предел: ставит задание после резерва'],
  ['services/adminService.js', 'одобрение модератором ставит нераспознанное меню — не просьба партнёра'],
]);

/** Двери партнёра — файлы, которые ставят задание через предел. */
const PARTNER_DOORS = [
  'services/establishmentService.js', // создание и правка карточки
  'services/mediaService.js', // загрузка в медиа карточки
  'services/partnerMenuItemService.js', // перезапуск партнёром
];

const MODEL_IMPORT = /import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+['"][^'"]*models\/ocrJobModel\.js['"]/g;

/** Пути в очередь мимо предела, найденные в исходнике. */
const directQueuePaths = (source) => {
  const paths = [];
  for (const [, namespace, names] of source.matchAll(MODEL_IMPORT)) {
    if (namespace) {
      paths.push(...(source.match(new RegExp(`\\b${namespace}\\s*\\.\\s*enqueue\\s*\\(`, 'g')) ?? []));
    }
    if (names && /\benqueue\b/.test(names)) {
      paths.push(`import { ${names.trim()} }`);
    }
  }
  paths.push(...(source.match(/INSERT\s+INTO\s+ocr_jobs\b/gi) ?? []));
  return paths;
};

const allowanceCalls = (source) => source.match(/\benqueueWithinDailyAllowance\s*\(/g) ?? [];

/** Исходники приложения: всё под src, кроме тестов. */
const appSources = (dir = SRC) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === 'tests' ? [] : appSources(path);
  return name.endsWith('.js') ? [relative(SRC, path).split(sep).join('/')] : [];
});

const read = (file) => readFileSync(join(SRC, file), 'utf8');

describe('Задание распознавания от имени партнёра — только через суточный предел', () => {
  test('якорь: разбор видит каждый путь в очередь и не путает его с пределом и с упоминанием', () => {
    const sample = [
      "import * as Jobs from '../models/ocrJobModel.js';",
      'Jobs.enqueue({ establishmentId, mediaId });',
      "import { findActiveJob, enqueue as queueRecognition } from '../../models/ocrJobModel.js';",
      "await pool.query('INSERT INTO ocr_jobs (establishment_id, media_id) VALUES ($1, $2)', [id, mediaId]);",
      "import * as OcrJobModel from '../models/ocrJobModel.js';",
      'OcrJobModel\n  .enqueue({ establishmentId, mediaId })',
      'enqueueWithinDailyAllowance({ userId, establishmentId, mediaId })',
      '// left alone it makes OcrJobModel.enqueue treat the media as active',
    ].join('\n');

    expect(directQueuePaths(sample)).toHaveLength(4);
    expect(allowanceCalls(sample)).toHaveLength(1);
  });

  test('путь в очередь мимо предела — только в файлах списка', () => {
    const files = appSources();
    // Сторож перебора: исходники нашлись (их больше сотни на 17.10.2026).
    expect(files.length).toBeGreaterThan(100);

    const direct = files.filter((file) => file !== QUEUE_MODEL && directQueuePaths(read(file)).length > 0);
    expect(direct.sort()).toEqual([...DIRECT_QUEUE_ALLOWED.keys()].sort());
  });

  test('двери партнёра ставят задание через предел', () => {
    const callers = appSources().filter((file) => file !== 'services/ocrAllowance.js' && allowanceCalls(read(file)).length > 0);
    expect(callers.sort()).toEqual([...PARTNER_DOORS].sort());
  });
});
