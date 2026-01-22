# Mobile Test_5 Report

**Дата:** 2026-01-22
**Commit:** 5d57b06

## Цель тестирования
Тестирование загрузки списка заведений и перехода на детальную карточку.

## Окружение
- **Эмулятор:** Android (API 36)
- **Бэкенд:** Node.js на 10.0.2.2:3000
- **База данных:** PostgreSQL 15.8 + PostGIS в Docker

## Выявленные проблемы и решения

### 1. Ошибка 422: Отсутствие координат в запросе поиска
**Проблема:** При переходе на список заведений API возвращал 422 Validation Error
**Причина:** Backend требовал обязательные параметры `latitude` и `longitude`, но mobile их не передавал.

**Решение (Backend):**
- Координаты сделаны опциональными в `searchController.js`
- Добавлен метод `searchWithoutLocation()` в `searchService.js`
- Без координат возвращаются все заведения, отсортированные по рейтингу

**Решение (Mobile):**
- Добавлены дефолтные координаты Минска (53.9006, 27.5590) в `establishments_provider.dart`
- Координаты передаются в каждый запрос поиска
- Добавлен метод `setUserLocation()` для будущей интеграции геолокации

### 2. Ошибка парсинга ответа API
**Проблема:** API возвращал успешный ответ, но UI показывал "Ошибка загрузки"
**Причина:** Несоответствие форматов данных:
- Backend: `{ success: true, data: { establishments: [...], pagination: {...} } }`
- Mobile ожидал: `{ data: [...], meta: {...} }`

**Решение:**
- Добавлена трансформация ответа в `establishments_service.dart`
- Маппинг полей пагинации: `limit` → `per_page`, `totalPages` → `total_pages`

### 3. Timeout при подключении к API
**Проблема:** Запросы падали по таймауту (10 секунд)
**Причина:** Слишком короткий `connectTimeout` для медленного подключения эмулятора

**Решение:** Увеличен `apiConnectTimeout` с 10 до 30 секунд в `environment.dart`

## Дополнительные улучшения
- Улучшено позиционирование UI элементов на экране детальной карточки

## Результат
Список заведений загружается успешно. Переход на детальную карточку работает.

## Файлы изменены
- `backend/src/controllers/searchController.js`
- `backend/src/services/searchService.js`
- `mobile/lib/config/environment.dart`
- `mobile/lib/providers/establishments_provider.dart`
- `mobile/lib/services/establishments_service.dart`
- `mobile/lib/screens/establishment/detail_screen.dart`
