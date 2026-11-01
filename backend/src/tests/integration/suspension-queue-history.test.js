/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Приостановленная карточка и очередь модератора (Координатор, 01.11.2026,
 * «А+В»).
 *
 * (А) Карточку, которую раньше приостанавливали, модератор видит в очереди с
 * пометкой «Раньше приостановлена»: кто (модератор, система, партнёр), почему
 * и когда — `previous_suspension` в детали карточки. До правки панель этого
 * не знала: метки приостановки стирались решением модератора, а деталь
 * отдавала автора только у карточки, приостановленной сейчас.
 *
 * (В) На модерацию из приостановки уходит только карточка, которую
 * приостановил модератор за содержание. Собственная пауза партнёра и
 * приостановка системой до решения, кому принадлежит карточка, — отказ со
 * своим кодом; сама приостановка при этом не меняется.
 *
 * Запросы идут настоящими маршрутами партнёра и панели. Карточки «из прошлого»
 * (ожидающая, отправленная до правки прямо из паузы партнёра или из спорной
 * приостановки) собираются записью в базу — сегодня маршрутом их не получить.
 * Ожидаемые тексты отказов — литералы: заготовки, ждущие слова Координатора.
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';

// Утверждены Координатором 01.11.2026.
const SUBMIT_FROM_OWN_PAUSE = 'Показ заведения приостановлен вами — отправлять его на модерацию не нужно. Чтобы гости снова видели заведение, возобновите показ.';
const SUBMIT_OWNERSHIP_DISPUTE = 'Карточка приостановлена до решения модератора: кому она принадлежит. До этого решения отправить её на модерацию нельзя. Если заведение ваше, напишите в поддержку: support@nirivio.by';
const EDIT_OWNERSHIP_DISPUTE = 'Карточка приостановлена до решения модератора: кому она принадлежит. До этого решения изменить её нельзя. Если заведение ваше, напишите в поддержку: support@nirivio.by';
// Утверждённый раньше текст обычной приостановки модератором — не меняется.
const MODERATOR_SUSPENDED = 'Заведение приостановлено модератором. Исправьте замечания и отправьте повторно на модерацию.';
// Текст причины, который пишет переход учётной записи (authService).
const TAKEOVER_REASON =
  'Учётная запись перешла к владельцу адреса e-mail после входа через Google или Яндекс. '
  + 'Карточка приостановлена до решения модератора: кому она принадлежит.';

const MODERATOR_NAME = 'Сергей Модераторов';

let moderator;
let partner;
let seq = 0;

beforeAll(async () => {
  await clearAllData();
  moderator = await createUserAndGetTokens({
    email: 'history-moderator@test.com',
    password: 'Admin123!@#',
    name: MODERATOR_NAME,
    role: 'admin',
  });
  partner = await createUserAndGetTokens({
    email: 'history-partner@test.com',
    password: 'Partner123!@#',
    name: 'Партнёр Истории',
    role: 'partner',
  });
});

afterAll(async () => {
  await clearAllData();
});

const asPartner = {
  submit: (id) => request(app).post(`/api/v1/partner/establishments/${id}/submit`)
    .set('Authorization', `Bearer ${partner.accessToken}`),
  pause: (id) => request(app).post(`/api/v1/partner/establishments/${id}/suspend`)
    .set('Authorization', `Bearer ${partner.accessToken}`),
  resume: (id) => request(app).post(`/api/v1/partner/establishments/${id}/resume`)
    .set('Authorization', `Bearer ${partner.accessToken}`),
  edit: (id, body) => request(app).put(`/api/v1/partner/establishments/${id}`)
    .set('Authorization', `Bearer ${partner.accessToken}`).send(body),
};

/** Карточка, приостановленная переходом учётной записи, — запись, как её делает authService. */
const disputedCard = async () => {
  const id = await activeCard();
  await query(
    "UPDATE establishments SET status = 'suspended', moderation_notes = $2 WHERE id = $1",
    [id, JSON.stringify({ suspend_reason: TAKEOVER_REASON, suspended_at: '2026-10-30T09:00:00.000Z', suspended_from: 'active' })],
  );
  return id;
};

const descriptionOf = async (id) => (await query('SELECT description FROM establishments WHERE id = $1', [id])).rows[0].description;

const asModerator = {
  detail: (id) => request(app).get(`/api/v1/admin/establishments/${id}`)
    .set('Authorization', `Bearer ${moderator.accessToken}`),
  suspend: (id, reason) => request(app).post(`/api/v1/admin/establishments/${id}/suspend`)
    .set('Authorization', `Bearer ${moderator.accessToken}`).send({ reason }),
  moderate: (id, body) => request(app).post(`/api/v1/admin/establishments/${id}/moderate`)
    .set('Authorization', `Bearer ${moderator.accessToken}`).send(body),
};

/** Опубликованная карточка партнёра со всеми полями, нужными для отправки. */
const activeCard = async () => {
  seq += 1;
  const est = await createTestEstablishment(partner.user.id);
  await query('UPDATE establishments SET name = $2 WHERE id = $1', [est.id, `История ${seq}`]);
  return est.id;
};

const statusOf = async (id) => (await query('SELECT status FROM establishments WHERE id = $1', [id])).rows[0].status;

const historyOf = async (id) => {
  const res = await asModerator.detail(id);
  expect(res.status).toBe(200);
  return res.body.data.previous_suspension;
};

const refusal = (res) => ({ http: res.status, code: res.body.error?.code, message: res.body.message });

describe('(А) «Раньше приостановлена» в очереди модератора', () => {
  it('приостановил модератор — партнёр отправил: кто, имя, причина и время; и после отказа модератора тоже', async () => {
    const id = await activeCard();
    await asModerator.suspend(id, 'Фото не того заведения').expect(200);
    await asPartner.submit(id).expect(200);
    expect(await statusOf(id)).toBe('pending');

    const first = await historyOf(id);
    expect(first).toMatchObject({ by: 'moderator', name: MODERATOR_NAME, reason: 'Фото не того заведения' });
    expect(Number.isNaN(Date.parse(first.at))).toBe(false);

    // Отказ модератора заменяет заметки целиком — метки приостановки уходят.
    // Партнёр исправил и отправил снова: история остаётся из журнала.
    await asModerator.moderate(id, { action: 'reject', moderation_notes: { name: 'Уточните название' } }).expect(200);
    const notes = (await query('SELECT moderation_notes FROM establishments WHERE id = $1', [id])).rows[0].moderation_notes;
    expect(JSON.parse(notes)).not.toHaveProperty('suspend_reason');
    await asPartner.submit(id).expect(200);

    expect(await historyOf(id)).toMatchObject({ by: 'moderator', name: MODERATOR_NAME, reason: 'Фото не того заведения' });
  });

  it('карточка, отправленная до правки прямо из паузы партнёра: «партнёр», без причины', async () => {
    const id = await activeCard();
    await asPartner.pause(id).expect(200);
    // Так её отправлял старый сервер: статус — в очередь, заметки не тронуты.
    await query("UPDATE establishments SET status = 'pending' WHERE id = $1", [id]);

    expect(await historyOf(id)).toMatchObject({ by: 'partner', name: null, reason: null });
  });

  it('карточка, отправленная до правки из спорной приостановки: «система», с её причиной', async () => {
    const id = await activeCard();
    const suspendedAt = '2026-10-30T09:00:00.000Z';
    await query(
      "UPDATE establishments SET status = 'pending', moderation_notes = $2 WHERE id = $1",
      [id, JSON.stringify({ suspend_reason: TAKEOVER_REASON, suspended_at: suspendedAt, suspended_from: 'active' })],
    );
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data)
       VALUES (NULL, 'suspend', 'establishment', $1, $2, $3)`,
      [id, JSON.stringify({ status: 'active' }), JSON.stringify({ status: 'suspended', reason: TAKEOVER_REASON })],
    );

    expect(await historyOf(id)).toEqual({ by: 'system', name: null, reason: TAKEOVER_REASON, at: suspendedAt });
  });

  it('карточку никогда не приостанавливали — пометки нет', async () => {
    const id = await activeCard();
    await query("UPDATE establishments SET status = 'pending' WHERE id = $1", [id]);

    expect(await historyOf(id)).toBeNull();
  });
});

describe('(В) Отправка на модерацию из приостановки', () => {
  it('из собственной паузы — отказ со своим кодом; пауза остаётся', async () => {
    const id = await activeCard();
    await asPartner.pause(id).expect(200);

    expect(refusal(await asPartner.submit(id)))
      .toEqual({ http: 400, code: 'SELF_PAUSED_SUBMISSION', message: SUBMIT_FROM_OWN_PAUSE });
    expect(await statusOf(id)).toBe('suspended');
  });

  it('из приостановки до решения, кому принадлежит карточка, — отказ со своим кодом; приостановка остаётся', async () => {
    const id = await disputedCard();

    expect(refusal(await asPartner.submit(id)))
      .toEqual({ http: 403, code: 'OWNERSHIP_DISPUTE', message: SUBMIT_OWNERSHIP_DISPUTE });
    expect(await statusOf(id)).toBe('suspended');
  });

  it('из приостановки модератора за содержание — как раньше: в очередь', async () => {
    const id = await activeCard();
    await asModerator.suspend(id, 'Цены не совпадают с меню').expect(200);

    await asPartner.submit(id).expect(200);
    expect(await statusOf(id)).toBe('pending');
  });
});

describe('Спорная карточка до решения модератора: ни правки, ни «Возобновить»', () => {
  it('правка — отказ со своим текстом, карточка не изменилась', async () => {
    const id = await disputedCard();
    const before = await descriptionOf(id);

    expect(refusal(await asPartner.edit(id, { description: 'Правка нового держателя' })))
      .toEqual({ http: 403, code: 'OWNERSHIP_DISPUTE', message: EDIT_OWNERSHIP_DISPUTE });
    expect(await descriptionOf(id)).toBe(before);
  });

  it('«Возобновить» — текст спора, а не «отправьте повторно»; код прежний', async () => {
    const id = await disputedCard();

    expect(refusal(await asPartner.resume(id)))
      .toEqual({ http: 403, code: 'ADMIN_SUSPENDED', message: SUBMIT_OWNERSHIP_DISPUTE });
    expect(await statusOf(id)).toBe('suspended');
  });

  it('обычная приостановка модератором: правка разрешена, «Возобновить» — прежний текст', async () => {
    const id = await activeCard();
    await asModerator.suspend(id, 'Цены не совпадают с меню').expect(200);

    await asPartner.edit(id, { description: 'Исправили цены' }).expect(200);
    expect(await descriptionOf(id)).toBe('Исправили цены');
    expect(refusal(await asPartner.resume(id)))
      .toEqual({ http: 403, code: 'ADMIN_SUSPENDED', message: MODERATOR_SUSPENDED });
  });
});
