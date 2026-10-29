/* eslint-env jest */
/**
 * The access token lifetimes read from JWT_ACCESS_EXPIRY (config/accessToken.js):
 * the panel's accounts at most an hour, every other role the variable as
 * before, and a warning from one day on (Coordinator 29.10.2026, after PR #155).
 * Through the HTTP doors — integration/panel-access-lifetime.test.js; the
 * startup line itself — unit/access-expiry-startup.test.js.
 */
import {
  ACCESS_EXPIRY_WARNING_SECONDS,
  PANEL_ACCESS_TOKEN_MAX_SECONDS,
  accessExpirySeconds,
  accessTokenLifetimeSeconds,
  resolveAccessTokenLifetime,
} from '../../config/accessToken.js';

const resolve = (value) => resolveAccessTokenLifetime({ JWT_ACCESS_EXPIRY: value });

describe('resolveAccessTokenLifetime', () => {
  test('without the variable: 4 h for the other roles, 1 h for the panel, no warning', () => {
    [undefined, '', '  '].forEach((value) => {
      expect(resolve(value)).toEqual({
        expiresIn: '4h', seconds: 14400, panelSeconds: 3600, warning: null,
      });
    });
    expect(resolveAccessTokenLifetime()).toMatchObject({ seconds: 14400, panelSeconds: 3600 });
  });

  test('the other roles are signed with the variable\'s own string, as before', () => {
    expect(resolve('4h').expiresIn).toBe('4h');
    expect(resolve('90m')).toMatchObject({ expiresIn: '90m', seconds: 5400 });
  });

  test('the panel never outlives the variable: 59 / 60 / 61 min give 59 / 60 / 60 min', () => {
    expect(PANEL_ACCESS_TOKEN_MAX_SECONDS).toBe(3600);
    expect(resolve('59m').panelSeconds).toBe(3540);
    expect(resolve('60m').panelSeconds).toBe(3600);
    expect(resolve('61m').panelSeconds).toBe(3600);
    expect(resolve('30d').panelSeconds).toBe(3600);
  });

  test('a day or more warns, a second less does not — 86399 s / 86400 s', () => {
    expect(ACCESS_EXPIRY_WARNING_SECONDS).toBe(86400);
    expect(resolve('86399s').warning).toBeNull();
    expect(resolve('23h').warning).toBeNull();
    expect(resolve('4h').warning).toBeNull();
    ['86400s', '24h', '1d', '7d'].forEach((value) => {
      const { warning, seconds } = resolve(value);
      expect(warning).toMatch(/a day or more/);
      expect(warning).toContain(`${seconds} s`);
    });
  });

  test('zero or less warns — every token born expired; one second does not', () => {
    expect(resolve('1s').warning).toBeNull();
    ['0s', '0', '-1h'].forEach((value) => {
      const { warning, seconds, panelSeconds } = resolve(value);
      expect(seconds).toBeLessThanOrEqual(0);
      // Never longer than the variable: the panel is expired too.
      expect(panelSeconds).toBe(seconds);
      expect(warning).toMatch(/expired when issued/);
    });
  });

  test('a value jsonwebtoken refuses warns and leaves the panel at its hour', () => {
    const resolved = resolve('four hours');
    expect(resolved).toMatchObject({ seconds: null, panelSeconds: 3600 });
    expect(resolved.warning).toMatch(/not a timespan/);
    expect(resolved.warning).not.toContain('four hours');
  });
});

describe('accessExpirySeconds — the unit is jsonwebtoken\'s', () => {
  test('a timespan string, and a bare number of the env is milliseconds', () => {
    expect(accessExpirySeconds('4h')).toBe(14400);
    expect(accessExpirySeconds('1d')).toBe(86400);
    // '86400' in the env is 86.4 s to jsonwebtoken, not a day: no warning.
    expect(accessExpirySeconds('86400')).toBe(86);
    expect(resolve('86400').warning).toBeNull();
    expect(accessExpirySeconds('nonsense')).toBeNull();
  });
});

describe('accessTokenLifetimeSeconds — by role (this process: .env.test, 4h)', () => {
  test('admin and viewer: 1 h; user and partner: 4 h', () => {
    expect(accessTokenLifetimeSeconds('admin')).toBe(3600);
    expect(accessTokenLifetimeSeconds('viewer')).toBe(3600);
    expect(accessTokenLifetimeSeconds('user')).toBe(14400);
    expect(accessTokenLifetimeSeconds('partner')).toBe(14400);
  });
});
