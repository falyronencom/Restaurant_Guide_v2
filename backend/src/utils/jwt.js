import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import dotenv from 'dotenv';
import logger from './logger.js';
import { accessTokenLifetime } from '../config/accessToken.js';
import { isPanelRole } from '../config/panelRoles.js';

// Load environment variables
// In test environment, .env.test is loaded by Jest setup
// In other environments, load .env
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * The JWT_SECRET values the repository itself publishes — the root
 * .env.example, backend/.env.example and the CI workflow — in lower case.
 * Anyone who reads the repository can sign tokens with them. The test
 * (jwt-secret-guard.test.js) reads those files and fails when one of them
 * carries a value this check would let through.
 */
export const PUBLISHED_PLACEHOLDER_SECRETS = Object.freeze([
  'your_jwt_secret_key_minimum_32_characters_long_please',
  'change_this_to_random_32_char_string',
  'ci-only-test-secret-at-least-32-characters-long',
]);

/** Below this many distinct characters a secret is not drawn at random. */
export const MIN_DISTINCT_CHARACTERS = 8;
/** A secret that repeats a piece this long or shorter is not drawn at random. */
export const MAX_REPEATED_PIECE = 16;

/**
 * The shortest period of a string: the least p with s[i] === s[i + p] for
 * every i — "abcabcab" has 3. A string with no period up to half its length
 * gets its own length.
 */
const shortestPeriod = (text) => {
  for (let p = 1; p <= text.length / 2; p += 1) {
    let repeats = true;
    for (let i = 0; i + p < text.length; i += 1) {
      if (text[i] !== text[i + p]) {
        repeats = false;
        break;
      }
    }
    if (repeats) return p;
  }
  return text.length;
};

/**
 * Why JWT_SECRET is not fit to sign tokens outside the tests, or null. The
 * reason never contains the value.
 *
 *   - shorter than 32 characters;
 *   - a value the repository publishes (case aside);
 *   - "test-…": the form of the test environments' secrets (.env.test);
 *   - plainly not random: fewer than 8 distinct characters, or one piece of
 *     up to 16 characters repeated ("abcabcabc…", "1234567890123…").
 *
 * Why these thresholds: a generated secret never trips them. 32 random hex
 * characters — the poorest alphabet a generator gives (openssl rand -hex 16)
 * — use fewer than 8 of the 16 digits with a chance of about 4·10⁻⁸; a period
 * of 16 or less needs at least 16 characters to repeat the ones before them,
 * 16⁻¹⁶ for hex. A secret typed by hand to pass the length — "aaaa…",
 * "abababab…", "qwertyqwerty…" — trips them at once. A sentence of words
 * would not, and no check of this kind can tell it from a random string;
 * the published ones are named.
 *
 * @param {string|undefined} secret
 * @returns {string|null}
 */
export const jwtSecretProblem = (secret) => {
  if (!secret || secret.length < 32) {
    return 'JWT_SECRET must be at least 32 characters long';
  }
  const lower = secret.trim().toLowerCase();
  if (PUBLISHED_PLACEHOLDER_SECRETS.includes(lower)) {
    return 'JWT_SECRET is a placeholder published in the repository (.env.example or the CI workflow)';
  }
  if (lower.startsWith('test-')) {
    return 'JWT_SECRET starts with "test-", the form of the test environments\' secrets';
  }
  if (new Set(secret).size < MIN_DISTINCT_CHARACTERS || shortestPeriod(secret) <= MAX_REPEATED_PIECE) {
    return 'JWT_SECRET is plainly not random (too few distinct characters or a short piece repeated)';
  }
  return null;
};

/**
 * Validates that JWT_SECRET is fit to sign tokens (jwtSecretProblem). This
 * validation happens at startup to fail fast if misconfigured: outside the
 * tests the server does not start. Until 2026-10-24 the check was the length
 * only, and the placeholder of the root .env.example (52 characters) passed
 * it (Railway incident 21–24.10, finding 6).
 *
 * In test environment, this validation is more lenient as environment variables
 * are loaded by Jest setup files, and the test secrets are allowed.
 */
const secretProblem = jwtSecretProblem(JWT_SECRET);
if (secretProblem) {
  if (process.env.NODE_ENV === 'test') {
    if (!JWT_SECRET || JWT_SECRET.length < 32) {
      // In test environment, log warning but allow continuation
      // Jest setup will load .env.test before tests actually run
      console.warn('⚠️  JWT_SECRET not yet loaded (will be loaded by Jest setup)');
    }
  } else {
    // In production/development, this is a fatal error
    logger.error(`${secretProblem}. Set a random secret, e.g. from: openssl rand -hex 32.`);
    process.exit(1);
  }
}

/**
 * Generates an access token with short expiration time.
 * Access tokens are used for API authentication: the signature is checked here,
 * the account behind the token in the database (middleware/auth.js).
 *
 * Architecture decision: 4 hour expiry balances security and mobile UX.
 * The panel's accounts get one hour (config/accessToken.js): admin-web renews
 * on the 401 by itself, and its tokens are the ones worth stealing.
 * Short expiry limits the damage window if a token is compromised, while refresh
 * tokens allow seamless session continuation. 15m was too aggressive for mobile
 * apps where users leave the app for hours between sessions.
 *
 * The issue time is carried twice: `iat` in whole seconds (the standard claim)
 * and `iatMs` in milliseconds. authenticate compares it with the moment the
 * account's sessions were last revoked (services/accountStatus.js), and whole
 * seconds cannot tell a token issued just before a password reset from one
 * issued just after it in the same second — the takeover of an unconfirmed
 * record issues its own tokens milliseconds after its stamp.
 *
 * @param {Object} payload - User data to encode in token
 * @param {string} payload.userId - User's unique identifier
 * @param {string} payload.email - User's email address
 * @param {string} payload.role - User's role (user, partner, admin)
 * @returns {string} Signed JWT access token
 */
export const generateAccessToken = (payload) => {
  const issuedAtMs = Date.now();
  const tokenPayload = {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    type: 'access',
    // One clock reading for both: jsonwebtoken takes iat from the payload
    // when it is there, and counts exp from it.
    iat: Math.floor(issuedAtMs / 1000),
    iatMs: issuedAtMs,
  };

  return jwt.sign(tokenPayload, JWT_SECRET, {
    // A number is seconds to jsonwebtoken; the other roles keep the
    // variable's own string, signed exactly as before.
    expiresIn: isPanelRole(payload.role)
      ? accessTokenLifetime().panelSeconds
      : accessTokenLifetime().expiresIn,
    issuer: 'restaurant-guide-belarus',
    audience: 'restaurant-guide-api',
  });
};

/**
 * Generates a cryptographically secure refresh token.
 * 
 * CRITICAL SECURITY: Refresh tokens are single-use with strict rotation.
 * When a refresh token is used, it must be immediately invalidated and replaced.
 * This prevents token reuse attacks where stolen tokens could be used alongside
 * legitimate sessions for extended periods.
 * 
 * Implementation note: This generates the token string only. The calling code
 * must store it — as a hash, utils/refreshTokenStorage.js — with user_id and
 * expiration timestamp.
 *
 * @returns {string} Cryptographically random 64-character hex string
 */
export const generateRefreshToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Derives the refresh token of a rotation's successor from the token it
 * replaces and the successor row's id.
 *
 * The database keeps only a hash of each refresh token, so the token of a
 * successor cannot be read back from it. The reuse grace window needs exactly
 * that: a replay of a burned token inside the window is answered with THE SAME
 * successor (config/auth.js, authService.handleReusedToken). Derived this way,
 * the successor is computed again from what the replaying client presents —
 * and from nothing the database holds: the key is drawn from JWT_SECRET under
 * a label of its own, the id is random per row, and the predecessor is stored
 * only as its hash.
 *
 * Changing JWT_SECRET changes every successor derived from then on; a replay
 * within the window of a rotation made under the old secret finds nothing to
 * hand back and gets the verdict of a stale replay.
 *
 * @param {string} predecessorToken - The refresh token being rotated
 * @param {string} successorId - Id of the successor's refresh_tokens row
 * @returns {string} 64-character hex string, the shape of generateRefreshToken
 */
export const deriveSuccessorRefreshToken = (predecessorToken, successorId) => {
  const key = crypto.createHmac('sha256', JWT_SECRET)
    .update('refresh-token-successor/v1')
    .digest();
  return crypto.createHmac('sha256', key)
    .update(`${successorId}\n${predecessorToken}`)
    .digest('hex');
};

/**
 * Decodes an access token that verifies — the check behind verifyAccessToken,
 * without its warning.
 *
 * For a caller that asks of every request whose genuine token it carries: the
 * global rate limiter (middleware/rateLimiter.js) runs before any route, so a
 * client still sending an expired token would log a second warning per request;
 * authenticate verifies the same token again and logs the refusal itself.
 *
 * @param {string} token - JWT access token to verify
 * @returns {Object} Decoded token payload with userId, email, role
 * @throws {Error} If token is invalid, expired, malformed or not an access token
 */
export const decodeAccessToken = (token) => {
  const decoded = jwt.verify(token, JWT_SECRET, {
    issuer: 'restaurant-guide-belarus',
    audience: 'restaurant-guide-api',
  });

  // Ensure this is an access token, not a refresh token somehow misused
  if (decoded.type !== 'access') {
    throw new Error('Invalid token type');
  }

  return decoded;
};

/**
 * Verifies and decodes an access token.
 *
 * Signature, expiry, issuer, audience and type only — no database access. The
 * JWT signature ensures the token hasn't been tampered with. Whether the
 * account may still act, with which role, and whether this token was issued
 * before its sessions were revoked is authenticate's next step
 * (middleware/auth.js, services/accountStatus.js).
 *
 * @param {string} token - JWT access token to verify
 * @returns {Object} Decoded token payload with userId, email, role
 * @throws {Error} If token is invalid, expired, or malformed
 */
export const verifyAccessToken = (token) => {
  try {
    return decodeAccessToken(token);
  } catch (error) {
    logger.warn('Access token verification failed', { error: error.message });
    throw error;
  }
};

/**
 * When a verified access token was issued, in milliseconds since the epoch.
 *
 * `iatMs` on every token issued since 2026-10-12. A token without it (issued
 * earlier) is placed at the start of its `iat` second — never later
 * than the moment it was actually issued, so against a revocation stamp it can
 * only come out older: the safe side. A token with neither claim counts as the
 * oldest possible.
 *
 * @param {Object} decoded - Payload returned by verifyAccessToken
 * @returns {number}
 */
export const accessTokenIssuedAtMs = (decoded) => {
  if (Number.isSafeInteger(decoded.iatMs)) {
    return decoded.iatMs;
  }
  if (Number.isSafeInteger(decoded.iat)) {
    return decoded.iat * 1000;
  }
  return 0;
};

/**
 * Extracts token from Authorization header.
 * Supports the standard "Bearer <token>" format.
 * 
 * @param {string} authHeader - Value of Authorization header
 * @returns {string|null} Token string or null if header is malformed
 */
export const extractTokenFromHeader = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7); // Remove "Bearer " prefix
};

/**
 * Calculates expiration timestamp for refresh tokens.
 * Used when storing refresh tokens in database.
 * 
 * @returns {Date} Expiration date 30 days from now
 */
export const getRefreshTokenExpiry = () => {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);
  return expiry;
};
