import crypto from 'node:crypto';
import net from 'node:net';
import { addressKey } from '../utils/clientAddress.js';
import logger from '../utils/logger.js';

/**
 * The site's own requests, and the visitor they are made for (registry v4.35,
 * directive D5).
 *
 * The site (web/) calls this API from its server, so to the API every visitor
 * of the site is one address — the site's. Its limiters then count the whole
 * site as one person: ten wrong passwords anywhere lock everyone out of
 * signing in for a minute (v4.44), twenty new phrases an hour end the smart
 * search for all. The site therefore names the visitor in a header of its own,
 * and proves the request is its own with a secret both services hold.
 *
 * - `X-Site-Secret` — the shared secret, SITE_REQUEST_SECRET (and, while it is
 *   being changed, SITE_REQUEST_SECRET_PREVIOUS) on both services. Compared
 *   as SHA-256 digests with crypto.timingSafeEqual, against every configured
 *   value, so the time taken says nothing about how close a guess came.
 *   A secret shorter than MIN_SECRET_LENGTH on the server counts as no secret:
 *   the header is then never accepted — an empty secret would otherwise match
 *   an empty header.
 * - `X-Site-Visitor` — the visitor's address: one value, an IP address, at
 *   most 64 characters; IPv6 counts by its /64 (utils/clientAddress.js).
 *   With a matching secret but no usable visitor, the request is the site's
 *   own (pre-rendering, sitemap, background revalidation): its own tier of the
 *   global limiter, its own key (rateLimiter.js requesterOf).
 *
 * A wrong or missing secret changes nothing — the same response and the same
 * key as a request without the headers, so a guess learns nothing. The
 * result goes to req.siteRequest only; req.ip is left alone, so the access
 * log, the error handler and the panel's audit keep the address the request
 * came from, not the visitors' addresses the site deliberately does not keep.
 * Both headers are removed from the request once read.
 *
 * Names are our own on purpose: Railway's edge rewrites X-Forwarded-For and
 * may rewrite X-Real-IP between the two services.
 */

export const SITE_SECRET_HEADER = 'x-site-secret';
export const SITE_VISITOR_HEADER = 'x-site-visitor';

/** Below this a secret on the server is ignored (a 256-bit random value is 43 in base64). */
export const MIN_SECRET_LENGTH = 32;

/** Longest visitor value read: an IPv6 address is 45 characters at most. */
const MAX_VISITOR_LENGTH = 64;

const digest = (value) => crypto.createHash('sha256').update(value, 'utf8').digest();

/**
 * The secrets the server accepts, read from the environment on every call so
 * a change of the variables needs no code path to forget a cached copy.
 *
 * @param {Object} env
 * @returns {Buffer[]} digests of the usable secrets
 */
const acceptedSecretDigests = (env) => ['SITE_REQUEST_SECRET', 'SITE_REQUEST_SECRET_PREVIOUS']
  .map((name) => env[name])
  .filter((value) => typeof value === 'string' && value.length >= MIN_SECRET_LENGTH)
  .map(digest);

/**
 * Whether the presented secret is one the server holds. Every configured
 * digest is compared, whatever the first comparison said.
 *
 * @param {*} presented
 * @param {Object} env
 * @returns {boolean}
 */
const secretMatches = (presented, env) => {
  const accepted = acceptedSecretDigests(env);
  if (accepted.length === 0 || typeof presented !== 'string' || presented === '') {
    return false;
  }
  const candidate = digest(presented);
  let matched = false;
  for (const expected of accepted) {
    matched = crypto.timingSafeEqual(candidate, expected) || matched;
  }
  return matched;
};

/**
 * Process-wide tallies, read by GET /search/health: whether the site's
 * requests are recognised after a deploy, without the Railway logs. Since the
 * process started; aggregates only, no address.
 */
const tallies = {
  since: new Date().toISOString(),
  accepted: 0,
  withoutVisitor: 0,
  visitorUnusable: 0,
  rejectedSecret: 0,
};

/**
 * `without_visitor` — the site named no visitor (pre-rendering, background);
 * `visitor_unusable` — it named one the server could not read: those
 * visitors share the site's budgets again, sign-in included.
 *
 * @returns {{ since: string, accepted: number, without_visitor: number,
 *   visitor_unusable: number, rejected_secret: number }}
 */
export const siteRequestTallies = () => ({
  since: tallies.since,
  accepted: tallies.accepted,
  without_visitor: tallies.withoutVisitor,
  visitor_unusable: tallies.visitorUnusable,
  rejected_secret: tallies.rejectedSecret,
});

/** Tests only: start the tallies from zero. */
export const resetSiteRequestTallies = () => {
  tallies.accepted = 0;
  tallies.withoutVisitor = 0;
  tallies.visitorUnusable = 0;
  tallies.rejectedSecret = 0;
};

const WARN_EVERY_MS = 5 * 60 * 1000;
let lastRejectionWarnAt = 0;
let lastUnusableWarnAt = 0;

/**
 * The visitor's key from the header, or null.
 *
 * @param {*} raw
 * @returns {string|null}
 */
const visitorKeyOf = (raw) => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_VISITOR_LENGTH) {
    return null;
  }
  const value = raw.trim();
  if (net.isIP(value) === 0) {
    return null;
  }
  return addressKey(value);
};

/**
 * Builds the middleware; `env` is process.env in the app.
 *
 * @param {Object} [env]
 * @returns {Function} Express middleware
 */
export const createSiteVisitor = (env = process.env) => (req, res, next) => {
  const presented = req.headers[SITE_SECRET_HEADER];
  const visitor = req.headers[SITE_VISITOR_HEADER];
  delete req.headers[SITE_SECRET_HEADER];
  delete req.headers[SITE_VISITOR_HEADER];

  if (presented === undefined) {
    return next();
  }

  if (!secretMatches(presented, env)) {
    tallies.rejectedSecret += 1;
    const now = Date.now();
    if (now - lastRejectionWarnAt >= WARN_EVERY_MS) {
      lastRejectionWarnAt = now;
      // No value of either header: the count is what tells a stale secret
      // on the site from someone guessing.
      logger.warn('Site request secret did not match; counted as an ordinary request', {
        rejectedSinceStart: tallies.rejectedSecret,
        secretsConfigured: acceptedSecretDigests(env).length,
      });
    }
    return next();
  }

  const visitorKey = visitorKeyOf(visitor);
  if (visitorKey) {
    tallies.accepted += 1;
  } else if (visitor === undefined) {
    tallies.withoutVisitor += 1;
  } else {
    tallies.visitorUnusable += 1;
    const now = Date.now();
    if (now - lastUnusableWarnAt >= WARN_EVERY_MS) {
      lastUnusableWarnAt = now;
      // Not the value: it is a visitor's address, or close to one.
      logger.warn('Site named a visitor the server cannot read; counted as the site itself', {
        unusableSinceStart: tallies.visitorUnusable,
      });
    }
  }
  req.siteRequest = { visitorKey };
  return next();
};

export const siteVisitor = createSiteVisitor();
