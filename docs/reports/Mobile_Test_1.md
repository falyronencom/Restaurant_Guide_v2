# Mobile Test_1 Report

**Дата:** 2026-01-20
**Commit:** 1a71a63

## Цель тестирования
Проверка базового user-flow мобильного приложения на Android эмуляторе с подключением к локальному бэкенду.

## Окружение
- **Эмулятор:** Pixel 9a (Android 16, API 36)
- **Бэкенд:** Node.js на localhost:3000
- **База данных:** PostgreSQL 15.8 + PostGIS в Docker
- **Redis:** localhost:6379

## Выявленные проблемы и решения

### 1. Connection refused на localhost:3000
**Проблема:** Android эмулятор не может подключиться к localhost хоста.
**Решение:** Изменён URL в `environment.dart` с `localhost:3000` на `10.0.2.2:3000`

### 2. Ошибка 422 "Invalid bounds coordinates"
**Проблема:** Flutter отправлял параметры `north/south/east/west`, бэкенд ожидал `neLat/swLat/neLon/swLon`
**Решение:** Исправлены имена параметров в `establishments_service.dart`

### 3. Пустая база данных
**Проблема:** Seed скрипт не работал из-за отсутствия изображений
**Решение:** Вручную добавлены 5 тестовых заведений через SQL:
- Кафе Минск (cafe, belarusian/european)
- Ресторан Традиция (restaurant, belarusian)
- Пиццерия Итальяно (pizzeria, italian)
- Бар Central (bar, international)
- Суши Бар Токио (restaurant, japanese/asian)

### 4. Ошибка парсинга: String vs int
**Проблема:** `type 'String' is not a subtype of type 'int' in type cast`
**Причина:** Бэкенд возвращает UUID (String), модель ожидала int
**Решение:** Изменён тип `Establishment.id` с `int` на `String` во всех файлах (~15 файлов)

### 5. Ошибка загрузки деталей заведения
**Проблема:** Endpoint `GET /api/v1/establishments/:id` не существовал
**Причина:** `useMockData = true` искал в mock данных, которые имели числовые id
**Решение:**
1. Добавлен публичный endpoint `GET /api/v1/search/establishments/:id`
2. Установлено `useMockData = false`
3. Исправлен путь в Flutter сервисе

## Изменённые файлы

### Backend
- `backend/src/services/searchService.js` - добавлен `getEstablishmentById()`
- `backend/src/controllers/searchController.js` - добавлен контроллер
- `backend/src/routes/v1/searchRoutes.js` - добавлен роут

### Mobile (Flutter)
- `mobile/lib/config/environment.dart` - URL для эмулятора
- `mobile/lib/models/establishment.dart` - id: String, обновлён fromJson
- `mobile/lib/services/establishments_service.dart` - параметры API, useMockData
- `mobile/lib/providers/establishments_provider.dart` - Set<String> favoriteIds
- Множество экранов и сервисов - обновлены типы id

## Результаты тестирования

| Функция | Статус |
|---------|--------|
| Карта загружается | ✅ |
| Маркеры отображаются | ✅ |
| Клик на маркер → превью | ✅ |
| Кнопка "Подробнее" → детали | ✅ |

## Следующие шаги
1. Тестирование регистрации партнера
2. Проверка соответствия UI с Figma макетами
3. Тестирование поиска и фильтров
