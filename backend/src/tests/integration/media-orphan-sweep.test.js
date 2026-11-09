/* eslint-env jest */
/**
 * Уборка файлов мастера, не ставших карточкой (нитка «Фото людей», шаг 1,
 * находка 2; директива п. 9): серверная петля и список для Координатора.
 *
 * База настоящая. Листинг облака подставлен (runOnce получает его готовым;
 * скрипт — файлом листинга), удаление заглушено на уровне SDK; выход в сеть —
 * провал. Что заглушка не доказывает: настоящий листинг Admin API и настоящее
 * удаление — первый прогон «только список» на проде (скрипт с --cloud).
 *
 * Ожидаемое — литералы директивы: удаляется только файл без единой ссылки из
 * базы, из папки хозяина; живые фото, фото переданной карточки, файл, который
 * карточка взяла между планом и удалением, — целы.
 */

import https from 'https';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import cloudinary, { generateAllResolutions } from '../../config/cloudinary.js';
import { pool } from '../../config/database.js';
import { isNamedAnywhere, loadTextColumns } from '../../models/mediaReferenceModel.js';
import { runOnce } from '../../services/mediaOrphanSweepLoop.js';
import logger from '../../utils/logger.js';
import { clearAllData, query } from '../utils/database.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(resolve(HERE, '../../../scripts'), 'media-orphans-audit.js');
// Облако теста: setup-env.js ставит CLOUDINARY_CLOUD_NAME='test'.
const CLOUD = 'test';
const AS_OF = new Date('2026-11-10T00:00:00Z');
const daysAgo = (n) => new Date(AS_OF.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const temp = (userId, name) => `establishments/temp/${userId}/interior/${name}`;
const cardFile = (cardId, name) => `establishments/${cardId}/interior/${name}`;
const asset = (publicId, createdAt) => ({
  public_id: publicId, resource_type: 'image', type: 'upload', format: 'jpg', bytes: 2048, created_at: createdAt,
});

const addUser = async ({ role = 'partner' } = {}) => {
  const id = randomUUID();
  await query(
    `INSERT INTO users (id, email, password_hash, name, role, auth_method, email_verified, is_active, created_at, updated_at)
     VALUES ($1, $2, NULL, 'Проверка', $3, 'email', true, true, NOW(), NOW())`,
    [id, `sweep-${id}@example.com`, role],
  );
  return id;
};

const addCard = async (partnerId) => {
  const id = randomUUID();
  await query(
    `INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude,
                                 categories, cuisines, working_hours, status, created_at, updated_at)
     VALUES ($1, $2, 'Карточка', $3, 'Проверка', 'Минск', 'ул. Проверки 1', 53.9, 27.5,
             ARRAY['Ресторан'], ARRAY['Европейская'], '{}'::jsonb, 'active', NOW(), NOW())`,
    [id, partnerId, `sweep-${id}`],
  );
  return id;
};

const attach = async (cardId, publicId) => {
  const urls = generateAllResolutions(publicId);
  await query(
    `INSERT INTO establishment_media (establishment_id, type, file_type, url, preview_url, thumbnail_url)
     VALUES ($1, 'interior', 'image', $2, $3, $4)`,
    [cardId, urls.url, urls.preview_url, urls.thumbnail_url],
  );
};

const markDeleted = (userId) => query(
  `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data)
   VALUES (NULL, 'user_delete_account', 'user', $1, '{}'::jsonb, '{}'::jsonb)`,
  [userId],
);

let destroy;

beforeEach(async () => {
  await clearAllData();
  jest.spyOn(https, 'request').mockImplementation(() => {
    throw new Error('в этом тесте сети нет');
  });
  destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  jest.spyOn(logger, 'info').mockImplementation(() => logger);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearAllData();
});

/**
 * Стенд на все правила разом: тихий партнёр с карточкой и сиротами, занятый
 * человек, удалённая учётка, учётки нет, удалённая карточка, переданная
 * карточка.
 */
const stand = async () => {
  const quiet = await addUser();
  const quietCard = await addCard(quiet);
  await attach(quietCard, temp(quiet, 'onCard'));

  const busy = await addUser({ role: 'user' });

  const deleted = await addUser({ role: 'user' });
  await markDeleted(deleted);

  const ghost = randomUUID();
  const goneCard = randomUUID();

  // Карточку завёл прежний владелец, её передали: файл лежит в его папке мастера.
  const previous = await addUser();
  const newOwner = await addUser();
  const transferred = await addCard(newOwner);
  await attach(transferred, temp(previous, 'transferred'));

  const assets = [
    asset(temp(quiet, 'onCard'), daysAgo(90)),
    asset(temp(quiet, 'orphan'), daysAgo(60)),
    asset(temp(busy, 'orphanOld'), daysAgo(90)),
    asset(temp(busy, 'fresh'), daysAgo(3)),
    asset(temp(deleted, 'draft'), daysAgo(1)),
    asset(temp(ghost, 'x'), daysAgo(1)),
    asset(cardFile(goneCard, 'y'), daysAgo(1)),
    asset(cardFile(quietCard, 'cabinet'), daysAgo(200)),
    asset(temp(previous, 'transferred'), daysAgo(200)),
    asset(`avatars/${quiet}/face`, daysAgo(200)),
  ];
  return { quiet, busy, deleted, ghost, goneCard, quietCard, previous, assets };
};

const list = (assets) => async () => ({ assets, cloudName: CLOUD });
const destroyed = () => destroy.mock.calls.map(([id]) => id).sort();

describe('петля сервера', () => {
  test('удаляет только сирот тихих, удалённых и пропавших хозяев — со сбросом копий, из папки хозяина', async () => {
    const s = await stand();

    const outcome = await runOnce({ list: list(s.assets), asOf: AS_OF });

    expect(destroyed()).toEqual([
      cardFile(s.goneCard, 'y'),
      temp(s.deleted, 'draft'),
      temp(s.ghost, 'x'),
      temp(s.quiet, 'orphan'),
    ].sort());
    for (const [, options] of destroy.mock.calls) expect(options).toEqual({ invalidate: true, resource_type: 'image' });
    expect(outcome).toEqual({ due: 4, removed: 4, named: 0, failed: 0, refused: null });
  });

  test('карточка взяла файл между планом и удалением — файл цел', async () => {
    const s = await stand();

    const outcome = await runOnce({
      list: list(s.assets),
      asOf: AS_OF,
      afterPlan: async () => { await attach(s.quietCard, temp(s.quiet, 'orphan')); },
    });

    expect(destroyed()).not.toContain(temp(s.quiet, 'orphan'));
    expect(outcome).toEqual(expect.objectContaining({ due: 4, removed: 3, named: 1 }));
  });

  test('база не знает этого облака — отказ, ничего не удалено', async () => {
    const s = await stand();
    const errors = jest.spyOn(logger, 'error').mockImplementation(() => logger);

    const outcome = await runOnce({ list: async () => ({ assets: s.assets, cloudName: 'another-cloud' }), asOf: AS_OF });

    expect(destroy).not.toHaveBeenCalled();
    expect(outcome.refused).toBe('the database does not link this cloud');
    expect(errors).toHaveBeenCalled();
  });

  test('сбой облака на одном файле не останавливает остальные', async () => {
    const s = await stand();
    destroy.mockRejectedValueOnce({ error: { message: 'Сломалось', http_code: 500 } });
    jest.spyOn(logger, 'error').mockImplementation(() => logger);

    const outcome = await runOnce({ list: list(s.assets), asOf: AS_OF });

    expect(outcome).toEqual(expect.objectContaining({ due: 4, removed: 3, failed: 1 }));
  });
});

describe('повторная проверка ссылки — по всем текстовым колонкам', () => {
  test('находит id в ссылке карточки, в журнале и в JSON любой таблицы; чужой id — нет', async () => {
    const userId = await addUser();
    const cardId = await addCard(userId);
    await attach(cardId, temp(userId, 'media'));
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data)
       VALUES (NULL, 'partner_delete_establishment', 'establishment', $1, $2::jsonb, '{}'::jsonb)`,
      [cardId, JSON.stringify({ photos: [temp(userId, 'journal')] })],
    );
    const tables = await loadTextColumns(pool);

    expect(await isNamedAnywhere(pool, tables, temp(userId, 'media'))).toBe(true);
    expect(await isNamedAnywhere(pool, tables, temp(userId, 'journal'))).toBe(true);
    expect(await isNamedAnywhere(pool, tables, temp(userId, 'nobody'))).toBe(false);
  });
});

describe('список для Координатора: scripts/media-orphans-audit.js --sweep', () => {
  test('сколько файлов, сколько места, у каких учёток и почему; сервер и список решают одинаково', async () => {
    const s = await stand();
    const dir = mkdtempSync(join(tmpdir(), 'sweep-'));
    const file = join(dir, 'listing.json');
    writeFileSync(file, JSON.stringify({ cloud_name: CLOUD, resources: s.assets }));
    try {
      const out = spawnSync(process.execPath, [SCRIPT, `--listing=${file}`, `--as-of=${AS_OF.toISOString()}`, '--sweep', '--json'], {
        env: { ...process.env }, encoding: 'utf8',
      });
      expect(out.status).toBe(0);
      const { sweep } = JSON.parse(out.stdout);
      expect(sweep.files).toBe(4);
      expect(sweep.bytes).toBe(4 * 2048);
      expect(sweep.recheck).toEqual({ planned: 4, stillNamed: 0 });
      expect(sweep.byReason).toEqual({
        quiet_wizard: { files: 1, bytes: 2048 },
        deleted_account: { files: 1, bytes: 2048 },
        account_gone: { files: 1, bytes: 2048 },
        card_gone: { files: 1, bytes: 2048 },
      });
      expect(sweep.owners.map((o) => [o.ownerId, o.reason]).sort()).toEqual([
        [s.goneCard.slice(0, 8), 'card_gone'],
        [s.deleted.slice(0, 8), 'deleted_account'],
        [s.ghost.slice(0, 8), 'account_gone'],
        [s.quiet.slice(0, 8), 'quiet_wizard'],
      ].sort());
      // В списке нет полных номеров и имён файлов.
      expect(JSON.stringify(sweep)).not.toContain(s.quiet);
      expect(JSON.stringify(sweep)).not.toContain('orphan');

      const text = spawnSync(process.execPath, [SCRIPT, `--listing=${file}`, `--as-of=${AS_OF.toISOString()}`, '--sweep'], {
        env: { ...process.env }, encoding: 'utf8',
      });
      expect(text.status).toBe(0);
      expect(text.stdout).toContain('УБОРКА ФАЙЛОВ МАСТЕРА');
      expect(text.stdout).toContain('Кандидатов: 4 файла');
      expect(text.stdout).toContain(`учётка ${s.deleted.slice(0, 8)} (пользователь, удалена)`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
