# Настройка OAuth провайдеров для Nirivio (Restaurant Guide Belarus)

## Контекст

Код OAuth уже реализован (бэкенд + мобайл). Нужно:
1. Зарегистрировать приложение в Google Cloud Console и Yandex OAuth
2. Получить client ID от каждого провайдера
3. Разместить конфигурационные файлы и переменные в нужных местах

---

## Часть 1: Google Sign-In

### Шаг 1.1 — Google Cloud Console

1. Перейти на https://console.cloud.google.com/
2. Создать новый проект (или использовать существующий)
3. В боковом меню: **APIs & Services → OAuth consent screen**
   - User Type: **External**
   - App name: **Nirivio** (или Restaurant Guide Belarus)
   - User support email: твой email
   - Developer contact: твой email
   - Scopes: добавить `email` и `profile`
   - Test users: добавить свой Google аккаунт (пока приложение в Testing mode)
   - Сохранить

### Шаг 1.2 — Создать OAuth Client ID для iOS

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **iOS**
3. Name: `Nirivio iOS`
4. Bundle ID: **тот же bundle ID что в Xcode** (посмотреть: Xcode → Runner → General → Bundle Identifier)
5. Нажать Create
6. **Скачать plist файл** — это `GoogleService-Info.plist`
7. Записать **iOS Client ID** (формат: `XXXX.apps.googleusercontent.com`)

### Шаг 1.3 — Создать OAuth Client ID для Web (для бэкенда)

1. **Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `Nirivio Backend`
4. Authorized redirect URIs: оставить пустым (бэкенд верифицирует токен, не редиректит)
5. Нажать Create
6. Записать **Web Client ID** (формат: `XXXX.apps.googleusercontent.com`)

### Шаг 1.4 — Разместить файлы и переменные

**iOS (для сборки на Mac):**
- Скопировать скачанный `GoogleService-Info.plist` в `mobile/ios/Runner/GoogleService-Info.plist`
- Убедиться что в plist есть ключ `CLIENT_ID` (iOS Client ID) и `REVERSED_CLIENT_ID`
- Добавить `REVERSED_CLIENT_ID` как URL scheme в `Info.plist`:

В файле `mobile/ios/Runner/Info.plist`, внутри массива `CFBundleURLTypes` (рядом с существующей записью для `restaurantguide`), добавить:

```xml
<dict>
    <key>CFBundleTypeRole</key>
    <string>Editor</string>
    <key>CFBundleURLSchemes</key>
    <array>
        <string>СЮДА_REVERSED_CLIENT_ID</string>
    </array>
</dict>
```

Значение `REVERSED_CLIENT_ID` берётся из скачанного `GoogleService-Info.plist` (формат: `com.googleusercontent.apps.XXXX`).

**Если в `GoogleService-Info.plist` нет `SERVER_CLIENT_ID`:**
Добавить ключ вручную:
```xml
<key>SERVER_CLIENT_ID</key>
<string>WEB_CLIENT_ID_ИЗ_ШАГА_1.3</string>
```
Это нужно чтобы `google_sign_in` возвращал `idToken` для верификации на бэкенде.

**Railway (бэкенд):**
- Добавить переменную окружения: `GOOGLE_CLIENT_ID` = **Web Client ID из шага 1.3**
- Это тот же ID, что и `SERVER_CLIENT_ID` в plist

---

## Часть 2: Yandex OAuth

### Шаг 2.1 — Регистрация приложения

1. Перейти на https://oauth.yandex.ru/
2. Войти с Яндекс аккаунтом
3. Нажать **Зарегистрировать новое приложение**
4. Название: **Nirivio** (или Restaurant Guide Belarus)
5. Платформы: выбрать **Веб-сервисы** (для callback URI)

### Шаг 2.2 — Настроить права (scopes)

Добавить:
- **Доступ к адресу электронной почты** (`login:email`)
- **Доступ к логину, имени и фамилии, полу** (`login:info`)

### Шаг 2.3 — Настроить Redirect URI

В разделе Redirect URI добавить:
```
restaurantguide://auth/yandex
```

Это кастомная URL-схема, зарегистрированная в приложении (Android: `AndroidManifest.xml`, iOS: `Info.plist`).

### Шаг 2.4 — Записать Client ID

После создания приложения Яндекс покажет:
- **ClientID** (он же ID приложения) — это то, что нужно
- Client Secret — НЕ нужен для implicit flow (мобайл использует `response_type=token`)

### Шаг 2.5 — Разместить переменные

**Мобайл (при сборке):**
Client ID передаётся через `--dart-define` при сборке:
```bash
flutter build ios --dart-define=YANDEX_CLIENT_ID=ваш_client_id
```

**Railway (бэкенд):**
Яндекс-токен верифицируется через API вызов к `login.yandex.ru/info` — дополнительных переменных на Railway для Яндекса НЕ нужно.

---

## Часть 3: Сборка и тестирование

### Полная команда сборки iOS:

```bash
cd mobile
flutter build ios --dart-define=YANDEX_CLIENT_ID=ваш_yandex_client_id
```

Примечание: `GOOGLE_CLIENT_ID` для мобайла передавать через `--dart-define` не обязательно — `google_sign_in` читает его напрямую из `GoogleService-Info.plist`.

### Чек-лист перед тестированием:

- [ ] `GoogleService-Info.plist` в `mobile/ios/Runner/`
- [ ] `REVERSED_CLIENT_ID` добавлен как URL scheme в `Info.plist`
- [ ] `SERVER_CLIENT_ID` есть в `GoogleService-Info.plist` (= Web Client ID)
- [ ] `GOOGLE_CLIENT_ID` установлен на Railway (= Web Client ID)
- [ ] Yandex OAuth app создан с redirect URI `restaurantguide://auth/yandex`
- [ ] `YANDEX_CLIENT_ID` передаётся при сборке через `--dart-define`
- [ ] Твой Google аккаунт добавлен как test user в OAuth consent screen

### Тестирование:

1. **Google**: Нажать "Продолжить с Google" → должен появиться Google Sign-In sheet → выбрать аккаунт → перенаправление на главный экран
2. **Яндекс**: Нажать "Продолжить с Яндекс" → откроется браузер с Яндекс авторизацией → после входа вернёт в приложение → перенаправление на главный экран
3. **Повторный запуск**: Закрыть и открыть приложение → пользователь должен остаться авторизован (токены в Secure Storage)
4. **Email логин**: Убедиться что обычный вход по email/паролю всё ещё работает

---

## Справка: Где что лежит в коде

| Что | Где |
|-----|-----|
| Бэкенд OAuth эндпоинт | `POST /api/v1/auth/oauth { provider, token }` |
| Бэкенд верификация Google | `backend/src/services/oauthService.js` → `verifyGoogleToken()` |
| Бэкенд верификация Yandex | `backend/src/services/oauthService.js` → `verifyYandexToken()` |
| Мобайл OAuth сервис | `mobile/lib/services/auth_service.dart` → `loginWithGoogle()` / `loginWithYandex()` |
| Мобайл OAuth провайдер | `mobile/lib/providers/auth_provider.dart` → `loginWithGoogle()` / `loginWithYandex()` |
| Конфиг env vars | `mobile/lib/config/environment.dart` |
| iOS URL schemes | `mobile/ios/Runner/Info.plist` → `CFBundleURLTypes` |
| Android callback | `mobile/android/app/src/main/AndroidManifest.xml` → `CallbackActivity` |
