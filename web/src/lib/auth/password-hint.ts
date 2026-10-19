/**
 * The password rule as the visitor reads it under every "new password" field
 * — registration and the reset page (сверка находок тестировщика с сайтом,
 * 18.10, п. 21: on the reset page it appeared only after a failed submit).
 * Mirrors the backend rule (validators/authValidation.js) and the action's
 * pre-check in lib/auth/actions.ts.
 */
export const PASSWORD_HINT =
  'Минимум 8 символов, заглавная и строчная буквы, цифра.';
