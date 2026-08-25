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

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createAdminAndGetToken } from '../utils/adminTestHelpers.js';

const BASE_URL = '/api/v1/admin/audit-log';

/** Действия, которые сервисы пишут в журнал. Источник — grep по `action:`. */
const WRITTEN_ACTIONS = [
  ['admin_update_coordinates', 'establishment', 'Координаты обновлены'],
  ['admin_update_slug', 'establishment', 'Адрес страницы изменён'],
  ['claim_establishment', 'establishment', 'Заведение передано партнёру'],
  ['suspend', 'establishment', 'Приостановлено заведение'],
  ['unsuspend', 'establishment', 'Возобновлено заведение'],
  ['moderate_approve', 'establishment', 'Одобрено заведение'],
  ['moderate_reject', 'establishment', 'Отклонено заведение'],
  ['review_hide', 'review', 'Скрыт отзыв'],
  ['review_show', 'review', 'Показан отзыв'],
  ['review_delete', 'review', 'Удалён отзыв'],
  ['hide_menu_item', 'menu_item', 'Скрыта позиция меню'],
  ['unhide_menu_item', 'menu_item', 'Показана позиция меню'],
  ['dismiss_sanity_flag', 'menu_item', 'Снят флаг с позиции меню'],
  ['upgrade_user_to_partner', 'user', 'Пользователь повышен до партнёра'],
];

let adminToken;

beforeAll(async () => {
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;

  // Записи вставляются напрямую: цель — проверить перевод, а не воспроизвести
  // четырнадцать сценариев. Обязательных колонок у audit_log две — action и
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
    const byAction = new Map(entries.map((e) => [e.action, e.summary]));

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
});
