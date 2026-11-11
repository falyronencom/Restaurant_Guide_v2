/**
 * The account, as the writers of a person's data read it — under a share lock,
 * in the statement or the transaction that writes (critic 2Г, items 2.01, 2.03,
 * П3-03; 10.11.2026).
 *
 * The deletion of an account (accountDeletionService) holds the account row
 * FOR UPDATE from its first statement to its COMMIT, clears the person's rows
 * and switches the account off. A request that passed the sign-in check
 * before that COMMIT — a second device, a second tab, the cached status of
 * another server process, the operator's script that cannot drop the server's
 * cache — used to write after it: the foreign key only waits for the lock and
 * then lets the row in, under an account nobody can open any more. A favourite
 * stayed in the card's counter for good, a device token, a draft card with
 * the person's phone and address, a review rewritten under «Гость».
 *
 * FOR SHARE conflicts with the deletion's FOR UPDATE, so one waits for the
 * other. A writer that comes second reads the row as the deletion left it —
 * under READ COMMITTED the lock re-reads a row changed by a transaction that
 * committed meanwhile — and finds it switched off: nothing is written. A
 * writer that comes first commits before the deletion starts, and the
 * deletion removes what it wrote. The same as the review's own check
 * (reviewService.createReview) and the booking's (bookingModel.create).
 *
 * A switched-off account (blocked from the panel) is refused the same way: it
 * cannot open what would be written for it. FOR SHARE does not wait for
 * another FOR SHARE, nor for FOR KEY SHARE: writers of one account do not
 * queue behind each other.
 */

/**
 * The account `param` names, if it is active — a FROM-able subquery that holds
 * the row in share mode for the statement. Writers of one statement select
 * their row FROM it: no active account, no row.
 *
 * @param {string} param - the placeholder of the account id, e.g. '$1'
 * @returns {string}
 */
export const activeAccountRow = (param) =>
  `(SELECT id FROM users WHERE id = ${param} AND is_active = TRUE FOR SHARE)`;

/**
 * Hold the account row in share mode for the rest of the caller's transaction
 * and say whether the account is active.
 *
 * @param {import('pg').PoolClient} client - inside BEGIN
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export const holdActiveAccount = async (client, userId) =>
  (await client.query('SELECT is_active FROM users WHERE id = $1 FOR SHARE', [userId]))
    .rows[0]?.is_active === true;
