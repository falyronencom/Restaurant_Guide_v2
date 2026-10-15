/* eslint-env jest */
/**
 * scripts/lib/productionDb.loadProductionEnvironment — откуда скрипт берёт
 * окружение прода (директива service_accounts 15.10.2026; Phase 3.5, линза).
 *
 *   - файл .env.production рядом со скриптами есть: его DATABASE_URL, пин
 *     сертификата и SERVICE_ACCOUNT_MAILBOXES побеждают то, что уже лежит в
 *     окружении процесса (backend/.env разработчика подгружается импортом
 *     серверных модулей и не должен сойти за прод);
 *   - прочие переменные, уже заданные, остаются (как у dotenv);
 *   - файла нет (запуск из worktree через node --env-file): берётся окружение;
 *   - DATABASE_URL нигде нет — отказ с подсказкой про --env-file.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadProductionEnvironment } from '../../../scripts/lib/productionDb.js';

describe('loadProductionEnvironment', () => {
  let dir;
  let file;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'prod-env-'));
    file = join(dir, '.env.production');
    writeFileSync(file, [
      'DATABASE_URL=postgresql://prod.example.test:5432/railway',
      'DATABASE_TLS_CERT=pinned-from-file',
      'SERVICE_ACCOUNT_MAILBOXES=owner@example.test',
      'NODE_ENV=production',
      'ONLY_IN_FILE=from-file',
    ].join('\n'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('the file\'s production keys win over values already in the environment', () => {
    const env = {
      DATABASE_URL: 'postgresql://localhost:5432/dev',
      DATABASE_TLS_CERT: 'dev-pin',
      SERVICE_ACCOUNT_MAILBOXES: 'someone@example.test',
    };
    expect(loadProductionEnvironment({ env, envFile: file })).toBe('postgresql://prod.example.test:5432/railway');
    expect(env).toMatchObject({
      DATABASE_URL: 'postgresql://prod.example.test:5432/railway',
      DATABASE_TLS_CERT: 'pinned-from-file',
      SERVICE_ACCOUNT_MAILBOXES: 'owner@example.test',
    });
  });

  test('other variables already set stay; missing ones are filled from the file', () => {
    const env = { NODE_ENV: 'development' };
    loadProductionEnvironment({ env, envFile: file });
    expect(env.NODE_ENV).toBe('development');
    expect(env.ONLY_IN_FILE).toBe('from-file');
  });

  test('without the file the environment is used as it is (a worktree run with --env-file)', () => {
    const env = { DATABASE_URL: 'postgresql://from-env-file.example.test:5432/railway' };
    expect(loadProductionEnvironment({ env, envFile: join(dir, 'absent') })).toBe('postgresql://from-env-file.example.test:5432/railway');
  });

  test('no DATABASE_URL anywhere — refused, pointing at --env-file', () => {
    expect(() => loadProductionEnvironment({ env: {}, envFile: join(dir, 'absent') }))
      .toThrow(/--env-file/);
  });
});
