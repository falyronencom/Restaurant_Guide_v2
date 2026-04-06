/**
 * Firebase Admin SDK Configuration
 *
 * Initializes the Firebase Admin SDK for sending push notifications via FCM.
 * Follows the same module pattern as cloudinary.js — SDK configured once at
 * import time, messaging instance exported for use by pushService.
 *
 * Credential sources (checked in order):
 * 1. FIREBASE_SERVICE_ACCOUNT env var — JSON string (preferred for Railway)
 * 2. FIREBASE_SERVICE_ACCOUNT_PATH env var — file path (local development)
 *
 * Graceful degradation: If neither credential is available, the module logs
 * a warning but does NOT crash the server. Push notifications simply won't
 * send — matching the non-blocking philosophy of the notification system.
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import logger from '../utils/logger.js';

let messaging = null;
let initialized = false;

try {
  let credential = null;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Railway / production: JSON string in env var
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    credential = admin.credential.cert(serviceAccount);
    logger.info('Firebase Admin: using FIREBASE_SERVICE_ACCOUNT env var');
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    // Local development: file path
    const serviceAccount = JSON.parse(
      readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'),
    );
    credential = admin.credential.cert(serviceAccount);
    logger.info('Firebase Admin: using FIREBASE_SERVICE_ACCOUNT_PATH file');
  }

  if (credential) {
    admin.initializeApp({ credential });
    messaging = admin.messaging();
    initialized = true;
    logger.info('Firebase Admin SDK initialized successfully');
  } else {
    logger.warn(
      'Firebase Admin: no credentials configured. Push notifications disabled. ' +
      'Set FIREBASE_SERVICE_ACCOUNT (JSON string) or FIREBASE_SERVICE_ACCOUNT_PATH (file path).',
    );
  }
} catch (error) {
  logger.error('Firebase Admin: initialization failed', {
    error: error.message,
  });
}

/**
 * Check if Firebase messaging is available
 * @returns {boolean}
 */
export const isAvailable = () => initialized && messaging !== null;

/**
 * Get the Firebase messaging instance
 * @returns {admin.messaging.Messaging|null}
 */
export const getMessaging = () => messaging;

export default { isAvailable, getMessaging };
