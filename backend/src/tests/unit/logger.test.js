/* eslint-env jest */
/**
 * Unit Tests: logger redaction formatter (OSB-I1)
 *
 * The winston 3.x call pattern used across the codebase —
 * `logger.error('msg', { ctx })` — spreads the context onto the TOP LEVEL of
 * `info`. The pre-fix redactor only inspected `info.message`-as-object and
 * `info.meta` (paths that never occur here), so `[REDACTED]` never fired.
 * These tests pin the formatter to the real call shape.
 *
 * The last describe reads the line the app's own logger prints, in both of
 * its chains: the formatter is only as good as its place in the chain.
 */

import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { redactSensitiveData } from '../../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const transform = (info) => redactSensitiveData().transform(info);

describe('redactSensitiveData (OSB-I1)', () => {
  test('redacts sensitive keys spread onto the top level of info', () => {
    const out = transform({
      level: 'error',
      message: 'login failed',
      password: 'hunter2',
      token: 'abc123',
    });

    expect(out.password).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.message).toBe('login failed');
    expect(out.level).toBe('error');
  });

  test('redacts inside nested plain objects and arrays', () => {
    const out = transform({
      level: 'error',
      message: 'ctx',
      ctx: {
        user: { authorization: 'Bearer x', name: 'Вася' },
        attempts: [{ refresh_token: 'r1' }, { access_token: 'a1' }],
      },
    });

    expect(out.ctx.user.authorization).toBe('[REDACTED]');
    expect(out.ctx.user.name).toBe('Вася');
    expect(out.ctx.attempts[0].refresh_token).toBe('[REDACTED]');
    expect(out.ctx.attempts[1].access_token).toBe('[REDACTED]');
  });

  test('matches key names case-insensitively', () => {
    const out = transform({
      level: 'error',
      message: 'x',
      Authorization: 'Bearer y',
    });

    expect(out.Authorization).toBe('[REDACTED]');
  });

  test('does not mutate the caller-owned nested context object', () => {
    const ctx = { token: 'abc', keep: 'yes' };
    transform({ level: 'error', message: 'x', ctx });

    expect(ctx.token).toBe('abc');
    expect(ctx.keep).toBe('yes');
  });

  test('survives circular structures without hanging', () => {
    const ctx = { name: 'loop' };
    ctx.self = ctx;

    const out = transform({ level: 'error', message: 'x', ctx });

    expect(out.ctx.name).toBe('loop');
    expect(out.ctx.self).toBe('[CIRCULAR]');
  });

  test('shared (non-circular) references are redacted in both places', () => {
    const shared = { token: 't' };
    const out = transform({ level: 'error', message: 'x', a: shared, b: shared });

    expect(out.a.token).toBe('[REDACTED]');
    expect(out.b.token).toBe('[REDACTED]');
  });

  test('leaves Error instances intact for winston error formatting', () => {
    const err = new Error('boom');
    const out = transform({ level: 'error', message: 'x', err });

    expect(out.err).toBe(err);
  });

  test('keeps non-sensitive scalars and nulls untouched', () => {
    const out = transform({
      level: 'info',
      message: 'ok',
      correlationId: 'req-1',
      count: 3,
      nothing: null,
    });

    expect(out.correlationId).toBe('req-1');
    expect(out.count).toBe(3);
    expect(out.nothing).toBeNull();
  });
});

// 30.10.2026: no e-mail address and no phone number reaches the log, whatever
// the field is called and wherever the value sits — a safety net under the
// call sites, which no longer hand them over (services' own tests).
describe('redactSensitiveData — e-mail and phone', () => {
  const ADDRESS = 'anna.petrova@example.by';
  const PHONE = '+375291234567';

  test('a field named for one is replaced whole, at any level, whatever it holds', () => {
    const out = transform({
      level: 'info',
      message: 'x',
      email: ADDRESS,
      toEmail: ADDRESS,
      user_email: ADDRESS,
      phone: PHONE,
      phoneNumber: '80291234567', // a phone typed without its plus
      ctx: { user: { Email: ADDRESS, userPhone: 375291234567 } },
      recipients: [{ email: ADDRESS }],
    });

    expect(out.email).toBe('[REDACTED]');
    expect(out.toEmail).toBe('[REDACTED]');
    expect(out.user_email).toBe('[REDACTED]');
    expect(out.phone).toBe('[REDACTED]');
    expect(out.phoneNumber).toBe('[REDACTED]');
    expect(out.ctx.user.Email).toBe('[REDACTED]');
    expect(out.ctx.user.userPhone).toBe('[REDACTED]');
    expect(out.recipients[0].email).toBe('[REDACTED]');
  });

  test('an address or a phone inside any text is cut out, the rest of the text kept', () => {
    const out = transform({
      level: 'error',
      message: `Letter to ${ADDRESS} failed`,
      error: `Key (email)=(${ADDRESS}) already exists.`,
      ctx: { note: 'call +375 (29) 123-45-67 or +375 29 123 45 67, then mail Почта@Пример.бел' },
      list: [`sms ${PHONE}`],
    });

    expect(out.message).toBe('Letter to [REDACTED] failed');
    expect(out.error).toBe('Key (email)=([REDACTED]) already exists.');
    expect(out.ctx.note).toBe('call [REDACTED] or [REDACTED], then mail [REDACTED]');
    expect(out.list).toEqual(['sms [REDACTED]']);
  });

  test('what only looks close stays: flags, no-address nulls, a door\'s name, dates, versions, ids', () => {
    const info = {
      level: 'info',
      message: '::1 - - [30/Oct/2026:05:45:48 +0000] "POST /api/v1/auth/login HTTP/1.1" 401 52',
      emailVerified: true,
      email_verified: false,
      phoneVerified: true,
      email: null,
      loginBy: 'email_and_phone',
      at: '2026-10-30T01:08:14+03:00',
      local: 'Fri Oct 30 2026 08:45:48 GMT+0300 (Moscow Standard Time)',
      dependency: 'winston@3.11.0',
      userId: '6f1e2d3c-4b5a-4978-8a1b-375291234567',
      count: 375291234567,
      reason: 'RESEND_NOT_CONFIGURED',
    };

    expect(transform({ ...info })).toEqual(info);
  });

  // The request line (morgan, server.js) carries the URL as the client encoded
  // it: the panel's user search sends an address or a phone in the query,
  // «@» as %40, «+» as %2B, a space as «+» or %20 (Phase 3.5, both reviewers).
  test('a request line: an address and a phone in an encoded query are cut too', () => {
    const line = (query) => `::1 - - [30/Oct/2026:05:45:48 +0000] "GET /api/v1/admin/users?${query}&page=1 HTTP/1.1" 200 52`;
    const out = transform({
      level: 'info',
      message: line('search=anna.petrova%40example.by'),
      a: line('search=%2B375+29+123-45-67'),
      b: line('search=%2b375291234567'),
      c: line('search=%2B375%2029%20123%2045%2067'),
    });

    expect(out.message).toBe(line('search=[REDACTED]'));
    expect(out.a).toBe(line('search=[REDACTED]'));
    expect(out.b).toBe(line('search=[REDACTED]'));
    expect(out.c).toBe(line('search=[REDACTED]'));
  });

  test('encoded lookalikes and flags stay: a short %2B number, a version after %40, hasEmail', () => {
    const info = {
      level: 'info',
      message: 'GET /api/v1/admin/users?search=%2B12345&page=1',
      dependency: 'winston%403.11.0',
      hasEmail: true,
      withPhone: false,
    };

    expect(transform({ ...info })).toEqual(info);
  });

  test('the phone boundary: a plus and 8 digits stay, 9 are a phone', () => {
    const out = transform({ level: 'info', message: 'x', a: 'code +1234 5678', b: 'code +1234 56789' });

    expect(out.a).toBe('code +1234 5678');
    expect(out.b).toBe('code [REDACTED]');
  });

  test('a long text without either costs one pass (bounded runs, no backtracking)', () => {
    // An address without its dot, then pluses with too few digits after each
    // (a letter after each run: «+» also joins a phone's digits, as an encoded
    // space). Measured 30.10.2026 on 2 × 40 000 letters: 18 ms bounded, 2.8 s
    // with an unbounded mailbox run (quadratic) — at 2 × 80 000 ≈ 11 s.
    const long = `${'a'.repeat(80000)}@${'b'.repeat(80000)}${'+1234567x'.repeat(20000)}`;
    const started = Date.now();

    const out = transform({ level: 'info', message: 'x', blob: long });

    expect(out.blob).toBe(long);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

// A logger built without the formatter, or with it after json() (the line is
// written by then), prints the password while every test above stays green.
// The real logger in a child process, with the environment that picks its chain.
describe('the app logger (utils/logger.js) — what it actually prints', () => {
  const loggerUrl = pathToFileURL(resolve(__dirname, '../../utils/logger.js')).href;

  test.each(['production', 'development'])('%s chain: the password and the token come out [REDACTED]', (nodeEnv) => {
    const script = `const { default: logger } = await import(${JSON.stringify(loggerUrl)});\n`
      + "logger.error('login failed', { password: 'hunter2', token: 'abc123' });";
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, NODE_ENV: nodeEnv, LOG_LEVEL: 'info' },
      encoding: 'utf8',
      timeout: 10000,
    });
    const printed = `${run.stdout}${run.stderr}`;

    expect(printed).toContain('login failed'); // the line was written at all
    expect(printed.match(/\[REDACTED\]/g)).toHaveLength(2); // the password and the token
    expect(printed).not.toContain('hunter2');
    expect(printed).not.toContain('abc123');
  });

  test.each(['production', 'development'])('%s chain: no e-mail and no phone, by field or in the text', (nodeEnv) => {
    const script = `const { default: logger } = await import(${JSON.stringify(loggerUrl)});\n`
      + "logger.warn('Letter to anna.petrova@example.by failed', {"
      + " toEmail: 'anna.petrova@example.by', phone: '80291234567',"
      + " note: 'call +375 29 123-45-67', user: { email: 'anna.petrova@example.by' } });";
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, NODE_ENV: nodeEnv, LOG_LEVEL: 'info' },
      encoding: 'utf8',
      timeout: 10000,
    });
    const printed = `${run.stdout}${run.stderr}`;

    expect(printed).toContain('Letter to'); // the line was written at all
    expect(printed.match(/\[REDACTED\]/g)).toHaveLength(5);
    expect(printed).not.toContain('anna.petrova');
    expect(printed).not.toContain('example.by');
    expect(printed).not.toContain('80291234567');
    expect(printed).not.toContain('123-45-67');
  });
});
