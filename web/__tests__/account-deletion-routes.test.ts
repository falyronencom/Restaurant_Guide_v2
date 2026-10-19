/**
 * @jest-environment node
 */
/*
 * Account deletion Route Handlers (brief В1, 18.10.2026) — transport on the
 * cabinet pattern (mirrors account-routes.test): the same-origin guard runs
 * first (cross-origin → 403, operation untouched); the delete handler sends
 * nothing to the backend without the word УДАЛИТЬ, and the word on as typed;
 * the operation's {ok,…} envelope returns verbatim.
 */
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/account/operations', () => ({
  checkAccountDeletion: jest.fn(),
  deleteAccount: jest.fn(),
}));

import { POST as checkPost } from '@/app/api/account/deletion/check/route';
import { POST as deletePost } from '@/app/api/account/delete/route';
import { checkAccountDeletion, deleteAccount } from '@/lib/account/operations';

const mockCheck = checkAccountDeletion as jest.Mock;
const mockDelete = deleteAccount as jest.Mock;

const SAME = { origin: 'http://localhost:3000', host: 'localhost:3000' };
const CROSS = { origin: 'http://evil.example', host: 'localhost:3000' };

function makeRequest(headers: Record<string, string>, body?: unknown): Request {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  } as unknown as Request;
}

beforeEach(() => jest.clearAllMocks());

describe('POST /api/account/deletion/check', () => {
  it('blocks a cross-origin request with 403 and asks nothing', async () => {
    const res = await checkPost(makeRequest(CROSS));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: 'CSRF' });
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('returns the operation envelope verbatim', async () => {
    mockCheck.mockResolvedValue({ ok: true, allowed: true, refusal: null });
    const res = await checkPost(makeRequest(SAME));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, allowed: true, refusal: null });
  });
});

describe('POST /api/account/delete', () => {
  it('blocks a cross-origin request with 403 and deletes nothing', async () => {
    const res = await deletePost(makeRequest(CROSS, { confirmation: 'УДАЛИТЬ' }));
    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it.each([
    ['no body', undefined],
    ['no word', {}],
    ['another word', { confirmation: 'удали' }],
    ['the word as a list', { confirmation: ['УДАЛИТЬ'] }],
  ])('%s — 400 CONFIRMATION_REQUIRED, nothing reaches the backend', async (_, body) => {
    const res = await deletePost(makeRequest(SAME, body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: 'CONFIRMATION_REQUIRED' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('the word in any case, with spaces around — the operation runs once, with the word as typed', async () => {
    mockDelete.mockResolvedValue({ ok: true });
    const res = await deletePost(makeRequest(SAME, { confirmation: '  удалить ' }));
    expect(await res.json()).toEqual({ ok: true });
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('  удалить ');
  });
});
