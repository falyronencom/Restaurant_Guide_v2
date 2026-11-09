import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { revalidatePath } from 'next/cache';

/*
 * The cached establishment pages, and who may drop them (critic 2Г, item 2.04;
 * 10.11.2026).
 *
 * The detail page `/{city}/{category}/{slug}` is ISR: kept for an hour
 * (`revalidate = 3600`), a quiet card longer — rebuilt on the first visit
 * after the hour, and that visit still gets the old page. Its reviews name
 * their authors as the API read them then, so after a person deleted the
 * account the page kept the real name. The API tells the site of a deletion
 * (backend services/siteRefresh.js → POST /api/revalidate/establishments):
 * every establishment page is marked out of date, and the next visit to each
 * builds it afresh.
 *
 * revalidatePath with the route and 'page' marks every page of the route at
 * once; nothing is rebuilt until a page is visited (Next 16, revalidatePath:
 * «The invalidation only happens when the path is next visited»), and the
 * mark is an expiry, not a stale-while-revalidate — the visit gets the new
 * page (checked on `next start`, 10.11.2026: MISS and «Гость» on the first
 * visit after the call). The /reviews list is force-dynamic and needs nothing.
 *
 * The API's request is proven its own by the secret the two services share —
 * SITE_REQUEST_SECRET, the one the site sends to the API with its own requests
 * (lib/api/visitor.ts). The secret itself does not travel here: the header
 * carries a time and an HMAC-SHA256 of «revalidate-establishments:<time>»
 * under the secret (backend signSiteRefresh), accepted within five minutes of
 * this clock either way, compared with timingSafeEqual under every configured
 * value — the previous one too, while it is being changed.
 */

/** The establishment page's route — every card's detail page. */
export const ESTABLISHMENT_PAGE_ROUTE = '/(public)/[city]/[category]/[slug]';

/** The header of the API's signed request: `<milliseconds>.<hex HMAC>`. */
export const REFRESH_HEADER = 'x-site-refresh';

/** What the signature covers besides the time — the backend signs the same. */
const PURPOSE = 'revalidate-establishments';

/** How far the signed time may stray from this clock, either way. */
export const REFRESH_WINDOW_MS = 5 * 60 * 1000;

/** A shorter configured secret counts as none (siteVisitor.js MIN_SECRET_LENGTH). */
const MIN_SECRET_LENGTH = 32;

const SIGNED = /^(\d{1,15})\.([0-9a-f]{64})$/;

type Env = Record<string, string | undefined>;

/** Whether the header is the API's signature, fresh, under a secret the site holds. */
export function isServerRefresh(
  header: string | null,
  env: Env = process.env,
  now: number = Date.now(),
): boolean {
  const secrets = [env.SITE_REQUEST_SECRET, env.SITE_REQUEST_SECRET_PREVIOUS]
    .filter((value): value is string => typeof value === 'string' && value.length >= MIN_SECRET_LENGTH);
  const signed = header ? SIGNED.exec(header) : null;
  if (secrets.length === 0 || !signed) return false;
  const [, time, signature] = signed;
  if (Math.abs(now - Number(time)) > REFRESH_WINDOW_MS) return false;
  const presented = Buffer.from(signature, 'hex');
  let matched = false;
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(`${PURPOSE}:${time}`).digest();
    matched = timingSafeEqual(presented, expected) || matched;
  }
  return matched;
}

/** Mark every establishment page out of date: the next visit builds it afresh. */
export function dropEstablishmentPages(): void {
  revalidatePath(ESTABLISHMENT_PAGE_ROUTE, 'page');
}
