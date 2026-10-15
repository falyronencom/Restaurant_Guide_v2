import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import dotenv from 'dotenv';
import logger from './logger.js';

// Load environment variables
// In test environment, .env.test is loaded by Jest setup
// In other environments, load .env
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '4h';

/**
 * Validates that JWT_SECRET is properly configured.
 * In production, JWT_SECRET must be at least 32 characters for adequate security.
 * This validation happens at startup to fail fast if misconfigured.
 *
 * In test environment, this validation is more lenient as environment variables
 * are loaded by Jest setup files.
 */
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'test') {
    // In test environment, log warning but allow continuation
    // Jest setup will load .env.test before tests actually run
    console.warn('⚠️  JWT_SECRET not yet loaded (will be loaded by Jest setup)');
  } else {
    // In production/development, this is a fatal error
    logger.error('JWT_SECRET must be at least 32 characters long. Configure in .env file.');
    process.exit(1);
  }
}

/**
 * Generates an access token with short expiration time.
 * Access tokens are used for API authentication: the signature is checked here,
 * the account behind the token in the database (middleware/auth.js).
 *
 * Architecture decision: 4 hour expiry balances security and mobile UX.
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
    expiresIn: JWT_ACCESS_EXPIRY,
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
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'restaurant-guide-belarus',
      audience: 'restaurant-guide-api',
    });

    // Ensure this is an access token, not a refresh token somehow misused
    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }

    return decoded;
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
