/**
 * A password set by an operator script ends every session of the account, as
 * a password reset does on the server (authService.revokeAllSessions,
 * migration 035): the account's refresh tokens are burned and
 * users.sessions_revoked_at is stamped, so a token issued before the stamp is
 * refused with 401 TOKEN_REVOKED. Until 2026-10-12 the scripts wrote
 * password_hash only, and whoever held the old credentials kept a working
 * session — the refresh token for its 30 days, the access token for its 4 h.
 *
 * Used by set-partner-password.js and by the branches of create-admin.js and
 * create-viewer.js that update an existing account. The password and the
 * revocation are written in one transaction: no login sees the new password
 * while the old sessions are alive, and a failure leaves both as they were.
 *
 * Where it differs from revokeAllSessions — the script runs on the operator's
 * machine, outside the server:
 *
 *   - The stamp is the database's clock_timestamp(), not this process's
 *     clock. It is compared with issue times from the server's clock; the
 *     database and the server keep synced clocks on Railway, the operator's
 *     machine may not. A stamp ahead of the server's clock would refuse the
 *     next login as well, until the server's clock caught up with it.
 *     clock_timestamp(), not now(): now() is the start of the transaction,
 *     before the burn, and the stamp must come after it (markSessionsRevoked
 *     explains the race).
 *   - used_at is written by NOW(), as refreshAccessToken writes it: the
 *     column is a naive timestamp, and a JS Date from a machine in another
 *     time zone would land shifted by its offset.
 *   - The server's cached account status cannot be dropped from here: each
 *     server process may let an old access token through for up to
 *     ACCOUNT_STATUS_TTL_MS after the commit. The scripts say so.
 *
 * Before migration 035 the stamp is skipped under a savepoint, as
 * markSessionsRevoked does, and the scripts warn: the refresh tokens are
 * burned, the access tokens live out their TTL.
 */

/** PostgreSQL undefined_column: the schema predates migration 035. */
const UNDEFINED_COLUMN = '42703';

/**
 * ACCOUNT_STATUS_TTL_MS of src/services/accountStatus.js, in seconds — how
 * long a server process may answer from its cached account status. Not
 * imported: that module opens the server's database pool.
 */
export const ACCOUNT_STATUS_TTL_SECONDS = 10;

/**
 * Burn the account's refresh tokens, then stamp users.sessions_revoked_at.
 * Runs inside the caller's transaction.
 *
 * @param {Object} client - pg client inside a transaction
 * @param {string} userId
 * @returns {Promise<{refreshTokens: number, revokedAt: Date|null}>}
 *   revokedAt — the stamp now in force; null when migration 035 is not applied
 */
export async function endAllSessions(client, userId) {
  const burned = await client.query(
    'UPDATE refresh_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );

  await client.query('SAVEPOINT sessions_revoked_at');
  let stamped;
  try {
    stamped = await client.query(
      `UPDATE users SET sessions_revoked_at = GREATEST(sessions_revoked_at, clock_timestamp())
       WHERE id = $1
       RETURNING sessions_revoked_at`,
      [userId],
    );
  } catch (error) {
    if (error.code !== UNDEFINED_COLUMN) throw error;
    await client.query('ROLLBACK TO SAVEPOINT sessions_revoked_at');
    return { refreshTokens: burned.rowCount, revokedAt: null };
  }
  await client.query('RELEASE SAVEPOINT sessions_revoked_at');
  return { refreshTokens: burned.rowCount, revokedAt: stamped.rows[0].sessions_revoked_at };
}

/**
 * Write the password and end the sessions of the account, in one transaction.
 *
 * @param {Object} client - pg client outside a transaction
 * @param {(client: Object) => Promise<Object|undefined>} write - the script's
 *   own UPDATE of the account; returns the updated row (with id), or
 *   undefined when it updated nothing
 * @returns {Promise<{account: Object|undefined, sessions: Object|null}>}
 *   sessions — endAllSessions' result; null when nothing was updated
 */
export async function writePasswordEndingSessions(client, write) {
  await client.query('BEGIN');
  try {
    const account = await write(client);
    const sessions = account ? await endAllSessions(client, account.id) : null;
    await client.query('COMMIT');
    return { account, sessions };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * The write of set-partner-password.js. Here and not in the script, because
 * that script targets production only and cannot be run by a test.
 *
 * @param {Object} client - pg client outside a transaction
 * @param {string} email
 * @param {string} passwordHash
 * @returns {Promise<{account: {id: string, email: string}|undefined, sessions: Object|null}>}
 *   account undefined — no active account with this e-mail
 */
export function setActiveAccountPassword(client, email, passwordHash) {
  return writePasswordEndingSessions(client, async (tx) => {
    const result = await tx.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW()
        WHERE email = $2 AND is_active = true
        RETURNING id, email`,
      [passwordHash, email],
    );
    return result.rows[0];
  });
}

/**
 * Report endAllSessions' result to the operator.
 *
 * @param {{refreshTokens: number, revokedAt: Date|null}} sessions
 */
export function reportEndedSessions({ refreshTokens, revokedAt }) {
  if (revokedAt) {
    console.log(`   Sessions ended: ${refreshTokens} refresh token(s) burned; access tokens issued before now are refused.`);
    console.log(`   A server process may still let an old access token through for up to ${ACCOUNT_STATUS_TTL_SECONDS} seconds`);
    console.log('   (its cached account status — a script cannot clear it).');
    return;
  }
  console.warn('⚠️  Migration 035 is not applied on this database (no users.sessions_revoked_at):');
  console.warn(`   ${refreshTokens} refresh token(s) burned, but access tokens already issued keep working until they expire (up to 4 hours).`);
  console.warn('   node scripts/apply-migration-production.js 035_sessions_revoked_at');
}
