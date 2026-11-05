/**
 * The site's address on the server: SITE_URL is read for one thing, the link
 * in the password-reset letter (services/emailService.js).
 *
 * A wrong value breaks nothing at start and nothing in the tests: the letter
 * still goes out, and only the person who presses its button finds out. So it
 * is said at startup, as an error line, without refusing to start
 * (server.js). On 05.11.2026 the value on production turned out to carry the
 * variable's own name in front of the address: no one could reset a password,
 * and since when is not known.
 *
 * The line does not repeat the value: it says what is wrong with it.
 */

/** The address taken when SITE_URL is unset. */
export const DEFAULT_SITE_URL = 'https://nirivio.by';

/**
 * What is wrong with SITE_URL for the reset letter's link, or null.
 *
 * Unset is not wrong outside production: the local run reads the link from the
 * console (services/emailService.js). In production it means the default
 * address, whatever the site's address is.
 *
 * @param {Object} env - process.env or a stand-in
 * @returns {string|null}
 */
export const siteUrlProblem = (env = {}) => {
  const raw = env.SITE_URL;
  if (raw === undefined || raw === '') {
    return env.NODE_ENV === 'production'
      ? `SITE_URL is not set: links in password-reset letters lead to ${DEFAULT_SITE_URL}`
      : null;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return 'SITE_URL is not a whole address: links in password-reset letters will not open';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'SITE_URL does not start with https://: links in password-reset letters will not open';
  }
  return null;
};
