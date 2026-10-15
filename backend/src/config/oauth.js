/**
 * Yandex sign-in: which applications' tokens the backend accepts
 *
 * login.yandex.ru/info answers for any valid Yandex OAuth token and names, in
 * `client_id`, the application the token was issued to (Yandex ID docs,
 * «Информация о пользователе»: a standard field of every response). Google's
 * ID token carries the same fact as its audience, and verifyGoogleToken has
 * always checked it; this list is the Yandex side of that check. A token
 * issued to any other application signs nobody in here.
 *
 * The default is the one Yandex application our clients use: the mobile app
 * (iOS and Android) and the website. A client ID is not a secret — every
 * build carries it and the browser shows it on oauth.yandex.ru at each
 * sign-in (mobile/run.sh has it too) — and having it as the default means a
 * deploy that predates the variable neither drops the check nor locks Yandex
 * users out.
 *
 * YANDEX_CLIENT_ID replaces the default when set: one ID, or several
 * separated by commas (an application being replaced, a second one). An
 * empty value means "not set".
 *
 * Pure: reads the env object it is given, never process.env.
 */

/** The Yandex application of the mobile app and the website (oauth.yandex.ru, re-created 2026-04-13). */
export const DEFAULT_YANDEX_CLIENT_IDS = Object.freeze(['bad2912d12db4c59a71511239a68c564']);

/**
 * @param {Object} [env] - Environment map (process.env in production)
 * @returns {ReadonlyArray<string>} client IDs whose tokens are accepted
 */
export const resolveYandexClientIds = (env = {}) => {
  const raw = env.YANDEX_CLIENT_ID;
  if (raw === undefined || raw === null) {
    return DEFAULT_YANDEX_CLIENT_IDS;
  }

  const ids = String(raw)
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');

  return ids.length > 0 ? Object.freeze(ids) : DEFAULT_YANDEX_CLIENT_IDS;
};
