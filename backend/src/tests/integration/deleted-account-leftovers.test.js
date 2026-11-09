/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Удаление учётки — без остатков (облачный критик, заход 2Г; пакет «Удаление
 * учётки — без остатков», 10.11.2026). Решения Координатора: видимые отзывы
 * остаются под «Гость» (18.10.2026); текст отзывов, которые человек удалил сам
 * или которые скрыл модератор, при удалении учётки стирается (09.11.2026,
 * «стирать»).
 *
 *   2.02 — текст невидимых отзывов стёрт, рейтинг заведений не сдвинулся;
 *   П3-02 — реквизиты записи о юрлице под удалённой учёткой стёрты целиком;
 *   2.01, 2.03 — запрос, прошедший вход до фиксации удаления и пишущий после
 *          неё, не оставляет под удалённой учёткой ни карточки, ни строки:
 *          избранное (и счётчик карточки), токен устройства, настройки,
 *          правка отзыва, уведомление, рассылка, ссылка сброса, код почты;
 *   П3-03 — уведомления отключённой или удалённой учётке не создаются;
 *   2.04 — удаление учётки с отзывами просит сайт пересобрать страницы
 *          заведений (services/siteRefresh.js);
 *   скрипт оператора scripts/erase-deleted-account-leftovers.js — то же
 *          стирание для учёток, удалённых раньше.
 *
 * Гонки — ниже HTTP только там, где HTTP не пускает к записи; иначе запрос
 * через приложение, но гонку держит транзакция теста: она блокирует строку
 * учётки и обезличивает её (как удаление), запрос встаёт за блокировкой,
 * тест ждёт его в очереди и только тогда фиксирует удаление
 * (feedback_supertest_does_not_reproduce_db_race: два запроса supertest гонки
 * не дают, держатель-транзакция — даёт).
 *
 * Ожидаемые значения — из решений и брифа, литералами: «Гость», код отказа
 * USER_INACTIVE, путь страницы сайта.
 */

import { spawnSync } from 'child_process';
import { createHmac, randomUUID } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../server.js';
import { anonymiseAccount, lockAccount } from '../../services/accountDeletionService.js';
import * as NotificationModel from '../../models/notificationModel.js';
import * as NotificationService from '../../services/notificationService.js';
import { updateEstablishmentAggregates } from '../../models/reviewModel.js';
import { createTokenWithinLimit } from '../../models/passwordResetModel.js';
import { reserveCodeWithinLimit } from '../../models/emailVerificationModel.js';
import {
  deleteReview as adminDeleteReview,
  hideReviewsBatch,
  setVisibility,
} from '../../services/adminReviewService.js';
import { clearAllData, getClient, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { createPartnerWithEstablishment, createTestReview } from '../utils/adminTestHelpers.js';
import { minimalEstablishment } from '../fixtures/establishments.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SWEEP = resolve(HERE, '../../../scripts/erase-deleted-account-leftovers.js');
const SWEEP_ACTOR = 'operator_script:erase-deleted-account-leftovers';
const WORD = 'УДАЛИТЬ';

// Скрипт — отдельный процесс (импорт сервера, соединение с базой).
jest.setTimeout(30000);

const person = async ({ role = 'user', name = 'Иван Тестов' } = {}) => {
  const created = await createUserAndGetTokens({
    email: `leftovers-${randomUUID()}@test.com`,
    phone: null,
    password: 'Person123!@#',
    name,
    role,
    authMethod: 'email',
  });
  return { ...created, id: created.user.id };
};

const deleteAccount = (token) => request(app)
  .delete('/api/v1/auth/account')
  .set('Authorization', `Bearer ${token}`)
  .send({ confirmation: WORD });

const count = async (sql, params) => (await query(sql, params)).rows[0].n;

const reviewRow = async (id) => (await query(
  'SELECT content, text, partner_response, rating, is_visible, is_deleted FROM reviews WHERE id = $1',
  [id],
)).rows[0];

const cardRating = async (id) => (await query(
  'SELECT average_rating::text AS average_rating, review_count FROM establishments WHERE id = $1',
  [id],
)).rows[0];

/** Ждать, пока чей-то запрос встанет в очередь за блокировкой строки. */
const waitForLockWaiters = async (expected) => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0].n >= expected) return;
    await new Promise((resolveWait) => { setTimeout(resolveWait, 20); });
  }
  throw new Error(`в очереди за блокировкой нет ${expected} запросов`);
};

/**
 * Удаление, с которым гонится действие: транзакция теста блокирует строку
 * учётки и обезличивает её — как удаление, — запускает действие, ждёт, пока
 * оно встанет за блокировкой, и фиксирует. Возвращает итог действия:
 * { value } или { error }.
 */
const racingDeletion = async (userId, action) => {
  const holder = await getClient();
  try {
    await holder.query('BEGIN');
    const account = await lockAccount(holder, userId);
    await anonymiseAccount(holder, account, { userId, queueAvatarDeletion: false });
    const pending = Promise.resolve()
      .then(action)
      .then((value) => ({ value }), (error) => ({ error }));
    await waitForLockWaiters(1);
    await holder.query('COMMIT');
    return await pending;
  } catch (error) {
    await holder.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    holder.release();
  }
};

const refusal = (response) => ({ status: response.status, code: response.body.error?.code });

const savedFetch = global.fetch;
const savedSiteUrl = process.env.SITE_URL;
const savedSiteSecret = process.env.SITE_REQUEST_SECRET;

beforeEach(async () => {
  await clearAllData();
});

afterEach(() => {
  global.fetch = savedFetch;
  process.env.SITE_URL = savedSiteUrl;
  process.env.SITE_REQUEST_SECRET = savedSiteSecret;
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// 2.02 — текст отзывов, которые не видит никто, кроме панели
// ============================================================================

describe('Удаление учётки: текст невидимых отзывов стёрт', () => {
  test('видимый — с текстом под «Гость»; удалённый самим и скрытый модератором — без текста; ответ заведения на месте; рейтинг не сдвинулся', async () => {
    const p = await person();
    const { establishment: visibleCard } = await createPartnerWithEstablishment('active');
    const { establishment: ownDeletedCard } = await createPartnerWithEstablishment('active');
    const { establishment: hiddenCard } = await createPartnerWithEstablishment('active');
    const { establishment: moderatorDeletedCard } = await createPartnerWithEstablishment('active');

    const visible = await createTestReview(p.id, visibleCard.id, { rating: 5, content: 'Видимый отзыв остаётся' });
    const ownDeleted = await createTestReview(p.id, ownDeletedCard.id, {
      rating: 1, content: 'Удалил сам — думал, что стёр', is_deleted: true,
    });
    const hidden = await createTestReview(p.id, hiddenCard.id, {
      rating: 1, content: 'Скрыт модератором', is_visible: false, partner_response: 'Ответ заведения',
    });
    const moderatorDeleted = await createTestReview(p.id, moderatorDeletedCard.id, {
      rating: 2, content: 'Удалён модератором', is_visible: false, is_deleted: true,
    });
    // У карточки со скрытым отзывом есть и чужой видимый: рейтинг не нулевой,
    // и вернись скрытый в оценку — он бы её сдвинул.
    await createTestReview(null, hiddenCard.id, { rating: 5, content: 'Чужой видимый отзыв' });
    for (const card of [visibleCard, ownDeletedCard, hiddenCard, moderatorDeletedCard]) {
      await updateEstablishmentAggregates(card.id);
    }
    const ratingsBefore = await Promise.all(
      [visibleCard, ownDeletedCard, hiddenCard, moderatorDeletedCard].map((card) => cardRating(card.id)),
    );

    await deleteAccount(p.accessToken).expect(200);

    expect(await reviewRow(visible.id)).toMatchObject({ content: 'Видимый отзыв остаётся', text: 'Видимый отзыв остаётся' });
    expect(await reviewRow(ownDeleted.id)).toMatchObject({ content: null, text: null, rating: 1, is_deleted: true });
    expect(await reviewRow(hidden.id)).toMatchObject({
      content: null, text: null, rating: 1, is_visible: false, partner_response: 'Ответ заведения',
    });
    expect(await reviewRow(moderatorDeleted.id)).toMatchObject({ content: null, text: null });
    const ratingsAfter = await Promise.all(
      [visibleCard, ownDeletedCard, hiddenCard, moderatorDeletedCard].map((card) => cardRating(card.id)),
    );
    expect(ratingsAfter).toEqual(ratingsBefore);
    expect(ratingsAfter[2]).toEqual({ average_rating: '5.00', review_count: 1 });

    const entry = (await query(
      `SELECT new_data FROM audit_log
       WHERE entity_type = 'user' AND entity_id = $1 AND action = 'user_delete_account'`,
      [p.id],
    )).rows[0];
    expect(entry.new_data).toMatchObject({ reviews_kept: 2, review_texts_erased: 3 });
  });

  test('журнал модерации больше не показывает текст скрытого отзыва', async () => {
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    const hidden = await createTestReview(p.id, establishment.id, { content: 'Текст, который скрыли', is_visible: false });
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_data)
       VALUES (NULL, 'review_hide', 'review', $1, '{"is_visible": false, "reason": "спам"}')`,
      [hidden.id],
    );

    await deleteAccount(p.accessToken).expect(200);

    // Экран журнала читает отрывок из самого отзыва (auditLogModel, text_snippet).
    const snippet = (await query(
      `SELECT LEFT(r.text, 120) AS snippet, al.new_data->>'reason' AS reason
       FROM audit_log al JOIN reviews r ON r.id = al.entity_id
       WHERE al.entity_type = 'review' AND al.entity_id = $1`,
      [hidden.id],
    )).rows[0];
    expect(snippet).toEqual({ snippet: null, reason: 'спам' });
  });
});

// ============================================================================
// П3-02 — реквизиты записи о юрлице под удалённой учёткой
// ============================================================================

describe('Удаление учётки: запись о юрлице под этой учёткой удалена', () => {
  test('контакт, название организации, УНП и ссылка на скан ушли вместе с записью; запись нового владельца не тронута', async () => {
    const p = await person();
    const { partner: holder, establishment } = await createPartnerWithEstablishment('active');
    await query(
      `INSERT INTO partner_documents (partner_id, establishment_id, document_type, document_url,
                                      company_name, tax_id, contact_person, contact_email)
       VALUES ($1, $2, 'registration_certificate', 'https://res.cloudinary.com/test/raw/upload/scan.pdf',
               'ИП Иванов Иван Иванович', '191234567', 'Иван Иванов', 'ivan@test.com'),
              ($3, $2, 'registration_certificate', '', 'ООО «Новый»', '192000000', 'Пётр', 'petr@test.com')`,
      [p.id, establishment.id, holder.user.id],
    );

    await deleteAccount(p.accessToken).expect(200);

    const docs = (await query(
      `SELECT partner_id, document_url, company_name, tax_id, contact_person, contact_email
       FROM partner_documents WHERE establishment_id = $1 ORDER BY company_name NULLS FIRST`,
      [establishment.id],
    )).rows;
    expect(docs).toEqual([
      {
        partner_id: holder.user.id, document_url: '', company_name: 'ООО «Новый»', tax_id: '192000000',
        contact_person: 'Пётр', contact_email: 'petr@test.com',
      },
    ]);
  });

  test('сохранение кабинета новым владельцем после удаления не пишет его данные под удалённой учёткой', async () => {
    const p = await person();
    const { partner: holder, establishment } = await createPartnerWithEstablishment('active');
    // Запись прежнего держателя карточки, переданной до 18.10 (без переноса).
    await query(
      `INSERT INTO partner_documents (partner_id, establishment_id, document_type, document_url, company_name, tax_id)
       VALUES ($1, $2, 'registration_certificate', '', 'ИП Иванов', '191234567')`,
      [p.id, establishment.id],
    );
    await deleteAccount(p.accessToken).expect(200);

    await request(app)
      .put(`/api/v1/partner/establishments/${establishment.id}`)
      .set('Authorization', `Bearer ${holder.accessToken}`)
      .send({ legal_name: 'ООО «Новый»', unp: '192000000' })
      .expect(200);

    const docs = (await query(
      'SELECT partner_id, company_name, tax_id FROM partner_documents WHERE establishment_id = $1',
      [establishment.id],
    )).rows;
    expect(docs).toEqual([{ partner_id: holder.user.id, company_name: 'ООО «Новый»', tax_id: '192000000' }]);
  });
});

// ============================================================================
// 2.01, 2.03 — запрос, начатый до фиксации удаления
// ============================================================================

describe('Запрос, прошедший вход до фиксации удаления, ничего не оставляет под удалённой учёткой', () => {
  test('избранное: отказ USER_INACTIVE; строки нет, счётчик карточки — 0', async () => {
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');

    const { value: response } = await racingDeletion(p.id, () => request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ establishmentId: establishment.id }));

    expect(refusal(response)).toEqual({ status: 403, code: 'USER_INACTIVE' });
    expect(await count('SELECT COUNT(*)::int AS n FROM favorites WHERE user_id = $1', [p.id])).toBe(0);
    expect(await count('SELECT favorite_count::int AS n FROM establishments WHERE id = $1', [establishment.id])).toBe(0);
  });

  test('токен устройства: отказ; строки нет, а телефон у учётки, которая держит его сейчас, остаётся', async () => {
    const p = await person();
    const other = await person({ name: 'Другой на том же телефоне' });
    await query(
      "INSERT INTO device_tokens (user_id, fcm_token, platform) VALUES ($1, 'fcm-shared-device', 'android')",
      [other.id],
    );

    const { value: response } = await racingDeletion(p.id, () => request(app)
      .put('/api/v1/notifications/device-token')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ fcm_token: 'fcm-shared-device', platform: 'android' }));

    expect(refusal(response)).toEqual({ status: 403, code: 'USER_INACTIVE' });
    expect(await count('SELECT COUNT(*)::int AS n FROM device_tokens WHERE user_id = $1', [p.id])).toBe(0);
    expect(await count(
      "SELECT COUNT(*)::int AS n FROM device_tokens WHERE user_id = $1 AND is_active = TRUE AND fcm_token = 'fcm-shared-device'",
      [other.id],
    )).toBe(1);
  });

  test('настройки уведомлений: отказ; строки нет', async () => {
    const p = await person();

    const { value: response } = await racingDeletion(p.id, () => request(app)
      .put('/api/v1/notifications/preferences')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ booking_push_enabled: false }));

    expect(refusal(response)).toEqual({ status: 403, code: 'USER_INACTIVE' });
    expect(await count('SELECT COUNT(*)::int AS n FROM notification_preferences WHERE user_id = $1', [p.id])).toBe(0);
  });

  test('правка скрытого отзыва: отказ; стёртый удалением текст не возвращается', async () => {
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    const hidden = await createTestReview(p.id, establishment.id, { content: 'Скрытый текст', is_visible: false });

    const { value: response } = await racingDeletion(p.id, () => request(app)
      .put(`/api/v1/reviews/${hidden.id}`)
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ content: 'Новый текст после удаления учётки' }));

    expect(refusal(response)).toEqual({ status: 403, code: 'USER_INACTIVE' });
    expect(await reviewRow(hidden.id)).toMatchObject({ content: null, text: null });
  });

  test('удаление своего отзыва: отказ; отзыв остаётся видимым под «Гость» — текст удалённого не повисает', async () => {
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    const visible = await createTestReview(p.id, establishment.id, { content: 'Видимый отзыв' });

    const { value: response } = await racingDeletion(p.id, () => request(app)
      .delete(`/api/v1/reviews/${visible.id}`)
      .set('Authorization', `Bearer ${p.accessToken}`));

    expect(refusal(response)).toEqual({ status: 403, code: 'USER_INACTIVE' });
    expect(await reviewRow(visible.id)).toMatchObject({ is_deleted: false, content: 'Видимый отзыв' });
  });

  test('правка видимого отзыва: отказ; под «Гость» остаётся прежний текст', async () => {
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    const visible = await createTestReview(p.id, establishment.id, { content: 'Прежний текст' });

    const { value: response } = await racingDeletion(p.id, () => request(app)
      .put(`/api/v1/reviews/${visible.id}`)
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ content: 'Переписано после удаления учётки' }));

    expect(refusal(response)).toEqual({ status: 403, code: 'USER_INACTIVE' });
    expect(await reviewRow(visible.id)).toMatchObject({ content: 'Прежний текст', text: 'Прежний текст' });
  });

  test('карточка партнёра: отказ USER_INACTIVE; карточки с контактами под удалённой учёткой нет', async () => {
    const p = await person({ role: 'partner' });

    const { value: response } = await racingDeletion(p.id, () => request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ ...minimalEstablishment, phone: '+375291112233', legal_name: 'ИП Тестов', unp: '191234567' }));

    expect(refusal(response)).toEqual({ status: 403, code: 'USER_INACTIVE' });
    expect(await count('SELECT COUNT(*)::int AS n FROM establishments WHERE partner_id = $1', [p.id])).toBe(0);
    expect(await count('SELECT COUNT(*)::int AS n FROM partner_documents WHERE partner_id = $1', [p.id])).toBe(0);
  });

  test('первая карточка обычного человека: отказ; ни карточки, ни роли партнёра у удалённой учётки', async () => {
    const p = await person();

    const { value: response } = await racingDeletion(p.id, () => request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${p.accessToken}`)
      .send({ ...minimalEstablishment, phone: '+375291112233' }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await count('SELECT COUNT(*)::int AS n FROM establishments WHERE partner_id = $1', [p.id])).toBe(0);
    expect((await query('SELECT role FROM users WHERE id = $1', [p.id])).rows[0].role).toBe('user');
  });

  test('уведомление: не записано', async () => {
    const p = await person();

    const { value: created } = await racingDeletion(p.id, () => NotificationModel.create({
      userId: p.id, type: 'partner_response', title: 'Ответ на отзыв', message: 'Владелец ответил',
    }));

    expect(created).toBeUndefined();
    expect(await count('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1', [p.id])).toBe(0);
  });

  test('рассылка тем, у кого карточка в избранном: удалённой учётке не записано', async () => {
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    await query('INSERT INTO favorites (user_id, establishment_id) VALUES ($1, $2)', [p.id, establishment.id]);

    const { value: written } = await racingDeletion(p.id, () => NotificationModel.createForEstablishmentFavorites({
      establishmentId: establishment.id, type: 'promotion_new', title: 'Новая акция', message: 'Акция',
    }));

    expect(written).toEqual([]);
    expect(await count('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1', [p.id])).toBe(0);
  });

  test('ссылка сброса пароля: не выдана, письма нет', async () => {
    const p = await person();

    const { value: issued } = await racingDeletion(p.id, () => createTokenWithinLimit(
      p.id, 'a'.repeat(64), new Date(Date.now() + 30 * 60 * 1000), { max: 5, minutes: 60 },
    ));

    expect(issued).toEqual({ token: null, recentCount: 0, inactive: true });
    expect(await count('SELECT COUNT(*)::int AS n FROM password_reset_tokens WHERE user_id = $1', [p.id])).toBe(0);
  });

  test('код подтверждения почты: не записан, письма нет', async () => {
    const p = await person();

    const { value: reserved } = await racingDeletion(p.id, () => reserveCodeWithinLimit(
      p.id, '123456', new Date(Date.now() + 15 * 60 * 1000), { max: 5, minutes: 60 },
    ));

    expect(reserved).toEqual({ reserved: null, recentCount: 0, inactive: true });
    expect(await count('SELECT COUNT(*)::int AS n FROM email_verification_codes WHERE user_id = $1', [p.id])).toBe(0);
  });
});

// ============================================================================
// 2.02 — отзыв «Гостя», скрытый или удалённый модератором уже после удаления
// ============================================================================

describe('Модератор скрыл или удалил отзыв удалённой учётки — текст стёрт', () => {
  const setUp = async () => {
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    const review = await createTestReview(p.id, establishment.id, { rating: 1, content: 'Текст под «Гость»' });
    await createTestReview(null, establishment.id, { rating: 5, content: 'Чужой видимый' });
    await updateEstablishmentAggregates(establishment.id);
    await deleteAccount(p.accessToken).expect(200);
    return { p, establishment, review };
  };

  test('скрытие: текста нет, оценка заведения — без скрытого; причина модератора в журнале', async () => {
    const { establishment, review } = await setUp();

    await setVisibility(review.id, false, null, { reason: 'оскорбление' });

    expect(await reviewRow(review.id)).toMatchObject({ is_visible: false, content: null, text: null, rating: 1 });
    expect(await cardRating(establishment.id)).toEqual({ average_rating: '5.00', review_count: 1 });
    const entry = (await query(
      "SELECT new_data->>'reason' AS reason FROM audit_log WHERE entity_type = 'review' AND entity_id = $1",
      [review.id],
    )).rows;
    expect(entry).toEqual([{ reason: 'оскорбление' }]);
  });

  test('удаление модератором и скрытие выбранных — текста нет', async () => {
    const { establishment, review } = await setUp();
    const other = await person({ name: 'Вторая удалённая' });
    const otherReview = await createTestReview(other.id, establishment.id, { rating: 2, content: 'Второй текст' });
    await deleteAccount(other.accessToken).expect(200);

    await adminDeleteReview(review.id, null, 'спам');
    await hideReviewsBatch([otherReview.id], 'спам', null);

    expect(await reviewRow(review.id)).toMatchObject({ is_deleted: true, content: null, text: null });
    expect(await reviewRow(otherReview.id)).toMatchObject({ is_visible: false, content: null, text: null });
    expect(await cardRating(establishment.id)).toEqual({ average_rating: '5.00', review_count: 1 });
  });

  test('отзыв живой учётки, скрытый модератором, текст сохраняет', async () => {
    const live = await person({ name: 'Живой автор' });
    const { establishment } = await createPartnerWithEstablishment('active');
    const review = await createTestReview(live.id, establishment.id, { content: 'Текст живого автора' });

    await setVisibility(review.id, false, null, { reason: 'проверка' });
    await adminDeleteReview(review.id, null, 'проверка');

    expect(await reviewRow(review.id)).toMatchObject({ content: 'Текст живого автора', is_deleted: true });
  });
});

// ============================================================================
// П3-03 — уведомления отключённой или удалённой учётке
// ============================================================================

describe('Уведомления отключённой или удалённой учётке не создаются', () => {
  test('ответ заведения на отзыв «Гостя» и скрытие его модератором — в ленту удалённой учётки ничего', async () => {
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    const review = await createTestReview(p.id, establishment.id, { content: 'Отзыв до удаления' });
    await deleteAccount(p.accessToken).expect(200);

    await NotificationService.notifyPartnerResponse(review.id, establishment.id);
    await NotificationService.notifyReviewModerated(review.id, 'hidden');
    await NotificationService.notifyReviewsHidden([review.id]);

    expect(await count('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1', [p.id])).toBe(0);
  });

  test('отключённой панелью учётке — ничего; включённой — как раньше', async () => {
    const off = await person({ name: 'Отключённый' });
    const on = await person({ name: 'Включённый' });
    const { establishment } = await createPartnerWithEstablishment('active');
    const offReview = await createTestReview(off.id, establishment.id, { content: 'Отзыв отключённого' });
    const onReview = await createTestReview(on.id, establishment.id, { content: 'Отзыв включённого' });
    await query('UPDATE users SET is_active = FALSE WHERE id = $1', [off.id]);

    await NotificationService.notifyReviewModerated(offReview.id, 'hidden');
    await NotificationService.notifyReviewModerated(onReview.id, 'hidden');

    expect(await count('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1', [off.id])).toBe(0);
    expect(await count(
      "SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'review_hidden'",
      [on.id],
    )).toBe(1);
  });
});

// ============================================================================
// 2.04 — сайт пересобирает страницы заведений
// ============================================================================

describe('Удаление учётки с отзывами просит сайт пересобрать страницы заведений', () => {
  const SECRET = 's'.repeat(43);

  beforeEach(() => {
    process.env.SITE_URL = 'https://site.test';
    process.env.SITE_REQUEST_SECRET = SECRET;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
  });

  test('с отзывами — один запрос сайту: POST /api/revalidate/establishments с подписью, без секрета и без данных человека', async () => {
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    await createTestReview(p.id, establishment.id, { content: 'Отзыв' });

    await deleteAccount(p.accessToken).expect(200);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(String(url)).toBe('https://site.test/api/revalidate/establishments');
    expect(init.method).toBe('POST');
    expect(Object.keys(init.headers)).toEqual(['x-site-refresh']);
    const [time, signature] = init.headers['x-site-refresh'].split('.');
    expect(signature).toBe(createHmac('sha256', SECRET).update(`revalidate-establishments:${time}`).digest('hex'));
    expect(Math.abs(Date.now() - Number(time))).toBeLessThan(60 * 1000);
    expect(JSON.stringify(init)).not.toContain(SECRET);
    expect(init.body).toBeUndefined();
  });

  test('без отзывов — сайт не зовут', async () => {
    const p = await person();

    await deleteAccount(p.accessToken).expect(200);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('сайт не ответил — учётка всё равно удалена', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    await createTestReview(p.id, establishment.id, { content: 'Отзыв' });

    await deleteAccount(p.accessToken).expect(200);

    expect((await query('SELECT is_active FROM users WHERE id = $1', [p.id])).rows[0].is_active).toBe(false);
  });
});

// ============================================================================
// Скрипт оператора: учётки, удалённые раньше
// ============================================================================

describe('scripts/erase-deleted-account-leftovers.js — остатки учёток, удалённых раньше', () => {
  const sweep = (args = []) => spawnSync(process.execPath, [SWEEP, ...args], {
    env: { ...process.env },
    encoding: 'utf8',
  });

  /**
   * Учётка, удалённая «старым» удалением: удаляем как сейчас, затем
   * возвращаем то, что старое удаление оставляло, и то, что дописывала гонка.
   */
  const deletedEarlier = async () => {
    const p = await person();
    const { establishment } = await createPartnerWithEstablishment('active');
    const hidden = await createTestReview(p.id, establishment.id, { content: 'Скрытый', is_visible: false });
    await deleteAccount(p.accessToken).expect(200);

    await query("UPDATE reviews SET content = 'Старый текст', text = 'Старый текст' WHERE id = $1", [hidden.id]);
    await query('INSERT INTO favorites (user_id, establishment_id) VALUES ($1, $2)', [p.id, establishment.id]);
    await query('UPDATE establishments SET favorite_count = 1 WHERE id = $1', [establishment.id]);
    await query("INSERT INTO device_tokens (user_id, fcm_token, platform) VALUES ($1, 'fcm-left', 'ios')", [p.id]);
    await query('INSERT INTO notification_preferences (user_id) VALUES ($1)', [p.id]);
    await query(
      "INSERT INTO notifications (user_id, type, title) VALUES ($1, 'partner_response', 'Ответ')",
      [p.id],
    );
    await query(
      `INSERT INTO partner_documents (partner_id, establishment_id, document_type, document_url, company_name, tax_id)
       VALUES ($1, $2, 'registration_certificate', '', 'ИП Старый', '190000001')`,
      [p.id, establishment.id],
    );
    const draft = (await query(
      `INSERT INTO establishments (partner_id, name, slug, description, city, address, latitude, longitude,
                                   categories, cuisines, working_hours, status, phone)
       VALUES ($1, 'Черновик гонки', $2, 'Описание', 'Минск', 'ул. Тестовая 3', 53.9, 27.5,
               ARRAY['Ресторан'], ARRAY['Европейская'], '{}'::jsonb, 'draft', '+375291112233')
       RETURNING id`,
      [p.id, `race-${randomUUID().slice(0, 8)}`],
    )).rows[0].id;
    const published = (await query(
      `INSERT INTO establishments (partner_id, name, slug, description, city, address, latitude, longitude,
                                   categories, cuisines, working_hours, status, published_at)
       VALUES ($1, 'Опубликованная', $2, 'Описание', 'Минск', 'ул. Тестовая 4', 53.9, 27.5,
               ARRAY['Ресторан'], ARRAY['Европейская'], '{}'::jsonb, 'active', NOW())
       RETURNING id`,
      [p.id, `pub-${randomUUID().slice(0, 8)}`],
    )).rows[0].id;
    return { p, establishment, hidden, draft, published };
  };

  const leftovers = async (userId) => (await query(
    `SELECT (SELECT COUNT(*) FROM reviews WHERE user_id = $1 AND content IS NOT NULL)::int AS review_texts,
            (SELECT COUNT(*) FROM favorites WHERE user_id = $1)::int AS favorites,
            (SELECT COUNT(*) FROM device_tokens WHERE user_id = $1)::int AS device_tokens,
            (SELECT COUNT(*) FROM notification_preferences WHERE user_id = $1)::int AS preferences,
            (SELECT COUNT(*) FROM notifications WHERE user_id = $1)::int AS notifications,
            (SELECT COUNT(*) FROM partner_documents WHERE partner_id = $1 AND company_name IS NOT NULL)::int AS documents,
            (SELECT COUNT(*) FROM establishments WHERE partner_id = $1)::int AS cards`,
    [userId],
  )).rows[0];

  test('без --apply — список того, что сотрётся; в базе ничего не меняется', async () => {
    const { p, published } = await deletedEarlier();
    const before = await leftovers(p.id);

    const run = sweep();

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Mode: list — every change is rolled back.');
    expect(run.stdout).toContain('Deleted accounts: 1');
    expect(run.stdout).toContain('texts of invisible reviews: 1');
    expect(run.stdout).toContain('favourites: 1');
    expect(run.stdout).toContain('unfinished cards: 1');
    expect(run.stdout).toContain(`card ${published} (active) — account ${p.id}`);
    expect(run.stdout).not.toContain('Старый текст');
    expect(await leftovers(p.id)).toEqual(before);
  });

  test('--apply — стёрто то же, что стирает удаление сейчас; черновик ушёл с записью журнала; опубликованная названа и цела; повтор — нули', async () => {
    const { p, establishment, hidden, draft, published } = await deletedEarlier();
    const active = await person({ name: 'Живая учётка' });
    const activeHidden = await createTestReview(active.id, establishment.id, {
      content: 'Скрытый, но учётка жива', is_visible: false,
    });

    const run = sweep(['--apply', '--yes']);

    expect(run.status).toBe(0);
    expect(await leftovers(p.id)).toEqual({
      review_texts: 0, favorites: 0, device_tokens: 0, preferences: 0, notifications: 0, documents: 0, cards: 1,
    });
    expect(await reviewRow(hidden.id)).toMatchObject({ content: null, text: null });
    expect(await count('SELECT favorite_count::int AS n FROM establishments WHERE id = $1', [establishment.id])).toBe(0);
    expect(await count('SELECT COUNT(*)::int AS n FROM establishments WHERE id = $1', [draft])).toBe(0);
    expect(await count('SELECT COUNT(*)::int AS n FROM establishments WHERE id = $1', [published])).toBe(1);
    const draftEntry = (await query(
      `SELECT user_id, new_data FROM audit_log
       WHERE action = 'partner_delete_establishment' AND entity_id = $1`,
      [draft],
    )).rows;
    expect(draftEntry).toEqual([{ user_id: null, new_data: { actor: SWEEP_ACTOR } }]);
    // Учётка жива — её скрытый отзыв не трогают.
    expect(await reviewRow(activeHidden.id)).toMatchObject({ content: 'Скрытый, но учётка жива' });

    const again = sweep();
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('accounts with something left: 0 of 1');
  });

  test('неизвестный аргумент — отказ, ничего не тронуто', async () => {
    const { p } = await deletedEarlier();
    const before = await leftovers(p.id);

    const run = sweep(['--aply']);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unknown argument: --aply');
    expect(await leftovers(p.id)).toEqual(before);
  });
});
