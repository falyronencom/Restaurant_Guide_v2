import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Guard: exactly one place in the app may present the refresh token.
 *
 * The boundary. A refresh cycle presents the single-use token AT MOST TWICE
 * (session.ts doRefresh: one attempt, plus one retry on a `transient` verdict).
 * Outside the backend's grace window (REFRESH_REUSE_GRACE_SECONDS, default 60s)
 * a re-presentation is read as theft: 403 TOKEN_REUSE_DETECTED, and every
 * session the user has is revoked.
 *
 * What holds it up. Three facts, each pinned somewhere else:
 *   - concurrent callers share ONE cycle (auth-refresh.test.ts, single-flight);
 *   - a cycle presents twice and never more (auth-refresh.test.ts, counts);
 *   - authedFetch runs at most one cycle per call (api-client-auth-injection).
 * And a fourth, pinned HERE: `attemptRefresh` is the ONLY code that goes to
 * /auth/refresh. Nothing else counts presentations made anywhere else — a
 * second entry point would simply not appear in any of those numbers.
 *
 * Not a hypothesis. mobile carried exactly such a second path for months:
 * `AuthService.refreshToken()` POSTed /api/v1/auth/refresh straight past the
 * lock. It had no callers, so it reddened nothing and survived until a review
 * on 13.09.2026 (removed in `4064c00`; the Dart twins of this guard are
 * `5c10bdb` and `dec97fa`).
 *
 * What this guard cannot do, stated plainly: a path assembled from pieces
 * ('/api/v1/auth/' + 'refresh') slips through. It catches the obvious form —
 * the form the mobile defect actually took — not a determined evasion. It is a
 * tripwire, not a sandbox.
 */

/** The refresh path inside a string or template literal. */
const LITERAL = String.raw`['"\`][^'"\`]*auth/refresh[^'"\`]*['"\`]`;

/** Any call whose first argument is that path: fetch(...), serverFetch<T>(...). */
const REQUEST_CALL = new RegExp(
  String.raw`[A-Za-z_$][\w$]*\s*(?:<[^<>]*>\s*)?\(\s*(?:${LITERAL})`,
);

const REFRESH_LITERAL = new RegExp(LITERAL);

/**
 * Files allowed to know the path, each with its reason.
 *
 * A map, not a bare list: an unexplained exemption invites the next author to
 * add their own file just to get the suite green — the very failure this guard
 * exists to prevent.
 */
const ALLOWED: Record<string, string> = {
  'src/lib/auth/session.ts':
    'owner of the inFlightRefresh single-flight map: attemptRefresh is the ' +
    'one presentation, and the cycle around it is what auth-refresh.test.ts ' +
    'counts',
};

const SRC = join(__dirname, '..', 'src');
const SESSION = join(SRC, 'lib', 'auth', 'session.ts');
const CODE = /\.(ts|tsx|js|jsx|mjs)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return CODE.test(entry) ? [full] : [];
  });
}

/**
 * Comment-only lines are dropped before the search.
 *
 * Whole lines, never a suffix: stripping from `//` onwards would truncate any
 * line holding a URL and could HIDE a violation written as
 * fetch('https://host/api/v1/auth/refresh'). A line that merely ENDS in a
 * comment keeps its code and stays under the search.
 */
function codeLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

describe('One entry point for the refresh token', () => {
  it('session.ts issues exactly one request to the refresh path', () => {
    const code = codeLines(readFileSync(SESSION, 'utf8'));
    const calls = code.match(new RegExp(REQUEST_CALL, 'g')) ?? [];

    expect(calls).toHaveLength(1);
  });

  it('no other file under src/ knows the refresh path', () => {
    const files = sourceFiles(SRC);

    // Without this, a wrong root would scan nothing and the guard below would
    // pass by finding no offenders among no files.
    expect(files.length).toBeGreaterThan(100);

    const offenders = files
      .map((file) => relative(SRC, file).split(sep).join('/'))
      .filter((path) => !(`src/${path}` in ALLOWED))
      .filter((path) =>
        REFRESH_LITERAL.test(codeLines(readFileSync(join(SRC, path), 'utf8'))),
      )
      .map((path) => `src/${path}`);

    expect(offenders).toEqual([]);
  });

  it('the search itself finds what it is supposed to find', () => {
    // The scan above goes green two ways: there are no offenders, or the
    // search is broken. The second way is silent, so the pattern is held
    // against code that certainly contains the path.
    //
    // There is deliberately no twin assertion for REQUEST_CALL: a broken call
    // pattern already fails the count above (0 instead of 1), and the
    // duplicate would only hide which of the two is the necessary one.
    expect(REFRESH_LITERAL.test(readFileSync(SESSION, 'utf8'))).toBe(true);

    // A dead entry in ALLOWED would mean the guard reports on a file that is
    // no longer there.
    for (const path of Object.keys(ALLOWED)) {
      expect(() => statSync(join(SRC, '..', path))).not.toThrow();
    }
  });
});
