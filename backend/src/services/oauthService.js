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

    logger.info('Google token verified', {
      sub: payload.sub,
      email: payload.email,
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
    logger.error('Google token verification failed', { error: error.message });
    throw new Error('OAUTH_INVALID_TOKEN');
  }
}

/**
 * Verifies a Yandex OAuth token by calling Yandex Login API.
 *
 * Unlike Google (JWT-based), Yandex uses opaque OAuth tokens that must be
 * validated via API call. The token is sent in the Authorization header.
 *
 * @param {string} oauthToken - Yandex OAuth token from mobile SDK
 * @returns {Promise<Object>} Normalized user data
 * @throws {Error} If token is invalid or API call fails
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

    if (!data.default_email) {
      throw new Error('OAUTH_NO_EMAIL');
    }

    // Construct avatar URL from default_avatar_id if available
    let avatarUrl = null;
    if (data.default_avatar_id) {
      avatarUrl = `${YANDEX_AVATAR_BASE}/${data.default_avatar_id}/${YANDEX_AVATAR_SIZE}`;
    }

    logger.info('Yandex token verified', {
      id: data.id,
      email: data.default_email,
    });

    return {
      providerId: String(data.id),
      email: data.default_email.toLowerCase().trim(),
      name: data.display_name || data.real_name || data.default_email.split('@')[0],
      avatarUrl,
      emailVerified: true, // Yandex considers default_email as verified
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
