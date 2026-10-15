/**
 * Pin the production database's certificate — once, on this computer.
 *
 * The operator scripts connect to production only if it presents the pinned
 * certificate (scripts/lib/productionDb.js). This tool reads the certificate
 * the server presents — without signing in: nothing but the TLS greeting is
 * sent, no user name, no password — shows its fingerprint, and on "yes"
 * writes it into backend/.env.production as DATABASE_TLS_CERT. Then it checks
 * that a verified handshake goes through.
 *
 * Before typing "yes", compare the fingerprint where you can: the same
 * command run from another network (a phone's hotspot) must show the same
 * one. A different fingerprint on the second network means one of the two
 * is not talking to the real server.
 *
 * A pin is never replaced silently: if the server now presents another
 * certificate, the tool stops and says so. Replace the pin with --replace
 * only when you know why it changed (Railway recreated or moved the
 * database).
 *
 * Usage (from backend/):
 *   node scripts/pin-production-db-cert.js             show, ask, pin, check
 *   node scripts/pin-production-db-cert.js --check     show and compare; changes nothing
 *                                                      exit 0 matches · 1 differs · 2 nothing pinned
 *   node scripts/pin-production-db-cert.js --replace   allow replacing a pin that differs
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import dotenv from 'dotenv';
import {
  PIN_VARIABLE,
  PRODUCTION_ENV_FILE,
  fetchServerCertificate,
  pinValue,
  readPinnedCertificate,
  targetOf,
  upsertEnvLine,
  verifyPinnedHandshake,
} from './lib/productionDb.js';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const allowReplace = args.includes('--replace');

if (!existsSync(PRODUCTION_ENV_FILE)) {
  console.error('❌ Нет backend/.env.production (нужен DATABASE_URL). См. scripts/README-MIGRATIONS.md');
  process.exit(1);
}
const envText = readFileSync(PRODUCTION_ENV_FILE, 'utf8');
const envValues = dotenv.parse(envText);
if (!envValues.DATABASE_URL) {
  console.error('❌ В backend/.env.production не задан DATABASE_URL.');
  process.exit(1);
}
const target = targetOf(envValues.DATABASE_URL);

const ask = (question) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim().toLowerCase());
  }));
};

const dateOf = (text) => new Date(text).toLocaleDateString('ru-RU');

async function main() {
  console.log('');
  console.log(`Рабочая база: ${target.host}:${target.port}`);
  const presented = await fetchServerCertificate(target);
  console.log('Сертификат, который она предъявляет:');
  console.log(`  кому выдан:  ${presented.subject.replace(/\n/g, ', ')}`);
  console.log(`  кем выдан:   ${presented.issuer.replace(/\n/g, ', ')}`);
  console.log(`  действует:   ${dateOf(presented.validFrom)} — ${dateOf(presented.validTo)}`);
  console.log(`  отпечаток:   ${presented.fingerprint256}`);

  // Pinning the certificate itself works for a self-signed one — Railway's
  // is. One issued by a separate authority needs that authority pinned, which
  // this tool does not do: say so instead of writing a pin that cannot work.
  const selfSigned = presented.checkIssued(presented) && presented.verify(presented.publicKey);
  if (!selfSigned) {
    console.error('');
    console.error('❌ Этот сертификат выдан не самим сервером, а отдельным центром — закрепить его');
    console.error('   этим инструментом нельзя. Ничего не изменено. Нужна правка инструмента (закреплять центр).');
    process.exitCode = 1;
    return;
  }

  let pinned = null;
  try {
    pinned = readPinnedCertificate({ env: envValues, envFile: null });
  } catch (error) {
    if (error.code !== 'PRODUCTION_DB_CERT_NOT_PINNED') {
      console.log(`  закреплённый: не читается (${error.code}) — будет заменён`);
    }
  }
  const matches = Boolean(pinned) && pinned.fingerprint256 === presented.fingerprint256;
  if (pinned) {
    console.log(matches
      ? '  закреплённый: тот же — совпадает'
      : `  закреплённый: ДРУГОЙ — ${pinned.fingerprint256}`);
  } else {
    console.log('  закреплённый: нет');
  }
  console.log('');

  if (checkOnly) {
    process.exitCode = matches ? 0 : (pinned ? 1 : 2);
    return;
  }

  if (matches) {
    await verifyPinnedHandshake(target, pinned);
    console.log('✓ Уже закреплён этот сертификат, и проверка проходит — менять нечего.');
    return;
  }

  if (pinned && !allowReplace) {
    console.error('❌ Рабочая база предъявляет не тот сертификат, что закреплён. Ничего не изменено.');
    console.error('   Если Railway пересоздавал или переносил базу — сверьте отпечаток выше из другой сети');
    console.error('   (например, через раздачу с телефона) и запустите с --replace.');
    console.error('   Если нет — не подключайтесь к базе: связь могла быть перехвачена.');
    process.exitCode = 1;
    return;
  }

  const answer = await ask(`Закрепить этот сертификат в backend/.env.production (${PIN_VARIABLE})? Введите "yes": `);
  if (answer !== 'yes') {
    console.log('Отменено — ничего не изменено.');
    return;
  }

  // The same check the scripts will make, before anything is written: a pin
  // that would not let them connect is never saved.
  await verifyPinnedHandshake(target, presented);
  console.log('✓ Проверка: подключение с проверкой этого сертификата проходит.');

  const temporary = `${PRODUCTION_ENV_FILE}.tmp-${process.pid}`;
  writeFileSync(temporary, upsertEnvLine(envText, PIN_VARIABLE, pinValue(presented.raw)), { mode: 0o600 });
  renameSync(temporary, PRODUCTION_ENV_FILE);
  console.log(`✓ Закреплён: ${PIN_VARIABLE} в backend/.env.production. Скрипты будут подключаться только к этой базе.`);
}

main().catch((error) => {
  console.error('❌', error.message);
  process.exit(1);
});
