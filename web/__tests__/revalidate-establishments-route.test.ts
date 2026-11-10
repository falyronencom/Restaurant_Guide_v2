/**
 * @jest-environment node
 */
/*
 * POST /api/revalidate/establishments — the API tells the site that its cached
 * establishment pages still name the author of a deleted account (critic 2Г,
 * item 2.04; backend services/siteRefresh.js). Only with a fresh signature
 * under the secret the two services share: «<ms>.<hex HMAC-SHA256 of
 * "revalidate-establishments:<ms>">» in X-Site-Refresh. Otherwise — 404, as
 * any unknown address, and nothing is dropped. With it — every establishment
 * page is marked out of date (revalidatePath with the route and 'page'), 204.
 *
 * Expected values come from the brief, Next's API and the signing rule, not
 * from the code: the route of the detail page as the file system names it,
 * 'page' as revalidatePath requires for a route with dynamic segments; the
 * signatures are computed here with node:crypto, as the backend computes them.
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { createHmac } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import { POST } from '@/app/api/revalidate/establishments/route';
import { isServerRefresh } from '@/lib/revalidate/establishment-pages';

const mockRevalidatePath = revalidatePath as jest.Mock;

const SECRET = 'a'.repeat(43);
const PREVIOUS = 'b'.repeat(43);
const FIVE_MINUTES = 5 * 60 * 1000;

const sign = (secret: string, time: number): string =>
  `${time}.${createHmac('sha256', secret).update(`revalidate-establishments:${time}`).digest('hex')}`;

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/revalidate/establishments', { method: 'POST', headers });
}

const savedEnv = { ...process.env };

beforeEach(() => {
  mockRevalidatePath.mockReset();
  process.env.SITE_REQUEST_SECRET = SECRET;
  delete process.env.SITE_REQUEST_SECRET_PREVIOUS;
});

afterAll(() => {
  process.env = savedEnv;
});

it('a fresh signature under the shared secret — every establishment page is marked out of date, 204', async () => {
  const response = await POST(request({ 'X-Site-Refresh': sign(SECRET, Date.now()) }));

  expect(response.status).toBe(204);
  expect(mockRevalidatePath).toHaveBeenCalledTimes(1);
  expect(mockRevalidatePath).toHaveBeenCalledWith('/(public)/[city]/[category]/[slug]', 'page');
});

it.each([
  ['no header', {}],
  ['the raw secret instead of a signature', { 'X-Site-Refresh': SECRET }],
  ['the raw secret in the header the site sends to the API', { 'X-Site-Secret': SECRET }],
  ['a signature under another secret', { 'X-Site-Refresh': sign('c'.repeat(43), Date.now()) }],
  ['a signature of another time than it names', {
    'X-Site-Refresh': `${Date.now()}.${sign(SECRET, Date.now() - 1000).split('.')[1]}`,
  }],
  ['an empty header', { 'X-Site-Refresh': '' }],
  ['a malformed header', { 'X-Site-Refresh': 'not-a-signature' }],
])('%s — 404, nothing dropped', async (_, headers) => {
  const response = await POST(request(headers as Record<string, string>));

  expect(response.status).toBe(404);
  expect(mockRevalidatePath).not.toHaveBeenCalled();
});

it('the window is five minutes either way: inside — accepted, outside — refused', () => {
  const now = 1_800_000_000_000;
  const env = { SITE_REQUEST_SECRET: SECRET };

  expect(isServerRefresh(sign(SECRET, now - FIVE_MINUTES), env, now)).toBe(true);
  expect(isServerRefresh(sign(SECRET, now + FIVE_MINUTES), env, now)).toBe(true);
  expect(isServerRefresh(sign(SECRET, now - FIVE_MINUTES - 1), env, now)).toBe(false);
  expect(isServerRefresh(sign(SECRET, now + FIVE_MINUTES + 1), env, now)).toBe(false);
});

it('no secret configured on the site — 404 to any header', async () => {
  delete process.env.SITE_REQUEST_SECRET;

  expect((await POST(request({ 'X-Site-Refresh': sign(SECRET, Date.now()) }))).status).toBe(404);
  expect((await POST(request({ 'X-Site-Refresh': sign('', Date.now()) }))).status).toBe(404);
  expect(mockRevalidatePath).not.toHaveBeenCalled();
});

it('a configured secret shorter than 32 characters counts as none', () => {
  const now = Date.now();
  const short = 'd'.repeat(31);
  const enough = 'e'.repeat(32);

  expect(isServerRefresh(sign(short, now), { SITE_REQUEST_SECRET: short }, now)).toBe(false);
  expect(isServerRefresh(sign(enough, now), { SITE_REQUEST_SECRET: enough }, now)).toBe(true);
});

it('while the secret is being changed, a signature under the previous one is accepted too', async () => {
  process.env.SITE_REQUEST_SECRET_PREVIOUS = PREVIOUS;

  expect((await POST(request({ 'X-Site-Refresh': sign(PREVIOUS, Date.now()) }))).status).toBe(204);
  expect((await POST(request({ 'X-Site-Refresh': sign(SECRET, Date.now()) }))).status).toBe(204);
  expect(mockRevalidatePath).toHaveBeenCalledTimes(2);
});
