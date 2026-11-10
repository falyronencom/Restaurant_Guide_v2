import {
  REFRESH_HEADER,
  dropEstablishmentPages,
  isServerRefresh,
} from '@/lib/revalidate/establishment-pages';

/*
 * POST /api/revalidate/establishments — the API says the cached establishment
 * pages are out of date: an account with reviews was deleted, and the pages
 * still name its author (critic 2Г, item 2.04; backend services/siteRefresh.js).
 * No body; a fresh signature under the secret the two services share proves
 * the request is the API's (lib/revalidate/establishment-pages.ts).
 *
 * Without that signature the route is not there: 404, the same as any unknown
 * address, so a guess learns nothing. Nobody but the API calls it — no
 * browser, no same-origin check.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!isServerRefresh(request.headers.get(REFRESH_HEADER))) {
    return new Response(null, { status: 404 });
  }
  dropEstablishmentPages();
  return new Response(null, { status: 204 });
}
