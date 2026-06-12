/**
 * Russian messages for partner establishment error codes (Phase C Slice 1,
 * Segment B). Pure map — shared by Server Actions and client islands (mirrors the
 * Slice 1-2 русификация pattern). Backend validator/service texts are English and
 * never surface; unknown codes fall back to a neutral message.
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
  MEDIA_LIMIT_EXCEEDED: 'Превышен лимит фотографий для заведения.',
  DUPLICATE_NAME: 'Заведение с таким названием у вас уже есть.',
  ESTABLISHMENT_NAME_EXISTS: 'Заведение с таким названием у вас уже есть.',
  FORBIDDEN: 'Нет доступа к этому заведению.',
  ESTABLISHMENT_NOT_FOUND: 'Заведение не найдено.',
  INVALID_STATUS_TRANSITION: 'Действие недоступно в текущем статусе заведения.',
  NO_SESSION: 'Сессия истекла. Войдите снова.',
  NETWORK: 'Сеть недоступна. Попробуйте позже.',
};

export function messageForEstablishmentError(code: string | undefined): string {
  return (
    (code && CODE_RU[code]) ||
    'Не удалось выполнить запрос. Попробуйте позже.'
  );
}
