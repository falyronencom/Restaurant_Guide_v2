/**
 * guardReturnTo — where a returnTo LEADS, not what it starts with.
 *
 * Every way back after sign-in (the server redirect after Yandex, including
 * its cancel and failure branches; AuthRedirect's router.replace after
 * e-mail, Google, or an already signed-in visit to /login and /register)
 * takes the value only through this guard. So the property pinned here is
 * the one the consumers rely on: whatever the guard returns, resolved from
 * one of our pages, stays on our site.
 *
 * The fixture holds both sides — the ways back the site builds itself, which
 * must survive unchanged, and values that resolve somewhere else, which must
 * collapse to '/'. A guard that returned '/' for everything would fail the
 * first half; one that let everything through would fail the second.
 */
import { guardReturnTo } from '@/lib/auth/yandex';

const SITE = 'https://site.example';
// Consumers resolve the value from the page the visitor is on.
const FROM_PAGES = [`${SITE}/login?returnTo=x`, `${SITE}/auth/yandex/callback?code=c&state=s`];

function staysOnSite(value: string): boolean {
  return FROM_PAGES.every((page) => {
    let resolved: URL;
    try {
      resolved = new URL(value, page);
    } catch {
      return false;
    }
    return resolved.origin === SITE;
  });
}

// Ways back the site builds itself (constants in layouts, header, footer, CTAs;
// the header's «Войти» carries the current pathname, URL-encoded by the
// browser), plus the shapes a way back may take — a query, a fragment, a
// nested returnTo. Each must come back exactly as given.
const LEGIT = [
  '/',
  '/cabinet',
  '/cabinet/new',
  '/favorites',
  '/profile',
  '/verify-email',
  '/minsk',
  '/minsk/restorany/kafe-1',
  '/minsk/restorany/kafe-1#reviews',
  '/minsk/restorany/kafe-1/reviews',
  '/minsk?category=kafe&sort=rating',
  '/verify-email?returnTo=%2Fcabinet%2Fnew',
  '/%D0%BC%D0%B8%D0%BD%D1%81%D0%BA',
];

// Values that do not stay on the site, by class. Each must collapse to '/'.
// The third field: does the value leave the site when handed on raw?
const OFF_SITE: Array<[string, string, boolean]> = [
  ['protocol-relative', '//evil.example', true],
  // Refused, not trimmed to its path: '/minsk' here would be a guess.
  ['protocol-relative with a path', '//evil.example/minsk', true],
  ['backslash after the slash', '/\\evil.example', true],
  ['backslash then slash', '/\\/evil.example', true],
  ['absolute https', 'https://evil.example', true],
  ['absolute http', 'http://evil.example', true],
  ['scheme only', 'javascript:alert(1)', true],
  // Raw, it stays on the site; refused by form.
  ['no leading slash', 'evil.example', false],
  ['tab after the slash', '/\t/evil.example', true],
  ['line feed after the slash', '/\n/evil.example', true],
  ['carriage return after the slash', '/\r/evil.example', true],
  ['tab and line feed together', '/\t\n/evil.example', true],
  ['leading space', ' //evil.example', true],
  ['leading control character', '\u0001//evil.example', true],
  // Raw, they stay on the site; the guard's normalised result would not.
  ['dot segment collapsing to a double slash', '/.//evil.example', false],
  ['dot-dot segment collapsing to a double slash', '/a/..//evil.example', false],
];

describe('guardReturnTo — the site’s own ways back survive unchanged', () => {
  it.each(LEGIT)('%p', (path) => {
    expect(guardReturnTo(path)).toBe(path);
  });
});

describe('guardReturnTo — values leading off the site collapse to /', () => {
  it.each(OFF_SITE)('%s', (_label, input) => {
    expect(guardReturnTo(input)).toBe('/');
  });

  it.each(['', null, undefined])('non-path %p collapses to /', (input) => {
    expect(guardReturnTo(input)).toBe('/');
  });

  // Fixture guard: the off-site half really does leave the site when handed on
  // raw — otherwise the cases above would prove nothing about the guard.
  it.each(OFF_SITE)('%s: raw, leaves the site only when marked so', (_label, input, leavesRaw) => {
    expect(staysOnSite(input)).toBe(!leavesRaw);
  });
});

describe('guardReturnTo — a value with control characters or whitespace is refused, not repaired', () => {
  // The URL parser would quietly drop the tab and keep the path; the guard
  // refuses instead — no address the site builds carries such characters.
  it.each(['/minsk\t', '/min\nsk', '/minsk restorany', '/minsk ', '/minsk\\kafe'])(
    '%p',
    (input) => {
      expect(guardReturnTo(input)).toBe('/');
    },
  );
});

describe('guardReturnTo — the result is the normalised path, not the raw input', () => {
  it.each([
    ['/minsk/./restorany', '/minsk/restorany'],
    ['/minsk/x/../restorany', '/minsk/restorany'],
    ['/minsk?', '/minsk'],
    ['/минск', '/%D0%BC%D0%B8%D0%BD%D1%81%D0%BA'],
  ])('%p → %p', (input, expected) => {
    expect(guardReturnTo(input)).toBe(expected);
  });
});

describe('guardReturnTo — property over every character in the risky positions', () => {
  // Every code point up to U+00A0 plus the Unicode separators, placed where a
  // prefix check would look: before the slash, between the slashes, after
  // them. Whatever the guard returns must stay on the site and be a fixed
  // point (the Yandex callback guards the stored value a second time).
  const chars: string[] = [];
  for (let c = 0; c <= 0xa0; c++) chars.push(String.fromCharCode(c));
  chars.push(' ', ' ', ' ', ' ', '　', '﻿', '／');
  const inputs = chars.flatMap((ch) => [
    `${ch}/evil.example`,
    `${ch}//evil.example`,
    `/${ch}/evil.example`,
    `/${ch}evil.example`,
    `//${ch}evil.example`,
    `/${ch}${ch}/evil.example`,
    `/.${ch}/evil.example`,
  ]);

  it(`holds for ${inputs.length} generated values`, () => {
    const leaks = inputs.filter((input) => !staysOnSite(guardReturnTo(input)));
    const unstable = inputs.filter((input) => {
      const once = guardReturnTo(input);
      return guardReturnTo(once) !== once;
    });

    expect(leaks).toEqual([]);
    expect(unstable).toEqual([]);
  });

  it('the generated set does contain values that leave the site raw', () => {
    // Fixture guard: without this the property above could pass vacuously.
    const rawLeaks = inputs.filter((input) => input.startsWith('/') && !staysOnSite(input));
    expect(rawLeaks.length).toBeGreaterThan(0);
  });
});
