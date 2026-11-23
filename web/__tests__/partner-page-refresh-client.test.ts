/**
 * The deferred drop of a card's public page, kept by the cabinet's browser
 * (lib/partner/page-refresh-client.ts; part 1 of «Кабинет партнёра на
 * сайте»): a write inside the card's interval answers «retry in N ms», and
 * the browser asks refresh-page then — one timer per card, the earliest
 * wins; still too early → once more; the page going away with a drop waiting
 * → sent at once as `final`.
 */
jest.mock('@/lib/partner/client', () => ({ refreshCardPageAction: jest.fn() }));

import { refreshCardPageAction } from '@/lib/partner/client';
import {
  _resetForTests,
  followPageRefresh,
  scheduleCardPageRefresh,
} from '@/lib/partner/page-refresh-client';

const refreshMock = refreshCardPageAction as jest.Mock;

async function advance(ms: number) {
  jest.advanceTimersByTime(ms);
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  refreshMock.mockReset();
  refreshMock.mockResolvedValue({ ok: true, page: { refreshed: true } });
  _resetForTests();
});

afterEach(() => {
  _resetForTests();
  jest.useRealTimers();
});

it('a deferred drop asks refresh-page after its term (and a margin), once', async () => {
  followPageRefresh('e1', { refreshed: false, retryInMs: 10_000 });

  await advance(10_000);
  expect(refreshMock).not.toHaveBeenCalled();
  await advance(600);
  expect(refreshMock).toHaveBeenCalledTimes(1);
  expect(refreshMock).toHaveBeenCalledWith('e1');

  await advance(60_000);
  expect(refreshMock).toHaveBeenCalledTimes(1);
});

it('a done or refused drop needs no timer', async () => {
  followPageRefresh('e1', { refreshed: true });
  followPageRefresh('e1', { refreshed: false });
  followPageRefresh('e1', undefined);
  await advance(120_000);
  expect(refreshMock).not.toHaveBeenCalled();
});

it('one timer per card: the earliest wins, later writes ride on it', async () => {
  scheduleCardPageRefresh('e1', 5_000);
  scheduleCardPageRefresh('e1', 20_000);
  scheduleCardPageRefresh('e2', 1_000);

  await advance(6_000);
  expect(refreshMock.mock.calls.map((c) => c[0]).sort()).toEqual(['e1', 'e2']);
  await advance(30_000);
  expect(refreshMock).toHaveBeenCalledTimes(2);
});

it('still inside the interval when it fires: asks once more after the new term', async () => {
  refreshMock
    .mockResolvedValueOnce({ ok: true, page: { refreshed: false, retryInMs: 4_000 } })
    .mockResolvedValueOnce({ ok: true, page: { refreshed: true } });
  scheduleCardPageRefresh('e1', 1_000);

  await advance(1_600);
  expect(refreshMock).toHaveBeenCalledTimes(1);
  await advance(4_600);
  expect(refreshMock).toHaveBeenCalledTimes(2);
});

it('the page going away with a drop waiting: sent at once as final, and not again later', async () => {
  scheduleCardPageRefresh('e1', 20_000);

  window.dispatchEvent(new Event('pagehide'));
  expect(refreshMock).toHaveBeenCalledWith('e1', { final: true });

  await advance(30_000);
  expect(refreshMock).toHaveBeenCalledTimes(1);
});

it('nothing waiting: leaving sends nothing', () => {
  window.dispatchEvent(new Event('pagehide'));
  expect(refreshMock).not.toHaveBeenCalled();
});
