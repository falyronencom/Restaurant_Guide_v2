/**
 * Сторож общего списка действий журнала (src/constants/auditLogActions.json).
 *
 * Список читают три стороны: подписи журнала (auditLogModel.js, сверяет
 * admin-audit-log-summaries.test.js), фильтр и расшифровка записи в панели
 * (admin-web, moderation_vocabulary_test.dart). Пока он был ручной копией в
 * двух тестах, новый писатель журнала мимо него проходил молча: в фильтре
 * панели не было шести действий, которые сервер писал (проход по панели
 * модератора, 20.10, A3-05, Ч38).
 *
 * Здесь список сверяется с кодом писателей — сервисов и скриптов оператора:
 * каждый код действия и каждый ключ old_data/new_data, найденный в коде,
 * обязан быть в списке, а каждое действие списка — найтись в коде (мёртвая
 * строка списка обещала бы фильтр по тому, чего не бывает).
 *
 * Поиск — по формам, которыми журнал пишут сегодня. Код, собранный выражением
 * (`moderate_${action}`, тернарник, константа), вписан в таблицу INDIRECT
 * с тем выражением, которое обязано остаться в файле: исчезни оно — тест
 * потребует пересмотреть таблицу, а не промолчит.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, '..', '..', '..');
const catalogue = JSON.parse(
  readFileSync(join(backendRoot, 'src', 'constants', 'auditLogActions.json'), 'utf8'),
);
const ACTIONS = new Set(catalogue.actions.map((a) => a.action));
const FIELDS = new Set(catalogue.fields);

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) {
    return name === 'node_modules' || name === 'tests' ? [] : walk(path);
  }
  return path.endsWith('.js') ? [path] : [];
});

const WRITES_JOURNAL = /createAuditLog\(|writeAuditLogInTransaction\(|INSERT INTO audit_log/;
const writers = [...walk(join(backendRoot, 'src')), ...walk(join(backendRoot, 'scripts'))]
  .filter((path) => !path.endsWith('auditLogModel.js'))
  .filter((path) => !path.endsWith(join('config', 'database.js')))
  .map((path) => ({ path: relative(backendRoot, path).split('\\').join('/'), text: readFileSync(path, 'utf8') }))
  .filter((file) => WRITES_JOURNAL.test(file.text));

/** Коды, собранные выражением: файл → выражение в нём → коды, которые оно даёт. */
const INDIRECT = [
  ['src/services/adminService.js', 'action: `moderate_${action}`', ['moderate_approve', 'moderate_reject']],
  ['src/services/adminReviewService.js', "const action = isVisible ? 'review_show' : 'review_hide'", ['review_show', 'review_hide']],
  ['src/services/accountDeletionService.js', "ACCOUNT_DELETED_ACTION = 'user_delete_account'", ['user_delete_account']],
  ['scripts/create-admin.js', "row.role === 'admin' ? 'operator_reset_admin' : 'operator_promote_admin'", ['operator_reset_admin', 'operator_promote_admin']],
  ['scripts/create-admin.js', "journal(client, 'operator_create_admin'", ['operator_create_admin']],
  ['scripts/set-user-active.js', "active ? 'user_unblock' : 'user_block'", ['user_unblock', 'user_block']],
];

/** Ключи, которые приходят «...spread»-ом из переменной: файл → выражение → ключи. */
const INDIRECT_FIELDS = [
  ['src/services/accountDeletionService.js', 'new_data: label ? { ...counts, actor: label } : counts',
    ['reviews_kept', 'bookings_cancelled', 'favorites_removed', 'drafts_deleted', 'access_tokens_revoked']],
];

const literalActions = (text) => {
  const found = new Set();
  for (const m of text.matchAll(/action:\s*'([a-z][a-z0-9_]*)'/g)) found.add(m[1]);
  // SQL, пишущий журнал своим оператором: код — второй столбец после автора.
  for (const m of text.matchAll(/(?:SELECT|VALUES\s*\()\s*(?:\$\d+(?:::uuid)?|NULL)\s*,\s*'([a-z][a-z0-9_]*)'\s*,\s*'(?:establishment|menu_item|review|user)'/g)) {
    found.add(m[1]);
  }
  return found;
};

/** Ключи верхнего уровня объектного литерала, начинающегося с `{` в [start]. */
const objectKeys = (text, start) => {
  let depth = 0;
  let end = start;
  for (; end < text.length; end += 1) {
    if (text[end] === '{') depth += 1;
    if (text[end] === '}') { depth -= 1; if (depth === 0) break; }
  }
  const body = text.slice(start + 1, end);
  const parts = [];
  let level = 0;
  let current = '';
  for (const ch of body) {
    if ('{[('.includes(ch)) level += 1;
    if ('}])'.includes(ch)) level -= 1;
    if (ch === ',' && level === 0) { parts.push(current); current = ''; } else current += ch;
  }
  parts.push(current);
  return parts
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('...') && !part.startsWith('//'))
    .map((part) => part.replace(/^\/\/.*\n/gm, '').trim())
    .map((part) => (part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::|$)/) || [])[1])
    .filter(Boolean);
};

const literalFields = (text) => {
  const found = new Set();
  for (const m of text.matchAll(/\b(?:old_data|new_data|oldData|newData|old|new):\s*(?=\{)/g)) {
    for (const key of objectKeys(text, m.index + m[0].length)) found.add(key);
  }
  // Писатели SQL-вставкой: ключи JSON.stringify({…}) и jsonb_build_object('…')
  // в пределах самого оператора записи.
  for (const m of text.matchAll(/INSERT INTO audit_log/g)) {
    const window = text.slice(m.index, m.index + 1400);
    for (const s of window.matchAll(/JSON\.stringify\(\s*(?=\{)/g)) {
      for (const key of objectKeys(window, s.index + s[0].length)) found.add(key);
    }
    for (const b of window.matchAll(/jsonb_build_object\(([^)]*)\)/g)) {
      for (const k of b[1].matchAll(/'([a-z][a-z0-9_]*)'\s*,/g)) found.add(k[1]);
    }
  }
  return found;
};

describe('Список действий журнала — по коду писателей', () => {
  it('писатели журнала, их коды и ключи найдены (иначе поиск сломался и молчит)', () => {
    expect(writers.length).toBeGreaterThanOrEqual(10);
    const codes = new Set(writers.flatMap((file) => [...literalActions(file.text)]));
    const keys = new Set(writers.flatMap((file) => [...literalFields(file.text)]));
    expect(codes.size).toBeGreaterThanOrEqual(18);
    expect(keys.size).toBeGreaterThanOrEqual(30);
    // Формы, которыми пишут скрипты и SQL, — тоже находятся.
    expect([...codes]).toEqual(expect.arrayContaining(['change_email', 'dismiss_sanity_flag', 'partner_pause']));
    expect([...keys]).toEqual(expect.arrayContaining(['moderation_notes', 'email_codes_spent', 'item_name']));
  });

  it('каждое выражение-источник кода всё ещё в своём файле', () => {
    for (const [path, expression] of [...INDIRECT, ...INDIRECT_FIELDS]) {
      const file = writers.find((w) => w.path === path);
      expect({ path, present: Boolean(file && file.text.includes(expression)) })
        .toEqual({ path, present: true });
    }
  });

  it('каждое действие, которое пишет код, есть в списке', () => {
    const written = new Set(INDIRECT.flatMap(([, , codes]) => codes));
    for (const file of writers) for (const code of literalActions(file.text)) written.add(code);

    const missing = [...written].filter((code) => !ACTIONS.has(code)).sort();
    expect(missing).toEqual([]);
  });

  it('каждое действие списка пишется кодом — мёртвых строк нет', () => {
    const written = new Set(INDIRECT.flatMap(([, , codes]) => codes));
    for (const file of writers) for (const code of literalActions(file.text)) written.add(code);

    const dead = [...ACTIONS].filter((code) => !written.has(code)).sort();
    expect(dead).toEqual([]);
  });

  it('каждый ключ записи, который пишет код, есть в списке полей', () => {
    const keys = new Set(INDIRECT_FIELDS.flatMap(([, , fields]) => fields));
    for (const file of writers) for (const key of literalFields(file.text)) keys.add(key);

    const missing = [...keys].filter((key) => !FIELDS.has(key)).sort();
    expect(missing).toEqual([]);
  });

  it('новое действие без строки в списке — тест краснеет', () => {
    // Проверка самого поиска: подставной писатель с незнакомым кодом.
    const fake = "await AuditLogModel.createAuditLog({ user_id: id, action: 'brand_new_action', old_data: { strange_key: 1 } });";
    expect([...literalActions(fake)].filter((c) => !ACTIONS.has(c))).toEqual(['brand_new_action']);
    expect([...literalFields(fake)].filter((k) => !FIELDS.has(k))).toEqual(['strange_key']);
  });
});
