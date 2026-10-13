/* eslint-env jest */
/**
 * scripts/cleanup-seed-cards.js — удаление карточек заведений по владельцу.
 *
 * До 12.10.2026 в скрипте был встроенный список владельцев от разовой чистки
 * 18.07: служебный аккаунт и тестовый аккаунт стороннего человека (чужой адрес
 * в публичном коде). Служебный аккаунт с тех пор держит настоящий каталог, и
 * запуск без параметров подключался к проду и предлагал удалить его карточки.
 * Теперь владельцы задаются только в --emails=; без них скрипт
 * останавливается, не прочитав настроек и не подключившись к базе.
 *
 * Как проверено. Скрипт пишет только в прод и берёт адрес базы из
 * backend/.env.production, а в основном checkout этот файл настоящий, поэтому
 * сам скрипт отсюда не запускается. Запускается его побайтовая копия в
 * backend/tmp/ со своим .env.production рядом: адрес в нём ведёт на
 * подставной сервер теста, который считает подключения и сразу их рвёт.
 * Пакеты копия находит в backend/node_modules, выше по дереву. Рядом с
 * копией — scripts/lib/productionDb.js и закреплённый сертификат в её
 * .env.production: к проду скрипт ходит только через них.
 */

import { spawn } from 'child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { pinValue } from '../../../scripts/lib/productionDb.js';
import { selfSignedCertificate } from '../utils/fakePostgresTls.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '../../..');
const SCRIPT = join(BACKEND, 'scripts', 'cleanup-seed-cards.js');

let sandbox;
let copy;
let server;
let connections = 0;

beforeAll(async () => {
  server = createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();

  mkdirSync(join(BACKEND, 'tmp'), { recursive: true });
  sandbox = mkdtempSync(join(BACKEND, 'tmp', 'cleanup-seed-cards-'));
  mkdirSync(join(sandbox, 'scripts', 'lib'), { recursive: true });
  copy = join(sandbox, 'scripts', 'cleanup-seed-cards.js');
  copyFileSync(SCRIPT, copy);
  copyFileSync(
    join(BACKEND, 'scripts', 'lib', 'productionDb.js'),
    join(sandbox, 'scripts', 'lib', 'productionDb.js'),
  );
  writeFileSync(
    join(sandbox, '.env.production'),
    `DATABASE_URL=postgresql://nobody:nothing@127.0.0.1:${port}/stub\n`
      + `DATABASE_TLS_CERT=${pinValue(selfSignedCertificate().der)}\n`,
  );
});

afterAll(async () => {
  rmSync(sandbox, { recursive: true, force: true });
  await new Promise((res) => server.close(res));
});

beforeEach(() => {
  connections = 0;
});

/**
 * Запуск копии — асинхронно: подставной сервер живёт в этом же процессе, и при
 * spawnSync он не принял бы подключение, а скрипт ждал бы ответа без конца.
 */
function run(args) {
  const env = { ...process.env };
  // dotenv не перезаписывает заданное окружение: адрес обязан прийти из файла.
  delete env.DATABASE_URL;
  delete env.DATABASE_TLS_CERT;
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [copy, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', rej);
    child.on('close', (code) => res({ code, out }));
  });
}

describe('cleanup-seed-cards: владельцы только из --emails=', () => {
  test('без --emails= скрипт к базе не подключается и объясняет, как задать владельцев', async () => {
    const { code, out } = await run([]);

    expect(connections).toBe(0);
    expect(code).not.toBe(0);
    expect(out).toContain('--emails=');
  });

  test('пустой --emails= — то же, что без него, даже с --yes', async () => {
    const { code, out } = await run(['--emails=', '--yes']);

    expect(connections).toBe(0);
    expect(code).not.toBe(0);
    expect(out).toContain('--emails=');
  });

  // Контроль стенда: без него «0 подключений» выше ничего бы не доказывал.
  test('с --emails= скрипт идёт к базе, и подставной сервер это видит', async () => {
    const { code } = await run(['--emails=owner@example.com', '--report-only']);

    expect(connections).toBe(1);
    expect(code).toBe(1);
  });
});
