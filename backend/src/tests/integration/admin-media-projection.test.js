/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Media Projection Tests.
 *
 * Проекция детали заведения раньше отдавала только url и thumbnail_url, из-за
 * чего админка не могла ни показать снимок крупно, ни отличить PDF-меню от
 * картинки. Просмотрщик с увеличением опирается на preview_url и file_type —
 * эти тесты держат их на месте.
 *
 * Существующий тест детали проверяет лишь, что массивы медиа существуют, и на
 * пустых фикстурах проходит независимо от состава полей. Здесь медиа
 * вставляются явно.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import {
  createAdminAndGetToken,
  createPartnerWithEstablishment,
} from '../utils/adminTestHelpers.js';

let adminToken;
let establishmentId;

async function addMedia({ type, fileType, url, thumb, preview, isPrimary = false }) {
  const id = randomUUID();
  await query(
    `INSERT INTO establishment_media
       (id, establishment_id, type, url, thumbnail_url, preview_url, file_type, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, establishmentId, type, url, thumb, preview, fileType, isPrimary],
  );
  return id;
}

beforeAll(async () => {
  await clearAllData();

  adminToken = (await createAdminAndGetToken()).accessToken;

  const { establishment } = await createPartnerWithEstablishment('pending');
  establishmentId = establishment.id;

  await addMedia({
    type: 'interior',
    fileType: 'image',
    url: 'https://cdn.test/interior-full',
    thumb: 'https://cdn.test/interior-thumb',
    preview: 'https://cdn.test/interior-preview',
    isPrimary: true,
  });

  // Меню бывает и картинкой, и PDF — клиент обязан их различать.
  await addMedia({
    type: 'menu',
    fileType: 'image',
    url: 'https://cdn.test/menu-photo-full',
    thumb: 'https://cdn.test/menu-photo-thumb',
    preview: 'https://cdn.test/menu-photo-preview',
  });

  await addMedia({
    type: 'menu',
    fileType: 'pdf',
    url: 'https://cdn.test/menu.pdf',
    thumb: 'https://cdn.test/menu-pdf-thumb',
    preview: 'https://cdn.test/menu-pdf-page1',
  });
});

afterAll(async () => {
  await clearAllData();
});

describe('GET /api/v1/admin/establishments/:id — проекция медиа', () => {
  let data;

  beforeAll(async () => {
    const res = await request(app)
      .get(`/api/v1/admin/establishments/${establishmentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    data = res.body.data;
  });

  it('фото интерьера несёт preview_url и file_type', () => {
    expect(data.interior_photos).toHaveLength(1);

    const photo = data.interior_photos[0];
    expect(photo).toMatchObject({
      url: 'https://cdn.test/interior-full',
      thumbnail_url: 'https://cdn.test/interior-thumb',
      preview_url: 'https://cdn.test/interior-preview',
      file_type: 'image',
      is_primary: true,
    });
  });

  it('меню-картинка и меню-PDF различимы по file_type', () => {
    expect(data.menu_media).toHaveLength(2);

    const byType = Object.fromEntries(
      data.menu_media.map((m) => [m.file_type, m]),
    );

    expect(byType.image.url).toBe('https://cdn.test/menu-photo-full');
    expect(byType.pdf.url).toBe('https://cdn.test/menu.pdf');
    // Для PDF растр первой страницы — единственное, что можно показать.
    expect(byType.pdf.preview_url).toBe('https://cdn.test/menu-pdf-page1');
  });

  it('is_primary есть только у фото интерьера — у меню его смысла нет', () => {
    expect(data.interior_photos[0]).toHaveProperty('is_primary');
    for (const item of data.menu_media) {
      expect(item).not.toHaveProperty('is_primary');
    }
  });
});
