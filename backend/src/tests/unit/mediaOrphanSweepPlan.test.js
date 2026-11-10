/* eslint-env jest */
/**
 * План уборки файлов мастера (нитка «Фото людей», шаг 1, находка 2; директива
 * п. 9): какие файлы уходят из облака и почему. Чистые функции — без базы и сети.
 *
 * Ожидаемое — литералы из директивы: сирота — только файл без единой ссылки из
 * базы (и в журнале тоже); папка и возраст сами по себе не причина; срок — 30
 * дней от ПОСЛЕДНЕЙ загрузки в папку хозяина; «сразу» — только по метке
 * журнала (учётка удалена, карточка удалена); строки просто нет — ждёт срок
 * (база из старого бэкапа не знает новых учёток — ревью по линзе PR 1б);
 * папка живой карточки не убирается.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  SWEEP_REASON, SWEEP_TERM_DAYS, lastUploads, planSweep, summarizeSweep,
} from '../../../scripts/lib/mediaOrphanSweep.js';
import { resolveMediaOrphanSweepPolicy } from '../../config/mediaOrphanSweep.js';

const LIVE = 'public.establishment_media.url';
const HISTORY = 'public.audit_log.new_data';
const UNKNOWN = 'public.bookings.comment';

const U = {
  quiet: '11111111-1111-4111-8111-111111111111',
  busy: '22222222-2222-4222-8222-222222222222',
  deleted: '33333333-3333-4333-8333-333333333333',
  gone: '44444444-4444-4444-8444-444444444444',
};
const C = {
  alive: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  gone: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  deleted: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};
const AS_OF = new Date('2026-11-10T00:00:00Z');
const daysAgo = (n) => new Date(AS_OF.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const temp = (user, name) => `establishments/temp/${user}/interior/${name}`;
const card = (id, name) => `establishments/${id}/interior/${name}`;
const asset = (publicId, createdAt, bytes = 1000) => ({ public_id: publicId, created_at: createdAt, bytes, resource_type: 'image' });

const owners = {
  users: new Map([
    [U.quiet, { role: 'partner', service: false, deleted: false }],
    [U.busy, { role: 'user', service: false, deleted: false }],
    [U.deleted, { role: 'user', service: false, deleted: true }],
  ]),
  cards: new Map([[C.alive, { status: 'active' }]]),
  deletedCards: new Set([C.deleted]),
};

const plan = (assets, byId = new Map(), extra = {}) => planSweep({
  assets, refs: { byId }, owners, topFolders: ['avatars', 'establishments'], asOf: AS_OF, ...extra,
});
const ids = (due) => due.map((f) => [f.public_id, f.reason]);

describe('сирота — только файл без единой ссылки', () => {
  test('ссылка из карточки, из журнала или из неизвестного места держит файл', () => {
    const files = ['live', 'history', 'unknown', 'none'].map((n) => asset(temp(U.quiet, n), daysAgo(60)));
    const byId = new Map([
      [temp(U.quiet, 'live'), new Set([LIVE])],
      [temp(U.quiet, 'history'), new Set([HISTORY])],
      [temp(U.quiet, 'unknown'), new Set([UNKNOWN])],
    ]);

    expect(ids(plan(files, byId))).toEqual([[temp(U.quiet, 'none'), SWEEP_REASON.QUIET_WIZARD]]);
  });

  test('аватары, корень облака и чужие разделы — не дело уборки', () => {
    const files = [
      asset(`avatars/${U.gone}/face`, daysAgo(90)),
      asset('loose-file', daysAgo(90)),
      asset(`other/${U.gone}/x`, daysAgo(90)),
    ];
    expect(plan(files)).toEqual([]);
  });
});

describe('срок — от последней загрузки человека в мастер', () => {
  test(`тихий больше ${SWEEP_TERM_DAYS} дней — все его сироты; одна свежая загрузка держит все старые`, () => {
    const files = [
      asset(temp(U.quiet, 'old'), daysAgo(SWEEP_TERM_DAYS + 1)),
      asset(temp(U.busy, 'old'), daysAgo(120)),
      asset(temp(U.busy, 'fresh'), daysAgo(SWEEP_TERM_DAYS - 1)),
    ];
    expect(ids(plan(files))).toEqual([[temp(U.quiet, 'old'), SWEEP_REASON.QUIET_WIZARD]]);
  });

  test('ровно срок — уже тихо; файл без даты держит папку', () => {
    expect(ids(plan([asset(temp(U.quiet, 'edge'), daysAgo(SWEEP_TERM_DAYS))])))
      .toEqual([[temp(U.quiet, 'edge'), SWEEP_REASON.QUIET_WIZARD]]);
    expect(plan([asset(temp(U.quiet, 'old'), daysAgo(90)), asset(temp(U.quiet, 'undated'), null)])).toEqual([]);
  });

  test('файл со ссылкой тоже считается загрузкой: человек, занятый карточкой, не тих', () => {
    const files = [asset(temp(U.busy, 'used'), daysAgo(2)), asset(temp(U.busy, 'spare'), daysAgo(70))];
    expect(plan(files, new Map([[temp(U.busy, 'used'), new Set([LIVE])]]))).toEqual([]);
  });
});

describe('ушедший хозяин', () => {
  test('по метке журнала — сразу: удалённая учётка и удалённая карточка, даже со свежими файлами', () => {
    const files = [asset(temp(U.deleted, 'a'), daysAgo(1)), asset(card(C.deleted, 'b'), daysAgo(1))];
    expect(ids(plan(files))).toEqual([
      [card(C.deleted, 'b'), SWEEP_REASON.DELETED_CARD],
      [temp(U.deleted, 'a'), SWEEP_REASON.DELETED_ACCOUNT],
    ]);
  });

  test('строки просто нет — свежие файлы ждут: база может быть старше облака', () => {
    const files = [asset(temp(U.gone, 'fresh'), daysAgo(1)), asset(card(C.gone, 'fresh'), daysAgo(1))];
    expect(plan(files)).toEqual([]);
  });

  test('строки нет и папка молчит срок — уходят', () => {
    const files = [asset(temp(U.gone, 'old'), daysAgo(40)), asset(card(C.gone, 'old'), daysAgo(40))];
    expect(ids(plan(files))).toEqual([
      [card(C.gone, 'old'), SWEEP_REASON.CARD_GONE],
      [temp(U.gone, 'old'), SWEEP_REASON.ACCOUNT_GONE],
    ]);
  });

  test('папка живой карточки — никогда', () => {
    expect(plan([asset(card(C.alive, 'y'), daysAgo(400))])).toEqual([]);
  });
});

test('закрытая доставка (private, authenticated) — не дело уборки', () => {
  const files = [{ ...asset(temp(U.deleted, 'private'), daysAgo(1)), type: 'private' }];
  expect(plan(files)).toEqual([]);
});

test('снимок: загруженное в момент чтения базы и позже — не судится', () => {
  const files = [asset(temp(U.deleted, 'before'), '2026-11-08T16:22:59Z'), asset(temp(U.deleted, 'after'), '2026-11-08T16:23:00Z')];
  expect(ids(plan(files, new Map(), { dbMoment: '2026-11-08T16:23:00Z' })))
    .toEqual([[temp(U.deleted, 'before'), SWEEP_REASON.DELETED_ACCOUNT]]);
});

test('сводка по хозяевам: файлы, объём, последняя загрузка, причина', () => {
  const files = [
    asset(temp(U.quiet, 'a'), '2026-09-01T10:00:00Z', 300),
    asset(temp(U.quiet, 'b'), '2026-09-02T10:00:00Z', 200),
    asset(card(C.deleted, 'c'), daysAgo(1), 1000),
  ];
  const due = plan(files);
  expect(summarizeSweep(due, owners, lastUploads(files))).toEqual([
    expect.objectContaining({ ownerId: C.deleted, group: 'cards', files: 1, bytes: 1000, reason: SWEEP_REASON.DELETED_CARD }),
    expect.objectContaining({
      ownerId: U.quiet, role: 'partner', files: 2, bytes: 500, lastUpload: '2026-09-02', reason: SWEEP_REASON.QUIET_WIZARD,
    }),
  ]);
});

describe('выключатель уборки на сервере', () => {
  test.each([
    [{}, false],
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'production', MEDIA_ORPHAN_SWEEP_ENABLED: 'false' }, false],
    [{ NODE_ENV: 'production', MEDIA_ORPHAN_SWEEP_ENABLED: 'yes' }, false],
    [{ NODE_ENV: 'development', MEDIA_ORPHAN_SWEEP_ENABLED: 'true' }, false],
    [{ NODE_ENV: 'production', MEDIA_ORPHAN_SWEEP_ENABLED: 'true' }, true],
  ])('%j → %s', (env, enabled) => {
    expect(resolveMediaOrphanSweepPolicy(env).enabled).toBe(enabled);
  });
});

describe('сервер уборку запускает и останавливает', () => {
  // server.js под NODE_ENV=test не стартует: связка проверяется по тексту.
  const server = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server.js'), 'utf8');

  test('запуск при старте и остановка среди фоновых петель выключения', () => {
    expect(server).toContain('const mediaOrphanSweepPolicy = mediaOrphanSweepLoop.start();');
    const loops = server.slice(server.indexOf('backgroundLoops: ['), server.indexOf('closePool,'));
    expect(loops).toContain('stop: () => mediaOrphanSweepLoop.stop(),');
  });
});
