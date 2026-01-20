# Mobile Test 4 - Отчёт о тестировании

**Дата:** 21 января 2026
**Тестировщик:** Всеволод + Claude
**Версия:** После Mobile_Test_3
**Статус:** Требуется анализ архитектора

---

## Цель тестирования

Исправить проблему из Mobile_Test_3: после успешного создания заведения через мастер регистрации партнёра UI не обновлялся - пользователь возвращался в личный кабинет и видел кнопку "Разместить заведение" вместо созданного заведения.

---

## Выявленные проблемы

### 1. JWT токен не обновляется после смены роли (user → partner)

**Проблема:**
При создании заведения backend обновляет роль пользователя в БД с `user` на `partner`, но JWT токен в приложении сохраняет старую роль `user`. Последующие запросы к `/api/v1/partner/establishments` возвращают 403 Forbidden.

**Попытка исправления:**
- Backend теперь возвращает новые токены с `role: partner` в ответе на создание заведения
- Flutter сохраняет новые токены через `AuthService.updateTokens()`

**Файлы изменены:**
- `backend/src/controllers/establishmentController.js` - добавлена генерация новых токенов
- `mobile/lib/services/establishments_service.dart` - сохранение новых токенов
- `mobile/lib/services/auth_service.dart` - добавлен метод `updateTokens()`

---

### 2. PartnerDashboardProvider не перезагружает данные

**Проблема:**
После создания заведения `PartnerDashboardProvider._isInitialized = true` (от предыдущей загрузки), поэтому `initializeIfNeeded()` не загружает новые данные.

**Попытка исправления:**
- Добавлен вызов `partnerDashboardProvider.reset()` после успешного создания
- `reset()` теперь также вызывает `loadEstablishments()`

**Файлы изменены:**
- `mobile/lib/screens/partner/partner_registration_screen.dart` - добавлен reset()
- `mobile/lib/providers/partner_dashboard_provider.dart` - reset() теперь async и вызывает loadEstablishments()

---

### 3. Сессия теряется при ошибках 429 (Rate Limit)

**Проблема:**
В `AuthProvider._initialize()` при любой ошибке (включая 429) вызывался `clearAuthData()`, удаляя валидные токены. Пользователь видел форму входа вместо личного кабинета.

**Попытка исправления:**
- Добавлена проверка типа ошибки: только при 401 очищаются токены
- При 429 сохраняется статус `authenticated`

**Файлы изменены:**
- `mobile/lib/providers/auth_provider.dart`

---

### 4. Бесконечный цикл запросов к API

**Проблема:**
ProfileScreen вызывал `loadEstablishments()` в двух местах:
1. `initState` → `initializeIfNeeded()`
2. `build` → через `addPostFrameCallback`

Каждый `notifyListeners()` вызывал rebuild, который снова запускал загрузку.

**Попытка исправления:**
- Удалена дублирующая логика из `build` метода
- Оставлен только вызов в `initState`

**Файлы изменены:**
- `mobile/lib/screens/profile/profile_screen.dart`

---

### 5. Агрессивный Rate Limiting

**Проблема:**
Стандартный лимит 100 запросов/минуту для авторизованных пользователей быстро исчерпывался при тестировании, особенно из-за бесконечного цикла.

**Попытка исправления:**
- Увеличен лимит до 1000 запросов/минуту в `.env`
- Регулярная очистка Redis: `docker exec -i rgb_redis redis-cli FLUSHALL`

**Файлы изменены:**
- `backend/.env` - добавлены RATE_LIMIT_AUTHENTICATED=1000, RATE_LIMIT_UNAUTHENTICATED=3000

---

## Нерешённые проблемы

### 1. Потеря сессии при входе
После успешного входа и перехода в личный кабинет приложение иногда показывает форму входа вместо данных пользователя. Причина не до конца выяснена.

**Возможные причины:**
- Race condition между инициализацией AuthProvider и навигацией
- Неправильная синхронизация состояния между провайдерами
- Проблемы с сохранением/загрузкой токенов из secure storage

### 2. Кнопка "Отправить" не работает
После заполнения всех шагов мастера и нажатия "Отправить":
- Заведение создаётся в БД (проверено)
- Роль меняется на `partner` (проверено)
- Но пользователь не видит успешную навигацию обратно в профиль

**Возможные причины:**
- Ошибка при парсинге ответа от backend
- Исключение в `_handleSubmit` после создания
- Проблема с навигацией

---

## Тестовые данные (очищены)

Были созданы и удалены:
- falyron@gmail.com - 3 заведения (AI Cafe, AI Restoran, Test Restoran)
- falyronencom@gmail.com - 1 заведение (Formula 1)
- totomercedes@gmail.com
- toto@gmail.com

---

## Изменённые файлы (не закоммичены)

### Backend:
1. `backend/src/controllers/establishmentController.js` - генерация новых токенов при смене роли
2. `backend/.env` - увеличенные rate limits

### Mobile:
1. `mobile/lib/providers/auth_provider.dart` - улучшенная обработка ошибок 429
2. `mobile/lib/providers/partner_dashboard_provider.dart` - reset() теперь async с загрузкой
3. `mobile/lib/screens/profile/profile_screen.dart` - убран дублирующий вызов загрузки
4. `mobile/lib/screens/partner/partner_registration_screen.dart` - вызов reset() после создания
5. `mobile/lib/services/establishments_service.dart` - сохранение новых токенов
6. `mobile/lib/services/auth_service.dart` - метод updateTokens()

---

## Рекомендации

### Вариант A: Откатить изменения и начать заново
- Вернуться к состоянию после Mobile_Test_3
- Провести более детальный анализ архитектуры аутентификации
- Добавить логирование для отладки

### Вариант B: Продолжить отладку
- Добавить детальное логирование во все точки flow
- Протестировать каждый компонент изолированно
- Возможно проблема в одном конкретном месте

### Вариант C: Закоммитить текущие изменения
- Некоторые исправления корректны (генерация новых токенов, обработка 429)
- Продолжить отладку в следующей сессии

---

## Результат: Частичный коммит

**Коммит:** `00dc390`
**Сообщение:** `fix: Handle JWT token refresh when user role changes to partner`

### Закоммичены (полезные исправления):
1. `backend/src/controllers/establishmentController.js` - генерация новых токенов при смене роли
2. `mobile/lib/providers/auth_provider.dart` - не удалять токены при 429
3. `mobile/lib/services/auth_service.dart` - метод updateTokens()
4. `mobile/lib/services/establishments_service.dart` - сохранение новых токенов
5. `reports/Mobile_Test_4.md` - этот отчёт

### Откачены (спорные изменения):
1. `mobile/lib/providers/partner_dashboard_provider.dart` - reset() с автозагрузкой
2. `mobile/lib/screens/partner/partner_registration_screen.dart` - вызов reset()
3. `backend/.env` - увеличенные rate limits (не отслеживается git)

---

## Выводы

Тестирование выявило несколько взаимосвязанных проблем в flow аутентификации и управления состоянием. Основная сложность - отладка асинхронных процессов и race conditions между провайдерами.

**Закоммичены** архитектурно правильные исправления (JWT refresh при смене роли, обработка 429).
**Требуется** дальнейшая отладка проблем с сессией и навигацией после создания заведения.
