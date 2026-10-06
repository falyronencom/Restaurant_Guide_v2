/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Точка уничтожения файлов в облаке: deleteImage уничтожает ассет только в
 * папках, которые вызывающий назвал своими (внешний обзор 02.10.2026, N1).
 *
 * До правки deleteImage передавал в cloudinary.uploader.destroy любой public_id.
 * Public_id приходил из ссылок, которые клиент мог записать сам (аватар в
 * PUT /auth/profile, медиа карточки в PUT /partner/establishments/:id), — и
 * любой зарегистрированный удалял чужие фото, PDF меню и аватары из облака.
 *
 * Здесь работает настоящий config/cloudinary.js; подменён только сетевой вызов
 * SDK — uploader.destroy общего экземпляра `cloudinary` v2. Ожидаемые public_id —
 * литералы: папки раскладки облака — avatars/{userId}/,
 * establishments/{establishmentId}/, establishments/temp/{userId}/ (так пишут
 * uploadAvatar, uploadImage/uploadPdf и маршрут временных загрузок).
 */

import { jest } from '@jest/globals';
import { v2 as cloudinarySdk } from 'cloudinary';
import { deleteImage } from '../../config/cloudinary.js';
import logger from '../../utils/logger.js';

const OWNER = 'a3c1e2f4-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const OTHER = 'b4d2f3a5-6c7e-4f80-9bac-1d2e3f4a5b6c';
const CARD = 'c5e3a4b6-7d8f-4a91-8cbd-2e3f4a5b6c7d';
const OTHER_CARD = 'd6f4b5c7-8e9a-4b02-9dce-3f4a5b6c7d8e';

// Папки, которые называет удаление медиа карточки CARD её владельцем OWNER.
const CARD_SCOPE = [`establishments/${CARD}/`, `establishments/temp/${OWNER}/`];

let destroy;

beforeEach(() => {
  destroy = jest.spyOn(cloudinarySdk.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('deleteImage — свой ассет уничтожается по точному public_id', () => {
  test.each([
    ['свой аватар', `avatars/${OWNER}/k3j2h1g0f9`, [`avatars/${OWNER}/`]],
    ['фото в папке своей карточки', `establishments/${CARD}/interior/a1b2c3d4e5`, CARD_SCOPE],
    ['PDF меню в папке своей карточки', `establishments/${CARD}/menu_pdf/m5n6b7v8c9`, CARD_SCOPE],
    ['фото в своей папке загрузок', `establishments/temp/${OWNER}/interior/z9y8x7w6v5`, CARD_SCOPE],
  ])('%s', async (_label, publicId, folders) => {
    const result = await deleteImage(publicId, folders);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(publicId);
    expect(result).toEqual({ result: 'ok' });
  });
});

describe('deleteImage — ассет вне папок вызывающего не уничтожается', () => {
  test.each([
    ['чужой аватар', `avatars/${OTHER}/k3j2h1g0f9`, [`avatars/${OWNER}/`]],
    ['фото чужой карточки', `establishments/${OTHER_CARD}/interior/a1b2c3d4e5`, CARD_SCOPE],
    ['PDF меню чужой карточки', `establishments/${OTHER_CARD}/menu_pdf/m5n6b7v8c9`, CARD_SCOPE],
    ['фото из чужой папки загрузок', `establishments/temp/${OTHER}/interior/z9y8x7w6v5`, CARD_SCOPE],
    ['фото карточки по праву на аватар', `establishments/temp/${OWNER}/interior/z9y8x7w6v5`, [`avatars/${OWNER}/`]],
    ['аватар по праву на карточку', `avatars/${OWNER}/k3j2h1g0f9`, CARD_SCOPE],
    // Папка — это id и слэш: id, лишь начинающийся с id владельца, — чужой.
    ['id, продолжающий id владельца', `avatars/${OWNER}0/k3j2h1g0f9`, [`avatars/${OWNER}/`]],
  ])('%s', async (_label, publicId, folders) => {
    const result = await deleteImage(publicId, folders);

    expect(destroy).not.toHaveBeenCalled();
    expect(result).toEqual({ result: 'refused' });
  });
});

describe('deleteImage — public_id, выходящий из папки или не похожий на ассет, не уничтожается', () => {
  test.each([
    ['шаг назад из своей папки', `avatars/${OWNER}/../${OTHER}/k3j2h1g0f9`],
    ['точка как сегмент', `avatars/${OWNER}/./k3j2h1g0f9`],
    ['пустой сегмент', `avatars/${OWNER}//k3j2h1g0f9`],
    ['закодированный слэш', `avatars/${OWNER}/x%2F..%2F${OTHER}`],
    ['обратная косая', `avatars/${OWNER}/x\\..\\y`],
    ['пробел', `avatars/${OWNER}/k3j2 h1g0f9`],
    ['не строка: null', null],
    ['не строка: число', 42],
  ])('%s', async (_label, publicId) => {
    const result = await deleteImage(publicId, [`avatars/${OWNER}/`]);

    expect(destroy).not.toHaveBeenCalled();
    expect(result).toEqual({ result: 'refused' });
  });
});

describe('deleteImage — без названной своей папки ничего не уничтожается', () => {
  const OWN_AVATAR = `avatars/${OWNER}/k3j2h1g0f9`;

  // Каждый public_id лежит «внутри» переданной строки по простому префиксу:
  // строка отличает проверку формы папки от её отсутствия.
  test.each([
    ['папки не переданы (прежняя сигнатура)', OWN_AVATAR, undefined],
    ['пустой список', OWN_AVATAR, []],
    ['пустая строка как папка', OWN_AVATAR, ['']],
    ['корень аватаров', OWN_AVATAR, ['avatars/']],
    ['корень карточек', `establishments/${CARD}/interior/a1b2c3d4e5`, ['establishments/']],
    ['корень загрузок', `establishments/temp/${OWNER}/interior/z9y8x7w6v5`, ['establishments/temp/']],
    ['папка без слэша на конце', OWN_AVATAR, [`avatars/${OWNER}`]],
    ['id — не UUID', 'avatars/not-a-uuid/k3j2h1g0f9', ['avatars/not-a-uuid/']],
    ['null в списке', OWN_AVATAR, [null]],
  ])('%s', async (_label, publicId, folders) => {
    const result = await deleteImage(publicId, folders);

    expect(destroy).not.toHaveBeenCalled();
    expect(result).toEqual({ result: 'refused' });
  });
});

describe('deleteImage — отказ виден в логе: причина и верхняя папка, без id и имён файлов', () => {
  // Поля лога — ровно эти два: public_id может прийти из текста клиента.
  test.each([
    ['ассет вне названных папок', `establishments/temp/${OTHER}/interior/privatephoto77`,
      [`avatars/${OWNER}/`], { reason: 'outside_owned_folders', topFolder: 'establishments' }],
    ['не названо ни одной своей папки', `avatars/${OWNER}/privatephoto77`,
      [], { reason: 'no_owned_folder_named', topFolder: 'avatars' }],
    ['public_id не похож на ассет', `avatars/${OWNER}/../${OTHER}/privatephoto77`,
      [`avatars/${OWNER}/`], { reason: 'not_a_plain_asset_id', topFolder: 'avatars' }],
    ['верхняя папка вне раскладки', 'private/privatephoto77',
      [`avatars/${OWNER}/`], { reason: 'outside_owned_folders', topFolder: 'other' }],
  ])('%s', async (_label, publicId, folders, fields) => {
    const warn = jest.spyOn(logger, 'warn');
    const info = jest.spyOn(logger, 'info');

    await deleteImage(publicId, folders);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Cloudinary delete refused: the asset is not in the caller\'s folders',
      fields,
    );
    // «Удалено» в лог не пишется — удаления не было.
    expect(info).not.toHaveBeenCalled();
  });
});
