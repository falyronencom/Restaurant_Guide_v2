/**
 * Три размера у старых фото карточек — логика. Запуск, команды и порядок
 * работы на проде — index.js.
 *
 * До 10.2026 мастер карточки (сайт и приложение) и синхронизация медиа при
 * правке писали в establishment_media одну ссылку 1920 px во все три поля —
 * url, preview_url, thumbnail_url (на проде 18.10.2026 так 250 фото из 437), и
 * ленты тянули полный размер там, где хватает 1200 или 400 px. Сервер теперь
 * пишет три размера (establishmentService, buildImageMediaFields); здесь —
 * старые строки.
 *
 * Что меняется: у фото (file_type = 'image') с preview_url = url и
 * thumbnail_url = url — preview_url и thumbnail_url, построенные из public_id
 * ссылки, как их строит generateAllResolutions; и обложка каталога
 * (establishments.primary_image_url), если это та же одноразмерная ссылка
 * фото этой карточки, — на её превью, как пишет setPrimaryPhoto.
 *
 * Что не меняется: url — по нему синхронизация медиа сверяет строки (новый url
 * удалил бы и вставил заново все фото при следующем автосохранении); PDF —
 * у них свои превью страницы, и ссылка на .pdf, записанная как фото, тоже
 * пропускается; ссылки не с нашего облака — их public_id не наш;
 * сами файлы в облаке — пересчитываются только адреса, оригиналы не трогаются.
 *
 * Запись — одной транзакцией, и каждая строка перепроверяется в самом UPDATE:
 * строка, которую партнёр успел изменить после сухого прогона, не
 * перезаписывается. Повторный запуск находит ноль строк.
 */

import { ownCloudPublicId, photoVariantsOf } from '../../src/config/cloudinary.js';

export const BACKUP_KIND = 'photo-sizes-backup';
export const BACKUP_VERSION = 1;

/** Фото с одной ссылкой во всех трёх полях. */
export const ONE_SIZE_PHOTOS_SQL = `
  SELECT m.id, m.establishment_id, m.type, m.url, m.thumbnail_url, m.preview_url
    FROM establishment_media m
   WHERE m.file_type = 'image'
     AND m.preview_url = m.url
     AND m.thumbnail_url = m.url
   ORDER BY m.establishment_id, m.type, m.position, m.id`;

/**
 * Что записать: по строке на фото нашего облака, остальные — в пропущенные.
 *
 * @param {Object[]} rows - строки ONE_SIZE_PHOTOS_SQL
 * @returns {{ changes: Object[], skipped: Object[] }}
 */
export const planPhotoSizes = (rows) => {
  const changes = [];
  const skipped = [];
  for (const row of rows) {
    // Меню-PDF, записанный до 20.07.2026 как фото: его чинит
    // scripts/backfill-media-fix.js (тип pdf и превью страницы) — превью
    // фото из него сделали бы строку невидимой для того скрипта.
    if (row.url.split('?')[0].toLowerCase().endsWith('.pdf')) {
      skipped.push({ id: row.id, establishment_id: row.establishment_id, url: row.url, reason: 'pdf_link' });
      continue;
    }
    // Тот же отбор, что у сервера при сохранении карточки (photoVariantsOf):
    // ссылка другого облака или не в той форме, что выдаёт сервер, остаётся
    // одной во всех полях.
    const variants = photoVariantsOf(row.url);
    if (!variants) {
      const reason = ownCloudPublicId(row.url) ? 'not_issued_form' : 'not_our_cloud';
      skipped.push({ id: row.id, establishment_id: row.establishment_id, url: row.url, reason });
      continue;
    }
    changes.push({
      id: row.id,
      establishment_id: row.establishment_id,
      type: row.type,
      url: row.url,
      old: { thumbnail_url: row.thumbnail_url, preview_url: row.preview_url },
      next: { thumbnail_url: variants.thumbnail_url, preview_url: variants.preview_url },
    });
  }
  return { changes, skipped };
};

/**
 * Обложки каталога, которые равны одноразмерной ссылке фото своей же карточки:
 * им — превью этого фото.
 *
 * @param {import('pg').Client} client
 * @param {Object[]} changes - из planPhotoSizes
 * @returns {Promise<Object[]>} { id, old, next }
 */
export const findCovers = async (client, changes) => {
  const establishmentIds = [...new Set(changes.map((change) => change.establishment_id))];
  if (establishmentIds.length === 0) return [];
  const previewOf = new Map(changes.map((change) => [`${change.establishment_id} ${change.url}`, change.next.preview_url]));
  const { rows } = await client.query(
    'SELECT id, primary_image_url FROM establishments WHERE id = ANY($1::uuid[]) ORDER BY id',
    [establishmentIds],
  );
  return rows
    .filter((row) => previewOf.has(`${row.id} ${row.primary_image_url}`))
    .map((row) => ({ id: row.id, old: row.primary_image_url, next: previewOf.get(`${row.id} ${row.primary_image_url}`) }));
};

/**
 * Весь план сухого прогона: фото, пропущенные и обложки.
 *
 * @param {import('pg').Client} client
 * @returns {Promise<{ found: number, changes: Object[], skipped: Object[], covers: Object[] }>}
 */
export const buildPlan = async (client) => {
  const { rows } = await client.query(ONE_SIZE_PHOTOS_SQL);
  const { changes, skipped } = planPhotoSizes(rows);
  const covers = await findCovers(client, changes);
  return { found: rows.length, changes, skipped, covers };
};

/**
 * Файл отката: старые значения и то, что записано вместо них. Пишется до
 * записи; по нему --rollback возвращает старое.
 */
export const buildBackup = ({ target, changes, covers }, now = new Date()) => ({
  kind: BACKUP_KIND,
  version: BACKUP_VERSION,
  createdAt: now.toISOString(),
  target,
  media: changes.map(({ id, establishment_id, url, old, next }) => ({ id, establishment_id, url, old, next })),
  covers,
});

/**
 * Запись плана одной транзакцией. Строка обновляется, только если она всё ещё
 * одноразмерная и с тем же url; обложка — только если всё ещё старая.
 *
 * @returns {Promise<{ media: number, covers: number }>} сколько записано
 */
export const applyPlan = async (client, { changes, covers }) => {
  await client.query('BEGIN');
  try {
    let media = 0;
    for (const change of changes) {
      const result = await client.query(
        `UPDATE establishment_media
            SET thumbnail_url = $1, preview_url = $2
          WHERE id = $3 AND file_type = 'image'
            AND url = $4 AND thumbnail_url = $4 AND preview_url = $4`,
        [change.next.thumbnail_url, change.next.preview_url, change.id, change.url],
      );
      media += result.rowCount;
    }
    let coverCount = 0;
    for (const cover of covers) {
      const result = await client.query(
        'UPDATE establishments SET primary_image_url = $1 WHERE id = $2 AND primary_image_url = $3',
        [cover.next, cover.id, cover.old],
      );
      coverCount += result.rowCount;
    }
    await client.query('COMMIT');
    return { media, covers: coverCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
};

/**
 * Что откат вернёт: строки, у которых сейчас ровно то, что записал скрипт.
 * Изменённые с тех пор (партнёр сохранил карточку, фото удалено) не трогаются.
 *
 * Файлу не верим на слово (ревью до коммита, линза, находка 4): откат пишет в
 * базу мимо сервера, поэтому каждая запись должна быть такой, какую мог
 * записать сам скрипт, — старое значение есть url строки, новое построено из
 * него; обложка — старая ссылка фото той же карточки и его превью. И цель
 * файла — та же база, что сейчас.
 *
 * @param {import('pg').Client} client
 * @param {Object} backup - содержимое файла отката
 * @param {string} target - база, к которой подключён откат («хост:порт/имя»)
 * @returns {Promise<{ media: Object[], covers: Object[], changedSince: number }>}
 * @throws {Error} code BACKUP_UNREADABLE — файл не от этого скрипта или изменён;
 *   code BACKUP_OTHER_TARGET — файл записан на другой базе
 */
export const planRollback = async (client, backup, target) => {
  const unreadable = (why) => Object.assign(new Error(why), { code: 'BACKUP_UNREADABLE' });
  if (backup?.kind !== BACKUP_KIND || backup?.version !== BACKUP_VERSION
    || !Array.isArray(backup.media) || !Array.isArray(backup.covers)) {
    throw unreadable('Это не файл отката этого скрипта.');
  }
  if (backup.target !== target) {
    throw Object.assign(
      new Error(`Файл отката записан на другой базе (${backup.target}), а подключение — к ${target}.`),
      { code: 'BACKUP_OTHER_TARGET' },
    );
  }
  for (const entry of backup.media) {
    const variants = photoVariantsOf(entry?.url);
    if (!variants || entry.old?.thumbnail_url !== entry.url || entry.old?.preview_url !== entry.url
      || entry.next?.thumbnail_url !== variants.thumbnail_url || entry.next?.preview_url !== variants.preview_url) {
      throw unreadable(`Запись фото ${entry?.id} в файле отката не та, что пишет скрипт: файл изменён.`);
    }
  }
  for (const cover of backup.covers) {
    const photo = backup.media.find((entry) => entry.establishment_id === cover?.id && entry.url === cover.old);
    if (!photo || cover.next !== photo.next.preview_url) {
      throw unreadable(`Обложка ${cover?.id} в файле отката не та, что пишет скрипт: файл изменён.`);
    }
  }
  const mediaIds = backup.media.map((entry) => entry.id);
  const coverIds = backup.covers.map((entry) => entry.id);
  const mediaNow = new Map((await client.query(
    'SELECT id, url, thumbnail_url, preview_url FROM establishment_media WHERE id = ANY($1::uuid[])',
    [mediaIds],
  )).rows.map((row) => [row.id, row]));
  const coversNow = new Map((await client.query(
    'SELECT id, primary_image_url FROM establishments WHERE id = ANY($1::uuid[])',
    [coverIds],
  )).rows.map((row) => [row.id, row]));

  const media = backup.media.filter((entry) => {
    const row = mediaNow.get(entry.id);
    return row && row.url === entry.url
      && row.thumbnail_url === entry.next.thumbnail_url && row.preview_url === entry.next.preview_url;
  });
  const covers = backup.covers.filter((entry) => coversNow.get(entry.id)?.primary_image_url === entry.next);
  const changedSince = (backup.media.length - media.length) + (backup.covers.length - covers.length);
  return { media, covers, changedSince };
};

/**
 * Откат одной транзакцией, с той же перепроверкой в UPDATE.
 *
 * @returns {Promise<{ media: number, covers: number }>}
 */
export const applyRollback = async (client, { media, covers }) => {
  await client.query('BEGIN');
  try {
    let mediaCount = 0;
    for (const entry of media) {
      const result = await client.query(
        `UPDATE establishment_media
            SET thumbnail_url = $1, preview_url = $2
          WHERE id = $3 AND url = $4 AND thumbnail_url = $5 AND preview_url = $6`,
        [entry.old.thumbnail_url, entry.old.preview_url, entry.id, entry.url, entry.next.thumbnail_url, entry.next.preview_url],
      );
      mediaCount += result.rowCount;
    }
    let coverCount = 0;
    for (const cover of covers) {
      const result = await client.query(
        'UPDATE establishments SET primary_image_url = $1 WHERE id = $2 AND primary_image_url = $3',
        [cover.old, cover.id, cover.next],
      );
      coverCount += result.rowCount;
    }
    await client.query('COMMIT');
    return { media: mediaCount, covers: coverCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
};
