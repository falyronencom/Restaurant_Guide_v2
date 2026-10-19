/**
 * verifyEmailHref — how registration hands its returnTo to /verify-email
 * (сверка находок тестировщика с сайтом, 18.10, п. 11). RegisterForm sends the
 * new user to this address with a hard navigation (window.location.assign —
 * not interceptable under jsdom, so the form itself is not rendered here);
 * the profile's «Подтвердить» uses it with /profile.
 */
import { verifyEmailHref } from '@/lib/auth/verify-email-href';

it('home needs no returnTo', () => {
  expect(verifyEmailHref('/')).toBe('/verify-email');
});

it('carries any other place, encoded', () => {
  expect(verifyEmailHref('/cabinet/new')).toBe(
    '/verify-email?returnTo=%2Fcabinet%2Fnew',
  );
  expect(verifyEmailHref('/minsk?x=1')).toBe(
    '/verify-email?returnTo=%2Fminsk%3Fx%3D1',
  );
});
