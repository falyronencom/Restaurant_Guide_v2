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
 * Every photo loads straight from where it lives (ReviewAvatar renders it
 * `unoptimized`): the site keeps no copy of a person's photo.
 * - Our cloud: the stored link as it is — only uploaded assets (`image/upload/`,
 *   the form the backend accepts as ours), not `.svg`. Until 09.11.2026 these
 *   went through the image optimizer, and its copy outlived the person: on
 *   production the cloud answered 404 after the account was deleted, the
 *   site's /_next/image copy 200 (Cache-Control up to 30 days). So no
 *   optimizer, and next.config.ts `remotePatterns` refuses avatars/ even when
 *   asked directly. No transformation of our own either: strict
 *   transformations are on in Cloudinary since 06.11.2026, a new form of link
 *   is refused; the uploaded avatar is already small (backend uploadAvatar).
 * - Sign-in provider photos load straight from the provider: the optimizer
 *   refuses those hosts, and widening `remotePatterns` to them is exactly what
 *   P0 30.09.2026 narrowed away.
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
};

// Our Cloudinary account.
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
    const uploaded =
      url.pathname.startsWith(OUR_CLOUD_UPLOADS) &&
      !url.pathname.toLowerCase().endsWith('.svg');
    return uploaded ? { src: url.href } : null;
  }

  const fromSignIn = SIGN_IN_AVATAR_SOURCES.some(
    ({ hostname, pathPrefix }) =>
      url.hostname === hostname && url.pathname.startsWith(pathPrefix),
  );
  return fromSignIn ? { src: url.href } : null;
}
