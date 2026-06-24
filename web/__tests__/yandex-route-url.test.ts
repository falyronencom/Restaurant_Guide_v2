/**
 * yandexRouteUrl — the «Как добраться» deep-link builder (D-2A).
 *
 * Locks the Yandex routing URL contract: destination-only route (empty origin
 * via the leading ~), driving mode (rtt=auto), the Belarus ccTLD, and — the
 * easy-to-get-wrong part — the LATITUDE-FIRST coordinate order that `rtext`
 * uses (unlike pt/ll, which are longitude-first). A wrong order would route to
 * the wrong place, so it gets its own guard.
 */
import { yandexRouteUrl } from '@/lib/establishment-helpers';

describe('yandexRouteUrl', () => {
  const LAT = 53.902284;
  const LON = 27.561831;

  it('targets the Belarus Yandex Maps domain', () => {
    expect(yandexRouteUrl(LAT, LON)).toContain('https://yandex.by/maps/');
  });

  it('routes to the point with an empty origin (leading ~), latitude first', () => {
    expect(yandexRouteUrl(LAT, LON)).toContain(`rtext=~${LAT},${LON}`);
  });

  it('selects the driving route', () => {
    expect(yandexRouteUrl(LAT, LON)).toContain('rtt=auto');
  });

  it('does NOT use the longitude-first order (rtext is the Yandex exception)', () => {
    // Guard against a copy-paste from pt/ll (lon,lat), which would route to the
    // wrong place: the lon,lat pair must not appear anywhere in the URL.
    expect(yandexRouteUrl(LAT, LON)).not.toContain(`${LON},${LAT}`);
  });
});
