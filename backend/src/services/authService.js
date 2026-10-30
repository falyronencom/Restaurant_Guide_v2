/**
 * Authentication Service
 * 
 * This service encapsulates all business logic for user authentication operations.
 * It handles user creation, credential verification, token generation, and token
 * lifecycle management. By separating business logic from HTTP concerns, we make
 * the code testable and maintainable.
 * 
 * Security considerations:
 * - Passwords are hashed using Argon2id with specific parameters for GPU resistance
 * - Constant-time operations prevent timing attacks
 * - Refresh tokens use strict rotation to prevent reuse attacks
 * - Refresh tokens are stored as hashes (utils/refreshTokenStorage.js)
 * - All database operations use parameterized queries for SQL injection protection
 */

import argon2 from 'argon2';
import { pool, getClient } from '../config/database.js';
import { resolveRefreshReuseGraceSeconds } from '../config/auth.js';
import { accessTokenLifetimeSeconds } from '../config/accessToken.js';
import {
  generateAccessToken,
  generateRefreshToken,
  deriveSuccessorRefreshToken,
} from '../utils/jwt.js';
import { storedRefreshToken } from '../utils/refreshTokenStorage.js';
import logger from '../utils/logger.js';
import { checkUserName, normalizeUserName, providerDisplayName } from '../utils/userName.js';
import {
  invalidateAccountStatus,
  issuedBeforeRevocation,
  markSessionsRevoked,
} from './accountStatus.js';
import * as AuditLogModel from '../models/auditLogModel.js';
import * as NotificationService from './notificationService.js';
import { invalidateCache as invalidateBadges } from './badgesService.js';
import { parseModerationNotes } from '../utils/moderationNotes.js';
import { isPanelRole, panelSessionLapsed } from '../config/panelRoles.js';
import { isOperatorManaged, serviceAccountFlagSql } from '../config/serviceAccounts.js';
import { randomUUID, randomBytes, createHash } from 'crypto';
import {
  createCode as createVerificationCode,
  findActiveCodeForUser,
  countRecentSends,
  invalidateActiveCodesForUser,
  reserveCodeWithinLimit,
  activateReservedCode,
  deleteReservedCode,
  incrementAttempts,
  markAsUsed,
} from '../models/emailVerificationModel.js';
import {
  createTokenWithinLimit as createResetTokenWithinLimit,
  retireTokensIssuedBefore as retireResetTokensIssuedBefore,
  deleteToken as deleteResetToken,
  findValidByTokenHash as findValidResetToken,
  markAsUsed as markResetTokenUsed,
} from '../models/passwordResetModel.js';
import { sendVerificationCodeEmail, sendPasswordResetEmail } from './emailService.js';

/**
 * Argon2id Parameters
 * 
 * These specific parameters were chosen by the architectural coordinator to balance
 * security against GPU attacks with acceptable performance for user login latency.
 * 
 * memory: 16MB (16 * 1024 = 16384 KB) - Makes GPU attacks expensive
 * time: 3 iterations - Computational cost
 * parallelism: 1 - Single thread (suitable for web server context)
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 16384, // 16MB in KB
  timeCost: 3,
  parallelism: 1,
};

/**
 * Stand-in hash for a login that has no stored hash to check: an unknown
 * email/phone, or an account without a password (Google/Yandex sign-up keeps
 * password_hash NULL). Verifying against it takes as long as a real check, so
 * the response time does not tell these cases from a wrong password; it
 * verifies to false. The cost is built from ARGON2_OPTIONS rather than written
 * out: a literal would keep the old cost if the options change, and these
 * answers would quietly become faster than a wrong password.
 */
const DUMMY_PASSWORD_HASH = [
  '$argon2id$v=19',
  `m=${ARGON2_OPTIONS.memoryCost},t=${ARGON2_OPTIONS.timeCost},p=${ARGON2_OPTIONS.parallelism}`,
  'dummysaltdummysalt',
  'dummyhashdummyhashdummyhashdummy',
].join('$');

/**
 * What a failed password login writes to the log: by what the person came in
 * (e-mail, phone), the account's id when there is one, and why — never the
 * e-mail or the phone itself (finding 27 of the Railway incident, 29.10.2026:
 * a wrong password at any door wrote the e-mail into the log). The id is
 * enough to look the account up; for an unknown address there is nothing to
 * look up. With both an e-mail and a phone the row found may be the phone's
 * account, not the e-mail's (email = $1 OR phone = $2), so no id is written.
 *
 * @param {Object} credentials - { email, phone } as the caller passed them
 * @param {Object|null} user - The row found, or null
 * @param {string} reason
 * @returns {Object}
 */
const loginFailureFields = ({ email, phone }, user, reason) => {
  let loginBy = 'none';
  if (email && phone) {
    loginBy = 'email_and_phone';
  } else if (email) {
    loginBy = 'email';
  } else if (phone) {
    loginBy = 'phone';
  }
  return {
    loginBy,
    ...(user && loginBy !== 'email_and_phone' ? { userId: user.id } : {}),
    reason,
  };
};

/**
 * A refresh-token row joined with its user — what refreshAccessToken starts
 * from, and re-reads after losing the claim race.
 *
 * sessions_revoked_at is read through to_jsonb rather than named: the column
 * comes with migration 035, which production applies by hand after this code
 * deploys, and a named column would fail every refresh until then
 * (services/accountStatus.js).
 *
 * $1 is storedRefreshToken(token): the table holds the token's hash, never
 * the token (utils/refreshTokenStorage.js).
 */
const REFRESH_TOKEN_ROW_SQL = `
  SELECT rt.id, rt.user_id, rt.token, rt.expires_at, rt.created_at, rt.used_at, rt.replaced_by,
         u.id as user_id, u.email, u.phone, u.name, u.role, u.is_active,
         (to_jsonb(u) ->> 'sessions_revoked_at')::timestamptz AS sessions_revoked_at
  FROM refresh_tokens rt
  JOIN users u ON rt.user_id = u.id
  WHERE rt.token = $1
`;

/**
 * Whether a refresh-token row was created before its account's sessions were
 * last revoked (accountStatus.issuedBeforeRevocation — the rule access tokens
 * are held to).
 *
 * created_at is compared in JS on purpose, like expires_at in
 * refreshAccessToken: generateTokenPair writes both from a JS Date into naive
 * columns, and node-pg reads them back in the same local time, so the instant
 * survives the round trip in any process time zone — SQL would read them in
 * the database's. A row without created_at counts as the oldest possible.
 *
 * @param {Object} row - REFRESH_TOKEN_ROW_SQL row
 * @returns {boolean}
 */
const refreshTokenRevoked = (row) => issuedBeforeRevocation(
  row.created_at ? new Date(row.created_at).getTime() : 0,
  row.sessions_revoked_at,
);

/**
 * Creates a new user account
 * 
 * This function handles the complete user registration flow including password
 * hashing, database insertion, and automatic login via token generation.
 * 
 * @param {Object} userData - User registration data
 * @param {string} userData.email - User's email (optional if phone provided)
 * @param {string} userData.phone - User's phone (optional if email provided)
 * @param {string} userData.password - Plain text password to be hashed
 * @param {string} userData.name - User's display name
 * @param {string} userData.authMethod - Authentication method: 'email', 'phone', 'google', 'yandex'
 * @returns {Promise<Object>} Created user object (without password hash)
 * @throws {Error} If database operation fails
 */
export async function createUser(userData) {
  const { email, phone, password, name, authMethod } = userData;
  
  try {
    // Hash the password using Argon2id with our security parameters
    // This operation is intentionally slow (around 50-100ms) to resist brute force
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    
    // Generate a unique ID for the user
    const userId = randomUUID();
    
    // Insert user into database with parameterized query for SQL injection protection
    // All new users start with 'user' role; elevated privileges granted separately
    const query = `
      INSERT INTO users (
        id, email, phone, password_hash, name, role, auth_method, 
        email_verified, phone_verified, is_active, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, email, phone, name, role, auth_method, created_at
    `;
    
    const values = [
      userId,
      email ? email.toLowerCase().trim() : null, // Normalize email for consistency
      phone ? phone.trim() : null,
      passwordHash,
      name.trim(),
      'user', // Default role for new registrations
      authMethod,
      false, // Email verification will be handled in future enhancement
      false, // Phone verification will be handled in future enhancement
      true,  // New accounts are active by default
      new Date(),
      new Date(),
    ];
    
    const result = await pool.query(query, values);
    const user = result.rows[0];
    
    logger.info('User created successfully', { 
      userId: user.id, 
      authMethod,
      // Never log sensitive data like passwords or hashes
    });
    
    return user;
    
  } catch (error) {
    // Check if error is due to unique constraint violation (duplicate email/phone)
    if (error.code === '23505') { // PostgreSQL unique violation code
      if (error.constraint === 'users_email_key') {
        throw new Error('EMAIL_ALREADY_EXISTS');
      }
      if (error.constraint === 'users_phone_key') {
        throw new Error('PHONE_ALREADY_EXISTS');
      }
    }
    
    logger.error('Failed to create user', { error: error.message });
    throw error;
  }
}

/**
 * Verifies user credentials and returns user object if valid
 * 
 * This function implements constant-time verification to prevent timing attacks
 * that could reveal whether an email/phone exists in the system. Even when a
 * user doesn't exist, we still perform a hash verification against a dummy hash
 * to maintain consistent response times. An account without a password (signed
 * up through Google/Yandex, password_hash NULL) is refused the same way as a
 * wrong password: the same dummy verification, then null.
 *
 * @param {Object} credentials - Login credentials
 * @param {string} credentials.email - User's email (optional if phone provided)
 * @param {string} credentials.phone - User's phone (optional if email provided)
 * @param {string} credentials.password - Plain text password to verify
 * @param {Object} [options]
 * @param {boolean} [options.panelAccounts=true] - false on the shared login: a
 *   panel account (admin, viewer) is answered there as a wrong password —
 *   after the same verification, with no write and no extra query, so neither
 *   the answer nor its timing nor last_login_at tells a right panel password
 *   from a wrong one (directive service_accounts 2026-10-15, B1; Phase 3.5)
 * @param {boolean} [options.otherAccounts=true] - false on the panel's login:
 *   an account outside the panel roles with a right password is returned
 *   as is, without last_login_at written — the door refuses it
 *   (adminController.adminLogin), and a refused login is not a login
 *   (verify S1–S4 29.10.2026, «Вне меток» 3)
 * @returns {Promise<Object|null>} User object if credentials valid, null otherwise
 */
export async function verifyCredentials(credentials, { panelAccounts = true, otherAccounts = true } = {}) {
  const { email, phone, password } = credentials;
  
  try {
    // Find user by email or phone
    // We use a single query that checks both fields for efficiency
    const query = `
      SELECT id, email, phone, password_hash, name, role, auth_method,
             avatar_url, is_active, last_login_at, created_at
      FROM users
      WHERE (email = $1 OR phone = $2) AND is_active = true
    `;
    
    const values = [
      email ? email.toLowerCase().trim() : null,
      phone ? phone.trim() : null,
    ];
    
    const result = await pool.query(query, values);
    
    // Constant-time verification strategy:
    // Always perform hash verification even if user not found
    // This prevents timing attacks from revealing valid emails/phones
    let isValidPassword = false;
    let failureReason = 'user_not_found';

    if (result.rows.length > 0) {
      const user = result.rows[0];

      if (user.password_hash) {
        // Verify password against stored hash
        // argon2.verify is intentionally slow and takes constant time
        isValidPassword = await argon2.verify(user.password_hash, password);
        failureReason = 'invalid_password';
      } else {
        // No password on this account (signed up through Google/Yandex).
        // argon2.verify throws on a missing hash — that was a 500 — and
        // skipping the verify would answer faster than a wrong password:
        // either way the response would tell the account type apart.
        await argon2.verify(DUMMY_PASSWORD_HASH, password);
        failureReason = 'no_password';
      }

      if (isValidPassword && !panelAccounts && isPanelRole(user.role)) {
        // A panel account on the shared login: the panel's own door only.
        // Same path out as a wrong password below — nothing written.
        isValidPassword = false;
        failureReason = 'panel_account_on_shared_login';
      }

      if (isValidPassword && !otherAccounts && !isPanelRole(user.role)) {
        // Another role at the panel's door: the caller refuses it with its
        // own answer and logs the refusal; nothing is written here.
        delete user.password_hash;
        return user;
      }

      if (isValidPassword) {
        // Update last login timestamp — only if the hash just verified is still
        // the row's hash. The verify takes tens of milliseconds, and a takeover
        // of the record (authenticateWithOAuth, 2c) may have dropped the
        // password meanwhile; a login that then issued tokens would outlive the
        // takeover (lens review, 08.10.2026).
        const stillCurrent = await pool.query(
          'UPDATE users SET last_login_at = $1 WHERE id = $2 AND password_hash = $3',
          [new Date(), user.id, user.password_hash],
        );
        if (stillCurrent.rowCount === 0) {
          logger.warn(
            'Login attempt failed',
            loginFailureFields(credentials, user, 'password_changed_during_verification'),
          );
          return null;
        }
        
        // Remove password_hash from returned object for security
        delete user.password_hash;
        
        logger.info('User login successful', { 
          userId: user.id,
          authMethod: user.auth_method, 
        });
        
        return user;
      }
    } else {
      // User not found, but still perform dummy hash verification
      // to maintain constant response time
      await argon2.verify(DUMMY_PASSWORD_HASH, password);
    }

    // Log failed login attempt for security monitoring
    logger.warn(
      'Login attempt failed',
      loginFailureFields(credentials, result.rows[0] ?? null, failureReason),
    );
    
    return null;
    
  } catch (error) {
    logger.error('Error verifying credentials', { error: error.message });
    throw error;
  }
}

/**
 * Generates a new pair of access and refresh tokens for a user
 * 
 * Access tokens are short-lived (4 hours, JWT_ACCESS_EXPIRY; the panel's accounts one hour,
 * config/accessToken.js) JWT tokens that authenticate API requests. expiresIn tells the
 * client the same lifetime the token carries (accessTokenLifetimeSeconds),
 * here and on a replay inside the reuse grace window.
 * Refresh tokens are long-lived (30 days) and stored in database for validation.
 * 
 * The token pair allows secure, stateless authentication while maintaining the ability
 * to revoke access by invalidating refresh tokens in the database.
 *
 * The database receives the refresh token's hash, never the token
 * (utils/refreshTokenStorage.js).
 *
 * @param {Object} user - User object containing id and role
 * @param {Object} [options]
 * @param {string} [options.replaces] - The refresh token this pair rotates.
 *   Set by refreshAccessToken only: the successor is then derived from it
 *   (utils/jwt.js deriveSuccessorRefreshToken), so that a replay inside the
 *   grace window can be handed the same successor again. A new session
 *   starts from random bytes.
 * @returns {Promise<Object>} Object containing accessToken and refreshToken
 */
export async function generateTokenPair(user, { replaces = null } = {}) {
  try {
    // Generate short-lived access token with user identity
    // This token is stateless and validated using JWT signature only
    const accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
      email: user.email || null,
    });

    // Store refresh token in database with metadata
    // This allows us to track token usage and implement rotation
    const tokenId = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now

    // Generate long-lived refresh token: random for a new session, derived
    // from the predecessor and this row's id for a rotation
    const refreshToken = replaces
      ? deriveSuccessorRefreshToken(replaces, tokenId)
      : generateRefreshToken();

    const query = `
      INSERT INTO refresh_tokens (
        id, user_id, token, expires_at, created_at, used_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    const values = [
      tokenId,
      user.id,
      storedRefreshToken(refreshToken),
      expiresAt,
      new Date(),
      null, // used_at starts as null, set when token is used for refresh
    ];
    
    await pool.query(query, values);
    
    logger.info('Token pair generated', { 
      userId: user.id,
      tokenId, 
    });
    
    return {
      accessToken,
      refreshToken,
      expiresIn: accessTokenLifetimeSeconds(user.role),
      // Row id of the refresh token just inserted. refreshAccessToken writes
      // it into the predecessor's replaced_by so a replay inside the grace
      // window can find this successor (config/auth.js). Callers that only
      // hand the pair to a client (login, verify, OAuth) ignore it.
      refreshTokenId: tokenId,
    };

  } catch (error) {
    logger.error('Failed to generate token pair', {
      userId: user.id,
      error: error.message, 
    });
    throw error;
  }
}

/**
 * Refreshes an access token using a valid refresh token
 *
 * This function implements STRICT TOKEN ROTATION for security:
 * 1. Validates that the refresh token exists and hasn't been used
 * 2. Claims the token atomically, recording its successor in replaced_by
 * 3. Generates a new token pair
 * 4. If an already-used token is presented, this indicates a security breach
 *    and ALL tokens for the user are invalidated — unless the replay lands
 *    inside the reuse grace window, where the same successor is handed back
 *    instead (handleReusedToken below; config/auth.js explains the window)
 *
 * A token created before the account's sessions were last revoked (password
 * reset, a detected reuse, account takeover) is refused before any of that,
 * as REFRESH_TOKEN_REVOKED: the revocation burned it, nobody stole it.
 *
 * @param {string} refreshToken - The refresh token to exchange
 * @returns {Promise<Object>} New token pair with user info
 * @throws {Error} If token is invalid, expired, revoked, or already used
 */
export async function refreshAccessToken(refreshToken) {
  try {
    // Look up the refresh token in database — by its hash
    const lookup = storedRefreshToken(refreshToken);
    const result = await pool.query(REFRESH_TOKEN_ROW_SQL, [lookup]);

    if (result.rows.length === 0) {
      // Not one character of the presented token: it is a credential, and a
      // piece of it identifies nothing a reader could use (30.10.2026).
      logger.warn('Refresh token not found');
      throw new Error('INVALID_REFRESH_TOKEN');
    }

    const tokenData = result.rows[0];

    // Check if token has expired
    if (new Date(tokenData.expires_at) < new Date()) {
      logger.warn('Expired refresh token used', {
        userId: tokenData.user_id,
        tokenId: tokenData.id,
      });
      throw new Error('REFRESH_TOKEN_EXPIRED');
    }

    // Created before the account's sessions were revoked: dead, and not a sign
    // of theft — the revocation burned it (or a race left it unburned), nobody
    // replayed it. It must not reach the reuse verdict below, which would
    // revoke every session once more — the one the user opened after a
    // password reset included, the moment a stale device woke up.
    if (refreshTokenRevoked(tokenData)) {
      logger.warn('Refresh token created before the account sessions were revoked', {
        userId: tokenData.user_id,
        tokenId: tokenData.id,
      });
      throw new Error('REFRESH_TOKEN_REVOKED');
    }

    // CRITICAL SECURITY CHECK: Detect token reuse
    // If used_at is not null, this token was already used for refresh. That is
    // either a stolen token racing the legitimate one, or the legitimate client
    // replaying a rotation whose answer it never received — handleReusedToken
    // separates the two by the grace window.
    if (tokenData.used_at !== null) {
      return await handleReusedToken(tokenData, refreshToken);
    }

    // A switched-off account: the presented session ends here rather than
    // waiting — burned, so switching the account back on does not bring it
    // back (directive service_accounts 2026-10-15, B4; critic 2B B2). NOW(),
    // as the claim below writes used_at; replaced_by stays empty, so a later
    // replay of it is never forgiven as a lost answer.
    if (!tokenData.is_active) {
      await pool.query(
        'UPDATE refresh_tokens SET used_at = NOW() WHERE id = $1 AND used_at IS NULL',
        [tokenData.id],
      );
      throw new Error('USER_ACCOUNT_INACTIVE');
    }

    // A panel account (admin, viewer) that has not renewed for a day: answered
    // as an expired token (config/panelRoles.js, S1 «а» 29.10.2026). After the
    // reuse check on purpose, not next to the expiry above: a burned token is
    // where theft shows — a thief who renewed the moderator's token first
    // leaves the moderator holding it, and a moderator back after a weekend
    // must still raise the alarm that ends the thief's chain, not a quiet
    // "log in again" that leaves it alive. After the switched-off check too,
    // so a disabled account keeps its own answer and its burned token.
    if (panelSessionLapsed(tokenData.role, tokenData.created_at)) {
      logger.warn('Panel refresh token past the panel idle limit', {
        userId: tokenData.user_id,
        tokenId: tokenData.id,
      });
      throw new Error('REFRESH_TOKEN_EXPIRED');
    }

    // Generate new token pair for the user
    const user = {
      id: tokenData.user_id,
      email: tokenData.email,
      phone: tokenData.phone,
      name: tokenData.name,
      role: tokenData.role,
    };

    // The successor is created BEFORE the predecessor is claimed, so that one
    // statement can both burn the old row and name its replacement. The
    // reverse order would leave a window where used_at is set and replaced_by
    // is still null: a replay arriving in that window would find no successor
    // to hand back and would revoke every session the user has.
    const tokens = await generateTokenPair(user, { replaces: refreshToken });

    // Atomic claim. `AND used_at IS NULL` is what makes two simultaneous
    // refreshes of the same token produce exactly one chain — the loser gets
    // rowCount 0 and takes the replay path instead of forking the chain.
    // used_at is written by NOW() rather than a JS Date because the column is
    // `timestamp without time zone` and the grace window is measured in SQL:
    // mixing the two clocks shifts the comparison by the process offset and
    // fails silently.
    const claim = await pool.query(
      `UPDATE refresh_tokens SET used_at = NOW(), replaced_by = $1
       WHERE id = $2 AND used_at IS NULL
       RETURNING id`,
      [tokens.refreshTokenId, tokenData.id],
    );

    if (claim.rowCount === 0) {
      // Lost the race: a concurrent request claimed this token first. Drop the
      // successor nobody will ever be handed, re-read the row — it now carries
      // the winner's used_at and replaced_by — and answer it like any other
      // replay, so the loser gets the winner's successor instead of a 403.
      await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [tokens.refreshTokenId]);

      const reread = await pool.query(REFRESH_TOKEN_ROW_SQL, [lookup]);

      if (reread.rows.length === 0) {
        throw new Error('INVALID_REFRESH_TOKEN');
      }

      // The claim may have been lost to a revocation rather than to a
      // concurrent rotation: then the token is simply dead.
      if (refreshTokenRevoked(reread.rows[0])) {
        throw new Error('REFRESH_TOKEN_REVOKED');
      }

      // concurrentClaim: this request held a token the database called unused
      // one round trip ago, so it is racing, not replaying something stale.
      // Before the atomic claim both racers simply rotated and both got 200;
      // answering one of them with "all your sessions are revoked" would be a
      // regression introduced by the claim, and it must not depend on whether
      // the grace window happens to be switched on.
      return await handleReusedToken(reread.rows[0], refreshToken, { concurrentClaim: true });
    }

    logger.info('Access token refreshed successfully', {
      userId: user.id,
      oldTokenId: tokenData.id,
    });

    // Built field by field rather than spread: generateTokenPair also returns
    // the new row id, which is bookkeeping for the claim above and must not
    // reach a client. This shape is also exactly what the replay path returns.
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user,
    };

  } catch (error) {
    logger.error('Failed to refresh access token', { error: error.message });
    throw error;
  }
}

/**
 * The token of a successor row, recovered for a replay of its predecessor.
 *
 * Derived again from the presented token and the row's id
 * (deriveSuccessorRefreshToken) and accepted only when it hashes to what the
 * row holds. What the row holds is never handed out itself: anything else
 * cannot be recovered, null.
 *
 * @param {Object} successorRow - Row of the window query (id, token)
 * @param {string} presentedToken - The predecessor as the client sent it
 * @returns {string|null}
 */
const successorTokenFor = (successorRow, presentedToken) => {
  const derived = deriveSuccessorRefreshToken(presentedToken, successorRow.id);
  return successorRow.token === storedRefreshToken(derived) ? derived : null;
};

/**
 * Decides what an already-used refresh token means.
 *
 * Strict rotation has a single verdict for a replay — theft — and pays for it
 * with false alarms: when a rotation's answer is lost, the legitimate client
 * is left holding a token the database has already burned, and its next
 * attempt costs the user every session they have (config/auth.js).
 *
 * Inside the grace window the replay is answered with THE SAME successor the
 * first call produced: a new access token, the successor's own refresh token
 * string, no new row. The chain never branches, so the protection that makes
 * a second presentation detectable at all is preserved. Outside the window,
 * or when there is nothing to hand back, the original verdict stands.
 *
 * There is nothing to hand back when replaced_by is null — a token burned by
 * logout, or one rotated before this column was ever written. Reading the
 * column already in hand keeps those paths, and a disabled window, free of
 * any extra query.
 *
 * The successor's token is not in the database — only its hash is. It is
 * derived again from the presented token (successorTokenFor below).
 *
 * @param {Object} tokenData - Refresh-token row joined with its user
 * @param {string} presentedToken - The refresh token as the client sent it
 * @param {Object} [options]
 * @param {boolean} [options.concurrentClaim=false] - Set by the caller that
 *   lost the atomic claim. Such a caller read the token as unused a round trip
 *   ago, so the row's age carries no information about it and the window's
 *   time bound is skipped — every other check still applies.
 * @returns {Promise<Object>} Same shape as a normal refresh, when forgiven
 * @throws {Error} REFRESH_TOKEN_REUSE_DETECTED otherwise
 */
async function handleReusedToken(tokenData, presentedToken, { concurrentClaim = false } = {}) {
  const { seconds: graceSeconds } = resolveRefreshReuseGraceSeconds(process.env);

  // An inactive account is never handed a fresh access token: it falls through
  // to the verdict below, exactly as it does today — the reuse check has
  // always run before the is_active check.
  if ((graceSeconds > 0 || concurrentClaim) && tokenData.replaced_by && tokenData.is_active) {
    // The window is compared entirely in SQL against the same clock that wrote
    // used_at. Both columns are `timestamp without time zone`, so a JS Date on
    // either side of this comparison would silently carry the process offset.
    //
    // BETWEEN, not a bare lower bound: used_at is still written by a JS Date on
    // the logout and revoke paths, and a JS Date reaches a naive column in the
    // process's local time — under TZ=Europe/Minsk that is three hours in the
    // future, which a one-sided `>=` would accept forever. Those rows carry no
    // successor today, so the gate above already excludes them; the upper bound
    // is what keeps that true if anything ever writes replaced_by elsewhere.
    //
    // The $3 escape is for the caller that lost the atomic claim. That caller
    // read this token as unused moments ago, so its replay is a concurrent
    // race rather than a stale presentation, and the age of the row says
    // nothing about it. Without the escape a disabled window would answer a
    // benign double refresh with "your account is under attack".
    const replay = await pool.query(
      `SELECT successor.id, successor.token, successor.used_at, successor.expires_at,
              EXTRACT(EPOCH FROM (NOW() - burned.used_at)) AS replay_age_seconds
       FROM refresh_tokens burned
       JOIN refresh_tokens successor
         ON successor.id = burned.replaced_by
        AND successor.user_id = burned.user_id
       WHERE burned.id = $1
         AND ($3 OR burned.used_at BETWEEN NOW() - make_interval(secs => $2) AND NOW())`,
      [tokenData.id, graceSeconds, concurrentClaim],
    );

    const successor = replay.rows[0];
    const successorToken = successor ? successorTokenFor(successor, presentedToken) : null;

    // A live successor inside the window whose token cannot be recovered —
    // after a JWT_SECRET change, for one. The replay is the kind the window
    // forgives, so it is not treated as theft: this session ends (401), the
    // account's other sessions are left alone.
    if (successor
      && !successorToken
      && successor.used_at === null
      && new Date(successor.expires_at) > new Date()) {
      logger.warn('Refresh token replayed within grace window, successor not recoverable', {
        userId: tokenData.user_id,
        tokenId: tokenData.id,
        successorTokenId: successor.id,
      });
      throw new Error('INVALID_REFRESH_TOKEN');
    }

    // The successor must still be the live end of the chain. Once it has been
    // used, the client demonstrably received it, and a replay of its
    // predecessor is no longer explained by a lost answer.
    if (successorToken
      && successor.used_at === null
      && new Date(successor.expires_at) > new Date()) {
      const user = {
        id: tokenData.user_id,
        email: tokenData.email,
        phone: tokenData.phone,
        name: tokenData.name,
        role: tokenData.role,
      };

      const accessToken = generateAccessToken({
        userId: user.id,
        role: user.role,
        email: user.email || null,
      });

      // info, not warn: this is the network behaving as networks do, not an
      // incident. The event name is what a log search greps for; the token
      // strings themselves never appear.
      logger.info('Refresh token replayed within grace window', {
        event: 'refresh_token_replayed_within_grace',
        userId: tokenData.user_id,
        tokenId: tokenData.id,
        successorTokenId: successor.id,
        // NUMERIC arrives from node-pg as a string.
        ageMs: Math.round(Number(successor.replay_age_seconds) * 1000),
        graceSeconds,
        // Distinguishes a lost answer from two requests racing each other —
        // the same log line otherwise, very different causes.
        concurrentClaim,
      });

      return {
        accessToken,
        refreshToken: successorToken,
        expiresIn: accessTokenLifetimeSeconds(user.role),
        user,
      };
    }
  }

  logger.error('SECURITY ALERT: Refresh token reuse detected', {
    userId: tokenData.user_id,
    tokenId: tokenData.id,
    originalUseTime: tokenData.used_at,
  });

  // End EVERY session of this user as security measure: refresh tokens burned,
  // access tokens issued until now refused from the next request
  await invalidateAllUserTokens(tokenData.user_id);

  throw new Error('REFRESH_TOKEN_REUSE_DETECTED');
}

/**
 * Invalidates a specific refresh token (used for logout)
 * 
 * @param {string} refreshToken - The token to invalidate
 * @returns {Promise<boolean>} True if token was invalidated
 */
export async function invalidateRefreshToken(refreshToken) {
  try {
    // Mark token as used to prevent further refresh operations. Found by its
    // hash — the only thing the table holds for it.
    const result = await pool.query(
      'UPDATE refresh_tokens SET used_at = $1 WHERE token = $2 AND used_at IS NULL',
      [new Date(), storedRefreshToken(refreshToken)],
    );
    
    const wasInvalidated = result.rowCount > 0;
    
    if (wasInvalidated) {
      // No piece of the token, as in refreshAccessToken (30.10.2026).
      logger.info('Refresh token invalidated');
    }
    
    return wasInvalidated;
    
  } catch (error) {
    logger.error('Failed to invalidate refresh token', { error: error.message });
    throw error;
  }
}

/**
 * Ends every session of a user, in the caller's transaction: burns every live
 * refresh token, then stamps users.sessions_revoked_at so the access tokens
 * issued until now are refused too. The order is load-bearing — see
 * accountStatus.markSessionsRevoked. The caller drops the cached account
 * status after COMMIT.
 *
 * @param {Object} client - pg client inside a transaction
 * @param {string} userId
 * @returns {Promise<{tokenCount: number, revokedAt: Date|null}>} revokedAt is
 *   null while migration 035 is not applied — then only the refresh tokens die
 */
async function revokeAllSessions(client, userId) {
  const burned = await client.query(
    'UPDATE refresh_tokens SET used_at = $1 WHERE user_id = $2 AND used_at IS NULL',
    [new Date(), userId],
  );
  const revokedAt = await markSessionsRevoked(client, userId);
  return { tokenCount: burned.rowCount, revokedAt };
}

/**
 * Switches off every push device of a user, in the caller's transaction: the
 * account's notices must stop reaching the phone of whoever was signed in.
 *
 * @param {Object} client - pg client inside a transaction
 * @param {string} userId
 * @returns {Promise<number>} devices switched off
 */
async function deactivateDevices(client, userId) {
  const devices = await client.query(
    `UPDATE device_tokens SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND is_active = TRUE`,
    [userId],
  );
  return devices.rowCount;
}

/**
 * Ends everything that gave the account access, in the caller's transaction:
 * its sessions (revokeAllSessions), its push devices and its unused
 * password-reset links — what scripts/lib/operator-password.js endAllSessions
 * does on the operator's machine, here with the server's clock. Used by the
 * block from the panel (adminUserService). The caller drops the cached account
 * status after COMMIT.
 *
 * @param {Object} client - pg client inside a transaction
 * @param {string} userId
 * @returns {Promise<{tokenCount: number, revokedAt: Date|null, devices: number, resetLinks: number}>}
 */
export async function endAllAccess(client, userId) {
  const sessions = await revokeAllSessions(client, userId);
  const devices = await deactivateDevices(client, userId);
  const resetLinks = await client.query(
    'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
  return { ...sessions, devices, resetLinks: resetLinks.rowCount };
}

/**
 * Invalidates all tokens of a user (security measure)
 *
 * This is used when token reuse is detected, indicating a possible
 * security breach. By invalidating all tokens, we force complete
 * re-authentication of the user: every refresh token is burned, and every
 * access token issued until now is refused from the next request
 * (revokeAllSessions). Before migration 035 the access tokens lived on
 * until their expiry, up to 4 hours.
 *
 * @param {string} userId - The user whose tokens should be invalidated
 * @returns {Promise<number>} Number of refresh tokens invalidated
 */
export async function invalidateAllUserTokens(userId) {
  const client = await getClient();
  let revoked;
  try {
    await client.query('BEGIN');
    revoked = await revokeAllSessions(client, userId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to invalidate all user tokens', {
      userId,
      error: error.message,
    });
    throw error;
  } finally {
    client.release();
  }

  invalidateAccountStatus(userId);

  logger.warn('All refresh tokens invalidated for user', {
    userId,
    tokenCount: revoked.tokenCount,
    accessTokensRevoked: revoked.revokedAt !== null,
  });

  return revoked.tokenCount;
}

/**
 * Finds user by ID (utility function)
 * 
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User object if found
 */
export async function findUserById(userId) {
  try {
    const query = `
      SELECT id, email, phone, name, role, auth_method, avatar_url,
             email_verified, phone_verified, is_active, created_at
      FROM users
      WHERE id = $1 AND is_active = true
    `;

    const result = await pool.query(query, [userId]);

    return result.rows.length > 0 ? result.rows[0] : null;

  } catch (error) {
    logger.error('Error finding user by ID', { error: error.message });
    throw error;
  }
}

/**
 * Updates user profile fields (name, avatar_url)
 *
 * @param {string} userId - The ID of the user to update
 * @param {Object} profileData - Fields to update
 * @param {string} [profileData.name] - New display name (the name rule, utils/userName.js)
 * @param {string} [profileData.avatarUrl] - New avatar URL (max 500 chars)
 * @returns {Promise<Object>} Updated user object
 * @throws {Error} If user not found or validation fails
 */
export async function updateUserProfile(userId, profileData) {
  const { name, avatarUrl } = profileData;

  // Build dynamic SET clause for only provided fields
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  // The rule is for a new name: the site and the app builds already installed
  // send the name with every save, and a name stored before the rule — a
  // provider's «ivan.petrov2001» — must not block the save of the rest. The
  // name as stored, compared after the rule's normalization, is left alone.
  let nameChanged = name !== undefined;
  if (nameChanged && typeof name === 'string') {
    const current = await pool.query(
      'SELECT name FROM users WHERE id = $1 AND is_active = true',
      [userId],
    );
    const stored = current.rows[0]?.name;
    nameChanged = typeof stored !== 'string'
      || normalizeUserName(stored) !== normalizeUserName(name);
  }

  if (nameChanged) {
    // The one name rule (utils/userName.js); the code thrown is the key of the
    // refusal the controller sends — NAME_EMPTY, NAME_LENGTH, NAME_CHARS,
    // NAME_PROFANE.
    const verdict = checkUserName(name);
    if (verdict.code) {
      throw new Error(verdict.code);
    }
    setClauses.push(`name = $${paramIndex++}`);
    values.push(verdict.name);
  }

  if (avatarUrl !== undefined) {
    if (avatarUrl && avatarUrl.length > 500) {
      throw new Error('AVATAR_URL_TOO_LONG');
    }
    setClauses.push(`avatar_url = $${paramIndex++}`);
    values.push(avatarUrl || null);
  }

  // Always update updated_at
  setClauses.push(`updated_at = $${paramIndex++}`);
  values.push(new Date());

  // Add userId as last parameter
  values.push(userId);

  const query = `
    UPDATE users
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex} AND is_active = true
    RETURNING id, email, phone, name, role, auth_method, avatar_url,
              email_verified, phone_verified, created_at
  `;

  const result = await pool.query(query, values);

  if (result.rows.length === 0) {
    throw new Error('USER_NOT_FOUND');
  }

  logger.info('User profile updated', { userId, fields: Object.keys(profileData) });

  return result.rows[0];
}

/**
 * Upgrades a user's role from 'user' to 'partner'
 *
 * This function is called when a regular user creates their first establishment.
 * The upgrade happens automatically as part of the partner registration flow.
 *
 * @param {string} userId - The ID of the user to upgrade
 * @returns {Promise<Object>} Updated user object with new role
 * @throws {Error} If user not found or already a partner/admin
 */
/**
 * What the moderator reads on a card parked by an account takeover, and what
 * the account's new holder is told. Literal: both read it as is.
 */
export const TAKEOVER_SUSPEND_REASON =
  'Учётная запись перешла к владельцу адреса e-mail после входа через Google или Яндекс. '
  + 'Карточка приостановлена до решения модератора: кому она принадлежит.';

/**
 * Hand a record whose e-mail was never confirmed to the person who just proved
 * the address through a provider.
 *
 * The record may have been created by anyone naming this address, so nothing
 * the registrant set up is trusted: the password is dropped (no password login
 * until «forgot password» sets one — that path proves the address again), every
 * refresh token is deleted — not merely burned: a burned token presented later
 * reads as token reuse and revokes every session of the record, the new
 * holder's included (review, 08.10.2026) — so a replay answers «unknown token»
 * and nothing else; the access tokens issued before the takeover are refused
 * from their next request (users.sessions_revoked_at, migration 035 — until
 * it is applied they live out their TTL). The registrant's push devices are
 * deactivated: the record's notices must not keep arriving on their phone.
 * The typed name, avatar and phone give way to the provider's data. The
 * partner role stays with the record, but the active cards are not published
 * under the new holder's name silently: each is suspended with a moderator's
 * mark and a reason, and the moderator decides; the holder may edit and
 * resubmit them, which puts them in the moderation queue with the marks kept.
 * Drafts, pending and rejected cards are not public and stay as they are.
 * Reviews, favorites, bookings, partner documents and notification
 * preferences stay on the record.
 *
 * One transaction: a provider login that ends with the old password still
 * valid, or the old sessions still alive, is the defect itself.
 *
 * @returns {Promise<Object>} The user row as the login response shapes it
 */
async function takeOverUnverifiedAccount(existingUser, { provider, providerId, name, avatarUrl }) {
  const now = new Date();
  const client = await getClient();
  let user;
  let deletedTokens = 0;
  let sessionsRevokedAt = null;
  let deactivatedDevices = 0;
  let parkedCards = [];
  try {
    await client.query('BEGIN');

    // Taken over only while the record is still on: a deletion committed since
    // the lookup has anonymised it, and the provider's name and picture
    // written now would sign the deleted person's reviews again (Phase 3.5,
    // В1). Nothing of the takeover happens then — the ROLLBACK below.
    const updated = await client.query(
      `UPDATE users
       SET auth_method = $1, oauth_provider_id = $2, last_login_at = $3, updated_at = $3,
           email_verified = true, password_hash = NULL,
           name = COALESCE($4, name), avatar_url = $5,
           phone = NULL, phone_verified = false
       WHERE id = $6 AND is_active = TRUE
       RETURNING id, email, phone, name, role, auth_method, avatar_url,
                 oauth_provider_id, is_active, last_login_at, created_at`,
      [provider, providerId, now, name || null, avatarUrl || null, existingUser.id],
    );
    user = updated.rows[0];
    if (!user) {
      throw new Error('ACCOUNT_DEACTIVATED');
    }

    // The successor link is a self-reference; clear it before the rows go.
    await client.query(
      'UPDATE refresh_tokens SET replaced_by = NULL WHERE user_id = $1',
      [existingUser.id],
    );
    const deleted = await client.query(
      'DELETE FROM refresh_tokens WHERE user_id = $1',
      [existingUser.id],
    );
    deletedTokens = deleted.rowCount;

    // After the refresh tokens are gone, not before (markSessionsRevoked).
    // The new holder's tokens are issued after COMMIT, so they come out newer.
    sessionsRevokedAt = await markSessionsRevoked(client, existingUser.id);

    const devices = await client.query(
      `UPDATE device_tokens SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND is_active = TRUE`,
      [existingUser.id],
    );
    deactivatedDevices = devices.rowCount;

    const cards = await client.query(
      `SELECT id, status, moderation_notes FROM establishments
       WHERE partner_id = $1 AND status = 'active'
       FOR UPDATE`,
      [existingUser.id],
    );
    for (const card of cards.rows) {
      const notes = {
        ...parseModerationNotes(card.moderation_notes),
        suspend_reason: TAKEOVER_SUSPEND_REASON,
        suspended_at: now.toISOString(),
        suspended_from: card.status,
      };
      await client.query(
        `UPDATE establishments
         SET status = 'suspended', moderation_notes = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [JSON.stringify(notes), card.id],
      );
    }
    parkedCards = cards.rows.map((card) => card.id);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // The registrant's cached status must not outlive the commit: their next
  // request reads the stamp.
  invalidateAccountStatus(existingUser.id);

  // Outside the transaction, as the moderator's own suspension does: the
  // journal and the notice must not undo a takeover that is already committed.
  for (const establishmentId of parkedCards) {
    await AuditLogModel.createAuditLog({
      user_id: null,
      action: 'suspend',
      entity_type: 'establishment',
      entity_id: establishmentId,
      old_data: { status: 'active' },
      new_data: { status: 'suspended', reason: TAKEOVER_SUSPEND_REASON, account_takeover: provider },
      ip_address: null,
      user_agent: null,
    });
    await NotificationService.notifyEstablishmentStatusChange(
      establishmentId,
      'suspended',
      TAKEOVER_SUSPEND_REASON,
    ).catch(() => {});
  }
  if (parkedCards.length > 0) {
    invalidateBadges();
  }

  logger.warn('OAuth login: unverified account taken over by the address owner', {
    userId: existingUser.id,
    provider,
    previousAuthMethod: existingUser.auth_method,
    deletedTokens,
    accessTokensRevoked: sessionsRevokedAt !== null,
    deactivatedDevices,
    parkedCards: parkedCards.length,
  });

  return user;
}

/**
 * Authenticates a user via OAuth provider data.
 *
 * Three scenarios handled:
 * 1. Existing OAuth user (same provider + providerId) → login
 * 2. Email matches existing user + provider email verified → link account
 *    (2c: if the record's own e-mail was never confirmed, the record passes to
 *    the person signing in — takeOverUnverifiedAccount)
 * 3. No match → create new user (password_hash = NULL)
 *
 * Security: unverified provider emails cannot claim existing accounts.
 *
 * @param {Object} providerData - Normalized data from oauthService
 * @param {string} providerData.providerId - External user ID from provider
 * @param {string} providerData.email - User's email from provider
 * @param {string} providerData.name - Display name from provider
 * @param {string} providerData.avatarUrl - Avatar URL from provider
 * @param {boolean} providerData.emailVerified - Whether provider verified email
 * @param {string} providerData.provider - 'google' or 'yandex'
 * @returns {Promise<Object>} { user, accessToken, refreshToken, expiresIn }
 */
export async function authenticateWithOAuth(providerData) {
  const { providerId, email, avatarUrl, emailVerified, provider } = providerData;
  // A provider's name is written under the same name rule as a typed one, but
  // never refuses a login: cleaned, or the neutral fallback (utils/userName.js).
  // Only a new account and a taken-over record write it.
  const name = providerDisplayName(providerData.name);

  try {
    // 1. Look up existing OAuth user by provider + providerId
    const oauthLookup = await pool.query(
      `SELECT id, email, phone, name, role, auth_method, avatar_url,
              oauth_provider_id, is_active, last_login_at, created_at,
              ${serviceAccountFlagSql('users')} AS is_service_account
       FROM users
       WHERE auth_method = $1 AND oauth_provider_id = $2`,
      [provider, providerId],
    );

    if (oauthLookup.rows.length > 0) {
      const user = oauthLookup.rows[0];

      // A panel or service account linked before the one-door rule (or by
      // hand) still does not get a session from a provider: it signs in by
      // password, through its own door (config/serviceAccounts.js). Refused
      // like an unproven link — the answer does not say what the account is,
      // nor whether it is switched off (checked first for that reason).
      if (isOperatorManaged(user)) {
        logger.warn('OAuth login refused to an operator-managed account', { userId: user.id, provider });
        throw new Error('OAUTH_EMAIL_NOT_VERIFIED');
      }

      if (!user.is_active) {
        throw new Error('ACCOUNT_DEACTIVATED');
      }

      // Existing OAuth user — update last_login_at and return. Only while the
      // account is still on: the lookup above holds no lock, and a deletion
      // (accountDeletionService) or a block that commits after it leaves the
      // record switched off — the login must neither write into it nor open a
      // session for it (Phase 3.5, В1).
      const touched = await pool.query(
        'UPDATE users SET last_login_at = $1 WHERE id = $2 AND is_active = TRUE',
        [new Date(), user.id],
      );
      if (touched.rowCount === 0) {
        throw new Error('ACCOUNT_DEACTIVATED');
      }

      logger.info('OAuth login: existing user', { userId: user.id, provider });

      const tokens = await generateTokenPair(user);
      return {
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      };
    }

    // 2. Check if email exists in users table
    const emailLookup = await pool.query(
      `SELECT id, email, phone, name, role, auth_method, avatar_url,
              oauth_provider_id, is_active, last_login_at, created_at, email_verified,
              ${serviceAccountFlagSql('users')} AS is_service_account
       FROM users
       WHERE email = $1`,
      [email.toLowerCase().trim()],
    );

    if (emailLookup.rows.length > 0) {
      const existingUser = emailLookup.rows[0];

      // Operator-managed: refused before anything else is said about it (below).
      if (isOperatorManaged(existingUser)) {
        logger.warn('OAuth login: operator-managed account not linked', {
          userId: existingUser.id,
          provider,
        });
        throw new Error('OAUTH_EMAIL_NOT_VERIFIED');
      }

      // 2a. Email exists + provider email verified → link account
      if (!emailVerified) {
        // 2b. Unverified email cannot claim existing account. Refused before
        // the switched-off answer below: an address the provider has not
        // confirmed gets the same answer whatever the record behind it is.
        // The account by its id, never the address (30.10.2026).
        logger.warn('OAuth login: unverified email tried to claim existing account', {
          userId: existingUser.id,
          provider,
        });
        throw new Error('OAUTH_EMAIL_NOT_VERIFIED');
      }

      if (!existingUser.is_active) {
        throw new Error('ACCOUNT_DEACTIVATED');
      }

      // A panel account (admin, viewer) or a service account (the seed house)
      // is never handed over and never linked: it is created by the operator
      // and signs in by password only. Linking would give whoever controls the
      // provider account — or the mailbox behind the address — a session on
      // the panel or the catalogue (directive service_accounts 2026-10-15,
      // B1/B2; critic 2B S1, S2). Until then only the unconfirmed record was
      // refused (review, 08.10.2026); a confirmed one — every account the
      // operator's scripts create — was linked. Refused like an unproven link
      // — checked above, before the switched-off answer.

      // 2c. The record's own e-mail was never confirmed: anyone can register
      // naming someone else's address, and the provider's verified e-mail is
      // the first proof of ownership this record has seen. The account passes
      // to the person signing in — nothing the registrant set up survives
      // (critics' pack 1, point 1; known since 02.10.2026 as N2 / F-09).
      if (!existingUser.email_verified) {
        const takenOver = await takeOverUnverifiedAccount(existingUser, {
          provider,
          providerId,
          name,
          avatarUrl,
        });
        const tokens = await generateTokenPair(takenOver);
        return {
          user: takenOver,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn,
        };
      }

      // Link: update auth_method, set oauth_provider_id, optionally update avatar
      const updateFields = [provider, providerId, new Date()];
      let avatarClause = '';
      if (!existingUser.avatar_url && avatarUrl) {
        avatarClause = ', avatar_url = $4';
        updateFields.push(avatarUrl);
      }

      // Linked only while the account is still on — the same race as the
      // existing-user path above: a deletion committed since the lookup has
      // cleared this record's identifiers, and a link written after it would
      // put the provider back into a deleted account for good.
      const linkResult = await pool.query(
        `UPDATE users
         SET auth_method = $1, oauth_provider_id = $2,
             last_login_at = $3, email_verified = true${avatarClause}
         WHERE id = $${updateFields.length + 1} AND is_active = TRUE
         RETURNING id, email, phone, name, role, auth_method, avatar_url,
                   oauth_provider_id, is_active, last_login_at, created_at`,
        [...updateFields, existingUser.id],
      );

      const linkedUser = linkResult.rows[0];
      if (!linkedUser) {
        throw new Error('ACCOUNT_DEACTIVATED');
      }
      logger.info('OAuth login: linked existing account', {
        userId: linkedUser.id,
        provider,
        previousAuthMethod: existingUser.auth_method,
      });

      const tokens = await generateTokenPair(linkedUser);
      return {
        user: linkedUser,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      };
    }

    // 3. No match → create new user
    const userId = randomUUID();
    const createResult = await pool.query(
      `INSERT INTO users (
        id, email, password_hash, name, role, auth_method,
        oauth_provider_id, email_verified, phone_verified,
        is_active, avatar_url, last_login_at, created_at, updated_at
      )
      VALUES ($1, $2, NULL, $3, 'user', $4, $5, $6, false, true, $7, $8, $8, $8)
      RETURNING id, email, phone, name, role, auth_method, avatar_url,
                oauth_provider_id, is_active, last_login_at, created_at`,
      [
        userId,
        email.toLowerCase().trim(),
        name,
        provider,
        providerId,
        emailVerified,
        avatarUrl,
        new Date(),
      ],
    );

    const newUser = createResult.rows[0];
    logger.info('OAuth login: new user created', {
      userId: newUser.id,
      provider,
    });

    const tokens = await generateTokenPair(newUser);
    return {
      user: newUser,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };

  } catch (error) {
    // Re-throw known error codes
    if (['ACCOUNT_DEACTIVATED', 'OAUTH_EMAIL_NOT_VERIFIED'].includes(error.message)) {
      throw error;
    }
    // Handle unique constraint violations (race condition: concurrent OAuth signup)
    if (error.code === '23505') {
      // No account exists to name: the constraint tells which race it was
      // (the address or the provider's account). Not the address, and not
      // pg's `detail` — that one quotes it (30.10.2026).
      logger.warn('OAuth signup race condition detected', {
        provider,
        constraint: error.constraint,
      });
      throw new Error('OAUTH_ACCOUNT_CONFLICT');
    }
    logger.error('OAuth authentication failed', { error: error.message, provider });
    throw error;
  }
}

export async function upgradeUserToPartner(userId) {
  try {
    // First check current role
    const checkQuery = `
      SELECT id, role FROM users WHERE id = $1 AND is_active = true
    `;
    const checkResult = await pool.query(checkQuery, [userId]);

    if (checkResult.rows.length === 0) {
      throw new Error('USER_NOT_FOUND');
    }

    const currentRole = checkResult.rows[0].role;

    // Only upgrade if currently a 'user' role
    if (currentRole === 'partner' || currentRole === 'admin') {
      logger.debug('User already has elevated role, no upgrade needed', {
        userId,
        currentRole,
      });
      return checkResult.rows[0];
    }

    // Upgrade role to partner
    const updateQuery = `
      UPDATE users
      SET role = 'partner', updated_at = $1
      WHERE id = $2
      RETURNING id, email, phone, name, role, auth_method, created_at
    `;

    let result;
    if (isPanelRole(currentRole)) {
      // Out of a panel role (a viewer made a partner from the panel): every
      // session the account had was opened as a panel session and must not
      // carry on as a partner's — sessions, push devices and unused reset
      // links end with the change, in one transaction (directive
      // service_accounts 2026-10-15, B4; critic 2B B2).
      const client = await getClient();
      try {
        await client.query('BEGIN');
        result = await client.query(updateQuery, [new Date(), userId]);
        await revokeAllSessions(client, userId);
        await deactivateDevices(client, userId);
        await client.query(
          'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL',
          [userId],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else {
      result = await pool.query(updateQuery, [new Date(), userId]);
    }

    // authenticate reads the role from the database (cached briefly): the
    // new role applies from the next request, whatever token is presented.
    invalidateAccountStatus(userId);

    logger.info('User upgraded to partner role', {
      userId,
      previousRole: currentRole,
      newRole: 'partner',
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Failed to upgrade user to partner', {
      userId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Generate a cryptographically random 6-digit numeric verification code.
 * Returns string with leading zeros preserved (e.g., "042193").
 */
function generateSixDigitCode() {
  // 4 random bytes interpreted as uint32 mod 10^6 — uniform distribution
  // bias is negligible (2^32 / 10^6 ≈ 4294.97, max bias < 0.0001%)
  const buf = randomBytes(4);
  const num = buf.readUInt32BE(0) % 1000000;
  return String(num).padStart(6, '0');
}

/**
 * Verification codes an account may be sent within an hour.
 *
 * The limit counts the codes written in the last hour: the one written at
 * registration (it may have been delivered — the send is not awaited there),
 * every resend whose email went out, and every resend whose email is still
 * on the way. A resend whose email did not go out leaves no code, so it does
 * not count (Н32).
 */
const VERIFICATION_CODE_LIMIT = { max: 5, minutes: 60 };

/**
 * The checks before a verification code is issued and a fresh code — steps
 * 1 and 3 of the flow documented on sendEmailVerificationCode, shared by both
 * senders. Writes nothing; each sender holds the hourly limit its own way.
 *
 * @param {string} userId
 * @returns {Promise<{user: Object, code: string, expiresAt: Date}>}
 * @throws {Error} 'USER_NOT_FOUND' | 'EMAIL_ALREADY_VERIFIED' | 'NO_EMAIL'
 */
async function prepareEmailVerificationCode(userId) {
  const userQuery = `
    SELECT id, email, name, email_verified
    FROM users
    WHERE id = $1 AND is_active = true
  `;
  const userResult = await pool.query(userQuery, [userId]);

  if (userResult.rows.length === 0) {
    throw new Error('USER_NOT_FOUND');
  }

  const user = userResult.rows[0];

  if (user.email_verified) {
    throw new Error('EMAIL_ALREADY_VERIFIED');
  }

  if (!user.email) {
    throw new Error('NO_EMAIL');
  }

  const code = generateSixDigitCode();
  const expiryMinutes = parseInt(process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES, 10) || 15;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  return { user, code, expiresAt };
}

/**
 * Whether a resent code or a reset link reached the user — the condition for
 * it to replace the codes or links they already hold.
 *
 * Outside production, without a mail provider (dev, tests), the database
 * (a code) or the console (a reset link — emailService prints it) is the only
 * place it can be read from: it counts as delivered, as it always has. In
 * production a missing key is a failure like any other.
 *
 * @param {{sent: boolean, reason?: string}} result - From emailService
 * @returns {boolean}
 */
function mailReachedUser(result) {
  return result.sent
    || (result.reason === 'RESEND_NOT_CONFIGURED' && process.env.NODE_ENV !== 'production');
}

/**
 * Re-issue an email verification code and email it, waiting for the
 * provider — the resend endpoint reports whether the email went out.
 *
 * Flow:
 *   1. Validate user exists, is active, has email, not already verified.
 *   2. Generate fresh 6-digit code with TTL from EMAIL_VERIFICATION_EXPIRY_MINUTES.
 *   3. Hold the limit: under the account's lock, count the hour's codes and,
 *      below five, write the new code as a reservation — counted, but not
 *      usable yet. Resends pressed together are counted one after another:
 *      the one that would be the sixth gets RATE_LIMITED, as a lone sixth
 *      does (Н45). Until 25.10 the count was read before the send and the
 *      code written after it, and every resend in flight saw the same count.
 *   4. Send email via Resend (bounded wait; degrades gracefully if not configured).
 *   5. Email went out: in one statement, retire the prior active codes and
 *      make the reservation the user's code (only the latest is valid).
 *      Email did not go out: remove the reservation — the codes the user
 *      already holds stay valid, and the resend does not count. Until 24.10
 *      the prior codes were retired before the send, and a refused resend
 *      left the user with no working code at all (Н31).
 *
 * The limit lives in the database: it holds whether or not Redis — where the
 * route's own limiter counts — is reachable.
 *
 * @param {string} userId
 * @returns {Promise<{sent: boolean, expiresAt: Date}>}
 * @throws {Error} 'USER_NOT_FOUND' | 'EMAIL_ALREADY_VERIFIED' | 'NO_EMAIL' | 'RATE_LIMITED'
 */
export async function sendEmailVerificationCode(userId) {
  const { user, code, expiresAt } = await prepareEmailVerificationCode(userId);

  const { reserved, recentCount } = await reserveCodeWithinLimit(userId, code, expiresAt, VERIFICATION_CODE_LIMIT);
  if (!reserved) {
    logger.warn('Email verification send rate-limited', { userId, recentCount });
    throw new Error('RATE_LIMITED');
  }

  const result = await sendVerificationCodeEmail(user.email, code, user.name, { userId });

  if (!mailReachedUser(result)) {
    // The failure itself is logged by emailService — one error line with the
    // account and the reason. A reservation that cannot be removed stays
    // unusable and only counts toward the hour: the answer stays sent:false.
    await deleteReservedCode(reserved.id).catch((error) => {
      logger.error('Unsent verification code could not be removed; it counts toward the hourly limit', {
        userId,
        error: error.message,
      });
    });
    logger.info('Email verification code not issued: the email did not go out, earlier codes stay valid', {
      userId,
      reason: result.reason,
    });
    return { sent: false, expiresAt };
  }

  await activateReservedCode(userId, reserved.id);

  logger.info('Email verification code issued', {
    userId,
    expiresAt,
    sent: result.sent,
  });

  return { sent: result.sent, expiresAt };
}

/**
 * Issue the first verification code at registration: steps 1–2 of
 * sendEmailVerificationCode, the hourly limit and the code write are
 * awaited, the email goes out in the background.
 *
 * Registration must not wait for the mail provider, and the code write must
 * not outlive the response either. Written after the response, it could land
 * after a quick resend had already invalidated the user's codes and leave two
 * codes active (auth-email-verification flake, 2026-09-28); a restart on
 * deploy could drop it altogether. Now only the network send runs on.
 *
 * @param {string} userId
 * @returns {Promise<{expiresAt: Date}>}
 * @throws {Error} as sendEmailVerificationCode — always before anything is sent
 */
export async function issueEmailVerificationCode(userId) {
  const { user, code, expiresAt } = await prepareEmailVerificationCode(userId);

  // The account was created a moment ago and no resend can run before this
  // answer carries its token: a plain count holds the limit here.
  const recentCount = await countRecentSends(userId, VERIFICATION_CODE_LIMIT.minutes);
  if (recentCount >= VERIFICATION_CODE_LIMIT.max) {
    logger.warn('Email verification send rate-limited', { userId, recentCount });
    throw new Error('RATE_LIMITED');
  }

  // Invalidate prior active codes — only the latest one is valid
  await invalidateActiveCodesForUser(userId);
  await createVerificationCode(userId, code, expiresAt);

  // Fire-and-forget: the network send only. sendVerificationCodeEmail handles
  // provider failures itself; this .catch keeps anything else from becoming an
  // unhandled rejection, which shuts the server down (server.js).
  sendVerificationCodeEmail(user.email, code, user.name, { userId })
    .then((result) => {
      logger.info('Email verification code issued', {
        userId,
        expiresAt,
        sent: result.sent,
      });
    })
    .catch((err) => {
      logger.error('Failed to send verification code email', {
        userId,
        error: err.message,
      });
    });

  return { expiresAt };
}

/**
 * Verify a 6-digit email verification code submitted by the user.
 *
 * On success: marks code as used, sets users.email_verified=true, returns user.
 * On wrong code: increments attempts; after 5 failed attempts the code is
 * invalidated and TOO_MANY_ATTEMPTS is returned on subsequent calls.
 *
 * @param {string} userId
 * @param {string} code - 6-digit string
 * @returns {Promise<Object>} Updated user record
 * @throws {Error} 'INVALID_OR_EXPIRED_CODE' | 'TOO_MANY_ATTEMPTS' | 'INVALID_CODE' | 'USER_NOT_FOUND'
 */
export async function verifyEmailCode(userId, code) {
  const activeCode = await findActiveCodeForUser(userId);

  if (!activeCode) {
    throw new Error('INVALID_OR_EXPIRED_CODE');
  }

  if (activeCode.attempts >= 5) {
    await markAsUsed(activeCode.id);
    throw new Error('TOO_MANY_ATTEMPTS');
  }

  if (activeCode.code !== code) {
    const newAttempts = await incrementAttempts(activeCode.id);
    if (newAttempts >= 5) {
      await markAsUsed(activeCode.id);
    }
    throw new Error('INVALID_CODE');
  }

  // Code matches — finalize verification
  await markAsUsed(activeCode.id);

  const updateResult = await pool.query(
    `UPDATE users
     SET email_verified = true, updated_at = $1
     WHERE id = $2 AND is_active = true
     RETURNING id, email, phone, name, role, auth_method, avatar_url,
               email_verified, phone_verified, is_active, created_at`,
    [new Date(), userId],
  );

  if (updateResult.rows.length === 0) {
    throw new Error('USER_NOT_FOUND');
  }

  logger.info('Email verified successfully', { userId });

  return updateResult.rows[0];
}

/**
 * SHA-256 hex digest of a reset token. Tokens are stored hashed so a
 * database leak yields nothing usable; the raw token lives only in the
 * emailed link.
 */
function hashResetToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issue a password reset token for the account behind an email address.
 *
 * ENUMERATION-SAFE BY CONTRACT: this function never signals to the caller
 * whether the email exists. Unknown email, throttled user, and successful
 * issue all resolve (no throws for those cases) — the controller returns
 * the same generic 200 regardless. Do not add distinguishing throws here.
 *
 * Flow:
 *   1. Look up active user by email — silently resolve if absent, and the
 *      same way for an account whose access only the operator restores (a
 *      panel role or a service account — config/serviceAccounts.js): no link,
 *      no mail, the same answer at the same moment as for an unknown address,
 *      after the same single query (directive service_accounts 2026-10-15, B2;
 *      critic 2B S1).
 *   2. Everything else — issuePasswordReset — runs in the BACKGROUND, after
 *      the answer: the limit, the token, the letter and what the letter's
 *      outcome decides. A known address is answered after the same single
 *      query as an unknown one — awaiting the database writes or the Resend
 *      round-trip here would make registered-email responses measurably
 *      slower, reopening enumeration through timing. Until 25.10 the limit
 *      and the token writes were awaited and only the letter ran on.
 *
 * @param {string} email
 * @returns {Promise<void>}
 */
export async function createPasswordResetToken(email) {
  const userResult = await pool.query(
    `SELECT id, email, name, role, ${serviceAccountFlagSql('users')} AS is_service_account
     FROM users
     WHERE email = $1 AND is_active = true`,
    [email.toLowerCase().trim()],
  );

  if (userResult.rows.length === 0) {
    logger.info('Password reset requested for unknown email');
    return;
  }

  const user = userResult.rows[0];

  if (isOperatorManaged(user)) {
    logger.warn('Password reset refused: access to this account is restored by the operator only', {
      userId: user.id,
    });
    return;
  }

  // Fire-and-forget (timing-channel defense, see flow note above). The
  // .catch keeps a failure from becoming an unhandled rejection, which shuts
  // the server down (server.js).
  const issue = issuePasswordReset(user)
    .catch((error) => {
      logger.error('Password reset issue failed', {
        userId: user.id,
        error: error.message,
      });
    })
    .finally(() => {
      pendingResetIssues.delete(issue);
    });
  pendingResetIssues.add(issue);
}

/**
 * Per-user reset links within an hour, so an attacker cycling IPs still
 * cannot bomb a victim's inbox. Links whose letter went out and links whose
 * letter is still on the way count; a link whose letter did not go out does not.
 */
const PASSWORD_RESET_LIMIT = { max: 5, minutes: 60 };

/** Issues started by createPasswordResetToken and not finished yet. */
const pendingResetIssues = new Set();

/**
 * Issue a reset link and mail it — the background part of
 * createPasswordResetToken.
 *
 *   1. Under the account's lock, count the hour's links and, below five,
 *      store the new one (SHA-256 hash, TTL from PASSWORD_RESET_EXPIRY_MINUTES,
 *      default 30) — active at once, next to the earlier ones. Requests that
 *      arrive together are counted one after another: the sixth gets nothing.
 *   2. Email the raw token as a deep link, waiting for the provider (bounded).
 *   3. The letter went out: retire the links issued before this one (only the
 *      latest emailed link works). The letter did not go out: remove the new
 *      token — the earlier links keep working, and the attempt does not count.
 *      The provider did not answer in time (the letter may still arrive):
 *      keep the new token and the earlier ones; the attempt counts.
 *
 * Until 25.10 the earlier links were retired before the letter was even
 * handed over: when it did not go out, the person held no working link at
 * all, and the failed attempt used up one of the hour's five (Н46).
 *
 * The limit lives in the database: it holds whether or not Redis — where the
 * route's own limiter counts — is reachable.
 *
 * @param {{id: string, email: string, name: string}} user
 * @returns {Promise<void>}
 */
async function issuePasswordReset(user) {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(rawToken);
  const expiryMinutes = parseInt(process.env.PASSWORD_RESET_EXPIRY_MINUTES, 10) || 30;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

  const { token, recentCount } = await createResetTokenWithinLimit(user.id, tokenHash, expiresAt, PASSWORD_RESET_LIMIT);
  if (!token) {
    logger.warn('Password reset issue throttled (per-user)', {
      userId: user.id,
      recentCount,
    });
    return;
  }

  // emailService logs a failed send with the account and the reason.
  const result = await sendPasswordResetEmail(user.email, rawToken, user.name, { userId: user.id });

  if (result.reason === 'RESEND_TIMEOUT') {
    // The provider did not answer in time: the letter may still arrive. Its
    // link keeps working, and so do the earlier ones — the person learns
    // nothing from the answer and may hold either. It counts toward the hour.
    logger.info('Password reset letter outcome unknown: the new link and the earlier ones stay valid', {
      userId: user.id,
    });
    return;
  }

  if (!mailReachedUser(result)) {
    // If the removal fails, the token stays: no one holds its link, and it
    // counts toward the hour — the caller logs the error.
    await deleteResetToken(token.id);
    logger.info('Password reset link not issued: the letter did not go out, earlier links stay valid', {
      userId: user.id,
      reason: result.reason,
    });
    return;
  }

  // If this fails, the earlier links stay valid next to the new one.
  await retireResetTokensIssuedBefore(user.id, token.id);

  logger.info('Password reset token issued', {
    userId: user.id,
    expiresAt,
    sent: result.sent,
  });
}

/**
 * Resolves once every reset issue started so far has finished. Test-only —
 * exported so tests can read what an issue left behind; the answer to
 * «forgot password» never waits for it.
 *
 * @returns {Promise<void>}
 */
export const _settlePasswordResetIssuesForTests = async () => {
  while (pendingResetIssues.size > 0) {
    await Promise.all([...pendingResetIssues]);
  }
};

/**
 * Consume a password reset token: set the new password and revoke all
 * active sessions.
 *
 * Order matters for safety:
 *   1. Claim the token FIRST (atomic UPDATE ... WHERE used_at IS NULL) —
 *      of two concurrent submissions exactly one proceeds, and a failure
 *      later leaves the token burned rather than replayable.
 *   2. Hash the new password with the same Argon2id parameters as register.
 *   3. In ONE transaction: set the password and end every session
 *      (revokeAllSessions — refresh tokens burned, access tokens issued
 *      until now refused) — a password reset must terminate whoever held the
 *      old credentials, and a reset that changes the password but leaves the
 *      old sessions alive is the defect itself. No login sees the new
 *      password before the old sessions are gone. The account's other reset
 *      links are retired in the same transaction.
 *
 * @param {string} token - Raw token from the emailed link
 * @param {string} newPassword - Already validated against register rules
 * @returns {Promise<Object>} { id, email, name } of the updated user
 * @throws {Error} 'INVALID_OR_EXPIRED_TOKEN' | 'USER_NOT_FOUND'
 */
export async function consumePasswordResetToken(token, newPassword) {
  const tokenHash = hashResetToken(token);
  const resetToken = await findValidResetToken(tokenHash);

  if (!resetToken) {
    throw new Error('INVALID_OR_EXPIRED_TOKEN');
  }

  const claimed = await markResetTokenUsed(resetToken.id);
  if (!claimed) {
    // Lost a concurrent race for the same token
    throw new Error('INVALID_OR_EXPIRED_TOKEN');
  }

  const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);

  const client = await getClient();
  let user;
  let revoked;
  try {
    await client.query('BEGIN');
    // Not for an account whose access only the operator restores (a panel
    // role, the seed house): a link issued before it became one — or before
    // this rule — is answered as a dead link, and stays spent (claimed
    // above). The rule sits in the write itself, so an account promoted
    // between the claim and this write is refused too (Phase 3.5, lens).
    const updateResult = await client.query(
      `UPDATE users
       SET password_hash = $1, updated_at = $2
       WHERE id = $3 AND is_active = true
         AND role NOT IN ('admin', 'viewer')
         AND NOT ${serviceAccountFlagSql('users')}
       RETURNING id, email, name`,
      [passwordHash, new Date(), resetToken.user_id],
    );
    user = updateResult.rows[0];
    if (user) {
      // Force re-login everywhere: the reset link came from email ownership,
      // any session created with the old password is no longer trustworthy.
      // The push devices go with the sessions (directive service_accounts
      // 2026-10-15, B4): a phone signed in with the old password stops
      // receiving the account's notices.
      revoked = await revokeAllSessions(client, resetToken.user_id);
      revoked.devices = await deactivateDevices(client, resetToken.user_id);
      // The account's other links go too: the password they would set is
      // already set. Several can be alive at once — while a newer letter is on
      // the way, or after a letter whose outcome is unknown.
      await client.query(
        'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL',
        [resetToken.user_id],
      );
    }
    await client.query(user ? 'COMMIT' : 'ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (!user) {
    const holder = await pool.query(
      `SELECT role, is_active, ${serviceAccountFlagSql('users')} AS is_service_account FROM users WHERE id = $1`,
      [resetToken.user_id],
    );
    if (holder.rows[0]?.is_active && isOperatorManaged(holder.rows[0])) {
      logger.warn('Password reset link refused: access to this account is restored by the operator only', {
        userId: resetToken.user_id,
      });
      throw new Error('INVALID_OR_EXPIRED_TOKEN');
    }
    throw new Error('USER_NOT_FOUND');
  }

  invalidateAccountStatus(resetToken.user_id);

  logger.info('Password reset completed', {
    userId: resetToken.user_id,
    tokenCount: revoked.tokenCount,
    accessTokensRevoked: revoked.revokedAt !== null,
  });

  return user;
}

