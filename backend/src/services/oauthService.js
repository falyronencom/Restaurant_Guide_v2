/**
 * OAuth Verification Service
 *
 * Verifies tokens from external OAuth providers (Google, Yandex) and returns
 * normalized user data. Each provider has a different token format and
 * verification mechanism, but all return the same normalized shape.
 *
 * Google: ID token (JWT) verified against Google's public keys
 * Yandex: OAuth token verified via Yandex API call
 */

import { OAuth2Client } from 'google-auth-library';
import { resolveYandexClientIds } from '../config/oauth.js';
import logger from '../utils/logger.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

// Yandex avatar URL template — default_avatar_id maps to this pattern
const YANDEX_AVATAR_BASE = 'https://avatars.yandex.net/get-yapic';
const YANDEX_AVATAR_SIZE = 'islands-200'; // 200x200px

/**
 * Verifies a Google ID token and extracts user information.
 *
 * Uses google-auth-library to verify the JWT signature against Google's
 * public keys and validates audience (client ID) to prevent token misuse.
 *
 * @param {string} idToken - Google ID token from mobile Sign-In SDK
 * @returns {Promise<Object>} Normalized user data
 * @throws {Error} If token is invalid, expired, or audience mismatch
 */
export async function verifyGoogleToken(idToken) {
  try {
    const client = new OAuth2Client(GOOGLE_CLIENT_ID);

    const ticket = await client.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload.email) {
      throw new Error('OAUTH_NO_EMAIL');
    }

    // The provider's account number, never the address: the log holds no
    // e-mail of a person (30.10.2026). authService names our account next.
    logger.info('Google token verified', {
      sub: payload.sub,
    });

    return {
      providerId: payload.sub,
      email: payload.email.toLowerCase().trim(),
      name: payload.name || payload.email.split('@')[0],
      avatarUrl: payload.picture || null,
      emailVerified: payload.email_verified === true,
      provider: 'google',
    };
  } catch (error) {
    if (error.message === 'OAUTH_NO_EMAIL') {
      throw error;
    }
    // google-auth-library quotes the token after its reason — the payload
    // (the person's e-mail, name, picture) or the whole token: «Token used too
    // late, <now> > <latest>: {…}», «Invalid token signature: <token>». The
    // log keeps the reason only, and the code a network failure carries
    // (30.10.2026).
    logger.error('Google token verification failed', {
      error: String(error.message).split(': ')[0],
      code: error.code,
    });
    throw new Error('OAUTH_INVALID_TOKEN');
  }
}

/**
 * Verifies a Yandex OAuth token by calling Yandex Login API.
 *
 * Unlike Google (JWT-based), Yandex uses opaque OAuth tokens that must be
 * validated via API call. The token is sent in the Authorization header.
 *
 * The answer names the application the token was issued to (client_id); only
 * our own applications are accepted (config/oauth.js) — the counterpart of the
 * audience check verifyGoogleToken makes. An answer without client_id is
 * refused as well: the field is standard, and its absence is not a reason to
 * skip the check.
 *
 * @param {string} oauthToken - Yandex OAuth token from mobile SDK
 * @returns {Promise<Object>} Normalized user data
 * @throws {Error} If token is invalid, issued to another application, or API call fails
 */
export async function verifyYandexToken(oauthToken) {
  try {
    const response = await fetch('https://login.yandex.ru/info?format=json', {
      headers: {
        Authorization: `OAuth ${oauthToken}`,
      },
    });

    if (!response.ok) {
      logger.error('Yandex API returned error', {
        status: response.status,
      });
      throw new Error('OAUTH_INVALID_TOKEN');
    }

    const data = await response.json();

    // Read per call, like the other env resolvers: a test can vary it without
    // reloading the module.
    const acceptedClientIds = resolveYandexClientIds(process.env);
    if (!acceptedClientIds.includes(data.client_id)) {
      // The other application's ID is not a secret and is what tells an
      // application of ours missing from YANDEX_CLIENT_ID apart from a stray
      // token.
      logger.warn('Yandex token issued to another application', {
        clientId: data.client_id === undefined ? null : String(data.client_id),
      });
      throw new Error('OAUTH_INVALID_TOKEN');
    }

    if (!data.default_email) {
      throw new Error('OAUTH_NO_EMAIL');
    }

    // Construct avatar URL from default_avatar_id if available
    let avatarUrl = null;
    if (data.default_avatar_id) {
      avatarUrl = `${YANDEX_AVATAR_BASE}/${data.default_avatar_id}/${YANDEX_AVATAR_SIZE}`;
    }

    // As for Google: the provider's account number, never the address.
    logger.info('Yandex token verified', {
      id: data.id,
    });

    return {
      providerId: String(data.id),
      email: data.default_email.toLowerCase().trim(),
      name: data.display_name || data.real_name || data.default_email.split('@')[0],
      avatarUrl,
      // default_email is taken as verified. Checked against Yandex ID docs on
      // 11.10.2026 (decision of the Coordinator): the info response carries no
      // verified flag; a Yandex ID registered on an outside address («упрощённая
      // регистрация», support/id/authorization/lite) requires the code sent to
      // that address, and a passwordless sign-in goes through a link mailed to
      // it — so the address behind default_email has been proven to Yandex.
      // Business-domain mail (Почта для бизнеса) cannot be used that way.
      emailVerified: true,
      provider: 'yandex',
    };
  } catch (error) {
    if (error.message === 'OAUTH_NO_EMAIL' || error.message === 'OAUTH_INVALID_TOKEN') {
      throw error;
    }
    logger.error('Yandex token verification failed', { error: error.message });
    throw new Error('OAUTH_INVALID_TOKEN');
  }
}
