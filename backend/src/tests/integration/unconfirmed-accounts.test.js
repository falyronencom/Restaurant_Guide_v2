/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Кто «неподтверждённый» для общего потолка (services/unconfirmedAllowance.js;
 * нитка «Расходы посторонних», п. 3) — на настоящей базе: модульные тесты
 * подменяют запрос, а сбой запроса считает неподтверждёнными всех, дом сида
 * тоже, и тесты с обычными (неподтверждёнными) учётками этого не заметили бы.
 */

import { isUnconfirmedAccount } from '../../services/unconfirmedAllowance.js';
import { clearAllData, query } from '../utils/database.js';
import { createTestUser } from '../utils/auth.js';

let n = 0;
const user = async () => {
  n += 1;
  return createTestUser({ email: `unconfirmed-${n}@example.com`, name: 'Проверка', password: 'Unconf123!@#' });
};

beforeEach(async () => {
  await clearAllData();
});

afterAll(async () => {
  await clearAllData();
});

test('новая учётка по почте — неподтверждённая', async () => {
  const fresh = await user();

  expect(await isUnconfirmedAccount(fresh.id)).toBe(true);
});

test.each([
  ['почта подтверждена', 'UPDATE users SET email_verified = true WHERE id = $1'],
  ['телефон подтверждён', 'UPDATE users SET phone_verified = true WHERE id = $1'],
  ['дом сида', 'UPDATE users SET is_service_account = true WHERE id = $1'],
])('%s — вне общего потолка', async (_label, sql) => {
  const account = await user();
  await query(sql, [account.id]);

  expect(await isUnconfirmedAccount(account.id)).toBe(false);
});
