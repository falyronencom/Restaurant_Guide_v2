/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Sentinel: no panel route hands a viewer personal data (pack 2, point 3;
 * cloud critic 2A, B-3 — and the guard of points 1 and 2 from now on).
 *
 * The viewer is the read-only panel role shown to people outside the project.
 * Hiding personal data from it used to be decided route by route; the critic
 * found routes where nobody had decided. This test does not trust the list of
 * routes anyone wrote down: it takes them from the router itself
 * (adminRoutes.stack) and requires, for every one of them:
 *
 *   - a read route has an entry in READ_FIXTURES below, else the test fails —
 *     a new route cannot slip past unvisited;
 *   - every fixture URL of a read route, fetched by a viewer, contains none of
 *     the seeded personal values (names, e-mails, phones of people, contact
 *     person, registration document, texts of hidden and deleted reviews, the
 *     moderator's user agent) — checked by VALUE, so a new column carrying them
 *     under a new name is caught too — and no key from WITHHELD_KEYS with a
 *     value;
 *   - an action route (and a read kept in the action tier) answers a viewer 403.
 *
 * And the control that makes the check non-vacuous: the same URLs fetched by
 * an admin contain every seeded personal value, member by member. A value the
 * seed failed to put on any route would otherwise pass the viewer check for
 * free.
 *
 * VIEWER_MAP_OUT=<file> writes the map «route → what it gives a viewer»
 * (key paths with a value / withheld) for the session report.
 */

import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import request from 'supertest';
import app from '../../server.js';
import adminRoutes from '../../routes/v1/adminRoutes.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { createPartnerWithEstablishment, createTestReview } from '../utils/adminTestHelpers.js';
import * as EstablishmentModel from '../../models/establishmentModel.js';

const PREFIX = '/api/v1/admin';

/** Routes without authentication: nothing to project. */
const PUBLIC_ROUTES = new Set(['POST /auth/login']);

/**
 * Keys that must never carry a value for a viewer, whatever the route — the
 * specification of point 3, written here as a literal and not imported from
 * the layer, so that shortening the layer's list cannot shorten the test.
 */
const WITHHELD_KEYS = [
  'author_email', 'reviewer_name', 'admin_name', 'admin_email',
  'contact_person', 'contact_email', 'contact_phone', 'registration_doc_url', 'document_url',
  'partner_name', 'partner_email', 'partner_phone',
  'user_name', 'user_email', 'user_phone', 'owner_name', 'owner_email', 'owner_phone',
  'ip_address', 'user_agent',
  // A block from the panel: the reviews it hid and an unblock showed again.
  'hidden_review_ids', 'restored_review_ids',
];

const tag = randomUUID().slice(0, 8);
const digits = () => String(Math.floor(1e6 + Math.random() * 8.9e6));

// Seeded people and texts. Every string is unique to this run.
const P = {
  moderatorName: `Модератор Сторожа ${tag}`,
  moderatorEmail: `sentinel-moderator-${tag}@test.com`,
  moderatorAgent: `SentinelModeratorAgent/${tag}`,
  partnerName: `Партнёр Сторожа ${tag}`,
  partnerPhone: `+37529${digits()}`,
  contactPerson: `Контактное Лицо ${tag}`,
  contactEmail: `sentinel-contact-${tag}@test.com`,
  documentUrl: `https://res.cloudinary.com/test/raw/upload/sentinel-${tag}.pdf`,
  hiddenAuthor: `Автор Скрытого ${tag}`,
  deletedAuthor: `Автор Удалённого ${tag}`,
  hiddenText: `сторож-скрытый-текст-${tag}`,
  // The moderator's comment on the field «contact person» — team text about a
  // field, not a person: it must reach the viewer (opaque moderation_notes).
  contactFieldComment: `уточните контактное лицо ${tag}`,
  deletedText: `сторож-удалённый-текст-${tag}`,
  blockedName: `Заблокированный Сторожа ${tag}`,
  blockedText: `сторож-текст-заблокированного-${tag}`,
};

const ids = {};
let adminToken;
let viewerToken;
let partnerEmail; // the partner who deleted a card — written into the journal
let cardPartnerAccountEmail; // the account e-mail of the card's partner — no read route shows it
let hiddenAuthorEmail;
let deletedAuthorEmail;
let blockedEmail;

/** Values a viewer must never receive and an admin receives somewhere. */
const personalValues = () => ({
  moderatorName: P.moderatorName,
  moderatorEmail: P.moderatorEmail,
  moderatorAgent: P.moderatorAgent,
  partnerName: P.partnerName,
  partnerEmail,
  contactPerson: P.contactPerson,
  contactEmail: P.contactEmail,
  documentUrl: P.documentUrl,
  hiddenAuthor: P.hiddenAuthor,
  hiddenAuthorEmail,
  deletedAuthor: P.deletedAuthor,
  deletedAuthorEmail,
  hiddenText: P.hiddenText,
  deletedText: P.deletedText,
  blockedName: P.blockedName,
  blockedEmail,
  blockedText: P.blockedText,
});

/**
 * Every read route of the panel and the URLs that exercise it, built from the
 * seeded ids. `viewer: 403` marks a variant the viewer must be refused.
 */
const READ_FIXTURES = {
  '/establishments/pending': () => ['/establishments/pending'],
  '/establishments/active': () => [
    '/establishments/active?per_page=50',
    `/establishments/active?search=${encodeURIComponent(`Сторож ${tag}`)}`,
  ],
  '/establishments/rejected': () => ['/establishments/rejected'],
  '/establishments/suspended': () => ['/establishments/suspended'],
  '/establishments/search': () => [`/establishments/search?search=${encodeURIComponent(`Сторож ${tag}`)}`],
  '/establishments/:id': () => [
    `/establishments/${ids.pending}`,
    `/establishments/${ids.active}`,
    `/establishments/${ids.suspended}`,
    `/establishments/${ids.rejected}`,
  ],
  '/analytics/overview': () => ['/analytics/overview', '/analytics/overview?period=90d'],
  '/analytics/users': () => ['/analytics/users?period=90d'],
  '/analytics/establishments': () => ['/analytics/establishments?period=90d'],
  '/analytics/reviews': () => ['/analytics/reviews?period=90d'],
  '/reviews': () => [
    '/reviews?per_page=50',
    '/reviews?status=hidden',
    '/reviews?status=deleted',
    `/reviews?search=${encodeURIComponent(P.hiddenText)}`,
    `/reviews?establishment_id=${ids.active}`,
    { url: `/reviews?user_id=${ids.hiddenAuthor}`, viewer: 403 },
  ],
  '/menu-items/flagged': () => ['/menu-items/flagged'],
  '/audit-log': () => [
    '/audit-log?per_page=50',
    '/audit-log?per_page=50&include_metadata=true',
    '/audit-log?per_page=50&entity_type=review',
    { url: `/audit-log?user_id=${ids.moderator}`, viewer: 403 },
  ],
  '/users': () => [
    '/users?per_page=50',
    '/users?status=blocked',
    { url: `/users?search=${encodeURIComponent(P.hiddenAuthor)}`, viewer: 403 },
  ],
  '/users/:id': () => [
    `/users/${ids.hiddenAuthor}`,
    `/users/${ids.blocked}`,
    `/users/${ids.moderator}`,
  ],
  '/quality/health': () => ['/quality/health'],
  '/badges': () => ['/badges'],
};

/** Reads that serve an action and stay admin-only (adminRoutes.js). */
const ACTION_TIER_READS = new Set(['/users/search']);

/** The routes as the router registered them. */
const routesFromRouter = () => adminRoutes.stack
  .filter((layer) => layer.route)
  .flatMap((layer) => Object.keys(layer.route.methods)
    .filter((method) => layer.route.methods[method])
    .map((method) => ({ method: method.toUpperCase(), path: layer.route.path })));

const normalize = (entry) => (typeof entry === 'string' ? { url: entry, viewer: 200 } : entry);

/** Every key path in a body: data[].author_name → value present / null. */
const keyPaths = (value, path = '', out = new Map()) => {
  if (Array.isArray(value)) {
    value.forEach((item) => keyPaths(item, `${path}[]`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      const hasValue = inner !== null && inner !== undefined;
      out.set(next, (out.get(next) || false) || hasValue);
      keyPaths(inner, next, out);
    }
  }
  return out;
};

// Under moderation_notes the keys are names of card fields with the
// moderator's comment on each («contact_person: укажите ФИО») — not people.
// The value check above still covers them.
const insideModerationNotes = (path) => /(^|\.)moderation_notes\./.test(path);

const withheldWithValue = (body) => [...keyPaths(body).entries()]
  .filter(([path, hasValue]) => hasValue
    && !insideModerationNotes(path)
    && WITHHELD_KEYS.includes(path.split('.').pop().replace('[]', '')))
  .map(([path]) => path);

const get = (url, token) => request(app).get(`${PREFIX}${url}`).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  const user = (name, email, role = 'user') => createUserAndGetTokens({
    email, phone: null, password: 'Sentinel123!@#', name, role, authMethod: 'email',
  });

  const moderator = await user(P.moderatorName, P.moderatorEmail, 'admin');
  adminToken = moderator.accessToken;
  ids.moderator = moderator.user.id;
  viewerToken = (await user('Sentinel Viewer', `sentinel-viewer-${tag}@test.com`, 'viewer')).accessToken;

  const act = (method, url, body) => request(app)[method](`${PREFIX}${url}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .set('User-Agent', P.moderatorAgent)
    .send(body);

  // Cards of one partner in every state the panel lists.
  const card = async (status, label) => {
    const { establishment, partner } = await createPartnerWithEstablishment(status);
    // The card's own phone and e-mail are business contacts printed on the
    // public card — kept for a viewer; seeded so the map shows them kept.
    await query(
      'UPDATE establishments SET name = $1, phone = $2, email = $3 WHERE id = $4',
      [`Сторож ${tag} ${label}`, '+375 17 200-00-00', `cafe-${tag}@cafe.by`, establishment.id],
    );
    return { establishment, partner };
  };
  const pending = await card('pending', 'на модерации');
  ids.pending = pending.establishment.id;
  cardPartnerAccountEmail = pending.partner.user.email;
  await query('UPDATE users SET name = $1, phone = $2 WHERE id = $3',
    [P.partnerName, P.partnerPhone, pending.partner.user.id]);
  await query(
    `INSERT INTO partner_documents (
      partner_id, establishment_id, document_type, document_url,
      company_name, tax_id, contact_person, contact_email
    ) VALUES ($1, $2, 'registration', $3, $4, $5, $6, $7)`,
    [pending.partner.user.id, ids.pending, P.documentUrl, `ООО «Сторож ${tag}»`, '190000001',
      P.contactPerson, P.contactEmail],
  );

  ids.active = (await card('active', 'действует')).establishment.id;
  ids.suspended = (await card('active', 'приостановлена')).establishment.id;
  await act('post', `/establishments/${ids.suspended}/suspend`, { reason: 'проверка сторожа' }).expect(200);
  ids.rejected = (await card('pending', 'отклонена')).establishment.id;
  await act('post', `/establishments/${ids.rejected}/moderate`, {
    action: 'reject',
    moderation_notes: { name: 'уточните название', contact_person: P.contactFieldComment },
  }).expect(200);

  // Reviews: visible, hidden and deleted by the moderator.
  const author = async (name, label) => {
    const email = `sentinel-${label}-${tag}@test.com`;
    const created = await user(name, email);
    return { id: created.user.id, email };
  };
  await createTestReview(null, ids.active, { rating: 5 });
  const hiddenAuthor = await author(P.hiddenAuthor, 'hidden-author');
  ids.hiddenAuthor = hiddenAuthor.id;
  hiddenAuthorEmail = hiddenAuthor.email;
  const hidden = await createTestReview(hiddenAuthor.id, ids.active, { rating: 1, content: P.hiddenText });
  // Причины скрытия и удаления — с именем автора: модератор пишет их
  // свободным текстом, и журнал не должен отдать их просмотрщику (волна 3,
  // ревью 3.5 по линзе: прежде засевались без имени, и сторож молчал).
  await act('post', `/reviews/${hidden.id}/visibility`, {
    is_visible: false,
    reason: `оскорбления, автор ${P.hiddenAuthor}`,
  }).expect(200);
  const deletedAuthor = await author(P.deletedAuthor, 'deleted-author');
  deletedAuthorEmail = deletedAuthor.email;
  const deleted = await createTestReview(deletedAuthor.id, ids.active, { rating: 2, content: P.deletedText });
  await act('post', `/reviews/${deleted.id}/delete`, { reason: `спам, автор ${P.deletedAuthor}` }).expect(200);

  // A flagged menu item, and a card deleted by its partner (journal entry in
  // the partner's name).
  const media = await query(
    `INSERT INTO establishment_media (establishment_id, type, file_type, url, thumbnail_url, preview_url)
     VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png') RETURNING id`,
    [ids.active],
  );
  await query(
    `INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn, sanity_flag, position)
     VALUES ($1, $2, 'Капучино', 0.5, $3::jsonb, 0)`,
    [ids.active, media.rows[0].id, JSON.stringify({ reason: 'price_below_threshold' })],
  );
  // A person blocked, unblocked, blocked again and renamed from the panel. The
  // journal names them to an admin (entity_context.user_name, old_data.user_name,
  // the reason — written with the name in it), lists their hidden review, and
  // gives a viewer none of it; the person's card gives a viewer no reason.
  const blocked = await author(P.blockedName, 'blocked');
  ids.blocked = blocked.id;
  blockedEmail = blocked.email;
  await createTestReview(blocked.id, ids.active, { rating: 1, content: P.blockedText });
  const blockReason = { reason: `мат в отзыве, автор ${P.blockedName}` };
  await act('post', `/users/${blocked.id}/block`, blockReason).expect(200);
  await act('post', `/users/${blocked.id}/unblock`, blockReason).expect(200);
  await act('post', `/users/${blocked.id}/block`, blockReason).expect(200);
  await act('post', `/users/${blocked.id}/reset-name`, blockReason).expect(200);

  const draft = await createPartnerWithEstablishment('draft');
  partnerEmail = draft.partner.user.email;
  await query('UPDATE users SET name = $1 WHERE id = $2', [P.partnerName, draft.partner.user.id]);
  expect(await EstablishmentModel.deleteEstablishment(draft.establishment.id, draft.partner.user.id))
    .not.toBeNull();
});

afterAll(async () => {
  await clearAllData();
});

describe('admin panel × viewer — sentinel over every route of the router', () => {
  test('the router still has its routes (else every check below is vacuous)', () => {
    expect(routesFromRouter().length).toBeGreaterThan(25);
  });

  test('every read route of the router has fixtures; no fixture names a route that is gone', () => {
    const reads = routesFromRouter()
      .filter((r) => r.method === 'GET' && !ACTION_TIER_READS.has(r.path))
      .map((r) => r.path);
    expect([...reads].sort()).toEqual(Object.keys(READ_FIXTURES).sort());
  });

  test('every action route, and every read kept in the action tier, refuses a viewer', async () => {
    const actions = routesFromRouter().filter((r) =>
      !PUBLIC_ROUTES.has(`${r.method} ${r.path}`) && (r.method !== 'GET' || ACTION_TIER_READS.has(r.path)));
    expect(actions.length).toBeGreaterThan(10);

    for (const route of actions) {
      const url = PREFIX + route.path.replace(/:id\b/, ids.active);
      const response = await request(app)[route.method.toLowerCase()](url)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({});
      expect({ route: `${route.method} ${route.path}`, status: response.status })
        .toEqual({ route: `${route.method} ${route.path}`, status: 403 });
    }
  });

  test('admin control: every seeded personal value reaches an admin on some route', async () => {
    const bodies = [];
    for (const build of Object.values(READ_FIXTURES)) {
      for (const entry of build().map(normalize)) {
        const response = await get(entry.url, adminToken);
        expect({ url: entry.url, status: response.status }).toEqual({ url: entry.url, status: 200 });
        bodies.push(JSON.stringify(response.body));
      }
    }
    const all = bodies.join('\n');
    for (const [name, value] of Object.entries(personalValues())) {
      expect({ name, reachesAdmin: all.includes(value) }).toEqual({ name, reachesAdmin: true });
    }
  });

  test('the layer does not over-reach: moderator comments on the contact fields reach the viewer', async () => {
    for (const url of ['/establishments/rejected', `/establishments/${ids.rejected}`]) {
      const response = await get(url, viewerToken).expect(200);
      expect({ url, comment: JSON.stringify(response.body).includes(P.contactFieldComment) })
        .toEqual({ url, comment: true });
    }
  });

  test('a viewer receives no personal value and no withheld key with a value on any read route', async () => {
    // Collected over every URL and asserted once: a red run names every leak,
    // not only the first one.
    const problems = [];
    const map = {};
    for (const [route, build] of Object.entries(READ_FIXTURES)) {
      for (const entry of build().map(normalize)) {
        const response = await get(entry.url, viewerToken);
        if (response.status !== entry.viewer) {
          problems.push(`${entry.url}: status ${response.status}, expected ${entry.viewer}`);
        }

        const body = JSON.stringify(response.body);
        // Plus values no read route gives even an admin — absent from the
        // control above, still forbidden here.
        const forbidden = {
          ...personalValues(),
          partnerPhone: P.partnerPhone,
          cardPartnerAccountEmail,
        };
        for (const [name, value] of Object.entries(forbidden)) {
          if (body.includes(value)) problems.push(`${entry.url}: ${name}`);
        }
        for (const path of withheldWithValue(response.body)) {
          problems.push(`${entry.url}: key ${path} has a value`);
        }

        map[`GET ${route}`] = map[`GET ${route}`] || {};
        map[`GET ${route}`][entry.url.replace(tag, '<tag>')] = {
          status: response.status,
          keys: Object.fromEntries(keyPaths(response.body)),
        };
      }
    }
    if (process.env.VIEWER_MAP_OUT) {
      writeFileSync(process.env.VIEWER_MAP_OUT, JSON.stringify(map, null, 2));
    }
    expect(problems).toEqual([]);
  });
});
