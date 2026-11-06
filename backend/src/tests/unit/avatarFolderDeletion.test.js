/* eslint-env jest */
/**
 * Удаление папки аватаров целиком: config/cloudinary.js, deleteAvatarFolder.
 *
 * Функция удаляет файлы по префиксу: пустой префикс унёс бы аватары всех людей,
 * префикс без косой черты задел бы соседнюю папку. Поэтому первым делом этот файл
 * проверяет, что настоящего облака у тестов нет: ни ключей, ни сети.
 *
 * Облако здесь заменено заглушкой на уровне SDK: список и удаление файла. Что
 * заглушка не доказывает и что сверяется вживую после выкатки: настоящий ответ
 * Admin API на список, настоящее удаление и сброс кэша.
 *
 * Ожидаемые значения — литералы, из раскладки облака (avatars/<userId>/).
 */

import https from 'https';
import { jest } from '@jest/globals';
import cloudinary, { deleteAvatarFolder, deleteImage } from '../../config/cloudinary.js';

const OWNER = '7f3c2b1a-0d4e-4f6a-8b9c-1a2b3c4d5e6f';
const OTHER = '0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d';
const FOLDER = `avatars/${OWNER}/`;

/**
 * Облако в памяти: файлы { id, type }. Список отдаёт по prefix, как настоящий:
 * начало public_id, без учёта того, закрыт ли префикс косой чертой.
 */
const fakeCloud = (files, { pageSize = 500 } = {}) => {
  const left = new Map(files.map(({ id, type = 'image' }) => [id, type]));
  const resources = jest.spyOn(cloudinary.api, 'resources').mockImplementation(async (options) => {
    const matching = [...left.entries()]
      .filter(([id, type]) => type === options.resource_type && id.startsWith(options.prefix))
      .map(([id]) => id)
      .sort();
    // Курсор — смещение, самый неудобный случай: удаление посреди обхода сдвинуло бы
    // его и молча пропустило файлы.
    const start = Number(options.next_cursor ?? 0);
    const end = start + Math.min(options.max_results, pageSize);
    return {
      resources: matching.slice(start, end).map((id) => ({ public_id: id })),
      ...(end < matching.length ? { next_cursor: String(end) } : {}),
    };
  });
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockImplementation(async (id) => {
    const existed = left.delete(id);
    return { result: existed ? 'ok' : 'not found' };
  });
  return { left, resources, destroy };
};

describe('настоящего облака у тестов нет', () => {
  test('ключи — заглушки, а не настоящие (setup-env.js, ci.yml)', () => {
    const { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret } = cloudinary.config();
    expect(cloudName).toBe('test');
    expect(apiKey).toBe('000000000000000');
    expect(apiSecret).toBe('ci-dummy-no-network-calls-in-tests');
  });

  test('сторож сети видит настоящий вызов SDK: подмена https ниже чего-то стоит', async () => {
    const network = jest.spyOn(https, 'request').mockImplementation(() => {
      throw new Error('в тестах сети нет');
    });

    await expect(Promise.resolve().then(() => cloudinary.api.resources({ prefix: FOLDER }))).rejects.toThrow('в тестах сети нет');

    expect(network).toHaveBeenCalledTimes(1);
  });
});

describe('префикс только целиком', () => {
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['пустая строка', ''],
    ['пробел', ' '],
    ['не UUID', 'not-a-uuid'],
    ['звёздочка', '*'],
    ['UUID с косой на конце', `${OWNER}/`],
    ['UUID с вложенной папкой', `${OWNER}/face`],
    ['шаг назад', `../${OWNER}`],
    ['обратная косая', `${OWNER}\\x`],
    ['перевод строки на конце', `${OWNER}\n`],
    ['заглавные: такой папки у нас нет', OWNER.toUpperCase()],
    ['массив: шаблон строки развернул бы его в тот же UUID', [OWNER]],
    ['объект', { toString: () => OWNER }],
  ])('%s — отказ без единого вызова', async (_name, userId) => {
    const { resources, destroy } = fakeCloud([{ id: `${FOLDER}face` }]);
    const network = jest.spyOn(https, 'request');

    await expect(deleteAvatarFolder(userId)).rejects.toThrow('the user id is not a UUID');

    expect(resources).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  test('список просит ровно avatars/<userId>/, с косой на конце, тип доставки upload', async () => {
    const { resources } = fakeCloud([]);

    await deleteAvatarFolder(OWNER);

    expect(resources.mock.calls.map(([options]) => options)).toEqual([
      { type: 'upload', resource_type: 'image', prefix: FOLDER, max_results: 500 },
      { type: 'upload', resource_type: 'video', prefix: FOLDER, max_results: 500 },
      { type: 'upload', resource_type: 'raw', prefix: FOLDER, max_results: 500 },
    ]);
  });

  test('соседняя папка и чужой человек не задеты', async () => {
    const neighbour = `avatars/${OWNER}0/face`;
    const stranger = `avatars/${OTHER}/face`;
    const { left } = fakeCloud([{ id: `${FOLDER}face` }, { id: neighbour }, { id: stranger }]);

    await deleteAvatarFolder(OWNER);

    expect([...left.keys()].sort()).toEqual([stranger, neighbour].sort());
  });

  test('файл не из этой папки в ответе списка не удаляется: deleteImage сверяет каждый id', async () => {
    const stranger = `avatars/${OTHER}/face`;
    const { destroy } = fakeCloud([]);
    jest.spyOn(cloudinary.api, 'resources').mockResolvedValue({ resources: [{ public_id: stranger }] });

    await expect(deleteAvatarFolder(OWNER)).rejects.toThrow('a file stayed on the cloud (refused)');

    expect(destroy).not.toHaveBeenCalled();
  });
});

describe('вся папка', () => {
  test('текущий и старый аватар удалены, каждый со сбросом кэша CDN', async () => {
    const { left, destroy } = fakeCloud([{ id: `${FOLDER}current` }, { id: `${FOLDER}old` }]);

    await expect(deleteAvatarFolder(OWNER)).resolves.toEqual({ complete: true, deleted: 2 });

    expect(left.size).toBe(0);
    expect(destroy.mock.calls).toEqual([
      [`${FOLDER}current`, { invalidate: true, resource_type: 'image' }],
      [`${FOLDER}old`, { invalidate: true, resource_type: 'image' }],
    ]);
  });

  test('файлы других типов тоже уходят, каждый со своим типом', async () => {
    const { left, destroy } = fakeCloud([
      { id: `${FOLDER}clip`, type: 'video' },
      { id: `${FOLDER}note`, type: 'raw' },
    ]);

    await expect(deleteAvatarFolder(OWNER)).resolves.toEqual({ complete: true, deleted: 2 });

    expect(left.size).toBe(0);
    expect(destroy.mock.calls).toEqual([
      [`${FOLDER}clip`, { invalidate: true, resource_type: 'video' }],
      [`${FOLDER}note`, { invalidate: true, resource_type: 'raw' }],
    ]);
  });

  test('страницы списка: идёт по курсору до конца', async () => {
    const files = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ id: `${FOLDER}${name}` }));
    const { left, resources } = fakeCloud(files, { pageSize: 2 });

    await expect(deleteAvatarFolder(OWNER)).resolves.toEqual({ complete: true, deleted: 5 });

    expect(left.size).toBe(0);
    // Три страницы картинок и по одной на видео и прочее; курсор — из ответа.
    expect(resources).toHaveBeenCalledTimes(5);
    expect(resources.mock.calls[1][0].next_cursor).toBe('2');
  });

  test('страниц больше предела — сбой до первого удаления: задача не закроется с оставшимися файлами', async () => {
    const { destroy } = fakeCloud([]);
    jest.spyOn(cloudinary.api, 'resources').mockResolvedValue({
      resources: [{ public_id: `${FOLDER}face` }],
      next_cursor: 'ещё',
    });

    await expect(deleteAvatarFolder(OWNER)).rejects.toThrow('more than 5 pages of image files');

    expect(cloudinary.api.resources).toHaveBeenCalledTimes(5);
    expect(destroy).not.toHaveBeenCalled();
  });

  test('пустая папка и уже удалённый файл — не сбой: повтор безвреден', async () => {
    const empty = fakeCloud([]);
    await expect(deleteAvatarFolder(OWNER)).resolves.toEqual({ complete: true, deleted: 0 });
    empty.destroy.mockRestore();
    empty.resources.mockRestore();

    jest.spyOn(cloudinary.api, 'resources').mockImplementation(async ({ resource_type: type }) => ({
      resources: type === 'image' ? [{ public_id: `${FOLDER}gone` }] : [],
    }));
    jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'not found' });

    await expect(deleteAvatarFolder(OWNER)).resolves.toEqual({ complete: true, deleted: 0 });
  });
});

describe('сбой облака', () => {
  test('список отказал: ошибка с кодом и текстом, без ключа и секрета из отказа SDK', async () => {
    jest.spyOn(cloudinary.api, 'resources').mockRejectedValue({
      request_options: { auth: '000000000000000:ci-dummy-no-network-calls-in-tests' },
      query_params: 'x',
      error: { message: 'Rate Limit Exceeded', http_code: 420 },
    });

    const error = await deleteAvatarFolder(OWNER).catch((rejection) => rejection);

    expect(error.message).toBe('Avatar folder listing failed: Rate Limit Exceeded');
    expect(error.httpCode).toBe(420);
    expect(JSON.stringify({ ...error, text: error.message })).not.toContain('ci-dummy');
  });

  test('удаление файла отказало: ошибка, а не тихий успех', async () => {
    fakeCloud([{ id: `${FOLDER}face` }]);
    cloudinary.uploader.destroy.mockRejectedValue({ message: 'Server error', http_code: 500 });

    const error = await deleteAvatarFolder(OWNER).catch((rejection) => rejection);

    expect(error.message).toBe('Failed to delete image: Server error');
    expect(error.httpCode).toBe(500);
  });

  test('облако ответило непонятно — файл считается оставшимся', async () => {
    fakeCloud([{ id: `${FOLDER}face` }]);
    cloudinary.uploader.destroy.mockResolvedValue({ result: 'error' });

    await expect(deleteAvatarFolder(OWNER)).rejects.toThrow('a file stayed on the cloud (error)');
  });

  test('список без ответа: срок свой, потому что timeout у Admin API ничего не обрывает', async () => {
    jest.spyOn(cloudinary.api, 'resources').mockReturnValue(new Promise(() => {}));

    await expect(deleteAvatarFolder(OWNER, { deadlineMs: 30 })).rejects.toThrow('no answer from the cloud in 30 ms');
  });

  test('удаление файла без ответа: тот же срок', async () => {
    fakeCloud([{ id: `${FOLDER}face` }]);
    cloudinary.uploader.destroy.mockReturnValue(new Promise(() => {}));

    await expect(deleteAvatarFolder(OWNER, { deadlineMs: 30 })).rejects.toThrow('no answer from the cloud in 30 ms');
  });
});

describe('остановка', () => {
  test('просьба остановиться до первого вызова: ни одного вызова', async () => {
    const { resources } = fakeCloud([{ id: `${FOLDER}face` }]);

    await expect(deleteAvatarFolder(OWNER, { shouldStop: () => true })).resolves.toEqual({ complete: false, deleted: 0 });

    expect(resources).not.toHaveBeenCalled();
  });

  test('просьба посреди папки: следующий файл не трогается, удалённое засчитано', async () => {
    const { left, destroy } = fakeCloud([{ id: `${FOLDER}a` }, { id: `${FOLDER}b` }]);
    const shouldStop = () => destroy.mock.calls.length >= 1;

    await expect(deleteAvatarFolder(OWNER, { shouldStop })).resolves.toEqual({ complete: false, deleted: 1 });

    expect([...left.keys()]).toEqual([`${FOLDER}b`]);
  });
});

describe('deleteImage для прочих вызовов не изменился', () => {
  test('без опций — по-прежнему один аргумент', async () => {
    const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });

    await deleteImage(`${FOLDER}face`, [FOLDER]);

    expect(destroy.mock.calls).toEqual([[`${FOLDER}face`]]);
  });

  test('со сбросом кэша — только он', async () => {
    const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });

    await deleteImage(`${FOLDER}face`, [FOLDER], { invalidate: true });

    expect(destroy.mock.calls).toEqual([[`${FOLDER}face`, { invalidate: true }]]);
  });

  test('текст отказа SDK виден: раньше здесь стояло undefined', async () => {
    jest.spyOn(cloudinary.uploader, 'destroy').mockRejectedValue({ error: { message: 'Request Timeout', http_code: 499 } });

    await expect(deleteImage(`${FOLDER}face`, [FOLDER])).rejects.toThrow('Failed to delete image: Request Timeout');
  });
});
