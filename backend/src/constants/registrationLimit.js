/**
 * What one address may do about new accounts in a day (thread «Расходы
 * посторонних», point 6, 03.11.2026). Every account holds its own budgets — 100
 * requests a minute on the global limiter and its own daily allowances — so until
 * then 20 registrations a minute from one address multiplied them without end. 20
 * a day leaves room for a family, an office or a café behind one address; the
 * site's visitors count by the address the site vouches for. Counted per Minsk
 * day, the day of the letters' allowance (middleware/rateLimiter.js bucketAt;
 * the UTC day until 10.11.2026 — then one address had two days of these limits
 * inside one day of letters).
 *
 * Two counters, because they hold different things.
 *
 * REGISTRATION_REQUESTS_DAY_LIMIT — requests to POST /auth/register, whatever they
 * answer. It holds what a request costs before any account exists: asking the
 * register which e-mail addresses it knows, and the letters. Every registration by
 * e-mail sends a code: with the resends of routes/v1/authRoutes.js, one address
 * spends at most 30 of the day's 50 codes (services/mailAllowance.js).
 *
 * NEW_ACCOUNTS_DAY_LIMIT — accounts created, by any way: POST /auth/register and a
 * first sign-in through Google or Yandex (thread «Общий потолок распознавания»,
 * November 2026; until then such an account was outside every limit of the day).
 * Only a created account spends it, through spendRouteLimit: a sign-in to an
 * existing account does not, and neither does a request refused — a day of junk
 * registrations from an address must not close the sign-in through a provider to
 * the new people behind that address.
 */
export const REGISTRATION_REQUESTS_DAY_LIMIT = Object.freeze({
  limit: 20,
  windowSeconds: 86400,
  keyPrefix: 'register-day',
});

export const NEW_ACCOUNTS_DAY_LIMIT = Object.freeze({
  limit: 20,
  windowSeconds: 86400,
  keyPrefix: 'new-accounts-day',
});
