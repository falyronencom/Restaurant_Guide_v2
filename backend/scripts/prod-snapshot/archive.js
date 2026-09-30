/**
 * Снимок прода — архив и шифрование: tar, sha256, gpg --symmetric.
 *
 * Пароль скрипт не видит никогда: gpg спрашивает его у gpg-agent, агент
 * показывает GUI-окно pinentry (pinentry-w32 из Git for Windows). Запрещено
 * и здесь не встречается: --passphrase, --passphrase-file, --passphrase-fd,
 * --pinentry-mode loopback. --no-symkey-cache: агент не кэширует пароль, и
 * проверочная расшифровка спрашивает его заново — так она доказывает, что
 * пароль, сохранённый Координатором, открывает архив.
 *
 * tar вызывается с относительными путями из рабочей папки: GNU tar из Git
 * читает «C:/…» как адрес удалённого хоста, а относительный путь понимают
 * оба tar (GNU и bsdtar Windows).
 */

import { createReadStream } from 'fs';
import { open } from 'fs/promises';
import { createHash } from 'crypto';
import { run } from './proc.js';

export const sha256File = (path) =>
  new Promise((resolvePromise, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => resolvePromise(h.digest('hex')))
      .on('error', reject);
  });

/** Путь для программ MSYS (gpg из Git): прямые слэши. */
const msysPath = (p) => p.replace(/\\/g, '/');

const GIT_GPG = 'C:\\Program Files\\Git\\usr\\bin\\gpg.exe';

/** gpg из PATH, иначе из Git for Windows. */
export const findGpg = async () => {
  for (const candidate of ['gpg', GIT_GPG]) {
    const r = await run(candidate, ['--version'], { timeoutMs: 30000 });
    if (r.code === 0) return { path: candidate, version: r.stdout.split(/\r?\n/)[0].trim() };
  }
  return null;
};

export const tarVersion = async () => {
  const r = await run('tar', ['--version'], { timeoutMs: 30000 });
  return r.code === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
};

export const tarCreate = (cwd, tarName, dirName) => run('tar', ['-cf', tarName, dirName], { cwd });
export const tarExtract = (cwd, tarName) => run('tar', ['-xf', tarName], { cwd });

/** Симметричное шифрование: AES-256, S2K SHA-512 с максимумом итераций, без сжатия (медиа и -Fc уже сжаты). */
export const GPG_ENCRYPT_ARGS = Object.freeze([
  '--no-tty', '--yes', '--no-symkey-cache',
  '--symmetric',
  '--cipher-algo', 'AES256',
  '--s2k-cipher-algo', 'AES256',
  '--s2k-digest-algo', 'SHA512',
  '--s2k-mode', '3',
  '--s2k-count', '65011712',
  '--compress-algo', 'none',
]);

/** Окно pinentry должно быть видно: у gpg не прячем окно (hideWindow: false). */
export const gpgEncrypt = (gpg, input, output) =>
  run(gpg, [...GPG_ENCRYPT_ARGS, '--output', msysPath(output), msysPath(input)], { hideWindow: false });

export const gpgDecrypt = (gpg, input, output) =>
  run(gpg, ['--no-tty', '--yes', '--no-symkey-cache', '--output', msysPath(output), '--decrypt', msysPath(input)], { hideWindow: false });

/**
 * Теги первых пакетов OpenPGP — формат шифрования без пароля:
 *   [3 v4, 18 v1] — классический (RFC 4880, MDC): читает любой gpg 2.x;
 *   [3 v5, 20]    — OCB LibrePGP: только GnuPG ≥ 2.3;
 *   [3 v6, 18 v2] — AEAD RFC 9580;
 *   [3, 9]        — без MDC: небезопасно.
 */
export const readPacketHeaders = async (path, maxPackets = 2) => {
  const fh = await open(path, 'r');
  const buf = Buffer.alloc(1024);
  let len;
  try {
    ({ bytesRead: len } = await fh.read(buf, 0, buf.length, 0));
  } finally {
    await fh.close();
  }
  const packets = [];
  let pos = 0;
  while (packets.length < maxPackets && pos < len) {
    const b = buf[pos];
    if ((b & 0x80) === 0) break;
    let tag;
    let bodyLen;
    let headerLen;
    let partial = false;
    if (b & 0x40) {
      tag = b & 0x3f;
      const l1 = buf[pos + 1];
      if (l1 < 192) { bodyLen = l1; headerLen = 2; }
      else if (l1 < 224) { bodyLen = ((l1 - 192) << 8) + buf[pos + 2] + 192; headerLen = 3; }
      else if (l1 === 255) { bodyLen = buf.readUInt32BE(pos + 2); headerLen = 6; }
      else { bodyLen = 1 << (l1 & 0x1f); headerLen = 2; partial = true; }
    } else {
      tag = (b >> 2) & 0x0f;
      const lt = b & 3;
      if (lt === 0) { bodyLen = buf[pos + 1]; headerLen = 2; }
      else if (lt === 1) { bodyLen = buf.readUInt16BE(pos + 1); headerLen = 3; }
      else if (lt === 2) { bodyLen = buf.readUInt32BE(pos + 1); headerLen = 5; }
      else { bodyLen = Infinity; headerLen = 1; partial = true; }
    }
    packets.push({ tag, version: buf[pos + headerLen] });
    if (partial) break;
    pos += headerLen + bodyLen;
  }
  return packets;
};

export const describePacketFormat = (packets) => {
  const [skesk, data] = packets;
  if (!skesk || skesk.tag !== 3 || !data) return { ok: false, text: `непонятные пакеты: ${JSON.stringify(packets)}` };
  if (data.tag === 18 && data.version === 1) return { ok: true, text: 'классический OpenPGP (RFC 4880, AES-256 + MDC) — расшифрует любой gpg 2.x' };
  if (data.tag === 20) return { ok: true, text: 'OCB LibrePGP — расшифрует только GnuPG ≥ 2.3' };
  if (data.tag === 18 && data.version === 2) return { ok: true, text: 'AEAD RFC 9580 — нужен gpg с поддержкой RFC 9580' };
  if (data.tag === 9) return { ok: false, text: 'шифрование без MDC — небезопасно' };
  return { ok: false, text: `неизвестный пакет данных: тег ${data.tag} v${data.version}` };
};
