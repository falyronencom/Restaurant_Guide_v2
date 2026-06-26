/**
 * Russian messages for partner establishment error codes (Phase C Slice 1,
 * Segment B; codes audited + aligned in the cabinet create-flow hardening,
 * CAT-C-3.x B1). Pure map — shared by the operations layer and client islands
 * (mirrors the Slice 1-2 русификация pattern). Backend validator/service texts
 * are English and never surface; unknown codes fall back to a neutral message.
 *
 * Keys MUST match the AppError codes thrown by backend establishmentService.js on
 * the create / update / submit paths. Manual cross-target sync (no shared package,
 * like constants.ts), so drift degrades SILENTLY to the neutral fallback — the
 * COORDINATES_CITY_MISMATCH / DUPLICATE_ESTABLISHMENT gap that masked the
 * create-flow failures. partner-errors.test.ts guards the cabinet code set.
 */

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
  // Upload / streaming-proxy codes (also surfaced from the media routes).
  FILE_TOO_LARGE: 'Файл слишком большой.',
  HTTP_413: 'Файл слишком большой.',
  INVALID_FILE_TYPE: 'Недопустимый тип файла.',
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
  ESTABLISHMENT_NOT_FOUND: 'Заведение не найдено.',
  INVALID_STATUS_TRANSITION: 'Действие недоступно в текущем статусе заведения.',
  INVALID_STATUS_FOR_SUBMISSION:
    'Это действие недоступно в текущем статусе заведения.',
  INCOMPLETE_ESTABLISHMENT:
    'Перед отправкой на модерацию заполните все обязательные поля.',
  CONSTRAINT_VIOLATION:
    'Данные заведения нарушают ограничения. Проверьте корректность полей.',
  NO_SESSION: 'Сессия истекла. Войдите снова.',
  NETWORK: 'Сеть недоступна. Попробуйте позже.',
};

export function messageForEstablishmentError(code: string | undefined): string {
  return (
    (code && CODE_RU[code]) ||
    'Не удалось выполнить запрос. Попробуйте позже.'
  );
}
