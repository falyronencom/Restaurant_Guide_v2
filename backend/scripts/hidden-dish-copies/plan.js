/**
 * Видимые копии скрытых блюд — логика. Запуск и печать — index.js.
 *
 * Зачем (слово Координатора 29.10.2026, п. 3а и П4а). С правки «скрытое
 * модератором блюдо остаётся скрытым во всех файлах меню заведения» «Скрыть»
 * доходит до одноимённых позиций других файлов, а новый файл приходит с
 * блюдом скрытым. До правки так не было: партнёр мог загрузить другое фото
 * или PDF того же меню, и скрытое блюдо возвращалось к гостям. Такие копии,
 * если они уже есть, правка сама не трогает. Скрипт их находит (сухой прогон
 * — на восстановленном снимке прода или на проде) и по слову Координатора
 * скрывает тем же правилом.
 *
 * Правило — то же, что у кода (не приближённый SQL): то же блюдо — одно
 * название по utils/menuItemName.js dishKey (регистр, пробелы, кавычки, тире,
 * ё/е), в любом разделе и с любой ценой. Видимая позиция — копия скрытого
 * блюда, если:
 *   - в её собственном файле скрытой позиции этого блюда нет — внутри одного
 *     файла раздел решает первым («Чай» в «Завтраках» рядом со скрытым «Чаем»
 *     в «Напитках» — решение модератора; повторное распознавание его держит —
 *     menuItemModel ownSectionDecision), и скрипт его не трогает;
 *   - и блюдо скрыто в ДРУГОМ файле того же заведения (так «Скрыть» действует
 *     теперь в момент нажатия — MenuItemModel.hideDish) или его помнит память
 *     заведения (миграция 038).
 *
 * Запись делает то же, что «Скрыть» на копии: is_hidden_by_admin = TRUE,
 * hidden_reason — причина скрытого блюда, updated_at = NOW(); на каждую
 * позицию — запись журнала 'hide_menu_item' (автор — скрипт оператора,
 * user_agent — AUDIT_USER_AGENT; в журнале панели — «Позиция скрыта
 * автоматически — это блюдо модератор скрыл раньше»); блюдо попадает в память
 * заведения, если миграция 038 применена.
 *
 * Защиты: запись требует N и отпечаток списка из сухого прогона; список
 * пересчитывается внутри транзакции под замками заведений (те же, что берут
 * запись распознавания и «Скрыть»), и если он не совпал — откат.
 *
 * Чего скрипт не делает: не сбрасывает кэш счётчиков работающего сервера —
 * скрытые позиции бейдж не считает, вкладка «Скрытые» покажет их после
 * обновления страницы; страница карточки на сайте живёт до часа.
 */

import { createHash } from 'crypto';
import { dishKey } from '../../src/utils/menuItemName.js';

/** Подпись скрипта в журнале действий (user_agent): панель называет автора «Скрипт оператора». */
export const AUDIT_USER_AGENT = 'scripts/hidden-dish-copies';

const FINGERPRINT_RE = /^[0-9a-f]{10}$/;

/** Отказ: условие не выполнено, в базе ничего не изменено. */
export class Refusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'Refusal';
  }
}

/**
 * Отпечаток состава списка: сухой прогон печатает его, запись сверяет.
 * Порядок id не важен — сортировка внутри.
 */
export const fingerprint = (ids) => createHash('sha256')
  .update([...ids].sort().join(','))
  .digest('hex')
  .slice(0, 10);

const hiddenNamesTableExists = async (client) => {
  const { rows } = await client.query(
    "SELECT to_regclass('public.menu_item_hidden_names') IS NOT NULL AS present",
  );
  return rows[0]?.present === true;
};

/**
 * Найти видимые копии скрытых блюд. Только чтение.
 *
 * @param {Object} client - Подключённый клиент pg
 * @returns {Promise<{copies: Object[], total: number, fingerprint: string, withMemory: boolean}>}
 *   copies — по одной на видимую позицию: заведение, файл, название, цена,
 *   раздел, причина, откуда решение ('file' | 'memory') и тот же ли раздел
 */
export const findCopies = async (client) => {
  const withMemory = await hiddenNamesTableExists(client);

  const venuesSql = withMemory
    ? `SELECT establishment_id FROM menu_items WHERE is_hidden_by_admin = TRUE
       UNION SELECT establishment_id FROM menu_item_hidden_names`
    : 'SELECT establishment_id FROM menu_items WHERE is_hidden_by_admin = TRUE';

  const { rows } = await client.query(
    `SELECT mi.id, mi.establishment_id, mi.media_id, mi.item_name, mi.price_byn,
            mi.category_raw, mi.is_hidden_by_admin, mi.hidden_reason,
            e.name AS establishment_name, e.city AS establishment_city,
            e.status AS establishment_status
       FROM menu_items mi
       JOIN establishments e ON e.id = mi.establishment_id
      WHERE mi.establishment_id IN (${venuesSql})
      ORDER BY e.name, mi.establishment_id, mi.created_at, mi.position, mi.id`,
  );
  const remembered = withMemory
    ? (await client.query(
      `SELECT establishment_id, item_name, category_raw, hidden_reason
         FROM menu_item_hidden_names
        ORDER BY created_at, id`,
    )).rows
    : [];

  const byVenue = new Map();
  const venueOf = (id) => {
    if (!byVenue.has(id)) byVenue.set(id, { rows: [], remembered: [] });
    return byVenue.get(id);
  };
  for (const row of rows) venueOf(row.establishment_id).rows.push(row);
  for (const entry of remembered) venueOf(entry.establishment_id).remembered.push(entry);

  const copies = [];
  for (const { rows: venueRows, remembered: venueMemory } of byVenue.values()) {
    const hidden = venueRows.filter(r => r.is_hidden_by_admin === true);
    for (const row of venueRows) {
      if (row.is_hidden_by_admin === true) continue;
      const key = dishKey(row.item_name);

      // The row's own file hides this dish (in another section): the
      // moderator's decision inside the file — a re-read keeps it shown
      // (menuItemModel ownSectionDecision), and so does the script.
      if (hidden.some(h => h.media_id === row.media_id && dishKey(h.item_name) === key)) continue;

      let source = hidden.find(h => h.media_id !== row.media_id && dishKey(h.item_name) === key);
      let from = 'file';
      if (!source) {
        source = venueMemory.find(m => dishKey(m.item_name) === key);
        from = 'memory';
      }
      if (!source) continue;

      copies.push({
        id: row.id,
        establishmentId: row.establishment_id,
        establishmentName: row.establishment_name,
        establishmentCity: row.establishment_city,
        establishmentStatus: row.establishment_status,
        mediaId: row.media_id,
        itemName: row.item_name,
        priceByn: row.price_byn,
        categoryRaw: row.category_raw,
        reason: source.hidden_reason ?? null,
        from,
        sameSection: dishKey(row.category_raw) === dishKey(source.category_raw),
        sourceItemName: source.item_name,
        sourceCategoryRaw: source.category_raw,
      });
    }
  }

  return {
    copies,
    total: copies.length,
    fingerprint: fingerprint(copies.map(c => c.id)),
    withMemory,
  };
};

const HIDE_SQL = `
  WITH hidden AS (
    UPDATE menu_items
       SET is_hidden_by_admin = TRUE, hidden_reason = $2, updated_at = NOW()
     WHERE id = $1 AND is_hidden_by_admin = FALSE
    RETURNING id, item_name, establishment_id
  )
  INSERT INTO audit_log (
    user_id, action, entity_type, entity_id, old_data, new_data, ip_address, user_agent
  )
  -- Название позиции и заведения — снимком, как у писателей панели
  -- (auditLogModel.createAuditLog): журнал называет позицию словами.
  SELECT NULL, 'hide_menu_item', 'menu_item', h.id,
         jsonb_strip_nulls(jsonb_build_object(
           'item_name', h.item_name,
           'establishment_name', e.name,
           'establishment_city', e.city
         )) || jsonb_build_object('is_hidden_by_admin', FALSE),
         jsonb_build_object('is_hidden_by_admin', TRUE, 'reason', $2::text),
         NULL, $3
    FROM hidden h
    LEFT JOIN establishments e ON e.id = h.establishment_id
  RETURNING entity_id`;

const REMEMBER_SQL = `
  INSERT INTO menu_item_hidden_names (establishment_id, item_name, category_raw, hidden_reason)
  SELECT $1::uuid, $2::varchar, $3::varchar, $4::text
  WHERE NOT EXISTS (
    SELECT 1 FROM menu_item_hidden_names
    WHERE establishment_id = $1::uuid
      AND item_name = $2::varchar
      AND category_raw IS NOT DISTINCT FROM $3::varchar
      AND hidden_reason IS NOT DISTINCT FROM $4::text
  )`;

/**
 * Запись: скрывает копии, если скрывается ровно то, что показал сухой
 * прогон: expect позиций с отпечатком plan. Одна транзакция под замками
 * заведений; при отказе или сбое — откат.
 *
 * @returns {Promise<{hidden: string[], withMemory: boolean}>}
 */
export const hideCopies = async (client, { expect, plan }) => {
  if (!Number.isInteger(expect) || expect < 1) {
    throw new Refusal('Запись требует --expect=<N>: число позиций из сухого прогона, подтверждённое человеком.');
  }
  if (typeof plan !== 'string' || !FINGERPRINT_RE.test(plan)) {
    throw new Refusal('Запись требует --plan=<отпечаток> из того же сухого прогона.');
  }

  await client.query('BEGIN');
  try {
    // Замки заведений — те же, что берут запись распознавания и «Скрыть»
    // (menuItemModel lockEstablishmentMenu): список не поменяется под рукой.
    // По порядку id — два писателя не возьмут их навстречу друг другу.
    const before = await findCopies(client);
    const venues = [...new Set(before.copies.map(c => c.establishmentId))].sort();
    for (const id of venues) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`menu_items:${id}`]);
    }

    const { copies, withMemory } = await findCopies(client);
    if (copies.length !== expect) {
      throw new Refusal(
        `Копий сейчас ${copies.length}, подтверждено ${expect} — ничего не изменено. `
        + 'Меню изменилось после сухого прогона: повторите его.',
      );
    }
    if (fingerprint(copies.map(c => c.id)) !== plan) {
      throw new Refusal(
        `Число сошлось (${expect}), но состав — не тот, что в сухом прогоне `
        + `(отпечаток ${fingerprint(copies.map(c => c.id))}, ожидался ${plan}) — ничего не изменено. `
        + 'Повторите сухой прогон.',
      );
    }

    const hidden = [];
    for (const copy of copies) {
      const { rows } = await client.query(HIDE_SQL, [copy.id, copy.reason, AUDIT_USER_AGENT]);
      hidden.push(...rows.map(r => r.entity_id));
      if (withMemory) {
        await client.query(REMEMBER_SQL, [copy.establishmentId, copy.itemName, copy.categoryRaw ?? null, copy.reason]);
      }
    }
    if (hidden.length !== expect) {
      throw new Refusal(`Скрыто ${hidden.length}, подтверждено ${expect} — ничего не изменено.`);
    }

    await client.query('COMMIT');
    return { hidden, withMemory };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
};

// ============================================================================
// Печать
// ============================================================================

const price = (value) => (value === null || value === undefined
  ? 'без цены'
  : `${Number(value).toFixed(2).replace('.', ',')} BYN`);

/**
 * Список для Координатора: по заведениям, по строке на копию.
 */
export const formatCopies = ({ copies, total, fingerprint: print, withMemory }) => {
  if (total === 0) {
    return [
      'Видимых копий скрытых блюд нет.',
      withMemory ? '' : '(Память скрытых блюд — миграция 038 — в этой базе не применена: проверены только скрытые позиции файлов.)',
    ].filter(Boolean).join('\n');
  }

  const lines = [];
  let venue = null;
  for (const c of copies) {
    if (c.establishmentId !== venue) {
      venue = c.establishmentId;
      lines.push('', `${c.establishmentName} (${c.establishmentCity}) [${c.establishmentStatus}] — ${c.establishmentId}`);
    }
    lines.push(
      `  файл ${c.mediaId} · «${c.itemName}» · ${price(c.priceByn)} · раздел «${c.categoryRaw ?? '—'}»`
      + ` · тот же раздел: ${c.sameSection ? 'да' : 'нет'}`
      + ` · причина «${c.reason ?? '—'}»`
      + ` · ${c.from === 'file' ? 'скрыто в другом файле' : 'из памяти заведения'}`,
    );
  }
  lines.push(
    '',
    `Итого: ${total} — отпечаток ${print}.`,
    withMemory ? '' : '(Память скрытых блюд — миграция 038 — в этой базе не применена: проверены только скрытые позиции файлов.)',
  );
  return lines.filter((line, i) => line !== '' || i > 0).join('\n').trimEnd();
};
