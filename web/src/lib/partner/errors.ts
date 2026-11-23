/**
 * Russian messages for partner establishment refusals (Phase C Slice 1,
 * Segment B; codes audited + aligned in the cabinet create-flow hardening,
 * CAT-C-3.x B1). Pure — shared by the operations layer and client islands.
 *
 * Which text the partner reads (сверка находок тестировщика с сайтом, 18.10,
 * пункты С5, С6, Х17 — the rule the app follows since PR #68 and the site's
 * review forms already do):
 *   1. the site's own phrase for the few refusals whose server text does not
 *      say enough — the daily upload allowance (with its term), the request
 *      limiter, a page address taken by a parallel save (OWN_PHRASE);
 *   2. the server's text when it is Russian (backend constants/
 *      establishmentRefusals.js, partnerSectionRefusals.js — the Coordinator's
 *      wording), shown as is;
 *   3. for a field-check refusal (VALIDATION_ERROR), the fields by name — the
 *      server's Russian field text, else the site's own (FIELD_TEXTS_RU);
 *   4. the site's own text by code (CODE_RU) — English server texts end here;
 *   5. a neutral fallback.
 *
 * CODE_RU keys MUST match the AppError codes the backend throws on the cabinet
 * paths. Manual cross-target sync (no shared package, like constants.ts), so
 * drift degrades SILENTLY to the neutral fallback when the server's text is
 * English — the COORDINATES_CITY_MISMATCH / DUPLICATE_ESTABLISHMENT gap that
 * masked the create-flow failures. partner-errors.test.ts guards the code set.
 */

import { personText } from '@/lib/api/person-text';
import {
  MENU_TEXTS,
  NO_MENU_FILES,
  recognitionShareSpent,
  restartsSpent,
} from '@/lib/partner/cabinet-texts';

const CODE_RU: Record<string, string> = {
  VALIDATION_ERROR: 'Проверьте правильность заполнения полей.',
  INVALID_CITY: 'Выберите город из списка.',
  INVALID_CATEGORIES_LENGTH: 'Выберите от 1 до 2 категорий.',
  INVALID_CATEGORY_VALUE: 'Недопустимая категория.',
  INVALID_CUISINES_LENGTH: 'Выберите от 1 до 3 кухонь.',
  INVALID_CUISINE_VALUE: 'Недопустимая кухня.',
  INVALID_LATITUDE: 'Координаты вне границ Беларуси.',
  INVALID_LONGITUDE: 'Координаты вне границ Беларуси.',
  COORDINATES_CITY_MISMATCH:
    'Координаты не попадают в границы выбранного города. Проверьте город или определите координаты по адресу заново.',
  MEDIA_LIMIT_EXCEEDED: 'Превышен лимит фотографий для заведения.',
  // The card's PDF limit: the upload to a card (mediaService) and the save
  // (establishmentService) answer it with the same sentence
  // (ESTABLISHMENT_REFUSALS.pdfLimit) — the same words here.
  PDF_LIMIT_EXCEEDED: 'Можно добавить не больше 2 файлов меню в формате PDF.',
  // Save refused: a media link is not among the partner's own uploads (backend
  // create/update ownership gate). The cabinet uploads into the partner's own
  // folders, so this surfaces only on stale state — same words as the server's
  // message.
  MEDIA_URL_NOT_OWNED:
    'Одно из фото или файлов меню загружено не с этой учётной записи. Удалите его и загрузите заново.',
  // Upload / streaming-proxy codes (also surfaced from the media routes).
  FILE_TOO_LARGE: 'Файл слишком большой.',
  HTTP_413: 'Файл слишком большой.',
  INVALID_FILE_TYPE:
    'Недопустимый формат файла. Допустимы фото JPG, PNG, WebP, HEIC и меню в PDF.',
  INVALID_MEDIA_TYPE: 'Не удалось загрузить файл. Обновите страницу и попробуйте ещё раз.',
  PDF_TYPE_MISMATCH: 'PDF можно загрузить только для меню.',
  FILE_REQUIRED: 'Файл не выбран.',
  INVALID_CONTENT_TYPE: 'Не удалось загрузить файл.',
  UPSTREAM_UNREACHABLE: 'Сервис загрузки недоступен. Попробуйте позже.',
  // Backend throws DUPLICATE_ESTABLISHMENT (409) on both the per-partner name
  // check and the DB unique-constraint catch; the DUPLICATE_NAME /
  // ESTABLISHMENT_NAME_EXISTS keys are legacy (never thrown) — kept harmless.
  DUPLICATE_ESTABLISHMENT: 'Заведение с таким названием у вас уже есть.',
  DUPLICATE_NAME: 'Заведение с таким названием у вас уже есть.',
  ESTABLISHMENT_NAME_EXISTS: 'Заведение с таким названием у вас уже есть.',
  FORBIDDEN: 'Нет доступа к этому заведению.',
  ESTABLISHMENT_SUSPENDED:
    'Заведение приостановлено вами. Возобновите его, чтобы редактировать.',
  ADMIN_SUSPENDED:
    'Заведение приостановлено модератором. Исправьте замечания и отправьте повторно на модерацию.',
  ESTABLISHMENT_NOT_FOUND: 'Заведение не найдено.',
  // Delete refused for any card but a draft/rejected one that has never been
  // public (backend deleteEstablishment). The cabinet hides the button for the
  // rest, so this surfaces only on a stale page — same words as the server's
  // message.
  ESTABLISHMENT_NOT_DELETABLE:
    'Удалить можно только черновик или отклонённую карточку, которая ещё не была на сайте. Чтобы убрать эту карточку, напишите в поддержку.',
  INVALID_STATUS_TRANSITION: 'Действие недоступно в текущем статусе заведения.',
  INVALID_STATUS_FOR_SUBMISSION:
    'Это действие недоступно в текущем статусе заведения.',
  INCOMPLETE_ESTABLISHMENT:
    'Перед отправкой на модерацию заполните все обязательные поля.',
  // The server's own text names the days and is what the partner reads; this one
  // is for a refusal that reaches the site without it.
  WORKING_HOURS_INCOMPLETE:
    'Часы работы заполнены не до конца. Укажите время открытия и закрытия или отметьте день выходным.',
  CONSTRAINT_VIOLATION:
    'Данные заведения нарушают ограничения. Проверьте корректность полей.',
  NO_SESSION: 'Сессия истекла. Войдите снова.',
  // authedFetch / the media proxy: the session refresh got no answer — the
  // session may be alive, so not «Сессия истекла».
  SESSION_REFRESH_UNAVAILABLE: 'Сервер временно недоступен. Попробуйте ещё раз.',
  NETWORK: 'Сеть недоступна. Попробуйте позже.',
  // The card's menu (part 1 of «Кабинет партнёра на сайте», 23.11.2026; the
  // texts await the Coordinator's word with the rest of lib/partner/
  // cabinet-texts.ts). The server's texts of these codes are English.
  // T4 — a restart of a card without menu files (backend retryOcr).
  NO_PDF_MENUS: NO_MENU_FILES,
  // T7б — the line is gone: replaced by a re-read, hidden by the moderator,
  // or not the partner's (backend updateMenuItem answers all three alike).
  MENU_ITEM_NOT_FOUND: MENU_TEXTS.itemGone,
  // The site checks the price, the fields and the id itself: these reach the
  // partner only from a stale page or a hand-made request.
  INVALID_PRICE: 'Цена указана неверно.',
  NO_FIELDS_TO_UPDATE: 'Нечего сохранять — ничего не изменилось.',
  INVALID_FORMAT: 'Не удалось выполнить действие. Обновите страницу и попробуйте ещё раз.',
  // Every queuing of a restart failed — the server's own Russian text, the same words.
  OCR_RESTART_FAILED: 'Не удалось запустить распознавание. Попробуйте позже.',
  // The same-origin guard of the cabinet's Route Handlers (lib/partner/same-origin.ts).
  CSRF: 'Не удалось выполнить действие. Обновите страницу и попробуйте ещё раз.',
  // The menu line's edit with a body over its bound — a hand-made request only.
  PAYLOAD_TOO_LARGE: 'Не удалось выполнить действие. Обновите страницу и попробуйте ещё раз.',
};

const FALLBACK = 'Не удалось выполнить запрос. Попробуйте позже.';

/**
 * Per-field texts keyed by the backend validator's field names
 * (validators/establishmentValidation.js) — its texts are English, so the
 * partner reads these, each naming its field.
 */
export const FIELD_TEXTS_RU: Record<string, string> = {
  name: 'Название — от 1 до 255 символов',
  description: 'Описание — не длиннее 2000 символов',
  address: 'Адрес — укажите улицу и дом',
  city: 'Город — выберите из списка',
  latitude: 'Точка на карте — определите её по адресу заново',
  longitude: 'Точка на карте — определите её по адресу заново',
  phone: 'Телефон — в формате +375XXXXXXXXX',
  email: 'Почта — адрес вида name@example.by',
  website: 'Сайт — адрес вида example.by или https://…',
  categories: 'Категория — выберите 1 или 2',
  cuisines: 'Кухня — выберите от 1 до 3',
  price_range: 'Средний чек — выберите один из вариантов',
  working_hours: 'Часы работы — проверьте время открытия и закрытия',
  special_hours: 'Особые часы работы — проверьте время',
  attributes: 'Удобства — выберите заново',
};

/** One field a field-check refusal named (the value is never carried). */
export type FieldRefusal = { field: string; message?: string };

/**
 * A refused cabinet operation as the client receives it: the code, the
 * server's text when it is Russian, the fields a field check named, and the
 * term of a limit.
 */
export type Refusal = {
  code?: string;
  message?: string;
  fields?: FieldRefusal[];
  retryAfter?: number;
  /** The moment the limit lets go (`details.reset_at`), when the seconds are not given. */
  resetAt?: string;
  /** Which limit refused, for RATE_LIMIT_EXCEEDED: the account's daily upload
   *  allowance, the shared ceiling of the accounts without a confirmed e-mail
   *  (backend services/unconfirmedAllowance.js — details.unconfirmed), the
   *  request limiter; for a restart of the menu's recognition only (ocrLimitOf)
   *  — the restarts of the day (`ocr_restarts`) or the day's share of
   *  recognition (`ocr_allowance`). */
  limit?: 'daily_uploads' | 'unconfirmed_uploads' | 'requests' | 'ocr_restarts' | 'ocr_allowance';
  /** How many the limit allows (`details.limit`), for `ocr_restarts`. */
  limitCount?: number;
  /** FORBIDDEN from the role gate (backend middleware/auth.js authorize): the
   *  role the server saw. Absent on the ownership refusal («не ваша или
   *  удалённая карточка»), which carries no details. */
  role?: string;
};

/** Which upload limit refused, from a 429's details (lib/partner/errors Refusal.limit). */
export function uploadLimitOf(
  details: { files_limit?: unknown; unconfirmed?: unknown } | undefined,
): 'daily_uploads' | 'unconfirmed_uploads' | 'requests' {
  if (details?.unconfirmed === true) return 'unconfirmed_uploads';
  return details?.files_limit !== undefined ? 'daily_uploads' : 'requests';
}

/**
 * Which limit refused a restart of the menu's recognition, from its 429's
 * details (backend): the route's limit of restarts — `limit` with the
 * day-long window (middleware/rateLimiter.js sendRateLimitRefusal,
 * routes/v1/establishmentRoutes.js ocrRestartLimiter); the day's share of
 * recognition — `jobs_limit` or `pages_limit` (services/ocrAllowance.js
 * DailyOcrLimitError). Anything else — the request limiter. Read for the
 * restart only: another daily limiter elsewhere would not be «restarts».
 */
export function ocrLimitOf(
  details: { limit?: unknown; window?: unknown; jobs_limit?: unknown; pages_limit?: unknown } | undefined,
): { limit: 'ocr_restarts' | 'ocr_allowance' | 'requests'; limitCount?: number } {
  if (details?.jobs_limit !== undefined || details?.pages_limit !== undefined) {
    return { limit: 'ocr_allowance' };
  }
  if (typeof details?.limit === 'number' && details.window === '86400 seconds') {
    return { limit: 'ocr_restarts', limitCount: details.limit };
  }
  return { limit: 'requests' };
}

/** Seconds until `resetAt` (ISO), whole and above zero, or undefined. */
function secondsUntil(resetAt: string | undefined, now = Date.now()): number | undefined {
  if (!resetAt) return undefined;
  const at = Date.parse(resetAt);
  if (!Number.isFinite(at)) return undefined;
  const seconds = Math.ceil((at - now) / 1000);
  return seconds > 0 ? seconds : undefined;
}

/** «3 ч 5 мин», «12 мин», «40 сек» — how long until a limit lets go. */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} сек`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** The site's own phrase for a refusal whose server text says too little. */
function ownPhrase(r: Refusal): string | undefined {
  switch (r.code) {
    case 'RATE_LIMIT_EXCEEDED': {
      const seconds = r.retryAfter ?? secondsUntil(r.resetAt);
      const wait = seconds ? formatWait(seconds) : null;
      // A restart of the menu's recognition (T2, T3; registry item Н5).
      if (r.limit === 'ocr_restarts') return restartsSpent(r.limitCount ?? 5, wait);
      if (r.limit === 'ocr_allowance') return recognitionShareSpent(wait);
      if (r.limit === 'unconfirmed_uploads') {
        // The server's own sentence: confirming the e-mail lifts the ceiling.
        return 'Загрузки для учётных записей без подтверждённой почты на сегодня закончились. '
          + 'Подтвердите почту в профиле — и продолжите.';
      }
      if (r.limit === 'daily_uploads') {
        // The allowance renews at Minsk midnight (backend uploadAllowance.js).
        return wait
          ? `Лимит загрузок на сегодня исчерпан. Загрузить снова можно через ${wait} — после полуночи.`
          : 'Лимит загрузок на сегодня исчерпан. Загрузить снова можно после полуночи.';
      }
      return wait
        ? `Слишком много запросов подряд. Попробуйте через ${wait}.`
        : 'Слишком много запросов подряд. Попробуйте чуть позже.';
    }
    // The site's own words even when the server's text turns Russian (the
    // thread Н8 gives the server its texts): the partner reads T4 and T7б.
    case 'NO_PDF_MENUS':
      return NO_MENU_FILES;
    case 'MENU_ITEM_NOT_FOUND':
      return MENU_TEXTS.itemGone;
    case 'SLUG_COLLISION':
      // Two saves under one name took the same page address at once; the
      // next save picks a free one (backend generateUniqueSlug).
      return 'Адрес страницы для этого названия только что занят. Сохраните ещё раз — сайт подберёт свободный.';
    default:
      return undefined;
  }
}

/** The fields a field check named, each by name, in one sentence. */
function fieldsPhrase(fields: FieldRefusal[] | undefined): string | undefined {
  if (!fields?.length) return undefined;
  const texts: string[] = [];
  for (const f of fields) {
    const text = (personText(f.message) ?? FIELD_TEXTS_RU[f.field])?.replace(/\.$/, '');
    if (text && !texts.includes(text)) texts.push(text);
  }
  if (!texts.length) return undefined;
  return `Не сохранено. Проверьте: ${texts.join('; ')}.`;
}

/** The text a partner reads for a refusal (order — the file header). */
export function refusalMessage(r: Refusal): string {
  return (
    ownPhrase(r) ??
    personText(r.message) ??
    (r.code === 'VALIDATION_ERROR' ? fieldsPhrase(r.fields) : undefined) ??
    (r.code && CODE_RU[r.code]) ??
    FALLBACK
  );
}

/** The site's text by code alone (no server text at hand). */
export function messageForEstablishmentError(code: string | undefined): string {
  return refusalMessage({ code });
}
