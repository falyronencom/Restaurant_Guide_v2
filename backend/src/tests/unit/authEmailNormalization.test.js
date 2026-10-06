/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Login finds the account by the e-mail as normalized at registration.
 *
 * users.email holds the address after normalizeEmail() of the validator
 * library. For Yandex that has always meant «any Yandex domain → yandex.ru»:
 * a guest who registered as Ivan.Petrov@yandex.by is stored as
 * ivan.petrov@yandex.ru, and login looks that string up. validator 13.15 put
 * the Yandex rewrite behind a new option (yandex_convert_yandexru); if a
 * future version flips its default, new logins would normalize to @yandex.by
 * and every existing Yandex account would stop matching. These literals pin
 * the stored form for the chains that write or look up users.email.
 */

import { validationResult } from 'express-validator';
import {
  validateRegister,
  validateLogin,
  validateForgotPassword,
} from '../../validators/authValidation.js';

async function normalizedEmail(chains, email) {
  const req = { body: { email, name: 'Иван', password: 'Password123', auth_method: 'email' } };
  for (const chain of chains) {
    // validateForgotPassword ends with a plain middleware, not a chain
    if (typeof chain.run === 'function') await chain.run(req);
  }
  const emailErrors = validationResult(req).array().filter((e) => e.path === 'email');
  expect(emailErrors).toEqual([]);
  return req.body.email;
}

describe.each([
  ['register', validateRegister],
  ['login', validateLogin],
  ['forgot password', validateForgotPassword],
])('%s normalizes the e-mail the same way', (_name, chains) => {
  test.each([
    ['Ivan.Petrov@yandex.by', 'ivan.petrov@yandex.ru'],
    ['ivan@ya.ru', 'ivan@yandex.ru'],
    ['Ivan.Petrov+cafe@gmail.com', 'ivan.petrov+cafe@gmail.com'],
    ['IVAN@MAIL.RU', 'ivan@mail.ru'],
    ['ivan@tut.by', 'ivan@tut.by'],
  ])('%s → %s', async (typed, stored) => {
    expect(await normalizedEmail(chains, typed)).toBe(stored);
  });
});
