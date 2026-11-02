/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Establishments Management System Integration Tests
 *
 * Tests all establishment management functionality:
 * - Create establishment (partner only, draft status)
 * - List establishments (pagination, filtering, ownership)
 * - Get establishment details
 * - Update establishment (ownership verification, status transitions)
 * - Submit for moderation (status workflow)
 * - Belarus-specific validation (cities, coordinates, categories, cuisines)
 * - Authorization and ownership checks
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, getClient, query } from '../utils/database.js';
import { sdkAnalyticsQuery } from '../utils/cloudinaryAnalytics.js';
import { createTestUser, createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import { createPartnerWithEstablishment } from '../utils/adminTestHelpers.js';
import {
  testEstablishments,
  invalidEstablishments,
  minimalEstablishment
} from '../fixtures/establishments.js';

let partnerToken;
let partner2Token;
let userToken;
let adminToken;
let partnerId;

// Setup and teardown
beforeAll(async () => {
  // Create test users
  const partner1 = await createUserAndGetTokens(testUsers.partner);
  const partner2 = await createUserAndGetTokens(testUsers.partner2);
  const user = await createUserAndGetTokens(testUsers.regularUser);
  const admin = await createUserAndGetTokens(testUsers.admin);

  partnerToken = partner1.accessToken;
  partner2Token = partner2.accessToken;
  userToken = user.accessToken;
  adminToken = admin.accessToken;
  partnerId = partner1.user.id;
});

beforeEach(async () => {
  // Clear establishments before each test
  await query('TRUNCATE TABLE establishments CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

describe('Establishments System - Create Establishment', () => {
  describe('POST /api/v1/partner/establishments - Basic Creation', () => {
    test('should create new establishment in draft status', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.establishment).toBeDefined();

      const establishment = response.body.data.establishment;
      expect(establishment.name).toBe(testEstablishments[0].name);
      expect(establishment.city).toBe('Минск');
      expect(establishment.status).toBe('draft');
      expect(establishment.partner_id).toBe(partnerId);
      expect(establishment.id).toBeDefined();
    });

    test('should create establishment with all fields', async () => {
      const establishmentData = testEstablishments[0];

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(establishmentData)
        .expect(201);

      const establishment = response.body.data.establishment;
      expect(establishment.name).toBe(establishmentData.name);
      expect(establishment.description).toBe(establishmentData.description);
      expect(establishment.city).toBe(establishmentData.city);
      expect(establishment.address).toBe(establishmentData.address);
      expect(parseFloat(establishment.latitude)).toBeCloseTo(establishmentData.latitude);
      expect(parseFloat(establishment.longitude)).toBeCloseTo(establishmentData.longitude);
      expect(establishment.phone).toBe(establishmentData.phone);
      expect(establishment.email).toBe(establishmentData.email);
      expect(establishment.website).toBe(establishmentData.website);
      expect(establishment.categories).toEqual(establishmentData.categories);
      expect(establishment.cuisines).toEqual(establishmentData.cuisines);
      expect(establishment.price_range).toBe(establishmentData.price_range);
      expect(establishment.working_hours).toEqual(establishmentData.working_hours);
    });

    test('should create establishment with minimal required fields', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(minimalEstablishment)
        .expect(201);

      const establishment = response.body.data.establishment;
      expect(establishment.name).toBe(minimalEstablishment.name);
      expect(establishment.city).toBe(minimalEstablishment.city);
      expect(establishment.working_hours).toBeDefined();
      expect(establishment.phone).toBeNull();
      expect(establishment.email).toBeNull();
      expect(establishment.website).toBeNull();
    });

    test('should reject creation without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .send(testEstablishments[0])
        .expect(401);

      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    test('should allow creation by regular user (auto-upgrade to partner)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${userToken}`)
        .send(testEstablishments[0])
        .expect(201);

      expect(response.body.data.establishment).toBeDefined();
    });

    // The first card in the app makes a user a partner, and the partner stays
    // signed in. The session is a real one — opened by /auth/login, as the app
    // opens it — and the test then holds what the app holds after the answer:
    // mobile establishments_service.dart replaces its pair with data.tokens
    // when data.tokens.accessToken is present, and keeps its own otherwise.
    // Until 2026-10-19 the server sent a refresh token it never stored, the
    // app took it, and /auth/refresh answered 401 once the access token
    // expired (honesty audit Д7).
    test('first card upgrades a user to partner, and the session the app holds still refreshes', async () => {
      await createTestUser({
        email: 'first-card@test.com',
        password: 'FirstCard123!@#',
        name: 'Первая Карточка',
        role: 'user',
      });
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'first-card@test.com', password: 'FirstCard123!@#' })
        .expect(200);
      const session = {
        accessToken: login.body.data.accessToken,
        refreshToken: login.body.data.refreshToken,
      };

      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ ...testEstablishments[0], name: 'Первая карточка' })
        .expect(201);

      const { rows: [account] } = await query(
        'SELECT role FROM users WHERE id = $1',
        [login.body.data.user.id],
      );
      expect(account.role).toBe('partner');

      const handedOut = created.body.data.tokens;
      const held = handedOut && handedOut.accessToken ? handedOut : session;

      const own = await request(app)
        .get('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${held.accessToken}`)
        .expect(200);
      expect(own.body.data.establishments.map((e) => e.name)).toEqual(['Первая карточка']);

      const refreshed = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: held.refreshToken })
        .expect(200);
      expect(refreshed.body.data.user.role).toBe('partner');

      await request(app)
        .get('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${refreshed.body.data.accessToken}`)
        .expect(200);

      // The chosen contract: no pair in the answer, the app keeps its own.
      expect(created.body.data.tokens).toBeUndefined();
    });

    // The role change fails — here the database refuses it, by a trigger on
    // this one account. Until 2026-11-02 the failure was only logged: the
    // answer was 201, the card stayed, the role stayed «user», and the
    // person's own list answered 403 (minor defects П3). Now the request is
    // refused and nothing is written.
    test('a role change that fails refuses the card and leaves none', async () => {
      const { user, accessToken } = await createUserAndGetTokens({
        email: 'role-refused@test.com',
        password: 'RoleRefused123!@#',
        name: 'Роль Не Сменилась',
        role: 'user',
      });
      await query(`
        CREATE OR REPLACE FUNCTION test_refuse_role_change() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'role change refused by the test';
        END
        $$ LANGUAGE plpgsql
      `);
      await query(`
        CREATE TRIGGER test_refuse_role_change BEFORE UPDATE OF role ON users
        FOR EACH ROW WHEN (OLD.email = 'role-refused@test.com')
        EXECUTE FUNCTION test_refuse_role_change()
      `);

      let response;
      try {
        response = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ ...testEstablishments[0], name: 'Карточка без роли' });
      } finally {
        await query('DROP TRIGGER IF EXISTS test_refuse_role_change ON users');
        await query('DROP FUNCTION IF EXISTS test_refuse_role_change()');
      }

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('ESTABLISHMENT_CREATE_FAILED');
      expect(response.body.message).toBe('Не удалось создать заведение. Попробуйте ещё раз позже.');

      const { rows: [account] } = await query('SELECT role FROM users WHERE id = $1', [user.id]);
      expect(account.role).toBe('user');
      const { rows: cards } = await query(
        'SELECT id FROM establishments WHERE partner_id = $1',
        [user.id],
      );
      expect(cards).toEqual([]);
    });

    // An account already left that way before 2026-11-02 — a card of its
    // own, the role «user». Sending the same card again gives the role back:
    // the answer is still 409 «…оно в списке ваших заведений», and the list
    // now opens.
    test('an account left with a card and the role «user» gets its role back on sending the card again', async () => {
      const { partner, establishment } = await createPartnerWithEstablishment('draft');
      await query("UPDATE users SET role = 'user' WHERE id = $1", [partner.user.id]);

      const again = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partner.accessToken}`)
        .send({ ...testEstablishments[0], name: establishment.name })
        .expect(409);
      expect(again.body.error.code).toBe('DUPLICATE_ESTABLISHMENT');

      const { rows: [account] } = await query('SELECT role FROM users WHERE id = $1', [partner.user.id]);
      expect(account.role).toBe('partner');

      const own = await request(app)
        .get('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partner.accessToken}`)
        .expect(200);
      expect(own.body.data.establishments.map((e) => e.id)).toEqual([establishment.id]);
    });
  });

  describe('POST/PUT - Media Materialization Limits & OCR enqueue', () => {
    // Media links are the partner's own uploads in the shape the temp-upload
    // route hands out (canonical extension-less delivery URL; PDF secure_url
    // with version and .pdf): saving a card accepts only files from the
    // partner's own folders (establishment-media-ownership.test.js). Builders,
    // not constants — partnerId is known only after beforeAll.
    const photoUrls = (count, prefix) => Array.from(
      { length: count },
      (_, i) => `https://res.cloudinary.com/test/image/upload/c_limit,w_1920/f_auto,fl_progressive,q_auto/v1/establishments/temp/${partnerId}/${prefix}/p${i}?_a=BAMAMiRg0`,
    );
    // Превью тех же файлов (w1200): его сервер пишет в preview_url и в обложку
    // каталога. Хвост ?_a= — от SDK этого процесса (зависит от версии Node).
    const previewUrls = (count, prefix) => Array.from(
      { length: count },
      (_, i) => `https://res.cloudinary.com/test/image/upload/c_limit,w_1200/f_auto,fl_progressive,q_auto/v1/establishments/temp/${partnerId}/${prefix}/p${i}${sdkAnalyticsQuery()}`,
    );

    // Бюджет 8000, а не 2000: на медленном раннере двух секунд может не
    // хватить. Держится под jest testTimeout (10000), поэтому глобальный
    // таймаут поднимать не требуется. В счастливом пути цикл выходит сразу.
    const pollOcrJobs = async (establishmentId, expected, timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const jobs = await query(
          'SELECT media_id FROM ocr_jobs WHERE establishment_id = $1',
          [establishmentId],
        );
        if (jobs.rows.length >= expected) return jobs.rows;
        if (Date.now() > deadline) {
          // Падать честно, а не возвращать неполный результат: иначе истёкшее
          // время выглядит как дефект постановки OCR в очередь.
          throw new Error(
            `OCR-задачи не появились за ${timeoutMs} мс: ожидалось ${expected}, получено ${jobs.rows.length}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };

    test('create accepts 30 interior photos at the bucket limit', async () => {
      const data = { ...testEstablishments[0], interior_photos: photoUrls(30, 'interior') };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      const media = await query(
        "SELECT id FROM establishment_media WHERE establishment_id = $1 AND type = 'interior'",
        [response.body.data.establishment.id],
      );
      expect(media.rows).toHaveLength(30);
    });

    test('create rejects 31 interior photos with MEDIA_LIMIT_EXCEEDED, no orphan row', async () => {
      const data = { ...testEstablishments[0], interior_photos: photoUrls(31, 'interior') };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(403);

      expect(response.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');

      // Validation fires before the INSERT — no orphan establishment row.
      const rows = await query('SELECT id FROM establishments', []);
      expect(rows.rows).toHaveLength(0);
    });

    test('create rejects 31 menu photos with MEDIA_LIMIT_EXCEEDED', async () => {
      const data = { ...testEstablishments[0], menu_photos: photoUrls(31, 'menu') };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(403);

      expect(response.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');
    });

    test('create with menu photos enqueues OCR jobs for them only (vision_image parity)', async () => {
      const data = {
        ...testEstablishments[0],
        interior_photos: photoUrls(2, 'interior'),
        menu_photos: photoUrls(2, 'menu'),
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      const estId = response.body.data.establishment.id;
      const jobs = await pollOcrJobs(estId, 2);
      expect(jobs).toHaveLength(2);

      const menuMedia = await query(
        "SELECT id FROM establishment_media WHERE establishment_id = $1 AND type = 'menu'",
        [estId],
      );
      expect(jobs.map((j) => j.media_id).sort())
        .toEqual(menuMedia.rows.map((r) => r.id).sort());
    });

    test('PUT media-sync rejects 31 photos per bucket, accepts 30', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const over = await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: photoUrls(31, 'interior') })
        .expect(403);
      expect(over.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');

      const overMenu = await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: photoUrls(31, 'menu') })
        .expect(403);
      expect(overMenu.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');

      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: photoUrls(30, 'interior') })
        .expect(200);

      const media = await query(
        "SELECT id FROM establishment_media WHERE establishment_id = $1 AND type = 'interior'",
        [estId],
      );
      expect(media.rows).toHaveLength(30);
    });

    // Regression: cabinet cards are created in two stages (POST at validator
    // minimum WITHOUT photos, then autosave PUT adds media). The PUT media-sync
    // must populate establishments.primary_image_url (catalog thumbnail) and type
    // menu PDFs correctly — both were broken (MARBL, 2026-07-20).
    const menuPdfUrl = () => `https://res.cloudinary.com/test/image/upload/v1759600000/establishments/temp/${partnerId}/menu_pdf/abc.pdf`;

    test('two-stage create→PUT populates establishments.primary_image_url', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;
      expect(created.body.data.establishment.primary_image_url).toBeNull();

      const interior = photoUrls(3, 'interior');
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: interior, primary_photo: interior[1] })
        .expect(200);

      const row = await query('SELECT primary_image_url FROM establishments WHERE id = $1', [estId]);
      expect(row.rows[0].primary_image_url).toBe(previewUrls(3, 'interior')[1]);
    });

    test('PUT falls back to the first interior photo as primary when none named', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const interior = photoUrls(2, 'interior');
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: interior })
        .expect(200);

      const row = await query('SELECT primary_image_url FROM establishments WHERE id = $1', [estId]);
      expect(row.rows[0].primary_image_url).toBe(previewUrls(1, 'interior')[0]);
    });

    test('removing all interior photos clears primary_image_url', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const interior = photoUrls(2, 'interior');
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: interior })
        .expect(200);
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: [] })
        .expect(200);

      const row = await query('SELECT primary_image_url FROM establishments WHERE id = $1', [estId]);
      expect(row.rows[0].primary_image_url).toBeNull();
    });

    test('PUT with a menu PDF url stores file_type=pdf + transformed pg_1 preview', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: [menuPdfUrl()] })
        .expect(200);

      const row = await query(
        "SELECT file_type, url, preview_url, thumbnail_url FROM establishment_media WHERE establishment_id = $1 AND type = 'menu'",
        [estId],
      );
      expect(row.rows).toHaveLength(1);
      const m = row.rows[0];
      expect(m.file_type).toBe('pdf');
      expect(m.url).toBe(menuPdfUrl()); // original preserved for download
      expect(m.preview_url).not.toBe(menuPdfUrl()); // transformed, not raw pdf (Cloudinary 401s raw)
      expect(m.preview_url).toContain('pg_1');
      expect(m.thumbnail_url).toContain('pg_1');
    });

    test('PUT with a plain image menu url keeps file_type=image (unchanged url, w1200 preview)', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const menuImg = photoUrls(1, 'menu')[0];
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: [menuImg] })
        .expect(200);

      const row = await query(
        "SELECT file_type, preview_url FROM establishment_media WHERE establishment_id = $1 AND type = 'menu'",
        [estId],
      );
      expect(row.rows[0].file_type).toBe('image');
      expect(row.rows[0].preview_url).toBe(previewUrls(1, 'menu')[0]);
    });

    // Regression: cabinet menus arrive via the two-stage flow (POST without
    // media, then autosave PUT), so OCR must be enqueued on the sync path too —
    // before 2026-07-20 only createEstablishment enqueued, and no cabinet menu
    // was ever recognized (MARBL).
    test('PUT media-sync enqueues OCR for newly inserted menu media only', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const menuUrls = [photoUrls(1, 'menu')[0], menuPdfUrl()];
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: photoUrls(2, 'interior'), menu_photos: menuUrls })
        .expect(200);

      const jobs = await pollOcrJobs(estId, 2);
      const menuMedia = await query(
        "SELECT id FROM establishment_media WHERE establishment_id = $1 AND type = 'menu'",
        [estId],
      );
      expect(menuMedia.rows).toHaveLength(2);
      expect(jobs.map((j) => j.media_id).sort())
        .toEqual(menuMedia.rows.map((r) => r.id).sort());

      // Re-sending the same bucket must not duplicate jobs (diff yields no
      // inserts; enqueue idempotency is the second guard).
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: menuUrls })
        .expect(200);
      const jobsAfter = await query(
        'SELECT media_id FROM ocr_jobs WHERE establishment_id = $1',
        [estId],
      );
      expect(jobsAfter.rows).toHaveLength(2);
    });

    // A menu file is recognised once per card, however its link is spelled
    // (review of PR #56, finding 1): recognition is paid per call, and a save
    // that named a file of the card anew — another version, size or query —
    // used to delete its row, with the job and the dishes, and queue it again.
    describe('one menu file — one row and one recognition per card', () => {
      const menuRows = async (estId) => (await query(
        "SELECT id, url, file_type FROM establishment_media WHERE establishment_id = $1 AND type = 'menu' ORDER BY position, created_at",
        [estId],
      )).rows;
      const createCard = async (media = {}) => {
        const created = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send({ ...testEstablishments[0], ...media })
          .expect(201);
        return created.body.data.establishment.id;
      };
      const saveMenu = (estId, menuPhotos, extra = {}) => request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: menuPhotos, ...extra });
      /** The same file as photoUrls(1, 'menu')[0]: no size and format steps, another version and query. */
      const respelled = () => `https://res.cloudinary.com/test/image/upload/v2/establishments/temp/${partnerId}/menu/p0?_a=other`;
      const pdf = (name) => `https://res.cloudinary.com/test/image/upload/v1759600000/establishments/temp/${partnerId}/menu_pdf/${name}.pdf`;

      test('PUT: a file the card already has, linked in another spelling, keeps its row, its job and its dishes', async () => {
        const estId = await createCard();
        const [menuPhoto] = photoUrls(1, 'menu');
        await saveMenu(estId, [menuPhoto]).expect(200);
        const [job] = await pollOcrJobs(estId, 1);
        const [row] = await menuRows(estId);
        // Recognised: the job is done and the file has a dish.
        await query("UPDATE ocr_jobs SET status = 'done', completed_at = NOW() WHERE media_id = $1", [job.media_id]);
        await query(
          "INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn) VALUES ($1, $2, 'Борщ', 12)",
          [estId, row.id],
        );

        await saveMenu(estId, [respelled()]).expect(200);

        expect(await menuRows(estId)).toEqual([{ id: row.id, url: menuPhoto, file_type: 'image' }]);
        const jobs = await query('SELECT media_id, status FROM ocr_jobs WHERE establishment_id = $1', [estId]);
        expect(jobs.rows).toEqual([{ media_id: row.id, status: 'done' }]);
        const dishes = await query('SELECT item_name FROM menu_items WHERE media_id = $1', [row.id]);
        expect(dishes.rows).toEqual([{ item_name: 'Борщ' }]);
      });

      test('PUT: the same file twice in the list — one row and one job; so are two spellings of one new file', async () => {
        const estId = await createCard();
        const [menuPhoto] = photoUrls(1, 'menu');

        await saveMenu(estId, [menuPhoto, menuPhoto, respelled()]).expect(200);

        const rows = await menuRows(estId);
        expect(rows.map((m) => m.url)).toEqual([menuPhoto]);
        const jobs = await pollOcrJobs(estId, 1);
        expect(jobs.map((j) => j.media_id)).toEqual([rows[0].id]);
      });

      test('PUT: two menu PDFs are accepted', async () => {
        const estId = await createCard();

        await saveMenu(estId, [pdf('a'), pdf('b')]).expect(200);

        expect((await menuRows(estId)).map((m) => [m.url, m.file_type])).toEqual([[pdf('a'), 'pdf'], [pdf('b'), 'pdf']]);
      });

      test('PUT: a third menu PDF is refused before any write — 403 PDF_LIMIT_EXCEEDED, the card as it was', async () => {
        const estId = await createCard();
        const [hall] = photoUrls(1, 'interior');
        await saveMenu(estId, [pdf('a'), pdf('b')], { interior_photos: [hall] }).expect(200);
        const before = await menuRows(estId);

        // The same save also removes the hall photo and renames the card.
        const response = await saveMenu(estId, [pdf('a'), pdf('b'), pdf('c')], { interior_photos: [], name: 'Новое имя' })
          .expect(403);

        expect(response.body.error.code).toBe('PDF_LIMIT_EXCEEDED');
        expect(response.body.message).toBe('Можно добавить не больше 2 файлов меню в формате PDF.');
        expect(await menuRows(estId)).toEqual(before);
        const interior = await query(
          "SELECT url FROM establishment_media WHERE establishment_id = $1 AND type = 'interior'",
          [estId],
        );
        expect(interior.rows).toEqual([{ url: hall }]);
        const card = await query('SELECT name FROM establishments WHERE id = $1', [estId]);
        expect(card.rows[0].name).toBe(testEstablishments[0].name);
      });

      test('PUT: interior photos still match by the link as sent — a photo in another spelling replaces the row, the cover is its preview', async () => {
        const estId = await createCard();
        const [hall] = photoUrls(1, 'interior');
        const hallRespelled = `https://res.cloudinary.com/test/image/upload/v2/establishments/temp/${partnerId}/interior/p0`;
        await request(app)
          .put(`/api/v1/partner/establishments/${estId}`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .send({ interior_photos: [hall], primary_photo: hall })
          .expect(200);

        await request(app)
          .put(`/api/v1/partner/establishments/${estId}`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .send({ interior_photos: [hallRespelled], primary_photo: hallRespelled })
          .expect(200);

        const interior = await query(
          "SELECT url FROM establishment_media WHERE establishment_id = $1 AND type = 'interior'",
          [estId],
        );
        expect(interior.rows).toEqual([{ url: hallRespelled }]);
        const card = await query('SELECT primary_image_url FROM establishments WHERE id = $1', [estId]);
        expect(card.rows[0].primary_image_url).toBe(previewUrls(1, 'interior')[0]);
      });

      test('a PDF\'s file linked without an extension is refused — as a photo it would be read whole (422 INVALID_FILE_TYPE)', async () => {
        const pdfFile = `https://res.cloudinary.com/test/image/upload/v1759600000/establishments/temp/${partnerId}/menu_pdf/a`;
        const estId = await createCard();

        const save = await saveMenu(estId, [pdfFile]).expect(422);
        const create = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send({ ...testEstablishments[0], name: 'Другое имя', menu_photos: [pdfFile] })
          .expect(422);

        for (const response of [save, create]) {
          expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
          expect(response.body.message).toBe('Этот формат не подходит: фото — JPG, PNG, WebP или HEIC, меню — ещё и PDF.');
        }
        expect(await menuRows(estId)).toEqual([]);
      });

      test('PUT: replacing one of two PDFs with another is not over the limit', async () => {
        const estId = await createCard();
        await saveMenu(estId, [pdf('a'), pdf('b')]).expect(200);

        await saveMenu(estId, [pdf('a'), pdf('c')]).expect(200);

        expect((await menuRows(estId)).map((m) => m.url)).toEqual([pdf('a'), pdf('c')]);
      });

      test('PUT: a card that already holds three PDFs saves an edit that adds none', async () => {
        const estId = await createCard();
        for (const [index, name] of ['a', 'b', 'c'].entries()) {
          await query(
            `INSERT INTO establishment_media (establishment_id, type, file_type, url, position)
             VALUES ($1, 'menu', 'pdf', $2, $3)`,
            [estId, pdf(name), index],
          );
        }
        const [menuPhoto] = photoUrls(1, 'menu');

        await saveMenu(estId, [pdf('a'), pdf('b'), pdf('c'), menuPhoto]).expect(200);

        expect((await menuRows(estId)).map((m) => m.url)).toEqual([pdf('a'), pdf('b'), pdf('c'), menuPhoto]);
      });

      test('create: the same menu photo twice — one row and one job', async () => {
        const [menuPhoto] = photoUrls(1, 'menu');

        const estId = await createCard({ menu_photos: [menuPhoto, respelled()] });

        const rows = await menuRows(estId);
        expect(rows.map((m) => m.url)).toEqual([menuPhoto]);
        const jobs = await pollOcrJobs(estId, 1);
        expect(jobs.map((j) => j.media_id)).toEqual([rows[0].id]);
      });

      test('create: the same menu PDF twice — one row', async () => {
        const estId = await createCard({ menu_pdfs: [{ url: pdf('a') }, { url: pdf('a') }] });

        expect((await menuRows(estId)).map((m) => [m.url, m.file_type])).toEqual([[pdf('a'), 'pdf']]);
      });

      test('create: two PDFs are kept, a third is dropped as before; a repeated one takes no place', async () => {
        const estId = await createCard({ menu_pdfs: [{ url: pdf('a') }, { url: pdf('a') }, { url: pdf('b') }, { url: pdf('c') }] });

        expect((await menuRows(estId)).map((m) => m.url)).toEqual([pdf('a'), pdf('b')]);
      });

      test('create: a menu photo naming the file of a menu PDF is not a second file', async () => {
        // The first page of the PDF as a picture — the same file of the cloud.
        const firstPage = `https://res.cloudinary.com/test/image/upload/v1759600000/establishments/temp/${partnerId}/menu_pdf/a.jpg`;

        const estId = await createCard({ menu_pdfs: [{ url: pdf('a') }], menu_photos: [firstPage] });

        expect((await menuRows(estId)).map((m) => [m.url, m.file_type])).toEqual([[pdf('a'), 'pdf']]);
      });
    });

    // Regression (MARKS, 2026-07-20): an .ai URL in the menu bucket lands as
    // file_type='image' and renders broken everywhere. The URL extension gate
    // must reject it before any DB write.
    const aiUrl = () => `https://res.cloudinary.com/test/image/upload/v1759600000/establishments/temp/${partnerId}/menu_pdf/menu.ai`;

    test('create rejects an .ai menu url with INVALID_FILE_TYPE, no orphan row', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], menu_photos: [aiUrl()] })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
      const rows = await query('SELECT id FROM establishments', []);
      expect(rows.rows).toHaveLength(0);
    });

    test('create rejects a PDF url in menu_photos (create types that bucket as image)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], menu_photos: [menuPdfUrl()] })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
    });

    test('PUT media-sync rejects an .ai menu url and writes nothing', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const response = await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: [aiUrl()] })
        .expect(422);
      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');

      const media = await query(
        'SELECT id FROM establishment_media WHERE establishment_id = $1',
        [estId],
      );
      expect(media.rows).toHaveLength(0);
    });

    test('PUT media-sync rejects a PDF url in the interior bucket', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      const response = await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: [menuPdfUrl()] })
        .expect(422);
      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
    });

    // Contract pin: canonical image delivery URLs built by
    // generateAllResolutions carry NO extension (cloudinary.url() without
    // `format` — transformation segment + public_id + query only). The gate
    // must accept that shape for image buckets, or every real cabinet
    // autosave PUT / mobile registration finalize 422s (found in review,
    // 2026-07-20).
    const extensionlessUrl = () => `https://res.cloudinary.com/test/image/upload/c_limit,h_1080,w_1920/f_auto,fl_progressive,q_auto/v1/establishments/temp/${partnerId}/interior/abc123xyz?_a=BAMAK`;

    test('PUT media-sync accepts a canonical extension-less image url', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ interior_photos: [extensionlessUrl()], menu_photos: [extensionlessUrl()] })
        .expect(200);

      const media = await query(
        'SELECT id FROM establishment_media WHERE establishment_id = $1',
        [estId],
      );
      expect(media.rows).toHaveLength(2);
    });

    test('create accepts a canonical extension-less image url', async () => {
      await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], interior_photos: [extensionlessUrl()] })
        .expect(201);
    });

    test('PUT media-sync keeps accepting an unchanged legacy url set (gate is insert-only)', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);
      const estId = created.body.data.establishment.id;

      // Seed a legacy row whose url would FAIL today's gate (pre-gate data).
      await query(
        `INSERT INTO establishment_media
           (establishment_id, type, file_type, url, thumbnail_url, preview_url, position)
         VALUES ($1, 'menu', 'image', $2, $2, $2, 0)`,
        [estId, aiUrl()],
      );

      // Re-sending the same set = no new inserts → must stay 200.
      await request(app)
        .put(`/api/v1/partner/establishments/${estId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ menu_photos: [aiUrl()] })
        .expect(200);
    });
  });

  describe('POST /api/v1/partner/establishments - Belarus City Validation', () => {
    test('should accept Минск', async () => {
      const data = { ...testEstablishments[0], city: 'Минск' };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.city).toBe('Минск');
    });

    test('should accept Гродно', async () => {
      const data = { ...testEstablishments[0], city: 'Гродно', latitude: 53.68, longitude: 23.83 };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.city).toBe('Гродно');
    });

    test('should accept Брест', async () => {
      const data = { ...testEstablishments[0], city: 'Брест', latitude: 52.1, longitude: 23.7 };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.city).toBe('Брест');
    });

    test('should accept Гомель', async () => {
      const data = { ...testEstablishments[0], city: 'Гомель', latitude: 52.42, longitude: 31.0 };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.city).toBe('Гомель');
    });

    test('should accept Витебск, Могилев, Бобруйск', async () => {
      const citiesWithCoords = [
        { city: 'Витебск', latitude: 55.19, longitude: 30.2 },
        { city: 'Могилев', latitude: 53.91, longitude: 30.35 },
        { city: 'Бобруйск', latitude: 53.15, longitude: 29.25 },
      ];

      for (const { city, latitude, longitude } of citiesWithCoords) {
        const data = { ...testEstablishments[0], name: `Test ${city}`, city, latitude, longitude };

        const response = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(data)
          .expect(201);

        expect(response.body.data.establishment.city).toBe(city);
      }
    });

    test('should reject invalid city (Москва)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.invalidCity)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.message.toLowerCase()).toContain('validation');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'city' })])
      );
    });

    test('should reject invalid city (Kiev)', async () => {
      const data = { ...testEstablishments[0], city: 'Киев' };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/partner/establishments - Geographic Coordinates Validation', () => {
    test('should accept valid Minsk coordinates', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 53.9,
        longitude: 27.5
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(parseFloat(response.body.data.establishment.latitude)).toBeCloseTo(53.9);
      expect(parseFloat(response.body.data.establishment.longitude)).toBeCloseTo(27.5);
    });

    test('should accept coordinates at Belarus boundaries', async () => {
      // Northern city (Витебск) — near north of Belarus
      const neData = {
        ...testEstablishments[0],
        name: 'NE Corner',
        city: 'Витебск',
        latitude: 55.19,
        longitude: 30.2
      };

      await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(neData)
        .expect(201);

      // South-Western city (Брест) — near south-west of Belarus
      const swData = {
        ...testEstablishments[0],
        name: 'SW Corner',
        city: 'Брест',
        latitude: 52.1,
        longitude: 23.7
      };

      await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(swData)
        .expect(201);
    });

    test('should reject coordinates outside Belarus (Moscow)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.outsideBelarus)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'longitude' })])
      );
    });

    test('should reject coordinates north of Belarus', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 57.0, // Above 56.0
        longitude: 27.5
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject coordinates south of Belarus', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 50.0, // Below 51.0
        longitude: 27.5
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject coordinates west of Belarus', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 53.9,
        longitude: 22.0 // Below 23.0
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject coordinates east of Belarus', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 53.9,
        longitude: 34.0 // Above 33.0
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/partner/establishments - Categories Validation', () => {
    test('should accept 1 category', async () => {
      const data = {
        ...testEstablishments[0],
        categories: ['Ресторан']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.categories).toEqual(['Ресторан']);
    });

    test('should accept 2 categories', async () => {
      const data = {
        ...testEstablishments[0],
        categories: ['Ресторан', 'Бар']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.categories).toEqual(['Ресторан', 'Бар']);
    });

    test('should reject 0 categories', async () => {
      const data = {
        ...testEstablishments[0],
        categories: []
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject 3 categories (max is 2)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.tooManyCategories)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should accept all valid category types', async () => {
      const validCategories = [
        'Ресторан', 'Кофейня', 'Кафе', 'Фаст-фуд', 'Бар', 'Кондитерская',
        'Пиццерия', 'Пекарня', 'Паб', 'Столовая', 'Кальянная',
        'Боулинг', 'Караоке', 'Бильярд', 'Клуб'
      ];

      for (const category of validCategories) {
        const data = {
          ...testEstablishments[0],
          name: `Test ${category}`,
          categories: [category]
        };

        const response = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(data)
          .expect(201);

        expect(response.body.data.establishment.categories).toContain(category);
      }
    });

    test('should reject invalid category', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.invalidCategory)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/partner/establishments - Cuisines Validation', () => {
    test('should accept 1 cuisine', async () => {
      const data = {
        ...testEstablishments[0],
        cuisines: ['Европейская']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.cuisines).toEqual(['Европейская']);
    });

    test('should accept 2 cuisines', async () => {
      const data = {
        ...testEstablishments[0],
        cuisines: ['Европейская', 'Итальянская']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.cuisines).toHaveLength(2);
    });

    test('should accept 3 cuisines (maximum)', async () => {
      const data = {
        ...testEstablishments[0],
        cuisines: ['Европейская', 'Итальянская', 'Японская']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.cuisines).toHaveLength(3);
    });

    test('should reject 0 cuisines', async () => {
      const data = {
        ...testEstablishments[0],
        cuisines: []
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject 4 cuisines (max is 3)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.tooManyCuisines)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should accept all valid cuisine types', async () => {
      const validCuisines = [
        'Народная', 'Авторская', 'Азиатская', 'Американская',
        'Вегетарианская', 'Японская', 'Грузинская', 'Итальянская',
        'Смешанная', 'Европейская', 'Китайская', 'Восточная'
      ];

      for (const cuisine of validCuisines) {
        const data = {
          ...testEstablishments[0],
          name: `Test ${cuisine}`,
          cuisines: [cuisine]
        };

        const response = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(data)
          .expect(201);

        expect(response.body.data.establishment.cuisines).toContain(cuisine);
      }
    });

    test('should reject invalid cuisine', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.invalidCuisine)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/partner/establishments - Required Fields Validation', () => {
    test('should reject missing name', async () => {
      const data = { ...testEstablishments[0] };
      delete data.name;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toContainEqual(
        expect.objectContaining({ field: 'name' })
      );
    });

    test('accepts a card without description (the field is optional)', async () => {
      const data = { ...testEstablishments[0] };
      delete data.description;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.establishment.description).toBeNull();
    });

    test('should reject missing city', async () => {
      const data = { ...testEstablishments[0] };
      delete data.city;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject missing coordinates', async () => {
      const data = { ...testEstablishments[0] };
      delete data.latitude;
      delete data.longitude;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject missing categories', async () => {
      const data = { ...testEstablishments[0] };
      delete data.categories;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject missing cuisines', async () => {
      const data = { ...testEstablishments[0] };
      delete data.cuisines;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});

describe('Establishments System - List & Read Operations', () => {
  let establishment1Id;

  beforeEach(async () => {
    // Create test establishments
    const response1 = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send(testEstablishments[0]);
    establishment1Id = response1.body.data.establishment.id;

    await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ ...testEstablishments[1], name: 'Second Establishment' });
  });

  describe('GET /api/v1/partner/establishments - List Own Establishments', () => {
    test('should list all partner establishments', async () => {
      const response = await request(app)
        .get('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data.establishments).toHaveLength(2);
      expect(response.body.data.pagination).toBeDefined();
    });

    test('should only show own establishments (ownership filter)', async () => {
      // Partner 2 creates establishment
      await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partner2Token}`)
        .send({ ...testEstablishments[2], name: 'Partner 2 Restaurant' });

      // Partner 1 lists - should only see their 2 establishments
      const response = await request(app)
        .get('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data.establishments).toHaveLength(2);
      response.body.data.establishments.forEach(est => {
        expect(est.partner_id).toBe(partnerId);
      });
    });

    test('should support pagination', async () => {
      // Create more establishments
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send({ ...testEstablishments[0], name: `Establishment ${i}` });
      }

      // Get page 1
      const page1 = await request(app)
        .get('/api/v1/partner/establishments?page=1&limit=5')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(page1.body.data.establishments).toHaveLength(5);
      expect(page1.body.data.pagination.page).toBe(1);
      expect(page1.body.data.pagination.pages).toBeGreaterThanOrEqual(3);

      // Get page 2
      const page2 = await request(app)
        .get('/api/v1/partner/establishments?page=2&limit=5')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(page2.body.data.establishments).toHaveLength(5);
      expect(page2.body.data.pagination.page).toBe(2);
    });

    test('should filter by status', async () => {
      // Submit one for moderation
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment1Id}/submit`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      // Filter by draft
      const drafts = await request(app)
        .get('/api/v1/partner/establishments?status=draft')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(drafts.body.data.establishments).toHaveLength(1);
      expect(drafts.body.data.establishments[0].status).toBe('draft');

      // Filter by pending
      const pending = await request(app)
        .get('/api/v1/partner/establishments?status=pending')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(pending.body.data.establishments).toHaveLength(1);
      expect(pending.body.data.establishments[0].status).toBe('pending');
    });
  });

  describe('GET /api/v1/partner/establishments/:id - Get Single Establishment', () => {
    test('should get establishment details', async () => {
      const response = await request(app)
        .get(`/api/v1/partner/establishments/${establishment1Id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data.establishment.id).toBe(establishment1Id);
      expect(response.body.data.establishment.name).toBe(testEstablishments[0].name);
    });

    test('should reject getting other partner establishment', async () => {
      const response = await request(app)
        .get(`/api/v1/partner/establishments/${establishment1Id}`)
        .set('Authorization', `Bearer ${partner2Token}`)
        .expect(404);

      expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
    });

    test('should reject non-existent establishment', async () => {
      const response = await request(app)
        .get('/api/v1/partner/establishments/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(404);

      expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
    });

    // A non-UUID names no card: refused as a missing one (routes/v1/
    // establishmentRoutes.js, from 20.10.2026; 422 VALIDATION_ERROR before).
    test('should reject invalid UUID format as a missing card', async () => {
      const response = await request(app)
        .get('/api/v1/partner/establishments/invalid-uuid')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(404);

      expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
    });
  });
});

describe('Establishments System - Update Operations', () => {
  let establishmentId;

  beforeEach(async () => {
    const response = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ ...testEstablishments[0], name: 'Update Target' });

    establishmentId = response.body.data.establishment.id;
  });

  test('should update establishment description', async () => {
    const response = await request(app)
      .put(`/api/v1/partner/establishments/${establishmentId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ description: 'Updated description' })
      .expect(200);

    expect(response.body.data.establishment.description).toBe('Updated description');
    expect(response.body.data.establishment.id).toBe(establishmentId);
  });

  test('should keep active status on major change (re-moderation removed)', async () => {
    await query('UPDATE establishments SET status = $1 WHERE id = $2', ['active', establishmentId]);

    const response = await request(app)
      .put(`/api/v1/partner/establishments/${establishmentId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({
        name: 'Updated Name',
        categories: ['Ресторан'],
        cuisines: ['Европейская'],
      })
      .expect(200);

    expect(response.body.data.establishment.status).toBe('active');
    expect(response.body.data.establishment.name).toBe('Updated Name');
  });

  // The site's cabinet erases an optional field the partner cleared by
  // sending null (сверка находок тестировщика с сайтом, 18.10, пункт С7).
  test('null erases phone, email, website and average check; other fields stay', async () => {
    await request(app)
      .put(`/api/v1/partner/establishments/${establishmentId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({
        phone: '+375291234567',
        email: 'cafe@example.by',
        website: 'https://cafe.example.by',
        price_range: '$$',
      })
      .expect(200);

    await request(app)
      .put(`/api/v1/partner/establishments/${establishmentId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ phone: null, email: null, website: null, price_range: null })
      .expect(200);

    const rows = await query(
      'SELECT phone, email, website, price_range, name FROM establishments WHERE id = $1',
      [establishmentId],
    );
    expect(rows.rows[0]).toEqual({
      phone: null,
      email: null,
      website: null,
      price_range: null,
      name: 'Update Target',
    });
  });

  test.each(['phone', 'email', 'website', 'price_range'])(
    'an empty string still does not erase %s (422)',
    async (field) => {
      const response = await request(app)
        .put(`/api/v1/partner/establishments/${establishmentId}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ [field]: '' })
        .expect(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  test('null on create is still refused for the phone (create is unchanged)', async () => {
    await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ ...testEstablishments[0], name: 'Create With Null Phone', phone: null })
      .expect(422);
  });

  test('should reject updates by non-owner partner', async () => {
    await request(app)
      .put(`/api/v1/partner/establishments/${establishmentId}`)
      .set('Authorization', `Bearer ${partner2Token}`)
      .send({ description: 'Should fail' })
      .expect(403);
  });
});

describe('Establishments System - Status Workflow', () => {
  let establishmentId;

  beforeEach(async () => {
    const response = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ ...testEstablishments[0], name: 'Submit Target' });

    establishmentId = response.body.data.establishment.id;
  });

  test('should submit draft for moderation (draft → pending)', async () => {
    const response = await request(app)
      .post(`/api/v1/partner/establishments/${establishmentId}/submit`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    expect(response.body.data.establishment.status).toBe('pending');
  });

  test('should reject submitting already pending establishment', async () => {
    await request(app)
      .post(`/api/v1/partner/establishments/${establishmentId}/submit`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    const second = await request(app)
      .post(`/api/v1/partner/establishments/${establishmentId}/submit`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(400);

    expect(second.body.error.code).toBe('INVALID_STATUS_FOR_SUBMISSION');
  });
});

describe('Establishments System - Slug Lifecycle', () => {
  describe('Auto-generation on create', () => {
    test('should auto-generate slug from name', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Кафе Весна' })
        .expect(201);

      expect(response.body.data.establishment.slug).toBeDefined();
      expect(response.body.data.establishment.slug).toBe('kafe-vesna');
    });

    test('two establishments with the same name get different slugs via auto-suffix', async () => {
      // Same name allowed across different partners (name uniqueness is partner-scoped),
      // but slug uniqueness is global — auto-suffix resolves the collision.
      const first = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Кафе Весна' })
        .expect(201);

      const second = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partner2Token}`)
        .send({ ...testEstablishments[0], name: 'Кафе Весна' })
        .expect(201);

      expect(first.body.data.establishment.slug).toBe('kafe-vesna');
      expect(second.body.data.establishment.slug).toBe('kafe-vesna-2');
      expect(first.body.data.establishment.slug)
        .not.toBe(second.body.data.establishment.slug);
    });
  });

  describe('Slug lifecycle on update', () => {
    test('renaming a draft regenerates the slug (mutable status)', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Старое название' })
        .expect(201);

      const id = created.body.data.establishment.id;
      const originalSlug = created.body.data.establishment.slug;
      expect(originalSlug).toBe('staroe-nazvanie');

      const updated = await request(app)
        .put(`/api/v1/partner/establishments/${id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ name: 'Новое название' })
        .expect(200);

      expect(updated.body.data.establishment.slug).toBe('novoe-nazvanie');
      expect(updated.body.data.establishment.slug).not.toBe(originalSlug);
    });

    test('renaming an active establishment does NOT change slug (frozen)', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Активный ресторан' })
        .expect(201);

      const id = created.body.data.establishment.id;
      const originalSlug = created.body.data.establishment.slug;

      // Promote to active manually (skip full moderation flow for test brevity)
      await query('UPDATE establishments SET status = $1 WHERE id = $2', ['active', id]);

      const updated = await request(app)
        .put(`/api/v1/partner/establishments/${id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ name: 'Переименованный ресторан' })
        .expect(200);

      // Display name changes, slug stays frozen for URL stability post-approve
      expect(updated.body.data.establishment.name).toBe('Переименованный ресторан');
      expect(updated.body.data.establishment.slug).toBe(originalSlug);
    });
  });

  describe('Admin slug correction (PATCH /admin/:id/slug)', () => {
    test('admin can override slug on an active establishment', async () => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Заведение для admin' })
        .expect(201);

      const id = created.body.data.establishment.id;
      await query('UPDATE establishments SET status = $1 WHERE id = $2', ['active', id]);

      const updated = await request(app)
        .patch(`/api/v1/admin/establishments/${id}/slug`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ slug: 'custom-admin-slug' })
        .expect(200);

      expect(updated.body.data.slug).toBe('custom-admin-slug');
    });

    test('admin PATCH with already-taken slug returns 409', async () => {
      const first = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Первое заведение' })
        .expect(201);

      const second = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ ...testEstablishments[0], name: 'Второе заведение' })
        .expect(201);

      const secondId = second.body.data.establishment.id;
      const firstSlug = first.body.data.establishment.slug;

      const response = await request(app)
        .patch(`/api/v1/admin/establishments/${secondId}/slug`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ slug: firstSlug })
        .expect(409);

      expect(response.body.error.code).toBe('SLUG_ALREADY_TAKEN');
    });

    // Остальное в смене адреса страницы модератором (замер Crapper 01.11.2026:
    // пройдена половина развилок). Требования к адресу — из описания
    // adminService.updateEstablishmentSlug: строчные латинские буквы, цифры,
    // одиночные дефисы между группами, длина 1–150 после обрезки пробелов.
    describe('format, journal and the race for a taken address', () => {
      const createActive = async (name) => {
        const created = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send({ ...testEstablishments[0], name })
          .expect(201);
        const { id, slug } = created.body.data.establishment;
        await query('UPDATE establishments SET status = $1 WHERE id = $2', ['active', id]);
        return { id, slug };
      };

      const patchSlug = (id, body) => request(app)
        .patch(`/api/v1/admin/establishments/${id}/slug`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body);

      const slugInDb = async (id) =>
        (await query('SELECT slug FROM establishments WHERE id = $1', [id])).rows[0].slug;

      test.each([
        ['заглавные буквы', 'Custom-Slug', 'INVALID_SLUG_FORMAT'],
        ['кириллица', 'novyi-адрес', 'INVALID_SLUG_FORMAT'],
        ['дефис в начале', '-custom', 'INVALID_SLUG_FORMAT'],
        ['дефис в конце', 'custom-', 'INVALID_SLUG_FORMAT'],
        ['два дефиса подряд', 'custom--slug', 'INVALID_SLUG_FORMAT'],
        ['пробел внутри', 'custom slug', 'INVALID_SLUG_FORMAT'],
        ['подчёркивание', 'custom_slug', 'INVALID_SLUG_FORMAT'],
        ['пустая строка', '', 'INVALID_SLUG_LENGTH'],
        ['одни пробелы', '   ', 'INVALID_SLUG_LENGTH'],
        ['151 знак', 'a'.repeat(151), 'INVALID_SLUG_LENGTH'],
        ['число', 123, 'INVALID_SLUG_TYPE'],
        ['null', null, 'INVALID_SLUG_TYPE'],
      ])('неверный адрес — 422, адрес не тронут: %s', async (_label, slug, code) => {
        const { id, slug: before } = await createActive('Адрес не меняется');

        const response = await patchSlug(id, { slug }).expect(422);

        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe(code);
        expect(await slugInDb(id)).toBe(before);
      });

      test('ровно 150 знаков с пробелами по краям — адрес принят обрезанным', async () => {
        const { id } = await createActive('Длинный адрес');
        const longest = `${'a'.repeat(149)}1`;

        const response = await patchSlug(id, { slug: `  ${longest}  ` }).expect(200);

        expect(response.body.data.slug).toBe(longest);
        expect(await slugInDb(id)).toBe(longest);
      });

      test('свой же адрес ещё раз — 200, адрес прежний', async () => {
        const { id, slug } = await createActive('Свой адрес');

        const response = await patchSlug(id, { slug }).expect(200);

        expect(response.body.data.slug).toBe(slug);
        expect(await slugInDb(id)).toBe(slug);
      });

      // До 01.11.2026 повтор писал в журнал пустую запись «X → X» (замер
      // Crapper, находка 7).
      test('свой же адрес ещё раз — в журнале ничего, время правки карточки прежнее', async () => {
        const { id, slug } = await createActive('Свой адрес без журнала');
        const updatedAt = async () =>
          (await query('SELECT updated_at FROM establishments WHERE id = $1', [id])).rows[0].updated_at;
        const before = await updatedAt();

        await patchSlug(id, { slug: `  ${slug} ` }).expect(200);

        const journal = await query(
          `SELECT COUNT(*)::int AS n FROM audit_log
            WHERE entity_id = $1 AND action = 'admin_update_slug'`,
          [id],
        );
        expect(journal.rows[0].n).toBe(0);
        expect(await updatedAt()).toEqual(before);
      });

      // Партнёрские маршруты отвечают на такой номер 404 с 20.10.2026; здесь
      // до 01.11.2026 был 500 SLUG_UPDATE_FAILED (замер Crapper, находка 4).
      test('номер заведения не UUID — 404 ESTABLISHMENT_NOT_FOUND', async () => {
        const response = await patchSlug('not-a-uuid', { slug: 'nichei-adres' }).expect(404);

        expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
      });

      test('несуществующее заведение — 404 ESTABLISHMENT_NOT_FOUND', async () => {
        const response = await patchSlug('00000000-0000-0000-0000-000000000000', { slug: 'nichei-adres' })
          .expect(404);

        expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
      });

      // Прежний адрес сервер не хранит и не перенаправляет: он остаётся только
      // в журнале действий (панель показывает «Адрес страницы: было → стало»,
      // admin-web/lib/config/audit_change_text.dart). Страница открывается
      // по новому адресу.
      test('журнал хранит прежний и новый адрес; страница открывается по новому', async () => {
        const { id, slug: oldSlug } = await createActive('Переезд адреса');

        await patchSlug(id, { slug: 'pereezd-adresa-2026' }).expect(200);

        const journal = await query(
          `SELECT old_data, new_data FROM audit_log
            WHERE entity_id = $1 AND action = 'admin_update_slug'`,
          [id],
        );
        expect(journal.rows).toEqual([{
          old_data: { slug: oldSlug },
          new_data: { slug: 'pereezd-adresa-2026' },
        }]);

        const page = await request(app)
          .get('/api/v1/public/establishments/by-slug/pereezd-adresa-2026')
          .expect(200);
        expect(page.body.data.establishment.id).toBe(id);
      });

      // Проверка занятости и запись — два разных запроса. Если адрес заняли
      // между ними, отвечает ограничение уникальности базы — модератор видит
      // тот же отказ «адрес занят», а не «не удалось».
      test('адрес заняли между проверкой и записью — 409 SLUG_ALREADY_TAKEN, адрес не тронут', async () => {
        const first = await createActive('Первый в гонке');
        const second = await createActive('Второй в гонке');

        // Ждать именно того, кто ждёт эту транзакцию: без привязки ранний
        // COMMIT молча увёл бы запрос в обычную проверку занятости.
        const waitForWaiterOn = async (blockerPid) => {
          for (let attempt = 0; attempt < 250; attempt += 1) {
            const { rows } = await query(
              `SELECT COUNT(*)::int AS n FROM pg_stat_activity
                WHERE $1 = ANY(pg_blocking_pids(pid))`,
              [blockerPid],
            );
            if (rows[0].n > 0) return;
            await new Promise((resolve) => { setTimeout(resolve, 20); });
          }
          throw new Error('никто не ждёт блокировки');
        };

        // Другой модератор уже записывает этот адрес второму заведению,
        // но ещё не закончил.
        const other = await getClient();
        let patch;
        try {
          await other.query('BEGIN');
          const { rows: [{ pid }] } = await other.query('SELECT pg_backend_pid() AS pid');
          await other.query('UPDATE establishments SET slug = $1 WHERE id = $2', ['zanyatyi-adres', second.id]);

          patch = patchSlug(first.id, { slug: 'zanyatyi-adres' }).then((response) => response);
          await waitForWaiterOn(pid);
          await other.query('COMMIT');
        } catch (error) {
          await other.query('ROLLBACK');
          throw error;
        } finally {
          other.release();
        }

        const response = await patch;
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('SLUG_ALREADY_TAKEN');
        expect(await slugInDb(first.id)).toBe(first.slug);
        expect(await slugInDb(second.id)).toBe('zanyatyi-adres');
      });
    });
  });
});

// ============================================================================
// Юридические реквизиты партнёра (partner_documents)
// ============================================================================
//
// Реквизиты — шаг «Юридическая информация» регистрации заведения в приложении.
// Тело запроса — в той форме, в какой его собирает телефон
// (mobile/lib/models/partner_registration.dart, toJson): реквизиты лежат в корне
// под legal_name, unp, contact_person, contact_email, поле уходит, только если
// оно не null; правка (PUT) шлёт то же тело целиком. contact_person в
// приложении — номер контактного лица (mobile/lib/screens/partner/steps/
// legal_info_step.dart), отсюда номера в тестах. Приложение не пускает дальше
// без всех четырёх полей, так что «часть реквизитов» — защита от других
// клиентов API, а не путь телефона. Партнёр видит реквизиты
// в своей карточке (GET /partner/establishments/:id — их читает
// mobile/lib/models/partner_establishment.dart). До 01.11.2026 запись
// реквизитов (partnerDocumentsModel.createPartnerDocument) не выполнял ни один
// тест: в модульных модель подменена заглушкой (замер Crapper 01.11.2026).

describe('Establishments System - Юридические реквизиты партнёра', () => {
  // Часы — как их шлёт телефон, когда партнёр не трогал расписание.
  const mobileWorkingHours = {
    monday: { is_open: true, open: '09:00', close: '21:00' },
    tuesday: { is_open: true, open: '09:00', close: '21:00' },
    wednesday: { is_open: true, open: '09:00', close: '21:00' },
    thursday: { is_open: true, open: '09:00', close: '21:00' },
    friday: { is_open: true, open: '09:00', close: '21:00' },
    saturday: { is_open: true, open: '10:00', close: '22:00' },
    sunday: { is_open: true, open: '10:00', close: '22:00' },
  };

  const mobileBody = (overrides = {}) => ({
    name: 'Реквизиты и точка',
    description: 'Кафе для проверки юридических реквизитов',
    categories: ['Кафе'],
    cuisines: ['Народная'],
    city: 'Минск',
    address: 'ул. Немига, 5',
    latitude: 53.9045,
    longitude: 27.556,
    working_hours: mobileWorkingHours,
    phone: '+375291112233',
    price_range: '$$',
    ...overrides,
  });

  const legal = {
    legal_name: 'ООО «Васильковый двор»',
    unp: '191234567',
    contact_person: '+375291112244',
    contact_email: 'buh@vasilki.by',
  };

  const legalRows = async (establishmentId) => (await query(
    `SELECT partner_id, company_name, tax_id, contact_person, contact_email
       FROM partner_documents WHERE establishment_id = $1`,
    [establishmentId],
  )).rows;

  const partnerCard = async (establishmentId) => (await request(app)
    .get(`/api/v1/partner/establishments/${establishmentId}`)
    .set('Authorization', `Bearer ${partnerToken}`)
    .expect(200)).body.data.establishment;

  test('карточка с реквизитами: в базе ровно присланное, партнёр видит его в карточке', async () => {
    const created = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send(mobileBody(legal))
      .expect(201);
    const id = created.body.data.establishment.id;

    expect(await legalRows(id)).toEqual([{
      partner_id: partnerId,
      company_name: 'ООО «Васильковый двор»',
      tax_id: '191234567',
      contact_person: '+375291112244',
      contact_email: 'buh@vasilki.by',
    }]);
    expect(await partnerCard(id)).toMatchObject({
      legal_name: 'ООО «Васильковый двор»',
      unp: '191234567',
      contact_person: '+375291112244',
      contact_email: 'buh@vasilki.by',
    });
  });

  // Клиент может не прислать поле или прислать его пустой строкой. При
  // создании карточки ни то, ни другое не пишется в базу пустой строкой
  // (правка пустую строку пишет как есть — её здесь не проверяем).
  test.each([
    [
      'без названия, лицо очищено',
      { unp: '191234567', contact_person: '', contact_email: 'buh@vasilki.by' },
      { company_name: null, tax_id: '191234567', contact_person: null, contact_email: 'buh@vasilki.by' },
    ],
    [
      'без УНП, почта очищена',
      { legal_name: 'ООО «Васильковый двор»', contact_person: '+375291112244', contact_email: '' },
      { company_name: 'ООО «Васильковый двор»', tax_id: null, contact_person: '+375291112244', contact_email: null },
    ],
  ])('часть реквизитов: присланное записано, неприсланное и пустое — пусто (%s)', async (_label, sent, stored) => {
    const created = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send(mobileBody(sent))
      .expect(201);
    const id = created.body.data.establishment.id;

    expect(await legalRows(id)).toEqual([{ partner_id: partnerId, ...stored }]);
  });

  test('карточка без реквизитов: записи нет; правка с реквизитами её создаёт', async () => {
    const created = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send(mobileBody())
      .expect(201);
    const id = created.body.data.establishment.id;
    expect(await legalRows(id)).toEqual([]);

    await request(app)
      .put(`/api/v1/partner/establishments/${id}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send(mobileBody(legal))
      .expect(200);

    expect(await legalRows(id)).toEqual([{
      partner_id: partnerId,
      company_name: 'ООО «Васильковый двор»',
      tax_id: '191234567',
      contact_person: '+375291112244',
      contact_email: 'buh@vasilki.by',
    }]);
  });

  test('правка реквизитов: в базе новые значения, запись по-прежнему одна', async () => {
    const created = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send(mobileBody(legal))
      .expect(201);
    const id = created.body.data.establishment.id;

    await request(app)
      .put(`/api/v1/partner/establishments/${id}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send(mobileBody({
        legal_name: 'ОДО «Новый двор»',
        unp: '192345678',
        contact_person: '+375447778899',
        contact_email: 'office@newdvor.by',
      }))
      .expect(200);

    expect(await legalRows(id)).toEqual([{
      partner_id: partnerId,
      company_name: 'ОДО «Новый двор»',
      tax_id: '192345678',
      contact_person: '+375447778899',
      contact_email: 'office@newdvor.by',
    }]);
    expect(await partnerCard(id)).toMatchObject({
      legal_name: 'ОДО «Новый двор»',
      unp: '192345678',
      contact_person: '+375447778899',
      contact_email: 'office@newdvor.by',
    });
  });

  // Реквизит, который запись не вместит или который не похож на УНП и почту,
  // сервер отказывает до первой записи. До 01.11.2026 слишком длинный реквизит
  // при создании пропадал молча (201, записи нет), а при правке давал 500
  // после того, как фото уже были изменены (замер Crapper 01.11.2026, находки
  // 1 и 2). Пределы — длины колонок partner_documents
  // (migrations/production_schema.sql): 255, 50, 100, 255. Тексты утверждены
  // Координатором 01.11.2026; телефон показывает их на красной плашке как есть.
  describe('проверка реквизитов до записи', () => {
    const LEGAL_NAME_TOO_LONG = 'Полное название заведения длиннее 255 знаков. Сократите его на шаге «Ваши данные» — например, «Общество с ограниченной ответственностью» замените на «ООО».';
    const UNP_INVALID = 'УНП — это 9 цифр. Проверьте номер на шаге «Ваши данные».';
    const CONTACT_PERSON_TOO_LONG = 'Номер контактного лица длиннее 100 знаков. Проверьте номер на шаге «Ваши данные».';
    const CONTACT_EMAIL_INVALID = 'Адрес электронной почты указан неверно. Проверьте его на шаге «Ваши данные».';
    // Уже утверждённый текст (15.10.2026) — на реквизит не строкой: так шлёт
    // только чужой клиент API.
    const CONSTRAINT_VIOLATION = 'Не удалось сохранить: часть данных заполнена неверно. Проверьте карточку и попробуйте ещё раз.';

    // Почта ровно в 255 знаков: 244 «x» и «@vasilki.by» (11).
    const email255 = `${'x'.repeat(244)}@vasilki.by`;

    const refused = [
      ['название юрлица в 256 знаков', { legal_name: 'Ж'.repeat(256) }, 'INVALID_LEGAL_NAME', LEGAL_NAME_TOO_LONG],
      ['УНП из букв', { unp: 'abc' }, 'INVALID_UNP', UNP_INVALID],
      ['УНП из 8 цифр', { unp: '19123456' }, 'INVALID_UNP', UNP_INVALID],
      ['УНП из 10 цифр', { unp: '1912345678' }, 'INVALID_UNP', UNP_INVALID],
      ['УНП в 51 знак', { unp: '1'.repeat(51) }, 'INVALID_UNP', UNP_INVALID],
      ['номер контактного лица в 101 знак', { contact_person: '1'.repeat(101) }, 'INVALID_CONTACT_PERSON', CONTACT_PERSON_TOO_LONG],
      ['почта без @', { contact_email: 'not-an-email' }, 'INVALID_CONTACT_EMAIL', CONTACT_EMAIL_INVALID],
      ['почта в 256 знаков', { contact_email: `x${email255}` }, 'INVALID_CONTACT_EMAIL', CONTACT_EMAIL_INVALID],
      ['УНП числом', { unp: 191234567 }, 'INVALID_UNP', CONSTRAINT_VIOLATION],
    ];

    const tempPhotos = (count, prefix) => Array.from(
      { length: count },
      (_, i) => `https://res.cloudinary.com/test/image/upload/c_limit,w_1920/f_auto,fl_progressive,q_auto/v1/establishments/temp/${partnerId}/${prefix}/p${i}?_a=BAMAMiRg0`,
    );

    /** Всё, что правка могла бы тронуть: карточка, её фото, её реквизиты. */
    const cardState = async (id) => ({
      card: (await query(
        'SELECT name, description, phone, slug, primary_image_url, updated_at FROM establishments WHERE id = $1',
        [id],
      )).rows,
      media: (await query(
        'SELECT url, type, is_primary FROM establishment_media WHERE establishment_id = $1 ORDER BY url',
        [id],
      )).rows,
      legal: await legalRows(id),
    });

    test.each(refused)('создание: %s — 422 с текстом, ни карточки, ни реквизитов', async (_label, bad, code, text) => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(mobileBody({ ...legal, ...bad, interior_photos: tempPhotos(2, 'refused') }))
        .expect(422);

      expect({ code: response.body.error.code, message: response.body.message }).toEqual({ code, message: text });
      const { rows } = await query(
        `SELECT
           (SELECT COUNT(*)::int FROM establishments WHERE partner_id = $1) AS cards,
           (SELECT COUNT(*)::int FROM partner_documents WHERE partner_id = $1) AS records`,
        [partnerId],
      );
      expect(rows[0]).toEqual({ cards: 0, records: 0 });
    });

    // Граница N / N+1: на пределе колонки — принято и записано целиком.
    // Название — из знаков вне основной плоскости: в JS-строке каждый из них
    // занимает две единицы, а база считает его одним знаком.
    test('ровно на пределе колонок — 201, записано как прислано', async () => {
      const sent = {
        legal_name: '🍽'.repeat(255),
        unp: '191234567',
        contact_person: '7'.repeat(100),
        contact_email: email255,
      };
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(mobileBody(sent))
        .expect(201);

      expect(await legalRows(created.body.data.establishment.id)).toEqual([{
        partner_id: partnerId,
        company_name: sent.legal_name,
        tax_id: '191234567',
        contact_person: sent.contact_person,
        contact_email: email255,
      }]);
    });

    test.each(refused)('правка: %s — 422 с текстом, карточка, фото и реквизиты не тронуты', async (_label, bad, code, text) => {
      const created = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(mobileBody({ ...legal, interior_photos: tempPhotos(2, 'before') }))
        .expect(201);
      const id = created.body.data.establishment.id;
      const before = await cardState(id);
      expect(before.media).toHaveLength(2);
      expect(before.legal).toHaveLength(1);

      // Тело целиком, как шлёт телефон: другие фото, другое описание — и
      // неверный реквизит.
      const response = await request(app)
        .put(`/api/v1/partner/establishments/${id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(mobileBody({
          ...legal,
          ...bad,
          description: 'Описание, которое не должно сохраниться',
          interior_photos: tempPhotos(3, 'after'),
        }))
        .expect(422);

      expect({ code: response.body.error.code, message: response.body.message }).toEqual({ code, message: text });
      expect(await cardState(id)).toEqual(before);
    });

    // Старые реквизиты, которые формату не отвечают (записаны до проверки):
    // правка, которая их не меняет, сохраняется, а смена на неверное —
    // нет. Телефон шлёт реквизиты при каждом сохранении.
    describe('старые реквизиты не по формату', () => {
      const cardWithOldLegal = async () => {
        const created = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(mobileBody())
          .expect(201);
        const id = created.body.data.establishment.id;
        await query(
          `INSERT INTO partner_documents
             (partner_id, establishment_id, document_type, document_url, company_name, tax_id, contact_person, contact_email)
           VALUES ($1, $2, 'registration_certificate', '', 'ИП Старые данные', 'abc', '+375291112244', 'not-an-email')`,
          [partnerId, id],
        );
        return id;
      };
      const oldLegal = {
        legal_name: 'ИП Старые данные',
        unp: 'abc',
        contact_person: '+375291112244',
        contact_email: 'not-an-email',
      };

      test('правка описания с теми же реквизитами — 200, описание сохранено', async () => {
        const id = await cardWithOldLegal();

        await request(app)
          .put(`/api/v1/partner/establishments/${id}`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(mobileBody({ ...oldLegal, description: 'Новое описание' }))
          .expect(200);

        const { rows } = await query('SELECT description FROM establishments WHERE id = $1', [id]);
        expect(rows[0].description).toBe('Новое описание');
        expect(await legalRows(id)).toEqual([{
          partner_id: partnerId,
          company_name: 'ИП Старые данные',
          tax_id: 'abc',
          contact_person: '+375291112244',
          contact_email: 'not-an-email',
        }]);
      });

      test.each([
        ['УНП сменили на другой неверный', { unp: 'abd' }, 'INVALID_UNP', UNP_INVALID],
        ['почту сменили на другую неверную', { contact_email: 'still-not-an-email' }, 'INVALID_CONTACT_EMAIL', CONTACT_EMAIL_INVALID],
      ])('%s — 422, ничего не сохранено', async (_label, changed, code, text) => {
        const id = await cardWithOldLegal();
        const before = await cardState(id);

        const response = await request(app)
          .put(`/api/v1/partner/establishments/${id}`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(mobileBody({ ...oldLegal, ...changed, description: 'Новое описание' }))
          .expect(422);

        expect({ code: response.body.error.code, message: response.body.message }).toEqual({ code, message: text });
        expect(await cardState(id)).toEqual(before);
      });

      // Приложение обрезает пробелы по краям всех полей шага, когда партнёр
      // его открывает (legal_info_step.dart), — сохранённое с пробелами
      // возвращается обрезанным, хотя партнёр его не трогал.
      test('старые УНП и почта с пробелами по краям приходят обрезанными — 200', async () => {
        const id = await cardWithOldLegal();
        await query(
          `UPDATE partner_documents SET tax_id = 'abc ', contact_email = ' not-an-email'
            WHERE establishment_id = $1`,
          [id],
        );

        await request(app)
          .put(`/api/v1/partner/establishments/${id}`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(mobileBody({ ...oldLegal, description: 'Новое описание' }))
          .expect(200);

        const { rows } = await query('SELECT description FROM establishments WHERE id = $1', [id]);
        expect(rows[0].description).toBe('Новое описание');
      });

      test('УНП исправили на 9 цифр — 200, записан новый', async () => {
        const id = await cardWithOldLegal();

        await request(app)
          .put(`/api/v1/partner/establishments/${id}`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(mobileBody({ ...oldLegal, unp: '191234567' }))
          .expect(200);

        expect((await legalRows(id))[0].tax_id).toBe('191234567');
      });
    });
  });
});
