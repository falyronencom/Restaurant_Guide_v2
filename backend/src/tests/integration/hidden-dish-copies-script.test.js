/* eslint-env jest */
/**
 * Видимые копии скрытых блюд — инструмент П4 (слово Координатора 29.10.2026,
 * п. 3а): находит копии тем же правилом, что код (dishKey, «другие файлы»),
 * сухой прогон ничего не пишет, запись — только с подтверждённым числом и
 * отпечатком списка, одной транзакцией, с журналом и памятью заведения.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../config/database.js';
import { clearAllData, query } from '../utils/database.js';
import { createPartnerWithEstablishment } from '../utils/adminTestHelpers.js';
import {
  AUDIT_USER_AGENT,
  Refusal,
  findCopies,
  fingerprint,
  formatCopies,
  hideCopies,
} from '../../../scripts/hidden-dish-copies/plan.js';

const REASON = 'не блюдо — табачная продукция';
const MIGRATION_038 = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'migrations', '038_menu_item_hidden_names.sql',
);

beforeEach(async () => {
  await query('TRUNCATE TABLE establishments CASCADE');
  await query('TRUNCATE TABLE audit_log');
});

afterAll(async () => {
  await clearAllData();
});

const seedFile = async (establishmentId) => (await query(
  `INSERT INTO establishment_media
     (establishment_id, type, file_type, url, thumbnail_url, preview_url)
   VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
   RETURNING id`,
  [establishmentId],
)).rows[0].id;

const seedItem = async (establishmentId, mediaId, itemName, { price = 10, category = null, hiddenReason = null } = {}) => (await query(
  `INSERT INTO menu_items
     (establishment_id, media_id, item_name, price_byn, category_raw, is_hidden_by_admin, hidden_reason, position)
   VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
   RETURNING id`,
  [establishmentId, mediaId, itemName, price, category, hiddenReason !== null, hiddenReason],
)).rows[0].id;

const rowOf = async (id) => (await query(
  'SELECT is_hidden_by_admin, hidden_reason FROM menu_items WHERE id = $1',
  [id],
)).rows[0];

/** Заведение с тремя случаями: копия в другом файле, копия из памяти, решение внутри файла. */
const seedScene = async () => {
  const { establishment } = await createPartnerWithEstablishment('active');
  const photo = await seedFile(establishment.id);
  const pdf = await seedFile(establishment.id);
  const board = await seedFile(establishment.id);

  // Скрыто в фото — копия в PDF (другой раздел, другая цена, другое написание).
  await seedItem(establishment.id, photo, 'Кальян «Классика»', { price: 45, category: 'Прочее', hiddenReason: REASON });
  const pdfHookah = await seedItem(establishment.id, pdf, 'кальян "классика"', { price: 50, category: 'Табак' });
  // Внутри одного файла раздел решает первым: «Чай» в «Завтраках» — решение
  // модератора. «Скрыть» на «Напитках» оставило так: скрыло «Чай» в PDF и
  // запомнило оба раздела. Копией скрипт его не считает — ни по скрытому в
  // другом файле, ни по памяти (рецензия 29.10.2026).
  await seedItem(establishment.id, photo, 'Чай', { category: 'Напитки', hiddenReason: REASON });
  const photoBreakfastTea = await seedItem(establishment.id, photo, 'Чай', { category: 'Завтраки' });
  await seedItem(establishment.id, pdf, 'Чай', { category: 'Завтраки', hiddenReason: REASON });
  await query(
    `INSERT INTO menu_item_hidden_names (establishment_id, item_name, category_raw, hidden_reason)
     VALUES ($1, 'Чай', 'Напитки', $2), ($1, 'Чай', 'Завтраки', $2)`,
    [establishment.id, REASON],
  );
  // Файл, где блюдо скрыли, удалён — помнит память заведения.
  await query(
    `INSERT INTO menu_item_hidden_names (establishment_id, item_name, category_raw, hidden_reason)
     VALUES ($1, 'Сигары', NULL, $2)`,
    [establishment.id, REASON],
  );
  const boardCigars = await seedItem(establishment.id, board, 'Сигары', { price: 30 });
  const boardLemonade = await seedItem(establishment.id, board, 'Лимонад', { price: 5 });

  return { establishment, pdf, board, pdfHookah, photoBreakfastTea, boardCigars, boardLemonade };
};

describe('миграция 038: заполнение памяти из уже скрытых позиций', () => {
  test('копирует каждое скрытое блюдо один раз; повторный запуск не плодит дублей', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');
    const photo = await seedFile(establishment.id);
    const pdf = await seedFile(establishment.id);
    // Одно блюдо, скрытое в двух файлах одинаково, — одна запись памяти.
    await seedItem(establishment.id, photo, 'Кальян', { hiddenReason: REASON });
    await seedItem(establishment.id, pdf, 'Кальян', { hiddenReason: REASON });
    await seedItem(establishment.id, pdf, 'Чай', { category: 'Напитки', hiddenReason: 'нет в продаже' });
    await seedItem(establishment.id, pdf, 'Борщ');
    await query('DELETE FROM menu_item_hidden_names');

    const migration = readFileSync(MIGRATION_038, 'utf8');
    await query(migration);
    await query(migration);

    const { rows } = await query(
      `SELECT item_name, category_raw, hidden_reason FROM menu_item_hidden_names
        WHERE establishment_id = $1 ORDER BY item_name`,
      [establishment.id],
    );
    expect(rows).toEqual([
      { item_name: 'Кальян', category_raw: null, hidden_reason: REASON },
      { item_name: 'Чай', category_raw: 'Напитки', hidden_reason: 'нет в продаже' },
    ]);
  });
});

describe('hidden-dish-copies: сухой прогон', () => {
  test('находит копии тем же правилом, что код, и ничего не пишет', async () => {
    const scene = await seedScene();
    const client = await pool.connect();
    try {
      const found = await findCopies(client);

      expect(found.copies.map((c) => [c.itemName, c.from, c.sameSection, c.reason]).sort()).toEqual([
        ['Сигары', 'memory', true, REASON],
        ['кальян "классика"', 'file', false, REASON],
      ]);
      expect(found.total).toBe(2);
      expect(found.fingerprint).toBe(fingerprint([scene.pdfHookah, scene.boardCigars]));
      expect(found.withMemory).toBe(true);

      const text = formatCopies(found);
      expect(text).toContain('тот же раздел: нет');
      expect(text).toContain('из памяти заведения');
      expect(text).toContain(`Итого: 2 — отпечаток ${found.fingerprint}.`);
    } finally {
      client.release();
    }

    for (const id of [scene.pdfHookah, scene.photoBreakfastTea, scene.boardCigars, scene.boardLemonade]) {
      expect((await rowOf(id)).is_hidden_by_admin).toBe(false);
    }
    expect((await query('SELECT COUNT(*)::int AS n FROM audit_log')).rows[0].n).toBe(0);
  });
});

describe('hidden-dish-copies: запись', () => {
  test('без подтверждённого числа или с чужим отпечатком — отказ, ничего не изменено', async () => {
    const scene = await seedScene();
    const client = await pool.connect();
    try {
      const { fingerprint: print } = await findCopies(client);
      await expect(hideCopies(client, { expect: 3, plan: print })).rejects.toBeInstanceOf(Refusal);
      await expect(hideCopies(client, { expect: 2, plan: '0000000000' })).rejects.toBeInstanceOf(Refusal);
      await expect(hideCopies(client, { expect: undefined, plan: print })).rejects.toBeInstanceOf(Refusal);
    } finally {
      client.release();
    }

    expect((await rowOf(scene.pdfHookah)).is_hidden_by_admin).toBe(false);
    expect((await rowOf(scene.boardCigars)).is_hidden_by_admin).toBe(false);
    expect((await query('SELECT COUNT(*)::int AS n FROM audit_log')).rows[0].n).toBe(0);
  });

  test('с числом и отпечатком из сухого прогона — скрывает, пишет журнал и память', async () => {
    const scene = await seedScene();
    const client = await pool.connect();
    try {
      const { total, fingerprint: print } = await findCopies(client);
      const result = await hideCopies(client, { expect: total, plan: print });
      expect(result.hidden.sort()).toEqual([scene.pdfHookah, scene.boardCigars].sort());

      // Повторный сухой прогон — копий больше нет.
      expect((await findCopies(client)).total).toBe(0);
    } finally {
      client.release();
    }

    expect(await rowOf(scene.pdfHookah)).toEqual({ is_hidden_by_admin: true, hidden_reason: REASON });
    expect(await rowOf(scene.boardCigars)).toEqual({ is_hidden_by_admin: true, hidden_reason: REASON });
    expect((await rowOf(scene.photoBreakfastTea)).is_hidden_by_admin).toBe(false);
    expect((await rowOf(scene.boardLemonade)).is_hidden_by_admin).toBe(false);

    const journal = await query(
      `SELECT entity_id, user_id, user_agent, new_data, old_data->>'item_name' AS item_name
         FROM audit_log WHERE action = 'hide_menu_item'`,
    );
    const byName = (a, b) => a.item_name.localeCompare(b.item_name);
    expect(journal.rows.sort(byName)).toEqual([
      {
        entity_id: scene.boardCigars,
        user_id: null,
        user_agent: AUDIT_USER_AGENT,
        new_data: { is_hidden_by_admin: true, reason: REASON },
        item_name: 'Сигары',
      },
      {
        entity_id: scene.pdfHookah,
        user_id: null,
        user_agent: AUDIT_USER_AGENT,
        new_data: { is_hidden_by_admin: true, reason: REASON },
        item_name: 'кальян "классика"',
      },
    ].sort(byName));

    const memory = await query(
      `SELECT item_name, category_raw FROM menu_item_hidden_names
        WHERE establishment_id = $1 ORDER BY item_name`,
      [scene.establishment.id],
    );
    expect(memory.rows.map((r) => r.item_name)).toEqual(expect.arrayContaining(['кальян "классика"', 'Сигары']));
  });
});
