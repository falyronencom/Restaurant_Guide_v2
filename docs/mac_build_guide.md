# Инструкция для сборки iOS билда — Nirivio (Restaurant Guide Belarus)

> **Для кого**: Помощник (Claude Code на Mac) + человек без опыта программирования.
> **Цель**: Собрать новый билд и загрузить в TestFlight.

---

## Предварительные требования

- macOS с установленным **Xcode** (последняя стабильная версия)
- **Flutter SDK** установлен и доступен в PATH (`flutter --version` работает)
- **Apple Developer** аккаунт авторизован в Xcode (Xcode → Settings → Accounts)
- **Git** установлен
- Репозиторий склонирован: `git clone <URL> Restaurant_Guide_Belarus_v2`

---

## Пошаговая сборка

### Шаг 1: Обновить код

```bash
cd Restaurant_Guide_Belarus_v2
git pull origin main
```

### Шаг 2: Установить зависимости

```bash
cd mobile
flutter pub get
cd ios
pod install --repo-update
cd ..
```

> Если `pod install` падает — попробовать `pod repo update` затем снова `pod install`.

### Шаг 3: GoogleService-Info.plist (ОДНОРАЗОВО — только при первой сборке или если файл не в проекте)

**Проверка**: Открыть `mobile/ios/Runner.xcworkspace` в Xcode. В левой панели (Project Navigator) раскрыть папку **Runner**. Если `GoogleService-Info.plist` уже виден в списке — этот шаг пропустить.

**Если файла нет в проекте Xcode:**
1. В Xcode: ПКМ на папку **Runner** → **Add Files to "Runner"...**
2. Перейти в `mobile/ios/Runner/`, выбрать `GoogleService-Info.plist`
3. **Снять** галку "Copy items if needed" (файл уже на месте)
4. Убедиться что target **Runner** отмечен галкой
5. Нажать **Add**

> **Почему**: Файл `GoogleService-Info.plist` нужен для Google Sign-In. Без него приложение крашится при нажатии кнопки "Войти через Google".

### Шаг 4: Увеличить номер билда

Открыть `mobile/ios/Runner.xcworkspace` в Xcode:
1. В Project Navigator нажать на **Runner** (верхний, с синей иконкой)
2. Targets → **Runner** → вкладка **General**
3. Раздел **Identity**: поле **Build** — увеличить на 1 (например 14 → 15)
4. **Version** не менять (остаётся 1.0.0)

### Шаг 5: Собрать архив

**Через командную строку** (рекомендуется):

```bash
cd mobile
flutter build ios --release \
  --dart-define=YANDEX_CLIENT_ID=982354456cb441dd9335513c9e2a1551
```

Затем в Xcode:
1. Убедиться что выбрано **Any iOS Device (arm64)** (не симулятор!)
2. Меню **Product → Archive**
3. Дождаться завершения (2-5 минут)

**Альтернатива — только через Xcode:**
1. Открыть `Runner.xcworkspace`
2. Выбрать **Any iOS Device (arm64)**
3. Product → Archive

> ⚠️ При сборке только через Xcode, `YANDEX_CLIENT_ID` нужно добавить вручную:
> Runner → Build Settings → найти "User-Defined" → добавить `DART_DEFINES` с нужным значением.
> **Проще использовать `flutter build ios` из командной строки.**

### Шаг 6: Загрузить в TestFlight

1. После Archive откроется **Organizer** (или Window → Organizer)
2. Выбрать последний архив (самый свежий по дате)
3. Нажать **Distribute App**
4. Выбрать **TestFlight & App Store** → **Next**
5. Оставить все настройки по умолчанию → **Next** → **Upload**
6. Дождаться загрузки (2-10 минут, зависит от интернета)

### Шаг 7: Проверить в App Store Connect

1. Перейти на [App Store Connect](https://appstoreconnect.apple.com)
2. Мои приложения → **Nirivio**
3. Вкладка **TestFlight** — новый билд должен появиться через 5-15 минут
4. После обработки Apple → статус "Ready to Test"
5. Внешние тестировщики получат уведомление автоматически

---

## Быстрая версия (для повторных сборок)

```bash
cd Restaurant_Guide_Belarus_v2
git pull origin main
cd mobile
flutter pub get
cd ios && pod install --repo-update && cd ..
flutter build ios --release --dart-define=YANDEX_CLIENT_ID=982354456cb441dd9335513c9e2a1551
```

Затем в Xcode:
1. Открыть `Runner.xcworkspace`
2. Runner → General → Build += 1
3. Product → Archive
4. Distribute App → TestFlight & App Store → Upload

---

## Типичные проблемы

| Проблема | Решение |
|----------|---------|
| `pod install` не работает | `sudo gem install cocoapods` затем `pod repo update` |
| "No signing certificate" | Xcode → Settings → Accounts → скачать сертификаты |
| Archive недоступен (серый) | Убедиться что выбрано "Any iOS Device", а не симулятор |
| "Provisioning profile" ошибка | Runner → Signing & Capabilities → Team должен быть выбран |
| Google Sign-In крашит приложение | Проверить Шаг 3 — GoogleService-Info.plist в проекте Xcode |
| Yandex OAuth не работает | Убедиться что `--dart-define=YANDEX_CLIENT_ID=...` указан при `flutter build` |
| `flutter build ios` fails | `flutter clean` затем повторить с Шага 2 |

---

## Информация о проекте

- **Bundle ID**: `com.nirivio.app`
- **App Name**: Nirivio (Apple ID: 6759831819)
- **Минимальная iOS**: 13.0
- **YANDEX_CLIENT_ID**: `982354456cb441dd9335513c9e2a1551`
- **Google OAuth**: Настроен через `GoogleService-Info.plist` (CLIENT_ID внутри файла)
- **Репозиторий**: файл `.env` НЕ нужен — мобильное приложение использует `--dart-define` и plist-файлы
