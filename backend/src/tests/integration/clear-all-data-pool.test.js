/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * clearAllData keeps no session state on pooled connections
 * clearAllData не оставляет состояния сессии на соединениях пула
 *
 * clearAllData sends every statement through the shared app pool, and one
 * call is not pinned to one connection. While the pool has free connections
 * it hands the call back the connection it has just released (LIFO, before
 * any other I/O callback runs), so a background tail returning its connection
 * mid-call lands underneath and changes nothing. Once the pool is saturated,
 * a released connection goes straight to the oldest waiter — typically a
 * fire-and-forget write of the previous test — and the call carries on over
 * another connection.
 *
 * That broke the pair clearAllData used to wrap its TRUNCATEs in
 * (`SET session_replication_role = replica` … `= DEFAULT`): the waiter ran on
 * the connection the SET had just switched to replica — FK checks and user
 * triggers off — and kept it so after the reset went elsewhere, for every
 * later query until the idle timeout closed it. Against pg-test, 2026-09-24:
 * 0 leaks in 39 trials with a timed tail on a free pool, 23 in 40 on a
 * saturated one; 0 in 350 calls of a full run — the pool reached its ceiling
 * inside tests (admin-analytics), never while a clearAllData call ran.
 *
 * The saturated interleaving is built deterministically from pool events:
 * every connection held, clearAllData's first statement and a tail queued
 * behind it, one connection freed; when the tail takes that connection back
 * from the first statement, a second one is freed for the rest of the call.
 * Red on the SET/reset version (the tail and one pooled connection read
 * 'replica'), green once clearAllData keeps no session state. The checkout
 * sequence is asserted in full: an interleaving of another shape lets the
 * SET/reset version pass.
 */

import { pool } from '../../config/database.js';
import { clearAllData } from '../utils/database.js';

// What `session_replication_role` reads back as by default (and after `= DEFAULT`).
const DEFAULT_ROLE = 'origin';

const ROLE_AND_PID =
  "SELECT current_setting('session_replication_role') AS role, pg_backend_pid() AS pid";

/**
 * Role of every connection the pool holds — all checked out at once so none
 * is skipped — then destroyed, so a leaked state cannot outlive this test.
 */
const rolesOfEveryConnection = async () => {
  const total = pool.totalCount;
  const clients = [];
  for (let i = 0; i < total; i += 1) {
    clients.push(await pool.connect());
  }
  try {
    const roles = [];
    for (const client of clients) {
      const { rows } = await client.query(ROLE_AND_PID);
      roles.push(rows[0]);
    }
    return roles;
  } finally {
    clients.forEach((client) => client.release(true));
  }
};

describe('clearAllData over the shared pool', () => {
  test('a call split across connections by a waiting tail leaves every connection in the default role', async () => {
    // Hold every connection the pool may open: from here on each request waits.
    const held = [];
    for (let i = 0; i < pool.options.max; i += 1) {
      held.push(await pool.connect());
    }

    const handedOut = []; // backend pid of every checkout, in order
    let secondPid;
    const onAcquire = (client) => {
      handedOut.push(client.processID);
      // Second checkout = the tail taking the connection the first statement
      // has just released: free another one for the rest of the call.
      if (handedOut.length === 2) {
        const second = held.pop();
        secondPid = second.processID;
        second.release();
      }
    };
    pool.on('acquire', onAcquire);

    let tail;
    try {
      const cleared = clearAllData(); // its first statement waits
      const tailQuery = pool.query(ROLE_AND_PID); // a background tail waits behind it
      held.pop().release(); // → the first statement
      const results = await Promise.all([cleared, tailQuery]);
      [tail] = results[1].rows;
    } finally {
      pool.removeListener('acquire', onAcquire);
      held.forEach((client) => client.release());
    }
    const roles = await rolesOfEveryConnection();

    // Preconditions: the first statement and the tail shared one connection,
    // every later statement of the call ran on the second one, and every
    // pooled connection was read.
    expect(handedOut).toEqual([
      tail.pid,
      tail.pid,
      ...Array(Math.max(handedOut.length - 2, 0)).fill(secondPid),
    ]);
    expect(roles).toHaveLength(pool.options.max);

    expect({
      tail: tail.role,
      leaked: roles.filter(({ role }) => role !== DEFAULT_ROLE),
    }).toEqual({ tail: DEFAULT_ROLE, leaked: [] });
  });
});
