/* eslint-env jest */
/**
 * Страж: в коде сервера и скриптов оператора нет адресов e-mail на чужих
 * доменах (директива service_accounts 15.10.2026, Б6; критик 2Б S1).
 *
 * Служебные учётки прода стояли на адресах доменов, которые проекту не
 * принадлежат, потому что скрипты несли такие адреса литералами — по
 * умолчанию или как «адрес дома сида». Чей домен, того и письма: сброс пароля
 * в том числе. Этот тест падает, как только литерал e-mail не из
 * разрешённого набора появится в backend/scripts или backend/src.
 *
 * Разрешено: домены проекта (scripts/lib/serviceAccounts.js OUR_DOMAINS) и
 * зарезервированные под примеры, которые никому не доставляются (RFC 2606 /
 * RFC 6761): example.com/.net/.org, *.example, *.test, *.invalid, localhost.
 *
 * Не проверяются backend/src/tests: тесты ходят только в тестовую базу и
 * обязаны держать адреса настоящих почтовых доменов (нормализация адресов
 * Яндекса и Gmail — unit/authEmailNormalization.test.js), а их фикстуры на
 * test.com — давний общий набор. Адрес из теста на прод не попадает: прод
 * пишут только скрипты и сервер, а они здесь проверяются.
 *
 * Страж с якорем (Methodology §2.4, п. 7): тот же поиск предъявляется строке,
 * где чужой адрес заведомо есть, — сломанный поиск не сойдёт за «ничего не
 * найдено».
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { OUR_DOMAINS } from '../../../scripts/lib/serviceAccounts.js';

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ROOTS = ['scripts', 'src'];
const SKIP_DIRS = new Set(['node_modules', 'tests']);
const SCANNED = /\.(c|m)?js$|\.sql$|\.json$/;

/** local@domain.tld — domain captured; a scoped package or a JSDoc tag has no local part. */
const EMAIL_LITERAL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g;

const RESERVED = [/^example\.(com|net|org)$/, /\.example$/, /\.test$/, /\.invalid$/, /^localhost$/];

const allowed = (domain) => {
  const d = domain.toLowerCase();
  return OUR_DOMAINS.includes(d) || RESERVED.some((pattern) => pattern.test(d));
};

/** Every foreign-domain e-mail literal in a text, as «domain». */
export const foreignDomainsIn = (text) => [...text.matchAll(EMAIL_LITERAL)]
  .map((match) => match[1])
  .filter((domain) => !allowed(domain));

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) {
    // Only src/tests is skipped, not a «tests» folder elsewhere.
    if (name === 'node_modules') return [];
    if (SKIP_DIRS.has(name) && relative(BACKEND, path).split(sep).join('/') === 'src/tests') return [];
    return files(path);
  }
  return SCANNED.test(name) ? [path] : [];
});

describe('no e-mail literal at a foreign domain in backend/scripts and backend/src', () => {
  test('the scan finds none', () => {
    const offenders = ROOTS
      .flatMap((root) => files(join(BACKEND, root)))
      .flatMap((path) => foreignDomainsIn(readFileSync(path, 'utf8'))
        .map((domain) => `${relative(BACKEND, path).split(sep).join('/')}: …@${domain}`));
    expect(offenders).toEqual([]);
  });

  test('the scan can fail: it sees the addresses that put service accounts on foreign domains', () => {
    // Anchor: the literals this guard exists for, as they stood in the scripts until 2026-10-15.
    expect(foreignDomainsIn("const email = process.env.ADMIN_EMAIL || 'admin@test.com';")).toEqual(['test.com']);
    expect(foreignDomainsIn("export const HOUSE = 'seed.data.generator@restaurantguide.by';")).toEqual(['restaurantguide.by']);
    expect(foreignDomainsIn('REVIEW_EMAIL=applereview@test.com')).toEqual(['test.com']);
    expect(foreignDomainsIn('owner@gmail.com')).toEqual(['gmail.com']);
  });

  test('allowed: project domains and reserved example domains; package scopes and JSDoc tags are not addresses', () => {
    expect(foreignDomainsIn([
      'noreply@nirivio.by', 'contact@nirivio.by', 'guest@example.com', 'a@b.example',
      'seed.user.1@seed-reviews.invalid', 'x@journey.test', 'postgres://postgres:postgres@localhost:5432/db',
      "import x from '@scope/pkg';", ' * @param {string} email',
    ].join('\n'))).toEqual([]);
  });

  test('the walk reaches the roots it guards (a broken walk is not «nothing found»)', () => {
    const scanned = ROOTS.flatMap((root) => files(join(BACKEND, root))).map((p) => relative(BACKEND, p).split(sep).join('/'));
    expect(scanned).toEqual(expect.arrayContaining([
      'scripts/create-admin.js', 'scripts/seed-import/contract.js', 'src/services/authService.js',
    ]));
    expect(scanned.some((p) => p.startsWith('src/tests/'))).toBe(false);
  });
});
