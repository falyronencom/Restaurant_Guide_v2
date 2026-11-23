/**
 * The browser's half of the cabinet's requests (lib/partner/client): what goes
 * on the wire to the Route Handlers — the hints of a save in its query, the
 * `final` of a page going away with keepalive (Phase 4.5, regular NIT 4: the
 * other tests mock this module whole).
 */
import { refreshCardPageAction, updateEstablishmentAction } from '@/lib/partner/client';

const fetchMock = jest.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ json: async () => ({ ok: true }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

it('a save names the previous city and category in its query, and `drop=0` when it sends nothing new', async () => {
  await updateEstablishmentAction('e1', { name: 'X' }, { city: 'Минск', category: 'Кафе' }, { drop: false });

  const [url, init] = fetchMock.mock.calls[0];
  const query = new URL(url, 'http://localhost').searchParams;
  expect(new URL(url, 'http://localhost').pathname).toBe('/api/partner/establishments/e1/update');
  expect(query.get('prevCity')).toBe('Минск');
  expect(query.get('prevCategory')).toBe('Кафе');
  expect(query.get('drop')).toBe('0');
  expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ name: 'X' }) });
});

it('a save with something new: no `drop` in its query', async () => {
  await updateEstablishmentAction('e1', { name: 'X' }, null);
  expect(new URL(fetchMock.mock.calls[0][0], 'http://localhost').searchParams.has('drop')).toBe(false);
});

it('`final` of a page going away: ?final=1, sent with keepalive; the timer\'s ask — neither', async () => {
  await refreshCardPageAction('e1', { final: true });
  expect(fetchMock.mock.calls[0][0]).toBe('/api/partner/establishments/e1/refresh-page?final=1');
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', keepalive: true });

  await refreshCardPageAction('e1');
  expect(fetchMock.mock.calls[1][0]).toBe('/api/partner/establishments/e1/refresh-page');
  expect(fetchMock.mock.calls[1][1]).not.toHaveProperty('keepalive');
});
