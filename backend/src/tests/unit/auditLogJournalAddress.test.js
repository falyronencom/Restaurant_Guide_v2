/* eslint-env jest */
/**
 * The request's address as the journal of actions keeps it
 * (models/auditLogModel.js, journalAddress).
 *
 * audit_log.ip_address is inet. Behind the edge req.ip is taken from the chain
 * the proxies wrote (config/trustProxy.js), and an entry of that chain need
 * not be an address. A moderator's decision and its journal entry share a
 * transaction (adminService.decideWithJournalEntry): an address the column
 * does not take would refuse every decision made from that network. So what
 * is not an address goes in as NULL — the entry stays, without it.
 */

import { journalAddress } from '../../models/auditLogModel.js';

describe('journalAddress — what goes into audit_log.ip_address', () => {
  test.each([
    ['IPv4', '203.0.113.7', '203.0.113.7'],
    ['IPv6', '2001:db8::7', '2001:db8::7'],
    ['IPv4 written as IPv6 (a dual-stack socket)', '::ffff:203.0.113.7', '::ffff:203.0.113.7'],
    ['loopback', '::1', '::1'],
  ])('%s is kept as it came', (_name, value, kept) => {
    expect(journalAddress(value)).toBe(kept);
  });

  test('a zone names an interface of the host and is dropped: inet takes none', () => {
    expect(journalAddress('fe80::1%eth0')).toBe('fe80::1');
  });

  test.each([
    ['a word a proxy wrote', 'unknown'],
    ['an address with a port', '203.0.113.7:51234'],
    ['an IPv6 address in brackets with a port', '[2001:db8::7]:443'],
    ['two addresses', '203.0.113.7, 198.51.100.2'],
    ['an address with a mask', '203.0.113.0/24'],
    ['an empty string', ''],
    ['nothing', undefined],
    ['null', null],
    ['a number', 2130706433],
    ['an object', { ip: '203.0.113.7' }],
  ])('%s is not an address: null', (_name, value) => {
    expect(journalAddress(value)).toBeNull();
  });
});
