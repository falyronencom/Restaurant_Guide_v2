/* eslint-env jest */
/**
 * config/panelRoles.js — panelSessionLapsed: the day without a renewal after
 * which a panel session cannot be renewed (S1 «а», 29.10.2026). Boundaries to
 * the millisecond here; the database round trip is pinned by
 * integration/panel-idle-refresh.test.js.
 */
import { PANEL_SESSION_IDLE_MS, panelSessionLapsed } from '../../config/panelRoles.js';

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const createdAgo = (ms) => new Date(NOW - ms);

describe('panelSessionLapsed', () => {
  test('the limit is one day', () => {
    expect(PANEL_SESSION_IDLE_MS).toBe(24 * 60 * 60 * 1000);
  });

  test.each(['admin', 'viewer'])('%s: exactly a day is alive, a millisecond more is not', (role) => {
    expect(panelSessionLapsed(role, createdAgo(PANEL_SESSION_IDLE_MS), NOW)).toBe(false);
    expect(panelSessionLapsed(role, createdAgo(PANEL_SESSION_IDLE_MS + 1), NOW)).toBe(true);
  });

  test.each(['user', 'partner'])('%s never lapses here — 29 days old included', (role) => {
    expect(panelSessionLapsed(role, createdAgo(PANEL_SESSION_IDLE_MS + 1), NOW)).toBe(false);
    expect(panelSessionLapsed(role, createdAgo(29 * PANEL_SESSION_IDLE_MS), NOW)).toBe(false);
  });

  test('a panel row without created_at counts as lapsed; another role\'s does not', () => {
    expect(panelSessionLapsed('admin', null, NOW)).toBe(true);
    expect(panelSessionLapsed('user', null, NOW)).toBe(false);
  });

  test('reads a node-pg Date as well as a string', () => {
    const created = createdAgo(PANEL_SESSION_IDLE_MS + 1);
    expect(panelSessionLapsed('viewer', created.toISOString(), NOW)).toBe(true);
  });
});
