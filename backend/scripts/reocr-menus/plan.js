/**
 * Перераспознавание меню — отбор файлов. Запуск, бэкап и постановка задач —
 * ../reocr-menus.js.
 *
 * Обработчик задачи (ocrService.processJob → menuItemModel.replaceForMedia)
 * удаляет все позиции файла и вставляет новые: правка человека на этом файле
 * пропала бы. Поэтому файл, где хоть одна позиция тронута человеком, без
 * --include-touched пропускается. Позиция тронута, если она:
 * - скрыта модератором сейчас — «скрыто модератором»;
 * - изменена после вставки (updated_at позже created_at больше чем на 1 с),
 *   и последнее изменение — показ после скрытия — «показано после скрытия»:
 *   партнёр мог править до скрытия, а показ сдвинул updated_at поверх;
 * - изменена после вставки, и записи журнала, которая объяснила бы
 *   изменение, нет — «правка без записи в журнале — вероятно, партнёр»:
 *   правку партнёра журнал не пишет.
 *
 * Снятие флага правкой не считается (решение Координатора 29.09.2026): если
 * последнее изменение позиции — снятие флага, файл перераспознаётся. Правило
 * держится на ПРИНЦИПЕ: непустой sanity_flag пишут только вставки
 * распознавания (sanityChecker → replaceForMedia), каждая правка содержимого
 * существующей позиции его обнуляет (сегодня это правка партнёра), и заново
 * его никто не ставит. Флаг живёт только на нетронутом выводе распознавания;
 * значит, если последним на позиции сняли флаг, её содержимое — этот вывод,
 * и перераспознать её безопасно. Принцип сторожит
 * integration/reocr-menus-script.test.js: если страж покраснел, пересматривать
 * надо это правило, а не страж.
 *
 * Что было последним изменением, говорит последняя запись журнала по позиции,
 * сделанная не раньше чем за 1 с до updated_at. «Снять флаг» в панели пишет
 * журнал отдельным запросом после UPDATE — запись позже updated_at на
 * миллисекунды; скрипт dismiss-menu-flags пишет снятие и журнал одним
 * запросом — метки равны. Правка партнёра после снятия сдвигает updated_at
 * дальше, и позиция остаётся тронутой. Исключения того же рода — совпадения
 * в пределах секунды, которых не ждём: правка сразу после снятия; и гонка
 * панели — «Снять флаг» читает позицию, проверяет флаг и пишет UPDATE без
 * условия на флаг, так что правка партнёра, успевшая между ними, пройдёт как
 * чистая (скрипт снятия от этого защищён: его UPDATE перепроверяет флаг).
 * Обе метки пишет NOW() базы, и сравниваются они между собой: пояс процесса,
 * который читает отчёт, роли не играет.
 *
 * После перераспознавания снятый флаг может встать снова: проверка цен пройдёт
 * заново. Отчёт называет, сколько таких позиций уходит в работу.
 */

/** Категории правок людей — строки отчёта (решение Координатора 29.09.2026). */
export const TOUCH_LABELS = Object.freeze({
  hidden: 'скрыто модератором',
  unhidden: 'показано после скрытия',
  unlogged: 'правка без записи в журнале — вероятно, партнёр',
});

export const TOUCHED_REASON = 'есть правки людей (--include-touched)';

// Mirrors requeue-menu-ocr.js / config/cloudinary.js.
const fileExtension = (url) => {
  const base = String(url || '').split('?')[0];
  const seg = base.slice(base.lastIndexOf('/') + 1);
  const dot = seg.lastIndexOf('.');
  return dot === -1 ? '' : seg.slice(dot + 1).toLowerCase();
};
const OCRABLE_EXTENSIONS = ['', 'pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'jfif'];

/**
 * Файлы меню заведений нужных статусов; у каждого — число позиций по
 * категориям (item.trace: hidden / unhidden / unlogged — правки людей,
 * flag_dismissed — последним сняли флаг, NULL — позицию не меняли) и
 * признак задачи в очереди.
 */
const MEDIA_SQL = `
  WITH item AS (
    SELECT mi.media_id,
           CASE
             WHEN mi.is_hidden_by_admin THEN 'hidden'
             WHEN mi.updated_at <= mi.created_at + interval '1 second' THEN NULL
             ELSE CASE (
               SELECT a.action
                 FROM audit_log a
                WHERE a.entity_type = 'menu_item'
                  AND a.entity_id = mi.id
                  AND a.created_at >= mi.updated_at - interval '1 second'
                ORDER BY a.created_at DESC
                LIMIT 1)
               WHEN 'dismiss_sanity_flag' THEN 'flag_dismissed'
               WHEN 'unhide_menu_item' THEN 'unhidden'
               ELSE 'unlogged'
             END
           END AS trace
      FROM menu_items mi
  )
  SELECT m.id AS media_id, m.establishment_id, m.url, m.file_type, e.name, e.status,
         COUNT(item.media_id)::int AS items,
         (COUNT(*) FILTER (WHERE item.trace = 'hidden'))::int AS hidden,
         (COUNT(*) FILTER (WHERE item.trace = 'unhidden'))::int AS unhidden,
         (COUNT(*) FILTER (WHERE item.trace = 'unlogged'))::int AS unlogged,
         (COUNT(*) FILTER (WHERE item.trace = 'flag_dismissed'))::int AS flag_dismissed,
         EXISTS (SELECT 1 FROM ocr_jobs j WHERE j.media_id = m.id
                  AND j.status IN ('pending', 'processing')) AS in_flight
    FROM establishment_media m
    JOIN establishments e ON e.id = m.establishment_id
    LEFT JOIN item ON item.media_id = m.id
   WHERE m.type = 'menu' AND e.status = ANY($1)
   GROUP BY m.id, e.id
   ORDER BY e.name, m.position`;

/** Позиций с правками людей в файле. */
export const touchedItems = (row) => row.hidden + row.unhidden + row.unlogged;

const skipReason = (row, includeTouched) => {
  if (!OCRABLE_EXTENSIONS.includes(fileExtension(row.url))) return 'формат не читается';
  if (row.in_flight) return 'задача уже в очереди';
  if (touchedItems(row) > 0 && !includeTouched) return TOUCHED_REASON;
  return null;
};

/**
 * Какие файлы меню уйдут в перераспознавание. Только чтение.
 *
 * @param {Object} client - pg Client или соединение пула
 * @param {Object} options
 * @param {string[]} options.statuses - статусы заведений
 * @param {boolean} [options.includeTouched] - брать и файлы с правками людей
 * @returns {Promise<{targets: Object[], skipped: Object[]}>} строки файлов со
 *   счётчиками позиций (items, hidden, unhidden, unlogged, flag_dismissed);
 *   у пропущенных ещё reason
 */
export const planReocr = async (client, { statuses, includeTouched = false }) => {
  const { rows } = await client.query(MEDIA_SQL, [statuses]);
  const targets = [];
  const skipped = [];
  for (const row of rows) {
    const reason = skipReason(row, includeTouched);
    if (reason) skipped.push({ ...row, reason });
    else targets.push(row);
  }
  return { targets, skipped };
};

const fileLine = (row) => `${row.name} [${row.status}]  media=${row.media_id}  items=${row.items}`;

/** Правки людей в файле — строка на категорию, только непустые. */
const touchLines = (row) => Object.entries(TOUCH_LABELS)
  .filter(([key]) => row[key] > 0)
  .map(([key, label]) => `          ${label}: ${row[key]}`);

/** Отчёт сухого прогона. */
export const formatPlan = ({ targets, skipped }) => {
  const lines = [];
  for (const row of skipped) {
    lines.push(`✗ skip  ${fileLine(row)}  — ${row.reason}`);
    if (row.reason === TOUCHED_REASON) lines.push(...touchLines(row));
  }
  // Только с --include-touched: эти правки заменит новый вывод (бэкап их хранит).
  for (const row of targets.filter((t) => touchedItems(t) > 0)) {
    lines.push(`⚠ правки людей будут заменены  ${fileLine(row)}`);
    lines.push(...touchLines(row));
  }

  const byCard = new Map();
  for (const t of targets) {
    const c = byCard.get(t.name) || { status: t.status, media: 0, items: 0 };
    c.media += 1;
    c.items += t.items;
    byCard.set(t.name, c);
  }
  lines.push('', 'К перераспознаванию:');
  for (const [name, c] of byCard) lines.push(`  ${name} [${c.status}] — файлов ${c.media}, позиций сейчас ${c.items}`);
  lines.push('', `Итого: ${targets.length} файлов меню, ${byCard.size} карточек, `
    + `позиций будет заменено ${targets.reduce((a, t) => a + t.items, 0)}.`);

  const withDismissed = targets.filter((t) => t.flag_dismissed > 0);
  if (withDismissed.length > 0) {
    lines.push(`Снятые флаги правкой не считаются: позиций со снятым флагом — `
      + `${withDismissed.reduce((a, t) => a + t.flag_dismissed, 0)}, файлов — ${withDismissed.length}. `
      + 'Проверка цен пройдёт заново, и флаг может встать снова.');
  }
  return lines.join('\n');
};
