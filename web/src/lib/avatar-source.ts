/**
 * Where the site may load a review author's avatar from — decided once, in the
 * server ReviewCard, before anything reaches the browser.
 *
 * `users.avatar_url` has three writers (backend): the upload into our cloud
 * (POST /auth/avatar), Google sign-in (the ID token's `picture`) and Yandex
 * sign-in (oauthService.js builds avatars.yandex.net/get-yapic/<id>/islands-200).
 * Values written before 06.10.2026 by PUT /auth/profile could be any string;
 * production holds none such (read-only census 12.10.2026), but the rule does
 * not lean on that.
 *
 * - Our cloud goes through the image optimizer, as before: it is the only host
 *   next.config.ts `remotePatterns` admits (P0 30.09.2026 — the optimizer
 *   decodes whatever it fetches). Only uploaded assets (`image/upload/`, the
 *   form the backend accepts as ours) and not `.svg`, which next/image would
 *   load past the optimizer.
 * - Sign-in provider photos load straight from the provider (`unoptimized`):
 *   the optimizer refuses those hosts, and widening `remotePatterns` to them is
 *   exactly what P0 narrowed away.
 * - Anything else is not loaded at all — the card shows the initial. Otherwise
 *   a guest's browser would fetch whatever address an author once put in their
 *   profile.
 *
 * Adding a host is a product decision (whose servers see guests' addresses):
 * avatar-source.test.ts pins the list.
 */

export type AvatarSource = {
  /** The address as parsed — what was checked is what gets loaded. */
  src: string;
  /** true — through /_next/image; false — straight from the provider. */
  optimized: boolean;
};

// Our Cloudinary account — the same one next.config.ts admits.
const OUR_CLOUD_HOSTNAME = 'res.cloudinary.com';
const OUR_CLOUD_UPLOADS = '/davrzdre8/image/upload/';

export const SIGN_IN_AVATAR_SOURCES: ReadonlyArray<{
  hostname: string;
  pathPrefix: string;
}> = [
  // Google: every `picture` seen in production is on lh3 (census 30.09, 12.10).
  { hostname: 'lh3.googleusercontent.com', pathPrefix: '/' },
  // Yandex: the only form oauthService.js writes.
  { hostname: 'avatars.yandex.net', pathPrefix: '/get-yapic/' },
];

export function avatarSource(
  avatarUrl: string | null | undefined,
): AvatarSource | null {
  if (!avatarUrl) return null;

  let url: URL;
  try {
    url = new URL(avatarUrl);
  } catch {
    return null; // relative paths (the pre-Cloudinary /uploads/…) and junk
  }
  // Exactly https://<host>: no login part, no port.
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return null;
  }

  if (url.hostname === OUR_CLOUD_HOSTNAME) {
    const optimizable =
      url.pathname.startsWith(OUR_CLOUD_UPLOADS) &&
      !url.pathname.toLowerCase().endsWith('.svg');
    return optimizable ? { src: url.href, optimized: true } : null;
  }

  const fromSignIn = SIGN_IN_AVATAR_SOURCES.some(
    ({ hostname, pathPrefix }) =>
      url.hostname === hostname && url.pathname.startsWith(pathPrefix),
  );
  return fromSignIn ? { src: url.href, optimized: false } : null;
}
