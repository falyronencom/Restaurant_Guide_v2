/* eslint-env jest */
/**
 * Счёт файлов облака без ссылок (scripts/lib/mediaOrphans.js) — чистые
 * функции: формы листинга (манифест снимка — той формы, что пишет снимок),
 * полный обход облака, токены и их хвосты, ссылка глазами браузера, границы
 * возраста, какие имена проверяемы, папки, старшинство мест ссылки. Поиск по
 * базе проверяет интеграционный тест integration/media-orphans-audit-script.test.js.
 * Ожидаемое — литералы.
 */

import {
  ageBucket,
  expandToken,
  folderOf,
  formatBytes,
  indexReferences,
  isCheckable,
  listWholeCloud,
  normalizeDeliveryUrl,
  parseListing,
  plural,
  statusOf,
  tokenRegexSource,
  tokensIn,
  topFoldersOf,
} from '../../../scripts/lib/mediaOrphans.js';
import { fileRecord } from '../../../scripts/prod-snapshot/manifest.js';

const USER = '0b6c7c3e-2f43-4a51-9d0e-5a6b7c8d9e0f';
const TOPS = ['avatars', 'establishments'];

describe('листинг: три формы', () => {
  test('манифест снимка той формы, что пишет снимок: облако, момент базы, счётчики, вердикт файла', () => {
    const publicId = `establishments/temp/${USER}/interior/abc`;
    // fileRecord — та же функция, которой prod-snapshot пишет manifest.json → files[].
    const file = fileRecord({
      asset: { public_id: publicId, resource_type: 'image', type: 'upload', format: 'jpg', created_at: '2026-09-01T10:00:00Z', bytes: 123456, width: 10, height: 10, version: 1 },
      refs: [{ table: 'establishment_media', id: 'm1', column: 'url' }],
      secondaryRefs: [],
      viaFallback: false,
    }, null);
    const listing = parseListing({
      format: 'nirivio-prod-snapshot-manifest/1',
      snapshot: { time_utc: '2026-10-11T17:58:46.104Z', exported_snapshot_id: 'x' },
      target: { database: 'postgresql://u:***@h:1/db', cloud_name: 'demo' },
      counts: { snapshot: { 'public.users': 7 }, after: null, excluded_data_tables: ['refresh_tokens'] },
      files: [file],
    });
    expect(listing).toEqual({
      cloudName: 'demo',
      dbMoment: '2026-10-11T17:58:46.104Z',
      counts: { 'public.users': 7 },
      excludedTables: ['refresh_tokens'],
      assets: [{
        public_id: publicId,
        resource_type: 'image',
        type: 'upload',
        format: 'jpg',
        bytes: 123456,
        created_at: '2026-09-01T10:00:00Z',
        snapshotStatus: 'referenced',
      }],
    });
  });

  test('ответ Admin API и голый массив; «status» самого Cloudinary — не вердикт снимка; без public_id и чужая форма — отказ', () => {
    expect(parseListing({ resources: [{ public_id: 'a/b', status: 'active' }] }).assets).toEqual([
      { public_id: 'a/b', resource_type: 'image', type: 'upload', format: '', bytes: 0, created_at: null },
    ]);
    expect(parseListing([{ public_id: 'a/b', bytes: '7' }]).assets[0].bytes).toBe(7);
    expect(parseListing({ cloud_name: 'x', resources: [] })).toEqual({ assets: [], cloudName: 'x', dbMoment: null, counts: null, excludedTables: [] });
    expect(() => parseListing({ files: [{ bytes: 1 }] })).toThrow('нет public_id');
    expect(() => parseListing({ items: [] })).toThrow('Листинг не распознан');
  });
});

describe('полный обход облака', () => {
  test('каждый тип доставки по имени, затем без имени; один ассет — один раз', async () => {
    const asked = [];
    const lists = {
      'image/upload': [{ resource_type: 'image', type: 'upload', public_id: 'a/1' }],
      'image/private': [{ resource_type: 'image', type: 'private', public_id: 'a/1' }],
      'image/*': [{ resource_type: 'image', type: 'upload', public_id: 'a/1' }, { resource_type: 'image', type: 'fetch', public_id: 'a/2' }],
    };
    const reader = {
      listAll: async (rt, type = null) => {
        asked.push(`${rt}/${type ?? '*'}`);
        return lists[`${rt}/${type ?? '*'}`] || [];
      },
    };
    const all = await listWholeCloud(reader, { resourceTypes: ['image', 'raw'], deliveryTypes: ['upload', 'private'] });
    expect(asked).toEqual(['image/upload', 'image/private', 'image/*', 'raw/upload', 'raw/private', 'raw/*']);
    expect(all.map((a) => `${a.type}:${a.public_id}`)).toEqual(['upload:a/1', 'private:a/1', 'fetch:a/2']);
  });
});

describe('токены и ссылки', () => {
  test('шаблон токена и его двойник в JavaScript: с середины слова не начинается, на точке и запятой обрывается', () => {
    expect(tokenRegexSource([])).toBeNull();
    expect(tokenRegexSource(TOPS)).toBe('(?<![A-Za-z0-9_-])((?:avatars|establishments)/[A-Za-z0-9_/-]*[A-Za-z0-9_-])');
    expect(tokensIn('x preestablishments/a/b /c_limit,w_1/establishments/a/b.jpg?_a=1 "avatars/u/v"', TOPS))
      .toEqual(['establishments/a/b', 'avatars/u/v']);
  });

  test('хвосты от внутренней верхней папки: папка с именем облака не прячет public_id', () => {
    expect(expandToken('test/image/upload/v1/avatars/u/x', ['avatars', 'test'])).toEqual(['test/image/upload/v1/avatars/u/x', 'avatars/u/x']);
    expect(expandToken(`establishments/temp/${USER}/interior/x`, TOPS)).toEqual([`establishments/temp/${USER}/interior/x`]);
  });

  test('ссылка глазами браузера: обратные косые — прямые, «..» убрано, хост без учёта регистра; чужой хост — null', () => {
    expect(normalizeDeliveryUrl('https://RES.cloudinary.com/c1/image/upload/v1\\establishments\\a\\b.jpg'))
      .toEqual({ cloud: 'c1', path: '/c1/image/upload/v1/establishments/a/b.jpg', href: 'https://res.cloudinary.com/c1/image/upload/v1/establishments/a/b.jpg' });
    expect(normalizeDeliveryUrl('https://res-2.cloudinary.com/c1/image/upload/establishments/a/zz/../b.jpg').path)
      .toBe('/c1/image/upload/establishments/a/b.jpg');
    expect(normalizeDeliveryUrl('https://example.com/c1/image/upload/establishments/a/b.jpg')).toBeNull();
    expect(normalizeDeliveryUrl('не ссылка')).toBeNull();
  });

  test('битые живые ссылки: файл, а не ссылка; только наше облако; история не битая', () => {
    const refs = indexReferences({
      tokenHits: [],
      urlHits: [
        { column: 'public.establishment_media.url', url: 'https://res.cloudinary.com/c1/image/upload/v1/establishments/a/gone.jpg', mentions: 1 },
        { column: 'public.establishment_media.preview_url', url: 'https://res.cloudinary.com/c1/image/upload/c_limit,w_1200/v1/establishments/a/gone', mentions: 1 },
        { column: 'public.establishment_media.url', url: 'https://res.cloudinary.com/c2/image/upload/v1/establishments/a/foreign.jpg', mentions: 2 },
        { column: 'public.audit_log.old_data', url: 'https://res.cloudinary.com/c1/image/upload/v1/establishments/a/deleted.jpg', mentions: 1 },
        { column: 'public.users.avatar_url', url: 'https://res.cloudinary.com/c1/image/upload/v1/avatars/u/here.jpg', mentions: 1 },
      ],
      topFolders: TOPS,
      cloudName: 'c1',
      listed: new Set(['avatars/u/here']),
    });
    expect([...refs.brokenLive]).toEqual(['establishments/a/gone']);
    expect(refs.clouds).toEqual({ ours: 4, others: 2, otherClouds: 1 });
    expect([...refs.byId.get('avatars/u/here')]).toEqual(['public.users.avatar_url']);
  });
});

describe('возраст корзинами', () => {
  const asOf = new Date('2026-10-17T00:00:00Z');
  test('границы: моложе суток, 1–7, 8–30, 31–90, старше', () => {
    expect(ageBucket('2026-10-16T00:00:01Z', asOf)).toBe('under1');
    expect(ageBucket('2026-10-16T00:00:00Z', asOf)).toBe('upTo7'); // 1
    expect(ageBucket('2026-10-10T00:00:00Z', asOf)).toBe('upTo7'); // 7
    expect(ageBucket('2026-10-09T00:00:00Z', asOf)).toBe('upTo30'); // 8
    expect(ageBucket('2026-09-17T00:00:00Z', asOf)).toBe('upTo30'); // 30
    expect(ageBucket('2026-09-16T00:00:00Z', asOf)).toBe('upTo90'); // 31
    expect(ageBucket('2026-07-19T00:00:00Z', asOf)).toBe('upTo90'); // 90
    expect(ageBucket('2026-07-18T00:00:00Z', asOf)).toBe('older'); // 91
  });

  test('без даты и с нечитаемой датой — «без даты»', () => {
    expect(ageBucket(null, asOf)).toBe('unknown');
    expect(ageBucket('вчера', asOf)).toBe('unknown');
  });
});

describe('какие имена проверяемы поиском токенов', () => {
  test('папка из листинга и простые сегменты — да; корень, пробел, точка, чужая папка — нет', () => {
    expect(isCheckable(`establishments/temp/${USER}/interior/abc123`, TOPS)).toBe(true);
    expect(isCheckable(`avatars/${USER}/a1`, TOPS)).toBe(true);
    expect(isCheckable('sample', TOPS)).toBe(false);
    expect(isCheckable('establishments/x/weird name', TOPS)).toBe(false);
    expect(isCheckable('establishments/x/menu.pdf', TOPS)).toBe(false);
    expect(isCheckable('samples/x', TOPS)).toBe(false);
  });

  test('верхние папки — из листинга, без файлов корня и без имён с иными символами', () => {
    const assets = [{ public_id: 'establishments/a/b' }, { public_id: 'avatars/u/x' }, { public_id: 'sample' }, { public_id: 'bad.folder/x' }];
    expect(topFoldersOf(assets)).toEqual(['avatars', 'establishments']);
  });
});

describe('папка файла', () => {
  test('загрузки мастера, папка карточки, аватар, прочее; id не UUID — без хозяина', () => {
    expect(folderOf(`establishments/temp/${USER}/interior/abc`)).toEqual({ group: 'temp', ownerId: USER, owner: USER, kind: 'interior' });
    expect(folderOf(`establishments/${USER}/menu_pdf/abc`)).toEqual({ group: 'cards', ownerId: USER, owner: USER, kind: 'menu_pdf' });
    expect(folderOf(`avatars/${USER}/abc`)).toEqual({ group: 'avatars', ownerId: USER, owner: USER, kind: null });
    expect(folderOf('establishments/temp/u1/interior/abc')).toEqual({ group: 'temp', ownerId: null, owner: 'u1', kind: 'interior' });
    expect(folderOf('sample').group).toBe('other');
    expect(folderOf('establishments/temp/x').group).toBe('other');
  });
});

describe('старшинство места ссылки', () => {
  test('живая > неизвестное место > история > нет', () => {
    expect(statusOf(new Set(['public.audit_log.old_data', 'public.establishment_media.url']))).toBe('live');
    expect(statusOf(new Set(['public.audit_log.old_data', 'public.reviews.text']))).toBe('other');
    expect(statusOf(new Set(['public.audit_log.new_data', 'public.ocr_jobs.error_message']))).toBe('history');
    expect(statusOf(new Set(['public.seed_import_registry.media_state (незавершённая загрузка)']))).toBe('live');
    expect(statusOf(new Set())).toBe('none');
    expect(statusOf(undefined)).toBe('none');
  });
});

describe('печать', () => {
  test('склонение и единицы', () => {
    expect(plural(1, ['файл', 'файла', 'файлов'])).toBe('1 файл');
    expect(plural(3, ['файл', 'файла', 'файлов'])).toBe('3 файла');
    expect(plural(11, ['файл', 'файла', 'файлов'])).toBe('11 файлов');
    expect(plural(21, ['файл', 'файла', 'файлов'])).toBe('21 файл');
    expect(plural(112, ['файл', 'файла', 'файлов'])).toBe('112 файлов');
    expect(formatBytes(1048576)).toBe('1,0 МБ');
    expect(formatBytes(1610612736)).toBe('1,50 ГБ');
  });
});
