import { serverFetch } from '@/lib/api/client';
import { visitorAddressFrom } from '@/lib/api/visitor';
import { assertSameOrigin } from '@/lib/partner/same-origin';

/*
 * A visitor of the site tapped an establishment's phone number: the site's half
 * of the partner's «Звонки» (lib/track-call.ts is the browser's half).
 *
 * Goes through here, not from the browser to the API, because API_URL is
 * server-only (lib/api/client.ts). The visitor's address is passed on so the
 * API's limit on these counters counts this visitor, not the whole site as one.
 *
 * The same-origin guard keeps another site's page from driving the counter with
 * its visitors' browsers. Nobody waits for the answer: it exists for the network
 * panel and the tests.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const { id } = await params;
  // A malformed id would only cost the API a request and a line in its log.
  if (!UUID.test(id)) return new Response(null, { status: 400 });

  try {
    await serverFetch(
      `/api/v1/establishments/${id}/track-call`,
      { method: 'POST' },
      { visitor: visitorAddressFrom(request.headers) },
    );
  } catch {
    return new Response(null, { status: 502 });
  }
  return new Response(null, { status: 204 });
}
