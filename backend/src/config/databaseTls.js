/**
 * TLS to the production database: the pinned certificate.
 *
 * Railway's Postgres presents a self-signed certificate (issued to
 * "localhost"), so no public certificate authority vouches for it. Trust is
 * the certificate itself, pinned as DATABASE_TLS_CERT (its DER, base64, one
 * line): the only trust anchor of the connection, with the host-name check
 * replaced by its fingerprint. A server without that certificate's key fails
 * the TLS handshake — before the user name or the password is sent.
 *
 * Used by the operator scripts (scripts/lib/productionDb.js, which also pins
 * it: scripts/pin-production-db-cert.js) and by the app's own pool
 * (config/database.js) when DATABASE_TLS_CERT is set — today only when an
 * operator script runs the service layer against production
 * (scripts/seed-import, --target=prod). Without the variable the pool keeps
 * its previous setting: encrypted, server unchecked.
 */

import { X509Certificate } from 'crypto';

/** Where the pin lives (backend/.env.production for the operator scripts). */
export const PIN_VARIABLE = 'DATABASE_TLS_CERT';

/**
 * A certificate as a pin: its DER, base64, one line.
 *
 * @param {Buffer} der
 * @returns {string}
 */
export const pinValue = (der) => Buffer.from(der).toString('base64');

/**
 * A pin back into a certificate. Accepts the one-line base64 the pin tool
 * writes and, for a hand-made pin, a PEM block.
 *
 * @param {string} value
 * @returns {X509Certificate}
 * @throws {Error} if the value is not a certificate
 */
export const certificateFromPin = (value) => {
  const text = String(value).trim();
  if (text.includes('-----BEGIN CERTIFICATE-----')) {
    return new X509Certificate(text);
  }
  return new X509Certificate(Buffer.from(text.replace(/\s+/g, ''), 'base64'));
};

/**
 * TLS options that accept only the pinned certificate.
 *
 * @param {X509Certificate} pinned
 * @returns {Object} node-pg `ssl` / tls.connect options
 */
export const sslForPinnedCertificate = (pinned) => ({
  ca: pinned.toString(),
  rejectUnauthorized: true,
  // Called only once the chain has verified against `ca` — that is, the
  // server holds the pinned certificate's key. The name check is replaced by
  // the fingerprint: the certificate is issued to "localhost".
  checkServerIdentity: (_host, cert) => {
    if (cert && cert.fingerprint256 === pinned.fingerprint256) {
      return undefined;
    }
    const error = new Error(
      `certificate ${cert && cert.fingerprint256} is not the pinned ${pinned.fingerprint256}`,
    );
    error.code = 'PRODUCTION_DB_CERT_MISMATCH';
    return error;
  },
});

/**
 * The `ssl` setting of the app's pool (config/database.js).
 *
 * Outside production: no TLS (local and test databases). In production: the
 * pinned certificate when DATABASE_TLS_CERT is set; otherwise the previous
 * setting, encrypted with the server unchecked — the server's own connection
 * inside Railway, a separate decision (review 02.10, EN1).
 *
 * @param {Object} env - process.env
 * @returns {false|Object}
 */
export const databaseSsl = (env) => {
  if (env.NODE_ENV !== 'production') {
    return false;
  }
  const pin = env[PIN_VARIABLE];
  if (pin === undefined || String(pin).trim() === '') {
    return { rejectUnauthorized: false };
  }
  return sslForPinnedCertificate(certificateFromPin(pin));
};
