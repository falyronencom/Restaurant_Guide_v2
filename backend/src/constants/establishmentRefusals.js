/**
 * The texts a partner reads when the server refuses an action on their card:
 * create, edit, submit for moderation, pause, resume, delete.
 *
 * The app shows the server's message as is (the site translates by code with
 * its own map — web/src/lib/partner/errors.ts). Decision of the Coordinator,
 * 13.10.2026: the server answers in Russian, so the text also reaches the app
 * builds already installed (the iPhone build is not replaced before launch).
 * The error codes stay as they were — clients and tests key on them.
 *
 * Every `new AppError(` in services/establishmentService.js takes its text from
 * here, and no text here carries Latin letters other than file-format names —
 * tests/unit/establishmentRefusals.test.js holds both. The wording is the
 * Coordinator's decision: a change of a text is asked, not made. Each group
 * below says whether its wording is approved or still awaits the word.
 */

import { SUPPORT_EMAIL } from './authRefusals.js';

/** Required fields named in the submit refusal, in the accusative («заполните: …»). */
const MISSING_FIELD_NAMES = {
  name: 'название',
  city: 'город',
  address: 'адрес',
  coordinates: 'точку на карте',
  categories: 'категорию',
  cuisines: 'кухню',
  working_hours: 'часы работы',
};

/** Photo buckets named in the limit refusal. */
const PHOTO_BUCKET_NAMES = {
  interior: 'фото интерьера',
  menu: 'фото меню',
};

export const ESTABLISHMENT_REFUSALS = Object.freeze({
  // Refusals a partner meets in normal use — wording approved by the
  // Coordinator, 13.10.2026.
  coordinatesOutsideCity:
    'Точка на карте не попадает в выбранный город. Проверьте город и адрес или передвиньте точку на карте. Если заведение за городом, напишите в поддержку.',
  duplicateName:
    'У вас уже есть заведение с таким названием — оно в списке ваших заведений. Если это второй адрес, добавьте к названию улицу или район.',
  selfPausedEdit:
    'Показ заведения приостановлен. Чтобы изменить карточку, сначала возобновите показ.',
  alreadySubmitted:
    'Эта карточка уже на модерации или опубликована — отправлять её не нужно.',
  pauseNotPublished: 'Приостановить можно только опубликованное заведение.',
  resumeNotPaused: 'Возобновить можно только приостановленное заведение.',

  // Approved by the Coordinator, 15.10.2026, replacing the wording of 13.10
  // («Нет доступа: это заведение принадлежит другому аккаунту.»), which does
  // not hold for every case: the ownership check also refuses a card that no longer
  // exists (a stale screen after the card was deleted), so this text covers
  // both. `notFound` is what opening such a card (GET) answers — there the
  // 404 deliberately does not tell a foreign card from a missing one, and
  // «возможно» keeps the text true for both.
  notOwner:
    'Нет доступа к этому заведению — возможно, оно удалено или принадлежит другой учётной записи. Обновите список заведений.',
  notFound:
    'Заведение не найдено — возможно, оно удалено. Обновите список заведений.',

  // Earlier decisions of the Coordinator: delete (01.10.2026), media from
  // another account (06.10.2026), the moderator's suspension.
  notDeletable:
    'Удалить можно только черновик или отклонённую карточку, которая ещё не была на сайте. Чтобы убрать эту карточку, напишите в поддержку.',
  mediaNotOwned:
    'Одно из фото или файлов меню загружено не с этой учётной записи. Удалите его и загрузите заново.',
  moderatorSuspended:
    'Заведение приостановлено модератором. Исправьте замечания и отправьте повторно на модерацию.',

  // A suspended card (Coordinator, 01.11.2026, «А+В»): the partner's own
  // pause is the partner's to lift, and a card parked by an account takeover
  // waits for the moderator's decision on whom it belongs to — it is neither
  // sent to moderation, nor resumed (the same text), nor edited. Approved by
  // the Coordinator, 01.11.2026.
  submitFromOwnPause:
    'Показ заведения приостановлен вами — отправлять его на модерацию не нужно. Чтобы гости снова видели заведение, возобновите показ.',
  submitOwnershipDispute:
    `Карточка приостановлена до решения модератора: кому она принадлежит. До этого решения отправить её на модерацию нельзя. Если заведение ваше, напишите в поддержку: ${SUPPORT_EMAIL}`,
  editOwnershipDispute:
    `Карточка приостановлена до решения модератора: кому она принадлежит. До этого решения изменить её нельзя. Если заведение ваше, напишите в поддержку: ${SUPPORT_EMAIL}`,

  // The legal details of the step «Ваши данные» (create and edit), checked
  // before anything is written: a value longer than its column had been lost
  // at create and failed the whole edit with a 500 (Crapper measurement,
  // 01.11.2026). The field names are the step's own. Approved by the
  // Coordinator, 01.11.2026.
  legalNameTooLong:
    'Полное название заведения длиннее 255 знаков. Сократите его на шаге «Ваши данные» — например, «Общество с ограниченной ответственностью» замените на «ООО».',
  unpInvalid: 'УНП — это 9 цифр. Проверьте номер на шаге «Ваши данные».',
  contactPersonTooLong:
    'Номер контактного лица длиннее 100 знаков. Проверьте номер на шаге «Ваши данные».',
  contactEmailInvalid:
    'Адрес электронной почты указан неверно. Проверьте его на шаге «Ваши данные».',

  // The app's form does not let these happen: they come from a version
  // mismatch between the app and the server, or a stale screen. Mostly the
  // site's wording; approved by the Coordinator, 15.10.2026.
  invalidCity: 'Выберите город из списка.',
  coordinatesOutsideBelarus:
    'Точка на карте за пределами Беларуси. Проверьте адрес или передвиньте точку на карте.',
  categoriesCount: 'Выберите от 1 до 2 категорий.',
  unknownCategory: 'Такой категории нет в списке. Выберите категорию заново.',
  cuisinesCount: 'Выберите от 1 до 3 кухонь.',
  unknownCuisine: 'Такой кухни нет в списке. Выберите кухню заново.',
  photoLimit: (bucket, limit) =>
    `Можно добавить не больше ${limit} ${PHOTO_BUCKET_NAMES[bucket] ?? 'фото'}.`,
  // A save that adds a third menu PDF (review of PR #56, finding 1: the limit
  // of the card's upload now holds on the save too). The app and the site do
  // not let a partner pick a third one. Approved by the Coordinator on
  // 17.10.2026 (PR #59).
  pdfLimit: (limit) => `Можно добавить не больше ${limit} файлов меню в формате PDF.`,
  invalidFileType:
    'Этот формат не подходит: фото — JPG, PNG, WebP или HEIC, меню — ещё и PDF.',
  incomplete: (missingFields) =>
    `Перед отправкой на модерацию заполните: ${missingFields
      .map((field) => MISSING_FIELD_NAMES[field] ?? 'обязательные поля')
      .join(', ')}.`,
  constraintViolation:
    'Не удалось сохранить: часть данных заполнена неверно. Проверьте карточку и попробуйте ещё раз.',
  slugCollision: 'Не удалось сохранить карточку. Попробуйте ещё раз.',

  // Server failures. The app shows its own text instead of these (the
  // transport passes a 5xx up without the server's message); they are Russian
  // so that the rule above holds without exceptions. Approved by the
  // Coordinator, 15.10.2026.
  createFailed: 'Не удалось создать заведение. Попробуйте ещё раз позже.',
  updateFailed: 'Не удалось сохранить изменения. Попробуйте ещё раз позже.',
  submitFailed: 'Не удалось отправить на модерацию. Попробуйте ещё раз позже.',
  fetchFailed: 'Не удалось загрузить заведение. Попробуйте ещё раз позже.',
  listFailed: 'Не удалось загрузить список заведений. Попробуйте ещё раз позже.',
});
