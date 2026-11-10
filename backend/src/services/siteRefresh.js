/**
 * Tell the site that its cached establishment pages are out of date — after an
 * account with reviews was deleted (critic 2Г, item 2.04; 10.11.2026).
 *
 * The site keeps every establishment page for up to an hour (web/, the detail
 * page's `revalidate = 3600`), and a quiet card longer: the page is rebuilt on
 * the first visit after the hour, and that visit still gets the old one. A
 * review on such a page kept its author's real name after the account was
 * deleted. The site cannot know of a deletion made in the app or by the
 * operator, so the server tells it: POST to the site's
 * /api/revalidate/establishments (web/src/app/api/revalidate/establishments),
 * which marks every establishment page out of date — the next visit to each
 * builds it afresh, reading «Гость». No list of cards is sent: nothing about
 * the person leaves the server, and a page the person reviewed is any page.
 *
 * The request is proven the server's by the secret the two services already
 * share — SITE_REQUEST_SECRET, which the site sends with its own requests here
 * (middleware/siteVisitor.js). The secret itself does not travel: the header
 * carries the time and an HMAC-SHA256 of «revalidate-establishments:<time>»
 * under the secret, and the site accepts it within SITE_REFRESH_WINDOW_MS. A
 * SITE_URL that pointed anywhere but the site would hand that host a
 * signature good for this one call for a few minutes — never the secret that
 * lets the site's requests through the server's limits (Phase 3.5, lens
 * review). No new variable.
 *
 * The deletion does not depend on it: a site that does not answer in
 * SITE_REFRESH_TIMEOUT_MS, refuses, or is not configured here costs a line in
 * the journal — the pages then refresh within the hour, as before.
 */

import { createHmac } from 'node:crypto';
import logger from '../utils/logger.js';
import { MIN_SECRET_LENGTH } from '../middleware/siteVisitor.js';

/** The site's route that drops its cached establishment pages. */
export const SITE_REFRESH_PATH = '/api/revalidate/establishments';

/** The header of the signed request: `<milliseconds since 1970>.<hex HMAC>`. */
export const SITE_REFRESH_HEADER = 'x-site-refresh';

/** What the signature covers, besides the time — this call and no other. */
export const SITE_REFRESH_PURPOSE = 'revalidate-establishments';

/** How far the site lets the signed time stray from its clock, either way. */
export const SITE_REFRESH_WINDOW_MS = 5 * 60 * 1000;

/** How long the server waits for the site — the person's answer waits too. */
export const SITE_REFRESH_TIMEOUT_MS = 3000;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https, or plain http to this machine only. */
const mayTravelTo = (url) => url.protocol === 'https:'
  || (url.protocol === 'http:' && (LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost')));

/**
 * The header value for the time `now`: the time, a dot, the signature.
 *
 * @param {string} secret
 * @param {number} now - milliseconds since 1970
 * @returns {string}
 */
export const signSiteRefresh = (secret, now) => {
  const time = String(Math.trunc(now));
  const signature = createHmac('sha256', secret).update(`${SITE_REFRESH_PURPOSE}:${time}`).digest('hex');
  return `${time}.${signature}`;
};

/**
 * Ask the site to rebuild its establishment pages on their next visits.
 *
 * @param {Object} [options]
 * @param {Object} [options.env=process.env] - SITE_URL, SITE_REQUEST_SECRET
 * @param {Function} [options.fetchImpl=globalThis.fetch]
 * @param {Function} [options.now=Date.now]
 * @returns {Promise<'refreshed'|'not_configured'|'failed'>}
 */
export const refreshEstablishmentPages = async ({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) => {
  const secret = env.SITE_REQUEST_SECRET;
  if (!env.SITE_URL || typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    logger.warn('Site pages not refreshed: SITE_URL or SITE_REQUEST_SECRET is not set; they refresh within the hour');
    return 'not_configured';
  }

  let url;
  try {
    url = new URL(SITE_REFRESH_PATH, env.SITE_URL);
  } catch {
    logger.warn('Site pages not refreshed: SITE_URL is not a whole address; they refresh within the hour');
    return 'not_configured';
  }
  // Over https only, or to this machine — as the site talks to the API (web
  // lib/api/visitor.ts secretMayTravelTo).
  if (!mayTravelTo(url)) {
    logger.warn('Site pages not refreshed: SITE_URL is not https; they refresh within the hour');
    return 'not_configured';
  }

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { [SITE_REFRESH_HEADER]: signSiteRefresh(secret, now()) },
      signal: AbortSignal.timeout(SITE_REFRESH_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('Site pages not refreshed: the site refused', { status: response.status });
      return 'failed';
    }
    return 'refreshed';
  } catch (error) {
    logger.warn('Site pages not refreshed: the site did not answer', { error: error.message });
    return 'failed';
  }
};
