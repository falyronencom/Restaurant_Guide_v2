/**
 * Подписи действий в журнале аудита.
 *
 * Подпись собирается CASE-выражением в SQL (`auditLogModel.js`), и у него есть
 * фолбэк `action || ' (' || entity_type || ')'`. Фолбэк — не украшение, а
 * симптом: он срабатывает, когда в журнал начали писать действие, которого нет
 * в карте. Ровно это и случилось незамеченным — четыре действия
 * (`admin_update_slug`, `hide_menu_item`, `unhide_menu_item`,
 * `dismiss_sanity_flag`) писались в базу и показывались модератору кодом.
 *
 * Тест закрывает две вещи: что переведены все действия, которые сервисы
 * реально пишут, и что фолбэк по-прежнему узнаваем — на нём держится
 * guard-тест клиента (`moderation_vocabulary_test.dart`).
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createAdminAndGetToken } from '../utils/adminTestHelpers.js';

const BASE_URL = '/api/v1/admin/audit-log';

/**
 * Действия, которые пишутся в журнал, — общий список сервера и панели
 * (src/constants/auditLogActions.json). Что он полон, сверяет с кодом
 * писателей unit/auditLogActionsGuard.test.js; здесь — что каждое действие
 * подписано по-русски и подпись та, что в списке. Записи карты вставляются без
 * автора, поэтому у действий с двумя подписями ожидается вариант «без автора».
 */
const catalogue = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'constants', 'auditLogActions.json'),
  'utf8',
));
const WRITTEN_ACTIONS = catalogue.actions.map((a) => [
  a.action,
  a.entity_type,
  a.summary_without_actor ?? a.summary,
]);

let adminToken;
let adminId;

beforeAll(async () => {
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;
  adminId = admin.user.id;

  // Записи вставляются напрямую: цель — проверить перевод, а не воспроизвести
  // пятнадцать сценариев. Обязательных колонок у audit_log две — action и
  // entity_type, остальное допускает NULL.
  for (const [action, entityType] of WRITTEN_ACTIONS) {
    await query(
      'INSERT INTO audit_log (action, entity_type) VALUES ($1, $2)',
      [action, entityType],
    );
  }
  await query(
    'INSERT INTO audit_log (action, entity_type) VALUES ($1, $2)',
    ['totally_new_action', 'establishment'],
  );
});

// Сьют убирает за собой ПОЛНОСТЬЮ, а не только свои строки журнала: админ
// создаётся из фикстуры с фиксированным адресом, и оставленный после себя он
// роняет следующий сьют на дубликате. Так делают 26 из 29 интеграционных
// сьютов — это здешняя норма, а не перестраховка.
afterAll(async () => {
  await clearAllData();
});

const fetchEntries = async () => {
  const { body } = await request(app)
    .get(`${BASE_URL}?per_page=100`)
    .set('Authorization', `Bearer ${adminToken}`);
  return body.data;
};

describe('GET /admin/audit-log — подписи действий', () => {
  it('каждое записываемое действие переведено на русский', async () => {
    const entries = await fetchEntries();
    // Записи карты — без объекта (entity_id NULL); запись последнего теста —
    // с объектом и сюда не попадает.
    const byAction = new Map(entries
      .filter((e) => e.entity_id === null)
      .map((e) => [e.action, e.summary]));

    for (const [action, , expected] of WRITTEN_ACTIONS) {
      expect(byAction.get(action)).toBe(expected);
    }
  });

  it('ни одна подпись не выглядит машинным кодом', async () => {
    const entries = await fetchEntries();
    const raw = /^[a-z][a-z0-9_]*\s+\([a-z_]+\)$/;

    const leaked = entries
      .filter((e) => e.action !== 'totally_new_action')
      .filter((e) => raw.test(e.summary));

    expect(leaked.map((e) => e.action)).toEqual([]);
  });

  it('незнакомое действие уходит в узнаваемый фолбэк', async () => {
    // На этой форме держится guard-тест клиента. Если фолбэк изменят, тот
    // перестанет ловить дрейф — и код снова доедет до модератора молча.
    const entries = await fetchEntries();
    const unknown = entries.find((e) => e.action === 'totally_new_action');

    expect(unknown.summary).toBe('totally_new_action (establishment)');
  });

  it('удалил сам человек — запись с автором, своя подпись: учётная запись и карточка', async () => {
    // Автор — любая учётка: подпись различает только «автор есть» (человек
    // из приложения или с сайта, партнёр в кабинете) и «автора нет» (скрипт
    // оператора).
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id)
       VALUES ($1, 'user_delete_account', 'user', $1),
              ($1, 'partner_delete_establishment', 'establishment', gen_random_uuid())`,
      [adminId],
    );

    const entries = await fetchEntries();
    // Строки карты — без объекта и без автора; строки этого теста — с тем и другим.
    const signed = (action) => entries
      .filter((e) => e.action === action)
      .map((e) => [e.entity_id === null ? 'без автора' : 'с автором', e.summary]);

    expect(signed('user_delete_account')).toEqual(expect.arrayContaining([
      ['с автором', 'Пользователь удалил учётную запись'],
      ['без автора', 'Учётная запись удалена по заявке в поддержку'],
    ]));
    expect(signed('user_delete_account')).toHaveLength(2);
    expect(signed('partner_delete_establishment')).toEqual(expect.arrayContaining([
      ['с автором', 'Заведение удалено партнёром'],
      ['без автора', 'Заведение удалено вместе с учётной записью по заявке в поддержку'],
    ]));
    expect(signed('partner_delete_establishment')).toHaveLength(2);
  });
});
