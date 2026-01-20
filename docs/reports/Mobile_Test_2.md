# Mobile Test_2 Report

**Дата:** 2026-01-20
**Commit:** 3d9a13d

## Цель тестирования
Продолжение тестирования: регистрация пользователя, исправление багов UI, подготовка к тестированию регистрации партнера.

## Окружение
- **Эмулятор:** Pixel 9a (Android 16, API 36)
- **Бэкенд:** Node.js на 10.0.2.2:3000
- **База данных:** PostgreSQL 15.8 + PostGIS в Docker

## Выявленные проблемы и решения

### 1. Неправильные координаты тестовых заведений
**Проблема:** Маркеры показывались не в тех местах (адрес "Зыбицкая 15" на Проспекте Независимости)
**Причина:** Координаты были введены примерно, не соответствовали реальным адресам
**Решение:** Создан скрипт `fix-coordinates.js`, обновлены координаты на реальные GPS данные

### 2. Регистрация не работала (бэкенд требовал `name`)
**Проблема:** Flutter не отправлял поле `name` при регистрации
**Причина:** auth_service.register() не имел параметра name
**Решение:**
- Добавлен параметр `name` в auth_service.register()
- Обновлены auth_provider методы registerWithEmail/Phone
- Экраны регистрации передают имя

### 3. Авто-логин без верификации
**Проблема:** Бэкенд возвращал токены сразу, Flutter ожидал verification flow
**Причина:** Несоответствие между backend (авто-логин) и frontend (ожидание кода)
**Решение:**
- Обновлён RegisterResponse для поддержки direct auth tokens
- auth_service сохраняет токены если пришли сразу
- auth_provider проверяет hasDirectAuth и устанавливает authenticated

### 4. Партнерский dashboard показывался всем пользователям
**Проблема:** User с ролью 'user' видел партнерский dashboard с заведениями
**Причина:**
  - `useMock = true` в partner_service.dart возвращал mock данные всем
  - URL endpoint был неправильный (`/partners/me/` вместо `/partner/`)
**Решение:**
- Установлен `useMock = false`
- Исправлен URL на `/api/v1/partner/establishments`
- Добавлен reset() PartnerDashboardProvider при logout

### 5. Кнопка "Разместить заведение" не работала
**Проблема:** Кнопка вибрировала но навигация не происходила
**Причина:** Navigator внутри IndexedStack не мог найти роут
**Решение:** Добавлен `rootNavigator: true` в Navigator.of()

## Изменённые файлы

### Backend
- `backend/scripts/fix-coordinates.js` — новый скрипт для исправления координат

### Mobile (Flutter)
- `mobile/lib/models/auth_response.dart` — добавлена поддержка direct auth tokens
- `mobile/lib/services/auth_service.dart` — добавлен параметр name, сохранение токенов
- `mobile/lib/services/partner_service.dart` — useMock=false, исправлен URL
- `mobile/lib/providers/auth_provider.dart` — добавлен name, проверка hasDirectAuth
- `mobile/lib/screens/auth/email_registration_screen.dart` — передача name, проверка authenticated
- `mobile/lib/screens/auth/phone_registration_screen.dart` — аналогичные изменения
- `mobile/lib/screens/profile/profile_screen.dart` — rootNavigator, reset при logout

## Результаты тестирования

| Функция | Статус |
|---------|--------|
| Координаты маркеров | ✅ Исправлены |
| Регистрация по email | ✅ Работает |
| Авто-логин без верификации | ✅ Работает |
| Профиль user (не partner) | ✅ Корректный UI |
| Кнопка "Разместить заведение" | ✅ Навигация работает |
| Wizard регистрации партнера | ⏳ Открывается, требует тестирования |

## Следующие шаги (для Test_3)
1. Полное тестирование wizard регистрации партнера (7 шагов)
2. Проверка отправки данных на бэкенд
3. Проверка изменения роли user → partner
4. Тестирование поиска и фильтров
5. Проверка соответствия UI с Figma

## Примечания
- 75 тестовых заведений в seed-data не загружены (требуют изображения)
- SMS/Email верификация не настроена (платные сервисы)
- Бэкенд работает в режиме авто-логина без верификации
