/* eslint-env jest */
/**
 * Два вида фото карточки — «Фото заведения» и «Меню» (нитка «Фото людей»,
 * PR 2; директива §3; журнал решений, поправки CAT-E-2.1 и CAT-E-2.3).
 *
 * Отдельных видов «фасад» и «блюда» больше нет: уже лежащие фото фасада и
 * блюд становятся фото заведения. Гость разницы не видит (та же обложка, те же
 * фото, тот же порядок); партнёр видит их в кабинете и может удалить;
 * модератор — при проверке карточки. Сохранение из кабинета больше не меняет
 * обложку-фасад на первое фото зала (вывод разведки H8 §3 — проверен здесь
 * запуском на старом коде).
 *
 * База и HTTP настоящие; облако — заглушка SDK.
 */

import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../server.js';
import cloudinary, { generateAllResolutions } from '../../config/cloudinary.js';
import { clearAllData, query } from '../utils/database.js';
import { createAdminAndGetToken, createPartnerWithEstablishment } from '../utils/adminTestHelpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, '..', '..', '..', 'migrations', '042_two_photo_kinds.sql');
const ROLLBACK = join(HERE, '..', '..', '..', 'migrations', '042_rollback_two_photo_kinds.sql');
const JPEG = { filename: 'photo.jpg', contentType: 'image/jpeg' };

let partner;
let card;
let admin;

/** Фото карточки в её папке облака, вида `type`, с позицией и временем. */
const addPhoto = async (type, name, { position = 0, primary = false, minutesAgo = 0 } = {}) => {
  const urls = generateAllResolutions(`establishments/${card.id}/${type}/${name}`);
  const { rows } = await query(
    `INSERT INTO establishment_media (id, establishment_id, type, file_type, url, preview_url, thumbnail_url,
                                      position, is_primary, created_at)
     VALUES ($1, $2, $3, 'image', $4, $5, $6, $7, $8, NOW() - ($9::int * INTERVAL '1 minute'))
     RETURNING id`,
    [randomUUID(), card.id, type, urls.url, urls.preview_url, urls.thumbnail_url, position, primary, minutesAgo],
  );
  if (primary) {
    await query('UPDATE establishments SET primary_image_url = $2 WHERE id = $1', [card.id, urls.preview_url]);
  }
  return { id: rows[0].id, ...urls };
};

/** Карточка, какой её кладёт скрипт команды: обложка — фасад, затем зал и блюда. */
const seededCard = async () => {
  const facade = await addPhoto('exterior', 'facade', { position: 0, primary: true, minutesAgo: 30 });
  const hall1 = await addPhoto('interior', 'hall1', { position: 0, minutesAgo: 20 });
  const hall2 = await addPhoto('interior', 'hall2', { position: 1, minutesAgo: 19 });
  const dish = await addPhoto('dishes', 'dish', { position: 0, minutesAgo: 10 });
  const menu = await addPhoto('menu', 'menu1', { position: 0, minutesAgo: 5 });
  return { facade, hall1, hall2, dish, menu };
};

const asPartner = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${partner.accessToken}`);

const cover = async () => (await query('SELECT primary_image_url FROM establishments WHERE id = $1', [card.id]))
  .rows[0].primary_image_url;

/** Что видит гость: обложка каталога и галерея развёрнутой карточки (сервер отдаёт порядок). */
const guestView = async () => {
  const { body } = await request(app).get(`/api/v1/public/establishments/by-slug/${card.slug}`).expect(200);
  const data = body.data.establishment ?? body.data;
  return {
    cover: data.primary_image_url,
    gallery: data.media.filter((m) => m.type !== 'menu').map((m) => [m.url, m.is_primary]),
  };
};

beforeEach(async () => {
  await clearAllData();
  ({ partner, establishment: card } = await createPartnerWithEstablishment('active'));
  admin = await createAdminAndGetToken();
  jest.spyOn(cloudinary.uploader, 'upload').mockImplementation(async (_path, options) => ({
    public_id: `${options.folder}/new${randomUUID().slice(0, 4)}`,
    secure_url: `https://res.cloudinary.com/test/image/upload/v1/${options.folder}/new.jpg`,
    width: 800, height: 600, format: 'jpg', bytes: 4096,
  }));
  jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearAllData();
});

describe('кабинет: сохранение не меняет обложку-фасад (H8 §3)', () => {
  test('карточка как у скрипта команды: сохранили из кабинета — обложка та же', async () => {
    const photos = await seededCard();
    const before = await cover();
    const { body } = await asPartner('get', `/api/v1/partner/establishments/${card.id}`).expect(200);
    const form = body.data.establishment ?? body.data;

    await asPartner('put', `/api/v1/partner/establishments/${card.id}`)
      .send({ interior_photos: form.interior_photos, menu_photos: form.menu_photos, primary_photo: form.primary_photo?.url })
      .expect(200);

    expect(before).toBe(photos.facade.preview_url);
    expect(await cover()).toBe(photos.facade.preview_url);
  });

  // Форма, открытая до выкатки: прежний сервер отдавал в «Фото» только зал, и
  // автосохранение сайта шлёт этот список (ревью Phase 3.5 PR 2, обычное и по
  // линзе). До миграции 042 такое сохранение не стирает фасад и блюда.
  test('форма, открытая до выкатки (без фасада и блюд): строки целы, обложка — фасад', async () => {
    const photos = await seededCard();

    await asPartner('put', `/api/v1/partner/establishments/${card.id}`)
      .send({ interior_photos: [photos.hall1.url, photos.hall2.url], menu_photos: [photos.menu.url], primary_photo: photos.facade.url })
      .expect(200);

    const ids = (await query('SELECT id FROM establishment_media WHERE establishment_id = $1', [card.id])).rows.map((r) => r.id);
    expect(ids.sort()).toEqual([photos.facade.id, photos.hall1.id, photos.hall2.id, photos.dish.id, photos.menu.id].sort());
    expect(await cover()).toBe(photos.facade.preview_url);
  });
});

describe('партнёр и модератор видят все фото заведения', () => {
  test('кабинет: фасад и блюда — среди фото заведения, фасад можно удалить', async () => {
    const photos = await seededCard();
    const { body } = await asPartner('get', `/api/v1/partner/establishments/${card.id}`).expect(200);
    const form = body.data.establishment ?? body.data;

    expect(form.interior_photos.sort()).toEqual([photos.facade.url, photos.hall1.url, photos.hall2.url, photos.dish.url].sort());
    expect(form.menu_photos).toEqual([photos.menu.url]);

    await asPartner('delete', `/api/v1/partner/establishments/${card.id}/media/${photos.dish.id}`).expect(200);
    expect((await query('SELECT 1 FROM establishment_media WHERE id = $1', [photos.dish.id])).rows).toEqual([]);
  });

  test('карточка модерации: фасад и блюда — в «Фото», а не потеряны', async () => {
    const photos = await seededCard();
    await query("UPDATE establishments SET status = 'pending' WHERE id = $1", [card.id]);

    const { body } = await request(app).get(`/api/v1/admin/establishments/${card.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
    const detail = body.data.establishment ?? body.data;

    expect(detail.interior_photos.map((p) => p.url).sort())
      .toEqual([photos.facade.url, photos.hall1.url, photos.hall2.url, photos.dish.url].sort());
    expect(detail.interior_photos.find((p) => p.url === photos.facade.url).is_primary).toBe(true);
  });
});

describe('миграция 042: гость разницы не видит', () => {
  test('та же обложка и тот же порядок до и после; старый вид — в таблице для отката; откат возвращает', async () => {
    const photos = await seededCard();
    const before = await guestView();

    await query(readFileSync(MIGRATION, 'utf8'));
    const after = await guestView();
    const types = (await query('SELECT id, type FROM establishment_media WHERE establishment_id = $1 ORDER BY id', [card.id])).rows;
    const kept = (await query('SELECT media_id, type FROM establishment_media_kinds_042 ORDER BY media_id')).rows;

    expect(after).toEqual(before);
    expect(before.cover).toBe(photos.facade.preview_url);
    expect(types.filter((t) => t.type !== 'menu').every((t) => t.type === 'interior')).toBe(true);
    expect(kept).toEqual([
      { media_id: photos.facade.id, type: 'exterior' },
      { media_id: photos.dish.id, type: 'dishes' },
    ].sort((a, b) => a.media_id.localeCompare(b.media_id)));

    // Повтор ничего не меняет; откат возвращает виды; новое применение — снова.
    await query(readFileSync(MIGRATION, 'utf8'));
    await query(readFileSync(ROLLBACK, 'utf8'));
    expect((await query('SELECT type FROM establishment_media WHERE id = $1', [photos.facade.id])).rows[0].type).toBe('exterior');
    expect((await query("SELECT to_regclass('public.establishment_media_kinds_042') AS t")).rows[0].t).toBeNull();
    await query(readFileSync(MIGRATION, 'utf8'));
    expect(await guestView()).toEqual(before);
  });
});

describe('старые виды на входе и предел 30', () => {
  test('загрузка с видом «exterior» и «dishes» — фото заведения, не отказ и не 500', async () => {
    for (const type of ['exterior', 'dishes']) {
      const res = await asPartner('post', `/api/v1/partner/establishments/${card.id}/media`)
        .field('type', type)
        .attach('file', Buffer.from('fake-jpeg'), JPEG);
      expect([type, res.status]).toEqual([type, 201]);
    }
    const rows = (await query('SELECT type FROM establishment_media WHERE establishment_id = $1', [card.id])).rows;
    expect(rows.map((r) => r.type)).toEqual(['interior', 'interior']);
    const folders = cloudinary.uploader.upload.mock.calls.map(([, options]) => options.folder);
    expect(folders).toEqual([`establishments/${card.id}/interior`, `establishments/${card.id}/interior`]);
  });

  test('мастер: вид «dishes» уходит в папку фото заведения', async () => {
    const res = await asPartner('post', '/api/v1/partner/media/upload')
      .field('type', 'dishes')
      .attach('file', Buffer.from('fake-jpeg'), JPEG);
    expect(res.status).toBe(201);
    expect(cloudinary.uploader.upload.mock.calls[0][1].folder).toBe(`establishments/temp/${partner.user.id}/interior`);
  });

  const fill = async (counts) => {
    for (const [type, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i += 1) await addPhoto(type, `${type}${i}`, { position: i });
    }
  };
  const upload = () => asPartner('post', `/api/v1/partner/establishments/${card.id}/media`)
    .field('type', 'interior')
    .attach('file', Buffer.from('fake-jpeg'), JPEG);

  test('ровно 30 фото заведения вместе с фасадом и блюдами — прежний отказ', async () => {
    await fill({ exterior: 10, interior: 10, dishes: 10 });

    const res = await upload();

    expect([res.status, res.body.message]).toEqual([403, 'Можно добавить не больше 30 фото интерьера.']);
  });

  test('больше 30 после слияния: ничего не удалено, загрузка — отказ с числом, сохранение из кабинета работает', async () => {
    await fill({ exterior: 12, interior: 20 });

    const res = await upload();
    expect([res.status, res.body.message]).toEqual([
      403, 'У заведения уже 32 фото — больше, чем можно (30). Новое фото добавится, когда их станет меньше 30: удалите лишние.',
    ]);

    const { body } = await asPartner('get', `/api/v1/partner/establishments/${card.id}`).expect(200);
    const form = body.data.establishment ?? body.data;
    expect(form.interior_photos).toHaveLength(32);
    await asPartner('put', `/api/v1/partner/establishments/${card.id}`)
      .send({ interior_photos: form.interior_photos, menu_photos: form.menu_photos })
      .expect(200);
    expect((await query('SELECT COUNT(*)::int AS n FROM establishment_media WHERE establishment_id = $1', [card.id])).rows[0].n).toBe(32);
  });
});
