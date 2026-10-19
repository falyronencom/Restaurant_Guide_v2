/**
 * The texts a partner reads when the server refuses an action outside the card
 * itself (the card's refusals: establishmentRefusals.js of the card pass —
 * branch claude/nice-meitner-ae8d57 on 13.10.2026).
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

/**
 * The account's daily upload allowance is spent (services/uploadAllowance.js);
 * it is renewed at Minsk midnight. One sentence for every uploader — the
 * wizard's upload, the card's media, a promotion's picture, the avatar —
 * approved by the Coordinator on 17.10.2026 («Согласен со всеми рекомендациями
 * по PR #54»).
 */
const DAILY_UPLOAD_LIMIT = 'Лимит загрузок на сегодня исчерпан. Продолжите завтра.';

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
 * The partner's promotions — /api/v1/partner/promotions…
 * (services/promotionService.js, controllers/promotionController.js). The app
 * shows the text from its next build (option Б), until then its own.
 */
export const PROMOTION_REFUSALS = Object.freeze({
  establishmentNotOwned: ESTABLISHMENT_NOT_OWNED,
  activeLimit: (max) =>
    `Одновременно может действовать не больше ${max} акций. Удалите одну из текущих, чтобы добавить новую.`,
  // Missing, or of another partner's establishment — one text for both.
  promotionNotFound: 'Акция не найдена — возможно, её уже удалили. Обновите список акций.',
  // Sent by the route's upload filter (routes/v1/promotionRoutes.js, from
  // 16.10.2026) and by the service's own check; the route refuses an oversized
  // file first with multer's limit. The service's two checks answer only if
  // the route and the service ever disagree.
  invalidImageType: 'Этот формат не подходит: картинка акции — JPG, PNG, WebP или HEIC.',
  imageTooLarge: 'Картинка больше 10 МБ. Выберите фото поменьше.',
  establishmentRequired: 'Не выбрано заведение.',
  titleRequired: 'Укажите название акции.',
  // The fields the controller checks before the service, so before the cloud
  // and the database (promotionController.js, from 18.10.2026; the wording
  // approved by the Coordinator 17.10.2026). Until then a title over 255
  // characters, a date the calendar lacks or a position past the column came
  // back as 500, and a description sent as an array was stored as text.
  titleTooLong: 'Название акции — не длиннее 255 знаков',
  dateInvalid: 'Дата начала или окончания акции указана неверно',
  positionInvalid: 'Позиция акции — целое число от 0 до 1 000 000',
  notText: 'Описание и условия акции должны быть текстом',
  dailyUploadLimit: DAILY_UPLOAD_LIMIT,
});

/**
 * The wizard's photo and PDF upload — POST /api/v1/partner/media/upload
 * (routes/v1/tempMediaRoutes.js). The app shows the text after its own prefix
 * «Ошибка при загрузке фото:» until its next build. `dailyLimit` also answers
 * the card's media (services/mediaService.js) and the avatar
 * (controllers/authController.js) — one allowance for every uploader. The
 * card's media (routes/v1/mediaRoutes.js, services/mediaService.js) refuses a
 * file by the same rules, so with the same texts (from 19.10.2026; English
 * before — the site translated by code, the app does not call that address).
 */
export const UPLOAD_REFUSALS = Object.freeze({
  fileRequired: 'Файл не выбран.',
  pdfOnlyInMenu: 'PDF можно добавить только в меню.',
  invalidFileType: 'Этот формат не подходит: фото — JPG, PNG, WebP или HEIC, меню — ещё и PDF.',
  pdfTooLarge: 'Файл меню больше 60 МБ. Выберите файл поменьше.',
  // A menu PDF above the cloud's file limit on the account's plan
  // (config/cloudinary.js CLOUD_MAX_FILE_MB, 10 on Free), refused before the
  // cloud — the wizard's upload and the card's media. Wording approved by the
  // Coordinator on 17.10.2026 for 10 МБ; the number follows the setting.
  pdfOverCloudLimit: (mb) => `Файл PDF больше ${mb} МБ — уменьшите его или загрузите меню фотографиями`,
  photoTooLarge: 'Фото больше 10 МБ. Выберите фото поменьше.',
  // multer's own ceiling for any file — 60 МБ (the old text said 10MB).
  fileTooLarge: 'Файл больше 60 МБ. Выберите файл поменьше.',
  unexpectedField: 'Не удалось загрузить файл. Попробуйте ещё раз.',
  // The cloud or the server failed after the file passed every check; the
  // inner text goes to the log only.
  uploadFailed: 'Не удалось загрузить файл. Попробуйте ещё раз через минуту.',
  // The account's daily allowance is spent — the same sentence answers the
  // card's media and the avatar (DAILY_UPLOAD_LIMIT above).
  dailyLimit: DAILY_UPLOAD_LIMIT,
});
