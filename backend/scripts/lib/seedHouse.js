/**
 * The seed house — the partner account that owns the platform's cards until a
 * real partner claims them (CAT-E-2.1) — found by its flag, never by its
 * address.
 *
 * Until 2026-10-15 every seed script carried the house's e-mail address as a
 * literal, at a domain the project does not own (cloud critic 2B S1), and the
 * scripts that create cards created the house when they did not find it. Once
 * the account moved to an address of ours, those scripts would have opened a
 * second seed house on the old address — an account whose password resets go
 * to a stranger, owning whatever the next import wrote. Now the house is the
 * one active partner with users.is_service_account (migration 037, set by
 * scripts/mark-service-account.js), and a script that does not find exactly
 * one stops: it never creates the house (directive service_accounts, B3).
 */

/** The one place the scripts' query for the seed house lives. */
export const SEED_HOUSE_SQL = `
  SELECT id, email
  FROM users
  WHERE role = 'partner'
    AND is_active = true
    AND COALESCE((to_jsonb(users) ->> 'is_service_account')::boolean, false)
`;

const stop = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

/**
 * The seed house, or an error that stops the script.
 *
 * @param {{query: Function}} db - pg client or pool
 * @returns {Promise<{id: string, email: string}>}
 * @throws {Error} code SEED_HOUSE_NOT_FOUND / SEED_HOUSE_AMBIGUOUS
 */
export async function findSeedHouse(db) {
  const { rows } = await db.query(SEED_HOUSE_SQL);
  if (rows.length === 0) {
    throw stop(
      'SEED_HOUSE_NOT_FOUND',
      'Дом сида не найден: нет активной учётки партнёра с признаком служебной ' +
        '(миграция 037 и scripts/mark-service-account.js). Скрипт остановлен — новую учётку он не заводит.',
    );
  }
  if (rows.length > 1) {
    throw stop(
      'SEED_HOUSE_AMBIGUOUS',
      `Служебных учёток партнёра ${rows.length}, ожидалась одна. Скрипт остановлен: какой из них принадлежат карточки, решает оператор.`,
    );
  }
  return rows[0];
}
