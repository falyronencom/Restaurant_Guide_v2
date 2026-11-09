/* eslint-env jest */
/**
 * Сторож: фото человека уходит другим людям только через правило одобрения
 * (миграция 041, models/avatarModerationModel.js; слово Координатора 09.11.2026,
 * нитка «Фото людей»).
 *
 * Правило стоит в одном месте — в SQL отзывов (reviewModel: publicAvatarSql).
 * Новый запрос, который возьмёт `users.avatar_url` как есть и отдаст его в
 * публичный ответ, обошёл бы фильтр молча: ни один старый тест его не увидит.
 * Поэтому здесь — список файлов сервера, которым можно называть колонку фото, с
 * причиной у каждого. Новый файл, назвавший её, красит гейт: его автор либо
 * берёт фото через publicAvatarSql, либо дописывает файл сюда и объясняет, кому
 * он отдаёт фото.
 *
 * Два публичных «переводчика» (reviewService, reviewProjections) называют ключ
 * `avatar_url` ответа, но берут его только из уже отфильтрованного
 * `author_avatar`: каждая их строка с этим ключом сверяется отдельно.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Файлы, которые читают или пишут колонку фото как есть, — и почему можно. */
const MAY_NAME_THE_COLUMN = Object.freeze({
  'controllers/authController.js': 'своё фото: ответы входа, профиля, загрузки; приём ссылки PUT /auth/profile',
  'services/authService.js': 'писатели фото (профиль, вход через Google и Яндекс) и свой профиль',
  'services/accountDeletionService.js': 'удаление учётки обнуляет фото',
  'services/avatarFiles.js': 'файл старого фото уходит из облака',
  'models/avatarFileDeletionModel.js': 'петля сверяет, не вернулся ли человек к файлу, перед удалением',
  'models/avatarModerationModel.js': 'само правило показа и очередь модератора',
  'models/adminUserModel.js': 'панель: фото в списке людей, только администратору',
  'models/adminReviewModel.js': 'панель: фото автора у отзыва, только администратору',
  'services/adminUserService.js': 'панель: одобрить и снять фото',
  'services/adminReviewService.js': 'панель: просмотрщику фото автора не отдаётся',
  'controllers/adminUserController.js': 'панель: тело запроса одобрения и снятия',
  'routes/v1/adminRoutes.js': 'панель: описание маршрутов',
  'routes/v1/authRoutes.js': 'описание PUT /auth/profile',
  'projections/viewerProjection.js': 'ключи, которые просмотрщик не получает',
});

/** Публичные переводчики: ключ ответа только из отфильтрованного author_avatar. */
const PUBLIC_MAPPERS = Object.freeze({
  'services/reviewService.js': /avatar_url: review\.author_avatar,/,
  'projections/reviewProjections.js': /avatar_url: review\.(author_avatar|author\.avatar_url),/,
});

// author_avatar_url — the panel's name of the same raw column (adminReviewModel).
const COLUMN = /\b(?:author_)?avatar_(?:approved_)?url\b/;

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

const serverFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === 'tests' ? [] : serverFiles(path);
  return name.endsWith('.js') ? [path] : [];
});

const files = serverFiles(SRC).map((path) => ({
  name: relative(SRC, path).split(sep).join('/'),
  lines: readFileSync(path, 'utf8').split(/\r?\n/),
}));

describe('колонку фото называют только файлы из списка', () => {
  test('ни один другой файл сервера не называет avatar_url', () => {
    const strangers = files
      .filter(({ name }) => !MAY_NAME_THE_COLUMN[name] && !PUBLIC_MAPPERS[name])
      .flatMap(({ name, lines }) => lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => COLUMN.test(line))
        .map(({ index }) => `${name}:${index + 1}`));

    expect(strangers).toEqual([]);
  });

  test('публичные переводчики берут фото только из отфильтрованного author_avatar', () => {
    const raw = Object.entries(PUBLIC_MAPPERS).flatMap(([name, allowed]) => {
      const file = files.find((f) => f.name === name);
      expect(file).toBeDefined();
      return file.lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => COLUMN.test(line) && !isComment(line) && !allowed.test(line))
        .map(({ index }) => `${name}:${index + 1}`);
    });

    expect(raw).toEqual([]);
  });

  test('отзывы берут фото автора через правило одобрения', () => {
    const model = files.find((f) => f.name === 'models/reviewModel.js').lines.join('\n');
    const authorAvatar = [...model.matchAll(/(\S+)\s+as\s+author_avatar\b/g)].map((m) => m[1]);

    expect(authorAvatar.length).toBeGreaterThanOrEqual(2);
    expect(new Set(authorAvatar)).toEqual(new Set(['${AUTHOR_AVATAR_SQL}']));
    expect(model).toMatch(/const AUTHOR_AVATAR_SQL = `[^`]*\$\{publicAvatarSql\('u'\)\}/);
  });

  // Запрос, берущий строку пользователя целиком, отдал бы фото, не назвав
  // колонку (ревью перед коммитом, NIT-1): такие чтения запрещены везде.
  test('строку пользователя целиком не читает ни один файл сервера', () => {
    const WHOLE_ROW = /SELECT\s+\*\s+FROM\s+(?:public\.)?users\b|\b(?:u|users)\.\*|row_to_json\s*\(/i;
    const hits = files.flatMap(({ name, lines }) => lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => !isComment(line) && WHOLE_ROW.test(line))
      .map(({ index }) => `${name}:${index + 1}`));

    expect(hits).toEqual([]);
  });

  test('список не гниёт: каждый файл из него на месте и называет колонку', () => {
    const named = new Set(files.filter(({ lines }) => lines.some((l) => COLUMN.test(l))).map((f) => f.name));
    const stale = Object.keys(MAY_NAME_THE_COLUMN).filter((name) => !named.has(name));

    expect(stale).toEqual([]);
  });
});
