/**
 * Что читает человек, когда сервер отказывает отключённой учётной записи.
 * Коды и статусы прежние — на них держатся приложение, сайт и тесты; меняется
 * только текст: английский («This account has been deactivated», «User account
 * is inactive») на русском экране.
 *
 * Адрес поддержки — здесь, а не в accountDeletionService: middleware/auth.js
 * подключается к каждому запросу, и тянуть ради одной строки сервис удаления
 * учётки со всеми его зависимостями незачем. accountDeletionService берёт
 * адрес отсюда же — одна строка на весь сервер.
 */

/** Куда отказы отправляют человека. */
export const SUPPORT_EMAIL = 'support@nirivio.by';

/**
 * Вход через Google или Яндекс в учётную запись, отключённую блокировкой из
 * панели (403 ACCOUNT_DEACTIVATED, authService.oauthLogin).
 */
export const ACCOUNT_DEACTIVATED_TEXT =
  `Учётная запись отключена. Если это ошибка — напишите в поддержку: ${SUPPORT_EMAIL}`;

/**
 * Запрос со старым токеном после того, как учётную запись отключили или
 * удалили (401 ACCOUNT_INACTIVE, middleware/auth.js), обновление токена
 * такой учётной записи (401 ACCOUNT_INACTIVE, authController.refresh) и
 * отзыв от неё (403 USER_INACTIVE, reviewService.createReview). Клиенты на
 * ACCOUNT_INACTIVE выходят из учётной записи.
 */
export const ACCOUNT_INACTIVE_TEXT =
  `Учётная запись отключена или удалена. Если это ошибка — напишите в поддержку: ${SUPPORT_EMAIL}`;
