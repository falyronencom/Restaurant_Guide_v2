/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * SITE_URL — только ссылка в письме сброса пароля (config/siteUrl.js). 05.11.2026
 * на проде в значении стояло имя переменной перед адресом: письмо уходило,
 * ссылка не открывалась, и узнать об этом можно было только нажав кнопку.
 */

import { DEFAULT_SITE_URL, siteUrlProblem } from '../../config/siteUrl.js';

const ADDRESS = 'https://site.example';

describe('верное значение — молчит', () => {
  test.each([
    ADDRESS,
    `${ADDRESS}/`,
    'http://localhost:3001',
    'https://nirivio.by',
  ])('%s', (value) => {
    expect(siteUrlProblem({ NODE_ENV: 'production', SITE_URL: value })).toBeNull();
  });
});

describe('неверное значение — строка, которая говорит, что не так', () => {
  test.each([
    ['имя переменной в значении (случай 05.11)', `SITE_URL=${ADDRESS}`],
    ['без https://', 'site.example'],
    ['слово вместо адреса', 'адрес сайта'],
  ])('%s', (_label, value) => {
    expect(siteUrlProblem({ NODE_ENV: 'production', SITE_URL: value }))
      .toBe('SITE_URL is not a whole address: links in password-reset letters will not open');
  });

  test.each([
    ['другая схема', 'ftp://site.example'],
    ['хост с портом без схемы читается как схема', 'localhost:3001'],
  ])('%s', (_label, value) => {
    expect(siteUrlProblem({ NODE_ENV: 'production', SITE_URL: value }))
      .toBe('SITE_URL does not start with https://: links in password-reset letters will not open');
  });

  test('строка не повторяет значение', () => {
    const line = siteUrlProblem({ NODE_ENV: 'production', SITE_URL: 'SITE_URL=https://secret-looking.example' });

    expect(line).not.toContain('secret-looking');
  });
});

describe('не задано', () => {
  test.each([undefined, ''])('на проде — говорит, куда поведут ссылки (%s)', (value) => {
    expect(siteUrlProblem({ NODE_ENV: 'production', SITE_URL: value })).toBe(
      `SITE_URL is not set: links in password-reset letters lead to ${DEFAULT_SITE_URL}`,
    );
  });

  test.each(['development', 'test', undefined])('вне прода (%s) — молчит: ссылку читают в консоли', (nodeEnv) => {
    expect(siteUrlProblem({ NODE_ENV: nodeEnv })).toBeNull();
  });
});
