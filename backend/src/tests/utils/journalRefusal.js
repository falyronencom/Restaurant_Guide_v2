/**
 * A journal entry the database refuses — for the tests of the actions written
 * with their entry or not at all (auditLogModel.writeAuditLogInTransaction):
 * a moderator's decision on a card (register item К7, PR #214) and the rest of
 * a moderator's actions (decision of the Coordinator, 19.11.2026).
 *
 * A trigger on audit_log refuses the entries of one marked user agent — a
 * stand-in for anything the database refuses. Left behind by a killed run, it
 * refuses nothing else. A test makes the same action twice: with the mark —
 * refused, nothing changed; without it — done. The second half is the scene:
 * the refusal the first half saw was the entry's, not the action's.
 */

import { query } from './database.js';

/** The user agent whose journal entries the trigger refuses. */
export const UNWRITABLE_AGENT = 'journal-refused-for-test';

/** A user agent like any other: its entries are written. */
export const WRITABLE_AGENT = 'journal-test';

/** Install the trigger (beforeAll). */
export const refuseMarkedJournalEntries = async () => {
  await query(
    `CREATE OR REPLACE FUNCTION refuse_journal_entry_for_test() RETURNS trigger AS $$
     BEGIN RAISE EXCEPTION 'the journal entry cannot be written (test)'; END;
     $$ LANGUAGE plpgsql`,
  );
  await query('DROP TRIGGER IF EXISTS refuse_journal_entry_for_test ON audit_log');
  await query(
    `CREATE TRIGGER refuse_journal_entry_for_test BEFORE INSERT ON audit_log
     FOR EACH ROW WHEN (NEW.user_agent = '${UNWRITABLE_AGENT}')
     EXECUTE FUNCTION refuse_journal_entry_for_test()`,
  );
};

/** Remove the trigger (afterAll). */
export const writeAllJournalEntries = async () => {
  await query('DROP TRIGGER IF EXISTS refuse_journal_entry_for_test ON audit_log');
  await query('DROP FUNCTION IF EXISTS refuse_journal_entry_for_test()');
};
