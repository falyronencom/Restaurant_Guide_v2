import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guard: authedFetch's allow-list (SESSION_REFUSAL_CODES, session.ts) is the
 * backend sign-in check's 401 codes — no more, no less.
 *
 * The list is a hand-kept copy; the web and the backend share no package. A
 * code the backend adds to `authenticate` and the web does not learn means a
 * signed-in visitor whose access token is refused that way gets an error
 * instead of a silent refresh. A code the web keeps after the backend drops it
 * is harmless today but would replay a future endpoint's own 401 of that name.
 *
 * Read from the backend source, the way the backend writes them: every
 * `code: '…'` and `errorCode = '…'` inside `authenticate`
 * (backend/src/middleware/auth.js; its only non-401 refusal is the 503
 * AppError, written positionally, so it does not match), and the 401 fallbacks
 * of errorHandler.js (`statusCode = 401; errorCode = '…'`), which must be
 * among them.
 */
const mockStore = { get: jest.fn(), set: jest.fn(), delete: jest.fn(), has: jest.fn() };

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve(mockStore)),
}));
jest.mock('@/lib/api/client', () => ({ serverFetch: jest.fn() }));

import { SESSION_REFUSAL_CODES } from '@/lib/auth/session';

const BACKEND = join(__dirname, '..', '..', 'backend', 'src', 'middleware');

function authenticateBody(): string {
  const source = readFileSync(join(BACKEND, 'auth.js'), 'utf8');
  const start = source.indexOf('export const authenticate =');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\nexport ', start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

function codesIn(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[1]);
}

describe('SESSION_REFUSAL_CODES', () => {
  it("equals the 401 codes of the backend's authenticate", () => {
    const body = authenticateBody();
    const backendCodes = new Set([
      ...codesIn(body, /\bcode:\s*'([A-Z_]+)'/g),
      ...codesIn(body, /\berrorCode\s*=\s*'([A-Z_]+)'/g),
    ]);
    // A parse that finds nothing would make the equality below vacuous.
    expect(backendCodes.size).toBeGreaterThanOrEqual(5);

    expect([...SESSION_REFUSAL_CODES].sort()).toEqual([...backendCodes].sort());
  });

  it("covers errorHandler's 401 fallbacks for token errors", () => {
    const source = readFileSync(join(BACKEND, 'errorHandler.js'), 'utf8');
    const fallbacks = codesIn(source, /statusCode\s*=\s*401;\s*errorCode\s*=\s*'([A-Z_]+)'/g);
    expect(fallbacks.length).toBeGreaterThanOrEqual(1);

    for (const code of fallbacks) {
      expect({ code, inList: SESSION_REFUSAL_CODES.has(code) }).toEqual({ code, inList: true });
    }
  });
});
