/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * setup-env.js ставит пределы общего лимитера как в CI (где они не заданы) —
 * что бы ни лежало в backend/.env разработчика (20.10.2026). До того .env
 * основной папки (RATE_LIMIT_AUTHENTICATED=1000, RATE_LIMIT_UNAUTHENTICATED=3000)
 * доходил до тестов через dotenv.config() модулей, и наборы на умолчаниях
 * вели себя не как в CI.
 *
 * Отдельный процесс: в нём .env разработчика — в рабочем каталоге, как у
 * прогона из основной папки; сначала setup-env.js, как у jest, затем лимитер.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SETUP_ENV = pathToFileURL(join(HERE, '..', 'setup-env.js')).href;
const RATE_LIMITER = pathToFileURL(join(HERE, '..', '..', 'middleware', 'rateLimiter.js')).href;

const NAMES = [
  'RATE_LIMIT_AUTHENTICATED',
  'RATE_LIMIT_WINDOW_AUTHENTICATED',
  'RATE_LIMIT_UNAUTHENTICATED',
  'RATE_LIMIT_WINDOW_UNAUTHENTICATED',
  'RATE_LIMIT_SITE',
  'RATE_LIMIT_WINDOW_SITE',
];

/** Пределы, которые увидит лимитер, когда в рабочем каталоге лежит такой .env. */
const tiersWith = (devEnv) => {
  const cwd = mkdtempSync(join(tmpdir(), 'setup-env-'));
  try {
    writeFileSync(join(cwd, '.env'), devEnv);
    const env = { ...process.env, NODE_ENV: 'test' };
    for (const name of NAMES) delete env[name];
    const script = `
      await import(${JSON.stringify(SETUP_ENV)});
      const { globalRateLimitTiers } = await import(${JSON.stringify(RATE_LIMITER)});
      process.stdout.write('TIERS ' + JSON.stringify(globalRateLimitTiers.tiers) + '\\n');
      process.exit(0);
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd, env, encoding: 'utf8', timeout: 30000 });
    const line = run.stdout.split('\n').find((text) => text.startsWith('TIERS '));
    if (!line) throw new Error(`child failed: ${run.status}\n${run.stdout}\n${run.stderr}`);
    return JSON.parse(line.slice('TIERS '.length));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

test('.env разработчика с другими пределами — тесты всё равно на умолчаниях, как CI', () => {
  const tiers = tiersWith([
    'RATE_LIMIT_AUTHENTICATED=1000',
    'RATE_LIMIT_WINDOW_AUTHENTICATED=120',
    'RATE_LIMIT_UNAUTHENTICATED=3000',
    'RATE_LIMIT_WINDOW_UNAUTHENTICATED=60',
    'RATE_LIMIT_SITE=9000',
    'RATE_LIMIT_WINDOW_SITE=60',
    '',
  ].join('\n'));

  expect(tiers).toEqual({
    user: { limit: 100, windowSeconds: 60 },
    ip: { limit: 300, windowSeconds: 3600 },
    // Ступень запросов самого сайта (D5, 25.10.2026) — так же на умолчаниях.
    site: { limit: 6000, windowSeconds: 3600 },
  });
});
