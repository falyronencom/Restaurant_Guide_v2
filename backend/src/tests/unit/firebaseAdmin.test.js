/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * config/firebaseAdmin.js against the real firebase-admin (no mock).
 *
 * Push depends on one thing happening at import time: the service-account key
 * from FIREBASE_SERVICE_ACCOUNT is accepted and messaging() is handed out.
 * firebase-admin 13.10 replaced node-forge with node:crypto for that key check;
 * these cases pin the contract across such swaps:
 *  - a key in the format Google issues (PKCS#8 "BEGIN PRIVATE KEY") enables push;
 *  - a broken key disables push without throwing out of the import.
 * Each case imports a fresh module instance (query string) and deletes the
 * default app afterwards, so the cases do not see each other's app.
 */
import { generateKeyPairSync } from 'node:crypto';
import admin from 'firebase-admin';

const serviceAccount = (privateKey) => JSON.stringify({
  type: 'service_account',
  project_id: 'unit-test-project',
  private_key_id: 'unit-test',
  private_key: privateKey,
  client_email: 'unit-test@unit-test-project.iam.gserviceaccount.com',
  client_id: '0',
});

describe('firebaseAdmin config', () => {
  const saved = {
    json: process.env.FIREBASE_SERVICE_ACCOUNT,
    path: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
  };

  afterEach(async () => {
    await Promise.all(admin.apps.filter(Boolean).map((app) => app.delete()));
    for (const [key, value] of [
      ['FIREBASE_SERVICE_ACCOUNT', saved.json],
      ['FIREBASE_SERVICE_ACCOUNT_PATH', saved.path],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('a PKCS#8 service-account key enables push', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    process.env.FIREBASE_SERVICE_ACCOUNT = serviceAccount(privateKey);
    delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    const fb = await import('../../config/firebaseAdmin.js?case=pkcs8');

    expect(fb.isAvailable()).toBe(true);
    expect(typeof fb.getMessaging().sendEachForMulticast).toBe('function');
  });

  test('a broken key leaves push disabled and does not throw', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = serviceAccount(
      '-----BEGIN PRIVATE KEY-----\nbm90IGEga2V5\n-----END PRIVATE KEY-----\n',
    );
    delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    const fb = await import('../../config/firebaseAdmin.js?case=broken');

    expect(fb.isAvailable()).toBe(false);
    expect(fb.getMessaging()).toBeNull();
  });
});
