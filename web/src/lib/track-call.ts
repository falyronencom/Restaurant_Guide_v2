/*
 * «Звонки» in the partner's statistics, from the site: a visitor tapped the
 * establishment's phone number.
 *
 * Counts the tap, not a conversation — the same as the app's call button. POSTs
 * to our own /api/establishments/:id/track-call, which keeps the API's address
 * server-only and names the visitor to the API's limit.
 *
 * MUST never throw and never hold up the call: every failure path is swallowed,
 * and the link opens the dialer whatever happens here. `keepalive` lets the
 * request survive the tap taking the visitor away from the page.
 */

import 'client-only';

export function reportCallTap(establishmentId: string): void {
  try {
    void fetch(
      `/api/establishments/${encodeURIComponent(establishmentId)}/track-call`,
      { method: 'POST', keepalive: true },
    ).catch(() => {});
  } catch {
    // Counting is best-effort by design.
  }
}
