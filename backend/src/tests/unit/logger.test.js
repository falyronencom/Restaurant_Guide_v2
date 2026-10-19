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
});
