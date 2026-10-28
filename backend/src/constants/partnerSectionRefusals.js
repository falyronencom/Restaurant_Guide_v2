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

/**
 * A form the server will not read: busboy cannot read it as a whole
 * (middleware/upload.js UNREADABLE_FORM_MESSAGE, every uploader — wording
 * approved by the Coordinator on 16.10.2026, PR #52), or multer stops reading
 * it at a limit — too many fields or parts, a bracketed field name, and on
 * the avatar a file under another field's name (the card's media answers
 * that one with UPLOAD_REFUSALS.unexpectedField). One sentence for the form
 * whatever stopped it; no client sends such a form. multer's own refusals
 * answer with it on the card's media and the avatar (from 20.10.2026;
 * multer's English before), the wizard's upload and the promotions keep
 * multer's text.
 */
const FORM_NOT_READ = 'Не удалось прочитать отправленные данные. Попробуйте ещё раз.';

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
  // multer's other refusals on the card's media (FORM_NOT_READ above).
  formNotRead: FORM_NOT_READ,
});

/**
 * The card's media past the file rules — the rest of
 * /api/v1/partner/establishments/:id/media… (validators/mediaValidation.js,
 * services/mediaService.js; from 20.10.2026, English before — the site
 * translated by code, the app does not call these addresses). A card that is
 * gone or not the caller's — and a card id not written as the database writes
 * it (routes/v1/mediaRoutes.js) — is refused with the card's own text,
 * ESTABLISHMENT_REFUSALS.notOwner. The fields below are ones the site's form
 * fills itself — a wrong bucket, flag, position or id comes from a stale page
 * or a hand-made request, so the text sends the partner to reload; the
 * caption is the only free text. Wording by analogy with the approved texts (the upload
 * form's — the site's own text for INVALID_MEDIA_TYPE; the caption's — the
 * promotion's title); approved as such by the Coordinator on 20.10.2026
 * (PR #114).
 */
export const MEDIA_REFUSALS = Object.freeze({
  // A media id that names no file of this card: missing, deleted meanwhile,
  // of another card, or no id at all.
  mediaNotFound: 'Файл не найден — возможно, его уже удалили. Обновите страницу.',
  // Upload: the bucket missing or unknown, is_primary not a flag.
  uploadFormInvalid: 'Не удалось загрузить файл. Обновите страницу и попробуйте ещё раз.',
  // Update: position or is_primary not what the form sends.
  changeInvalid: 'Не удалось сохранить изменения. Обновите страницу и попробуйте ещё раз.',
  // List: an unknown bucket in the filter.
  listFilterInvalid: 'Не удалось показать файлы. Обновите страницу и попробуйте ещё раз.',
  // establishment_media.caption is varchar(255), counted as the database counts.
  captionTooLong: 'Подпись к фото — не длиннее 255 знаков',
});

/**
 * Why recognition of a menu file failed for good, as the partner reads it on
 * the menu screen — the `recognition.reason` of
 * GET /api/v1/partner/establishments/:id/menu-items
 * (services/partnerMenuItemService.js recognitionState). Not a refusal of an
 * action: the outcome of a job the partner started by uploading. The job keeps
 * its own English error_message for the log and the moderator; which of these
 * the partner sees is decided by services/ocr/failureReason.js
 * failureReasonOf, and the app gives its advice by the cause's code. Three causes, by
 * the directive of 24.10.2026 (Trunk, finding 3 of the Railway incident);
 * wording approved by the Coordinator on 24.10.2026 (PR #128).
 */
export const MENU_RECOGNITION_FAILURES = Object.freeze({
  // Nothing readable came out of the file: blank pages, a scan without text.
  unreadable: 'Не удалось прочитать файл: текста меню в нём не нашлось.',
  // The PDF's parse broke its time or memory limit — the same file breaks it
  // on every attempt (pdfParseRunner PDF_PARSE_LIMIT).
  overLimit: 'Файл слишком большой или сложный — превышен предел распознавания.',
  // Everything else: the recognition service failed, timed out, or the
  // attempt was cut short by the server — the file may well be fine.
  serviceFailure: 'Сбой распознавания — попробуйте позже.',
});

/**
 * The partner's restart of the menu's recognition —
 * POST /api/v1/partner/establishments/:id/retry-ocr
 * (services/partnerMenuItemService.js retryOcr). Its other refusals keep
 * their own: a spent daily allowance answers with the limiters' sentence
 * (constants/rateLimitRefusal.js), a card without menu files with the code
 * NO_PDF_MENUS the app has its own text for. Wording proposed by Trunk on
 * 25.10.2026 (directive of session К, finding Н40).
 */
export const MENU_RECOGNITION_REFUSALS = Object.freeze({
  // Every file's queuing failed: nothing was started.
  restartNotQueued: 'Не удалось запустить распознавание. Попробуйте позже.',
});

/**
 * The avatar — POST /api/v1/auth/avatar (routes/v1/authRoutes.js,
 * controllers/authController.js uploadAvatar). Every account's, not only a
 * partner's; kept here with the other uploaders' texts under one guard. The
 * app shows its own text («Не удалось загрузить аватар») and picks a photo of
 * 512 px, far below the limit; the site does not upload avatars. Status and
 * codes as before (400 FILE_TOO_LARGE, INVALID_FILE_TYPE, NO_FILE); English
 * until 20.10.2026. The size text approved by the Coordinator on 20.10.2026
 * («текст аватара — как предложил»); the other two — by the directive of that
 * day.
 */
export const AVATAR_REFUSALS = Object.freeze({
  // middleware/upload.js uploadAvatar: fileSize 5 MB.
  photoTooLarge: 'Фото больше 5 МБ. Выберите фото поменьше.',
  // middleware/upload.js imageFilter: image/jpeg, image/png, image/webp.
  invalidFileType: 'Такой формат фото не подходит. Нужны JPEG, PNG или WebP.',
  fileRequired: 'Выберите фото.',
  // multer's other refusals — a second field, too many fields and the like
  // (FORM_NOT_READ above).
  formNotRead: FORM_NOT_READ,
});
