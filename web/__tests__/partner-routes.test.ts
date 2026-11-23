/**
 * @jest-environment node
 */
/*
 * Partner cabinet Route Handlers (CAT-C-3.14). Verifies the transport layer:
 * the same-origin guard runs first (cross-origin → 403, operation untouched),
 * the JSON body + [id] param are forwarded to the (mocked) operation, and the
 * operation's {ok,…} envelope is returned verbatim. Node env: the guard's 403 is
 * a real global Response. NextResponse.json is stubbed (it does not load here);
 * operations are mocked so no backend is reached.
 */
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/partner/operations', () => ({
  loadEstablishments: jest.fn(),
  createEstablishmentAction: jest.fn(),
  updateEstablishmentAction: jest.fn(),
  submitEstablishmentAction: jest.fn(),
  loadEstablishmentForEdit: jest.fn(),
  retryOcrAction: jest.fn(),
  deleteEstablishmentAction: jest.fn(),
  resumeEstablishmentAction: jest.fn(),
  suspendEstablishmentAction: jest.fn(),
  loadMenuItemsAction: jest.fn(),
  updateMenuItemAction: jest.fn(),
  refreshCardPageAction: jest.fn(),
}));
jest.mock('@/lib/partner/media-proxy', () => ({
  proxyMediaUpload: jest.fn(),
}));

import { POST as createPost } from '@/app/api/partner/establishments/create/route';
import { POST as deletePost } from '@/app/api/partner/establishments/[id]/delete/route';
import { POST as listPost } from '@/app/api/partner/establishments/list/route';
import { POST as loadPost } from '@/app/api/partner/establishments/[id]/load/route';
import { POST as mediaAttachPost } from '@/app/api/partner/establishments/[id]/media/route';
import { POST as resumePost } from '@/app/api/partner/establishments/[id]/resume/route';
import { POST as retryPost } from '@/app/api/partner/establishments/[id]/retry-ocr/route';
import { POST as submitPost } from '@/app/api/partner/establishments/[id]/submit/route';
import { POST as updatePost } from '@/app/api/partner/establishments/[id]/update/route';
import { POST as menuItemsPost } from '@/app/api/partner/establishments/[id]/menu-items/route';
import { POST as suspendPost } from '@/app/api/partner/establishments/[id]/suspend/route';
import { POST as refreshPagePost } from '@/app/api/partner/establishments/[id]/refresh-page/route';
import { POST as menuItemUpdatePost } from '@/app/api/partner/menu-items/[itemId]/update/route';
import { POST as mediaTempPost } from '@/app/api/partner/media/route';
import { proxyMediaUpload } from '@/lib/partner/media-proxy';
import {
  createEstablishmentAction,
  deleteEstablishmentAction,
  loadEstablishmentForEdit,
  loadEstablishments,
  loadMenuItemsAction,
  refreshCardPageAction,
  resumeEstablishmentAction,
  retryOcrAction,
  submitEstablishmentAction,
  suspendEstablishmentAction,
  updateEstablishmentAction,
  updateMenuItemAction,
} from '@/lib/partner/operations';

const SAME = { origin: 'http://localhost:3000', host: 'localhost:3000' };
const CROSS = { origin: 'http://evil.example', host: 'localhost:3000' };

function makeRequest(headers: Record<string, string>, body?: unknown, url?: string): Request {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
    text: async () => {
      if (body === undefined) throw new Error('no body');
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
    body: null,
    ...(url ? { url } : {}),
  } as unknown as Request;
}

/** Same origin, with the session's cookies (the menu line's edit wants them before its body). */
const SIGNED = { ...SAME, cookie: 'rg_at=access-token; rg_rt=refresh-token' };

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const itemCtx = (itemId: string) => ({ params: Promise.resolve({ itemId }) });

beforeEach(() => jest.clearAllMocks());

/*
 * Guard coverage is exhaustive by construction (2026-09-08, honesty-audit
 * finding 4 closed): every partner Route Handler that exists has a cross-origin
 * case below — list, update, delete, create, submit, load, retry-ocr,
 * resume, media-temp and media-attach, and from part 1 of «Кабинет партнёра на
 * сайте» (23.11.2026) menu-items, the menu item's update, suspend and
 * refresh-page — fourteen of fourteen. Each case is proved able to fail:
 * replacing `assertSameOrigin(request)` with `null` in one route file turns
 * exactly that route's case red and leaves the rest green. A fifteenth handler
 * added without its own case here breaks that property silently — the describe
 * would again cover less than its title claims.
 */

describe('same-origin guard on the partner handlers', () => {
  it('blocks a cross-origin list POST with 403 before the operation runs', async () => {
    const res = await listPost(makeRequest(CROSS));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: 'CSRF' });
    expect(loadEstablishments).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin [id] update POST before reading params/body', async () => {
    const res = await updatePost(makeRequest(CROSS, { name: 'X' }), ctx('e9'));
    expect(res.status).toBe(403);
    expect(updateEstablishmentAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin delete POST (destructive — guard must hold)', async () => {
    const res = await deletePost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(deleteEstablishmentAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin create POST before the body is parsed', async () => {
    const res = await createPost(makeRequest(CROSS, { name: 'X' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: 'CSRF' });
    expect(createEstablishmentAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin submit POST (moderation write — guard must hold)', async () => {
    const res = await submitPost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(submitEstablishmentAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin load POST (authed read — may rotate the cookie)', async () => {
    const res = await loadPost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(loadEstablishmentForEdit).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin retry-ocr POST', async () => {
    const res = await retryPost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(retryOcrAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin resume POST (status write — guard must hold)', async () => {
    const res = await resumePost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(resumeEstablishmentAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin menu-items POST (authed read — may rotate the cookie)', async () => {
    const res = await menuItemsPost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(loadMenuItemsAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin menu item update POST before the body is read', async () => {
    const res = await menuItemUpdatePost(makeRequest(CROSS, { price_byn: 1 }), itemCtx('i9'));
    expect(res.status).toBe(403);
    expect(updateMenuItemAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin suspend POST (status write — guard must hold)', async () => {
    const res = await suspendPost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(suspendEstablishmentAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin refresh-page POST', async () => {
    const res = await refreshPagePost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(refreshCardPageAction).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin temp media upload with 403 (OSB-P4 parity)', async () => {
    const res = await mediaTempPost(makeRequest(CROSS));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: 'CSRF' });
    expect(proxyMediaUpload).not.toHaveBeenCalled();
  });

  it('blocks a cross-origin establishment media upload with 403 (OSB-P4 parity)', async () => {
    const res = await mediaAttachPost(makeRequest(CROSS), ctx('e9'));
    expect(res.status).toBe(403);
    expect(proxyMediaUpload).not.toHaveBeenCalled();
  });

  it('passes a same-origin media upload through to the proxy with the right paths', async () => {
    (proxyMediaUpload as jest.Mock).mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const tempReq = makeRequest(SAME);
    await mediaTempPost(tempReq);
    expect(proxyMediaUpload).toHaveBeenCalledWith(
      tempReq,
      '/api/v1/partner/media/upload',
    );

    const attachReq = makeRequest(SAME);
    await mediaAttachPost(attachReq, ctx('e9'));
    expect(proxyMediaUpload).toHaveBeenCalledWith(
      attachReq,
      '/api/v1/partner/establishments/e9/media',
    );
  });
});

describe('happy path — handlers forward to operations and return the envelope', () => {
  it('list returns the loadEstablishments envelope', async () => {
    (loadEstablishments as jest.Mock).mockResolvedValue({
      ok: true,
      establishments: [],
    });
    const res = await listPost(makeRequest(SAME));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, establishments: [] });
    expect(loadEstablishments).toHaveBeenCalledTimes(1);
  });

  it('resume forwards the [id] param and returns the envelope', async () => {
    (resumeEstablishmentAction as jest.Mock).mockResolvedValue({ ok: true, status: 'active' });
    const res = await resumePost(makeRequest(SAME), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true, status: 'active' });
    expect(resumeEstablishmentAction).toHaveBeenCalledWith('e9');
  });

  it('create parses the JSON body and forwards it', async () => {
    (createEstablishmentAction as jest.Mock).mockResolvedValue({
      ok: true,
      id: 'e1',
      user: null,
    });
    const payload = { name: 'Кафе' };
    const res = await createPost(makeRequest(SAME, payload));
    expect(await res.json()).toEqual({ ok: true, id: 'e1', user: null });
    expect(createEstablishmentAction).toHaveBeenCalledWith(payload);
  });

  it('create returns 400 on a malformed body without calling the operation', async () => {
    const res = await createPost(makeRequest(SAME)); // no body → json() throws
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: 'BAD_REQUEST' });
    expect(createEstablishmentAction).not.toHaveBeenCalled();
  });

  it('update forwards the [id] param and the body', async () => {
    (updateEstablishmentAction as jest.Mock).mockResolvedValue({
      ok: true,
      status: 'draft',
    });
    const payload = { name: 'X' };
    const res = await updatePost(makeRequest(SAME, payload), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true, status: 'draft' });
    expect(updateEstablishmentAction).toHaveBeenCalledWith('e9', payload, null, { drop: true });
  });

  it('submit forwards the [id] param', async () => {
    (submitEstablishmentAction as jest.Mock).mockResolvedValue({
      ok: true,
      status: 'pending',
    });
    const res = await submitPost(makeRequest(SAME), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true, status: 'pending' });
    expect(submitEstablishmentAction).toHaveBeenCalledWith('e9');
  });

  it('load forwards the [id] param', async () => {
    (loadEstablishmentForEdit as jest.Mock).mockResolvedValue({
      ok: true,
      establishment: { id: 'e9' },
    });
    const res = await loadPost(makeRequest(SAME), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true, establishment: { id: 'e9' } });
    expect(loadEstablishmentForEdit).toHaveBeenCalledWith('e9');
  });

  it('retry-ocr forwards the [id] param', async () => {
    (retryOcrAction as jest.Mock).mockResolvedValue({ ok: true });
    const res = await retryPost(makeRequest(SAME), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true });
    expect(retryOcrAction).toHaveBeenCalledWith('e9');
  });

  it('delete forwards the [id] param', async () => {
    (deleteEstablishmentAction as jest.Mock).mockResolvedValue({ ok: true });
    const res = await deletePost(makeRequest(SAME), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteEstablishmentAction).toHaveBeenCalledWith('e9');
  });

  it('update passes the previous city and category of the query on', async () => {
    (updateEstablishmentAction as jest.Mock).mockResolvedValue({ ok: true, status: 'active' });
    const payload = { name: 'X' };
    const url = `http://localhost:3000/api/partner/establishments/e9/update?prevCity=${encodeURIComponent('Минск')}&prevCategory=${encodeURIComponent('Кафе')}`;
    await updatePost(makeRequest(SAME, payload, url), ctx('e9'));
    expect(updateEstablishmentAction).toHaveBeenCalledWith('e9', payload, { city: 'Минск', category: 'Кафе' }, { drop: true });
  });

  it('update with drop=0 (the form sent nothing new) passes «no drop» on; any other value drops', async () => {
    (updateEstablishmentAction as jest.Mock).mockResolvedValue({ ok: true, status: 'active' });
    const payload = { name: 'X' };
    await updatePost(makeRequest(SAME, payload, 'http://localhost:3000/api/partner/establishments/e9/update?drop=0'), ctx('e9'));
    expect(updateEstablishmentAction).toHaveBeenLastCalledWith('e9', payload, null, { drop: false });
    await updatePost(makeRequest(SAME, payload, 'http://localhost:3000/api/partner/establishments/e9/update?drop=no'), ctx('e9'));
    expect(updateEstablishmentAction).toHaveBeenLastCalledWith('e9', payload, null, { drop: true });
  });

  it('menu-items forwards the [id] param', async () => {
    (loadMenuItemsAction as jest.Mock).mockResolvedValue({ ok: true, menu: { items: [] } });
    const res = await menuItemsPost(makeRequest(SAME), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true, menu: { items: [] } });
    expect(loadMenuItemsAction).toHaveBeenCalledWith('e9');
  });

  it('suspend forwards the [id] param', async () => {
    (suspendEstablishmentAction as jest.Mock).mockResolvedValue({ ok: true, status: 'suspended' });
    const res = await suspendPost(makeRequest(SAME), ctx('e9'));
    expect(await res.json()).toEqual({ ok: true, status: 'suspended' });
    expect(suspendEstablishmentAction).toHaveBeenCalledWith('e9');
  });

  it('refresh-page: `final` only from ?final=1', async () => {
    (refreshCardPageAction as jest.Mock).mockResolvedValue({ ok: true, page: { refreshed: true } });
    await refreshPagePost(makeRequest(SAME), ctx('e9'));
    expect(refreshCardPageAction).toHaveBeenLastCalledWith('e9', { final: false });
    await refreshPagePost(
      makeRequest(SAME, undefined, 'http://localhost:3000/api/partner/establishments/e9/refresh-page?final=1'),
      ctx('e9'),
    );
    expect(refreshCardPageAction).toHaveBeenLastCalledWith('e9', { final: true });
  });

  it('a menu item update forwards only the three fields a partner may change, each of its type', async () => {
    (updateMenuItemAction as jest.Mock).mockResolvedValue({ ok: true });
    await menuItemUpdatePost(
      makeRequest(SIGNED, {
        item_name: 'Суп',
        price_byn: null,
        category_raw: '',
        is_hidden_by_admin: false,
        sanity_flag: null,
        establishment_id: 'other',
      }),
      itemCtx('i9'),
    );
    expect(updateMenuItemAction).toHaveBeenCalledWith('i9', { item_name: 'Суп', price_byn: null, category_raw: '' });

    await menuItemUpdatePost(makeRequest(SIGNED, { price_byn: '12', item_name: 5, category_raw: 7 }), itemCtx('i9'));
    expect(updateMenuItemAction).toHaveBeenLastCalledWith('i9', {});
  });

  it('a menu item update with a body that is not an object → 400, nothing sent', async () => {
    const res = await menuItemUpdatePost(makeRequest(SIGNED, ['x']), itemCtx('i9'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: 'BAD_REQUEST' });
    expect(updateMenuItemAction).not.toHaveBeenCalled();
  });

  describe('a menu line\'s edit, before and around its body (Phase 4.5, P2 3 and P3 5)', () => {
    /** A request whose body records whether it was read. */
    function watched(headers: Record<string, string>, text: string) {
      const read = jest.fn(async () => text);
      const request = {
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
        json: jest.fn(async () => JSON.parse(text)),
        text: read,
        body: null,
      } as unknown as Request;
      return { request, read };
    }

    it('without a session cookie: 401 NO_SESSION, the body not read, nothing sent', async () => {
      for (const cookie of [undefined, 'other=1', 'rg_at=; rg_rt=', 'xrg_at=token']) {
        const { request, read } = watched(cookie ? { ...SAME, cookie } : SAME, JSON.stringify({ price_byn: 14 }));
        const res = await menuItemUpdatePost(request, itemCtx('i9'));
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ ok: false, code: 'NO_SESSION' });
        expect(read).not.toHaveBeenCalled();
      }
      expect(updateMenuItemAction).not.toHaveBeenCalled();
    });

    it('a refresh cookie alone is a session: the body is read and sent', async () => {
      (updateMenuItemAction as jest.Mock).mockResolvedValue({ ok: true });
      const { request } = watched({ ...SAME, cookie: 'rg_rt=refresh-token' }, JSON.stringify({ price_byn: 14 }));
      await menuItemUpdatePost(request, itemCtx('i9'));
      expect(updateMenuItemAction).toHaveBeenCalledWith('i9', { price_byn: 14 });
    });

    it('a Content-Length over 16 KB: 413, the body not read', async () => {
      const { request, read } = watched({ ...SIGNED, 'content-length': String(16 * 1024 + 1) }, '{}');
      const res = await menuItemUpdatePost(request, itemCtx('i9'));
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ ok: false, code: 'PAYLOAD_TOO_LARGE' });
      expect(read).not.toHaveBeenCalled();
      expect(updateMenuItemAction).not.toHaveBeenCalled();
    });

    it('a body sent without a length is read no further than 16 KB: 413; at 16 KB it is read', async () => {
      const over = `{"item_name":"${'я'.repeat(9000)}"}`; // 18 000+ bytes of UTF-8
      const stream = new Response(over).body;
      let pulled = 0;
      const counting = stream!.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            pulled += chunk.byteLength;
            controller.enqueue(chunk);
          },
        }),
      );
      const request = {
        headers: { get: (k: string) => (SIGNED as Record<string, string>)[k.toLowerCase()] ?? null },
        body: counting,
        text: jest.fn(),
      } as unknown as Request;
      const res = await menuItemUpdatePost(request, itemCtx('i9'));
      expect(res.status).toBe(413);
      expect(updateMenuItemAction).not.toHaveBeenCalled();

      (updateMenuItemAction as jest.Mock).mockResolvedValue({ ok: true });
      const fits = JSON.stringify({ category_raw: 'Супы' });
      const ok = {
        headers: { get: (k: string) => (SIGNED as Record<string, string>)[k.toLowerCase()] ?? null },
        body: new Response(fits).body,
        text: jest.fn(),
      } as unknown as Request;
      await menuItemUpdatePost(ok, itemCtx('i9'));
      expect(updateMenuItemAction).toHaveBeenCalledWith('i9', { category_raw: 'Супы' });
      expect(pulled).toBeGreaterThan(0);
    });

    it.each([
      ['a name of 256 characters', { item_name: 'ж'.repeat(256) }],
      ['a name of spaces only', { item_name: '   ' }],
      ['a price below zero', { price_byn: -1 }],
      ['a price with three decimals', { price_byn: 12.345 }],
      ['a price over 99 999 999,99', { price_byn: 100_000_000 }],
      ['a price written in exponent form', { price_byn: 1e21 }],
      ['a section of 101 characters', { category_raw: 'ж'.repeat(101) }],
    ])('%s → 400, nothing sent (the editor\'s own checks, in the route)', async (_label, body) => {
      const res = await menuItemUpdatePost(makeRequest(SIGNED, body), itemCtx('i9'));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, code: 'BAD_REQUEST' });
      expect(updateMenuItemAction).not.toHaveBeenCalled();
    });

    it('within the checks: sent as the editor sends — edges trimmed, 255 and 100 characters, a price of two decimals', async () => {
      (updateMenuItemAction as jest.Mock).mockResolvedValue({ ok: true });
      await menuItemUpdatePost(
        makeRequest(SIGNED, { item_name: `  ${'ж'.repeat(255)}  `, price_byn: 99_999_999.99, category_raw: ` ${'с'.repeat(100)} ` }),
        itemCtx('i9'),
      );
      expect(updateMenuItemAction).toHaveBeenCalledWith('i9', {
        item_name: 'ж'.repeat(255),
        price_byn: 99_999_999.99,
        category_raw: 'с'.repeat(100),
      });
    });
  });
});
