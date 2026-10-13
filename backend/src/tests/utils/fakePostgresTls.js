/**
 * A Postgres server stand-in for TLS tests, and the certificates it presents.
 *
 * selfSignedCertificate() builds the kind of certificate Railway's Postgres
 * presents — self-signed, issued to "localhost" with DNS:localhost — at test
 * time, with node:crypto alone: Node has no API that writes an X.509
 * certificate, so the DER is put together here. No key material is
 * committed to the repository (firebaseAdmin.test.js does the same for its
 * key).
 *
 * startFakePostgres() answers an SSLRequest with 'S', completes the TLS
 * handshake with the given certificate, and records the first message the
 * client sends inside TLS — the startup message, which carries the user
 * name. It then answers with an ErrorResponse, so a client's connect() fails
 * with FAKE_SERVER_STOP: proof that the handshake was accepted. A client that
 * refuses the certificate never sends that message.
 */

import net from 'net';
import tls from 'tls';
import { generateKeyPairSync, randomBytes, sign, X509Certificate } from 'crypto';

const tlv = (tag, content) => {
  const { length } = content;
  let header;
  if (length < 0x80) header = Buffer.from([tag, length]);
  else if (length < 0x100) header = Buffer.from([tag, 0x81, length]);
  else header = Buffer.from([tag, 0x82, length >> 8, length & 0xff]);
  return Buffer.concat([header, content]);
};
const sequence = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const integer = (bytes) => tlv(0x02, bytes);
const oid = (dotted) => {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const bytes = [40 * first + second];
  rest.forEach((arc) => {
    const chunk = [arc & 0x7f];
    for (let value = arc >> 7; value > 0; value >>= 7) chunk.unshift((value & 0x7f) | 0x80);
    bytes.push(...chunk);
  });
  return tlv(0x06, Buffer.from(bytes));
};
const utf8String = (text) => tlv(0x0c, Buffer.from(text, 'utf8'));
const utcTime = (date) => tlv(0x17, Buffer.from(`${date.toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`));
const name = (commonName) => sequence(set(sequence(oid('2.5.4.3'), utf8String(commonName))));
const ECDSA_WITH_SHA256 = sequence(oid('1.2.840.10045.4.3.2'));

/**
 * @param {Object} [options]
 * @param {string} [options.commonName='localhost']
 * @returns {{ certPem: string, keyPem: string, der: Buffer, fingerprint256: string }}
 */
export const selfSignedCertificate = ({ commonName = 'localhost' } = {}) => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const serial = randomBytes(8);
  serial[0] = (serial[0] & 0x7f) | 0x01; // positive, minimal DER
  const now = Date.now();
  const subjectAltName = sequence(
    oid('2.5.29.17'),
    tlv(0x04, sequence(tlv(0x82, Buffer.from(commonName, 'ascii')))),
  );
  const tbs = sequence(
    tlv(0xa0, integer(Buffer.from([2]))), // v3
    integer(serial),
    ECDSA_WITH_SHA256,
    name(commonName),
    sequence(utcTime(new Date(now - 60_000)), utcTime(new Date(now + 3650 * 86_400_000))),
    name(commonName),
    publicKey.export({ type: 'spki', format: 'der' }),
    tlv(0xa3, sequence(subjectAltName)),
  );
  const signature = sign('sha256', tbs, privateKey); // DER ECDSA-Sig-Value
  const der = sequence(tbs, ECDSA_WITH_SHA256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const certPem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  return {
    certPem,
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    der,
    fingerprint256: new X509Certificate(der).fingerprint256,
  };
};

/** The message a client's connect() fails with once the server stops it. */
export const FAKE_SERVER_STOP = 'fake server: stopped after the startup message';

const errorResponse = (message) => {
  const fields = Buffer.concat([
    Buffer.from('SFATAL\0VFATAL\0C28000\0', 'latin1'),
    Buffer.from(`M${message}\0`, 'utf8'),
    Buffer.from([0]),
  ]);
  const head = Buffer.alloc(5);
  head.write('E', 0, 'latin1');
  head.writeInt32BE(fields.length + 4, 1);
  return Buffer.concat([head, fields]);
};

/**
 * @param {{ certPem: string, keyPem: string }} certificate
 * @returns {Promise<{ port: number, received: Buffer[], sslRequests: number, close: () => Promise<void> }>}
 */
export const startFakePostgres = async ({ certPem, keyPem }) => {
  const state = { received: [], sslRequests: 0 };
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.once('data', (first) => {
      if (first.length !== 8 || first.readInt32BE(4) !== 80877103) {
        socket.destroy();
        return;
      }
      state.sslRequests += 1;
      socket.write('S');
      const secure = new tls.TLSSocket(socket, { isServer: true, key: keyPem, cert: certPem });
      secure.on('error', () => {});
      secure.once('data', (message) => {
        state.received.push(message);
        secure.end(errorResponse(FAKE_SERVER_STOP));
      });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    get received() { return state.received; },
    get sslRequests() { return state.sslRequests; },
    close: () => new Promise((resolve) => {
      sockets.forEach((socket) => socket.destroy());
      server.close(() => resolve());
    }),
  };
};
