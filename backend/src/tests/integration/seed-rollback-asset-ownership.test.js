/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Откат партии сида уничтожает в облаке только ассеты из папки своей карточки
 * (внешний обзор 02.10.2026, N1 — четвёртая точка уничтожения).
 *
 * С 06.10.2026 deleteImage уничтожает ассет, только если вызывающий назвал
 * папку, в которой тот лежит. Откат (scripts/seed-import, `--rollback`) берёт
 * public_id из реестра партии и обязан назвать папку карточки, к которой
 * реестр их относит, — иначе откат молча перестал бы чистить облако.
 *
 * Работает настоящий run() из scripts/seed-import/run.js: реестр, снимок,
 * удаление в облаке через config/cloudinary.js, удаление карточек. Подменён
 * только сетевой вызов SDK — uploader.destroy общего экземпляра `cloudinary` v2.
 * run() закрывает пул базы в finally, поэтому в файле один тест, и вызов
 * run() — его последнее обращение к базе.
 */

import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import { clearAllData, query } from '../utils/database.js';
import { createTestEstablishment, createUserAndGetTokens } from '../utils/auth.js';
import { run } from '../../../scripts/seed-import/run.js';

const snapshotFile = join(tmpdir(), `seed-rollback-ownership-${process.pid}-${Date.now()}.json`);

afterAll(() => {
  if (existsSync(snapshotFile)) rmSync(snapshotFile);
});

test('ассеты из папки карточки уничтожаются по точному public_id, чужой — нет', async () => {
  await clearAllData();
  const destroy = jest.spyOn(cloudinarySdk.uploader, 'destroy').mockResolvedValue({ result: 'ok' });

  const { user: house } = await createUserAndGetTokens({
    email: `house-${Date.now()}@test.com`, password: 'House123!@#', name: 'House', role: 'partner',
  });
  const { user: stranger } = await createUserAndGetTokens({
    email: `stranger-${Date.now()}@test.com`, password: 'Stranger123!@#', name: 'Stranger', role: 'partner',
  });
  const card = await createTestEstablishment(house.id);
  // Третья запись — испорченный реестр: public_id вне папки карточки.
  const mediaState = {
    'interior/01.jpg': { public_id: `establishments/${card.id}/interior/seed0001` },
    'menu/menu.pdf': { public_id: `establishments/${card.id}/menu_pdf/seed0002` },
    'interior/02.jpg': { public_id: `establishments/temp/${stranger.id}/interior/victim0005` },
  };
  await query(
    `INSERT INTO seed_import_registry (stable_id, establishment_id, batch_id, content_hash, phase, media_state)
     VALUES ('ownership-card-01', $1, 'ownership-batch', 'hash', 'activated', $2)`,
    [card.id, JSON.stringify(mediaState)],
  );

  const result = await run({ rollbackBatchId: 'ownership-batch', snapshotFile, log: () => {} });

  expect(destroy).not.toHaveBeenCalledWith(`establishments/temp/${stranger.id}/interior/victim0005`);
  expect(destroy).toHaveBeenCalledTimes(2);
  expect(destroy).toHaveBeenCalledWith(`establishments/${card.id}/interior/seed0001`);
  expect(destroy).toHaveBeenCalledWith(`establishments/${card.id}/menu_pdf/seed0002`);
  expect(result).toEqual({ deleted: 1, skipped_claimed: 0, assets_destroyed: 2 });
});
