/* eslint-env jest */
/**
 * Сторож слова: тексты сервера для человека — отказы, письма — говорят
 * «учётная запись», не «аккаунт» и не «учётка» (слово Координатора
 * 29.10.2026). Прошлый проход по словам пропустил заглавную «Аккаунт» в
 * приложении — поиск не видел заглавную букву; сторож ищет оба регистра.
 * Зеркало сторожей приложения и сайта.
 *
 * Смотрятся строки в кавычках в `src/` без тестов. Комментарии — не текст
 * для человека; сообщения скриптов оператора (`backend/scripts`) — тоже.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const WORD = /[Аа]ккаунт|[Уу]чётк/;
const QUOTED = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'tests' ? [] : files(path);
    return name.endsWith('.js') ? [path] : [];
  });
}

test('в текстах сервера нет «аккаунт» и «учётка»', () => {
  const found = [];
  const scanned = files(SRC);
  for (const file of scanned) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((raw, i) => {
        const line = raw.trimStart();
        if (/^(\/\/|\*|\/\*)/.test(line)) return;
        for (const quoted of line.match(QUOTED) ?? []) {
          if (WORD.test(quoted)) found.push(`${file}:${i + 1}: ${quoted}`);
        }
      });
  }
  // Разбор, который ничего не прочитал, прошёл бы и со словом.
  expect(scanned.length).toBeGreaterThan(50);
  expect(found).toEqual([]);
});
