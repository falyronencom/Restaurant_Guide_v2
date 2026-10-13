/**
 * The texts a partner reads when the server refuses an action outside the card
 * itself (the card's refusals live in establishmentRefusals.js).
 *
 * Decision of the Coordinator, 13.10.2026 (option A): the server writes the
 * refusal in Russian and the error codes stay as they were — clients and tests
 * key on them; the site translates by code with its own map. In these sections
 * the app does not show the server's text everywhere yet: the wizard upload
 * shows it today, in every installed build; bookings and promotions start
 * showing it with the app change approved the same day (option Б).
 *
 * Every refusal these modules send takes its text from here, and no text here
 * carries Latin letters other than file-format names —
 * tests/unit/partnerSectionRefusals.test.js holds both. The wording is the
 * Coordinator's decision (approved 13.10.2026): a change of a text is asked,
 * not made.
 */

/**
 * The establishment in the URL is missing or not the caller's. One text for
 * both on purpose: a stranger must not learn whether the card exists.
 */
const ESTABLISHMENT_NOT_OWNED =
  'Заведение не найдено или принадлежит другому аккаунту. Обновите список заведений.';

/** A booking's present status, as the partner reads it when an action is refused. */
const BOOKING_STATUS_PHRASES = {
  pending: 'Бронь ещё не подтверждена.',
  confirmed: 'Бронь уже подтверждена.',
  declined: 'Бронь уже отклонена.',
  expired: 'Время на ответ истекло — бронь снята автоматически.',
  cancelled: 'Гость отменил эту бронь.',
  no_show: 'Бронь уже отмечена: гость не пришёл.',
  completed: 'Бронь уже отмечена как состоявшаяся.',
};

/**
 * The partner's bookings — /api/v1/partner/bookings/:establishmentId/…
 * (services/bookingService.js, the partner actions only; the guest's own
 * cancel keeps its texts until the Coordinator's word). The app shows the
 * text from its next build (option Б), until then its own.
 */
export const BOOKING_REFUSALS = Object.freeze({
  establishmentNotOwned: ESTABLISHMENT_NOT_OWNED,
  // Missing, or of another establishment than the one in the URL.
  bookingNotFound: 'Бронь не найдена. Обновите список броней.',
  // Confirm, decline, no-show or complete on a booking whose status has
  // changed meanwhile: the answer time ran out, the guest cancelled, another
  // phone of the same account acted first.
  statusChanged: (status) => {
    const phrase = Object.hasOwn(BOOKING_STATUS_PHRASES, status)
      ? BOOKING_STATUS_PHRASES[status]
      : 'Статус брони изменился.';
    return `${phrase} Обновите список броней.`;
  },
  declineReasonRequired: 'Укажите причину отказа.',
});

/**
 * The wizard's photo and PDF upload — POST /api/v1/partner/media/upload
 * (routes/v1/tempMediaRoutes.js). The app shows the text after its own prefix
 * «Ошибка при загрузке фото:» until its next build.
 */
export const UPLOAD_REFUSALS = Object.freeze({
  fileRequired: 'Файл не выбран.',
  pdfOnlyInMenu: 'PDF можно добавить только в меню.',
  invalidFileType: 'Этот формат не подходит: фото — JPG, PNG, WebP или HEIC, меню — ещё и PDF.',
  pdfTooLarge: 'Файл меню больше 60 МБ. Выберите файл поменьше.',
  photoTooLarge: 'Фото больше 10 МБ. Выберите фото поменьше.',
  // multer's own ceiling for any file — 60 МБ (the old text said 10MB).
  fileTooLarge: 'Файл больше 60 МБ. Выберите файл поменьше.',
  unexpectedField: 'Не удалось загрузить файл. Попробуйте ещё раз.',
  // The cloud or the server failed after the file passed every check; the
  // inner text goes to the log only.
  uploadFailed: 'Не удалось загрузить файл. Попробуйте ещё раз через минуту.',
});
