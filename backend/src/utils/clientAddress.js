import net from 'node:net';

/**
 * A client address as a limit key: one person, one key (directive D5, 25.10).
 *
 * - IPv4 stays as it is; an IPv4 written as IPv6 (`::ffff:a.b.c.d`, what a
 *   dual-stack socket reports) becomes `a.b.c.d` — the same person must not
 *   hold two keys for two spellings of one address.
 * - IPv6 is cut to its /64: a home or a phone gets a whole /64 from its
 *   provider and may pick any of its 2^64 addresses, so a full IPv6 address
 *   as a key would hand one person unlimited fresh budgets (finding 1 of
 *   PR #53). The key reads `2001:db8:1:2::/64`.
 * - Anything that is not an address comes back as null; the caller decides.
 *
 * Today Railway's domains have no AAAA record and every client is IPv4
 * (SSG_A §7.9, 25.10.2026); the /64 matters from the day a domain behind
 * Cloudflare answers over IPv6 (CAT-C-4.3).
 */

const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * The eight 16-bit groups of an IPv6 address, as numbers.
 *
 * @param {string} address - Passed net.isIPv6, without a zone
 * @returns {number[]}
 */
const ipv6Groups = (address) => {
  let text = address;
  // An embedded IPv4 tail (`::1.2.3.4`, `64:ff9b::1.2.3.4`) is two groups.
  const tail = text.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = rest === undefined ? [] : (rest ? rest.split(':') : []);
  const missing = rest === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array(missing).fill('0'), ...right].map((group) => parseInt(group, 16));
};

/**
 * The limit key of an address, or null when the text is not an address.
 *
 * @param {*} value - req.ip, or an address another service vouched for
 * @returns {string|null}
 */
export const addressKey = (value) => {
  if (typeof value !== 'string' || value === '' || value.length > 64) {
    return null;
  }
  // A zone (`fe80::1%eth0`) names an interface of the host, not a client.
  const address = value.split('%')[0];
  const mapped = address.match(MAPPED_IPV4);
  if (mapped && net.isIPv4(mapped[1])) {
    return mapped[1];
  }
  if (net.isIPv4(address)) {
    return address;
  }
  if (!net.isIPv6(address)) {
    return null;
  }
  const groups = ipv6Groups(address);
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
};
