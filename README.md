# Nirivio

Гид по кафе и ресторанам Минска: поиск не только заведения, но и конкретного блюда с ценой. Меню заведений распознаются с фотографий и PDF с помощью ИИ.

> **In English.** Nirivio is a restaurant guide for Minsk, Belarus, that lets people search for a specific dish and its price, not just a venue; menus are extracted from photos and PDFs with AI. The repository holds four parts: a Node.js/Express API on PostgreSQL + PostGIS, a Flutter mobile app, a Flutter Web moderation panel, and a Next.js public website with a partner cabinet. The product UI, code comments and commit messages are in Russian. Local setup and test commands are below; all rights reserved.

## Состояние

- Работает на Railway: API, публичный сайт и панель модерации. Сайт пока закрыт от поисковиков, домен не привязан.
- Каталог — несколько десятков заведений Минска, наполненных вручную, с распознанными меню.
- Мобильное приложение распространяется тестовыми сборками (TestFlight на iOS, APK на Android); в магазинах приложений его нет.
- Публичного запуска не было.

Продукт сделан одним человеком в паре с ИИ-агентами (Claude Code).

## Из чего состоит

| Часть | Каталог | Что делает | Стек |
|---|---|---|---|
| API | `backend/` | REST API `/api/v1`: заведения, поиск, меню, отзывы, избранное, брони, акции, уведомления, модерация | Node.js 20, Express, PostgreSQL 16 + PostGIS, Redis 7, Jest |
| Приложение | `mobile/` | iOS и Android: поиск и карта, карточки заведений, отзывы, избранное; кабинет заведения (карточка, меню, акции, брони, статистика) | Flutter 3.35, Provider, Dio, Yandex MapKit, Firebase Cloud Messaging |
| Панель модерации | `admin-web/` | Проверка заявок и карточек, отзывы, позиции меню, журнал действий, аналитика; есть роль «только просмотр» | Flutter Web, GoRouter, Provider |
| Сайт | `web/` | Публичная витрина и каталог, умный поиск, карта, вход и избранное; кабинет заведения | Next.js 16 (App Router, серверный рендеринг), React 19, TypeScript, Tailwind CSS 4 |

Внешние сервисы: Cloudinary (фото и PDF меню), OpenRouter (модели для разбора поисковых запросов и распознавания меню), Resend (письма), Firebase (push-уведомления), Яндекс Карты, вход через Google и Яндекс.

```
 mobile (Flutter) ─────┐
 admin-web (Flutter) ──┼── HTTPS /api/v1 ──► backend (Express) ──► PostgreSQL + PostGIS
 web (Next.js, SSR) ───┘   сайт ходит в API              │      └► Redis (лимиты, кеш)
                           со своего сервера             └► Cloudinary · OpenRouter · Resend · FCM
```

## Структура репозитория

```
backend/
  src/routes/v1/      адреса API и цепочки middleware
  src/controllers/    разбор запроса и формат ответа
  src/services/       бизнес-правила
  src/models/         SQL-запросы
  src/projections/    публичные формы ответов
  src/tests/          unit, integration и e2e (Jest; integration — на настоящей БД)
  migrations/         миграции 001–035 и снимок схемы production_schema.sql
  scripts/            операторские скрипты (миграции на сервере, снимок данных, учётные записи панели)
mobile/               приложение Flutter
admin-web/            панель Flutter Web (Dockerfile + Caddyfile для хостинга)
web/                  сайт Next.js; тесты в web/__tests__/
tools/brand/          генератор знака и иконок для всех платформ
.github/workflows/    CI
```

## Локальный запуск

Нужны: Node.js 20 (`.nvmrc`; в `backend/package.json` и `web/package.json` — `>=20.9.0 <21`), npm 10, Docker, Flutter 3.35.2.

Команды ниже — для bash (Linux, macOS, Git Bash на Windows) и запускаются из корня репозитория, если не сказано иное. Они повторяют рецепт CI (`.github/workflows/ci.yml`); `docker-compose.yml` в корне описывает прежнюю локальную среду и для этих шагов не нужен. На Windows клонируйте репозиторий в короткий путь (например, `C:\dev\nirivio`) или включите `git config --global core.longpaths true`: часть путей внутри `mobile/ios` длинная.

### База данных и Redis

```bash
docker run -d --name rg-pg -p 5432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=restaurant_guide_test \
  postgis/postgis:16-3.4
docker run -d --name rg-redis -p 6379:6379 redis:7-alpine

# Дождаться, когда сервер примет соединения по сети (первый старт образа занимает до минуты)
until docker exec rg-pg pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 2; done
```

Схема разворачивается из снимка `production_schema.sql` (состав рабочего сервера) и миграций поверх него — так же, как в CI. Миграция 030 намеренно не применяется: причина записана в шапке снимка.

```bash
for f in production_schema 031_seed_import_registry 032_password_reset_tokens \
         033_menu_push_preference 034_viewer_role 035_sessions_revoked_at; do
  docker exec -i rg-pg psql -U postgres -d restaurant_guide_test -v ON_ERROR_STOP=1 -q \
    < backend/migrations/$f.sql
done
```

Сообщения `NOTICE: ... already exists, skipping` ожидаемы: снимок уже содержит эти миграции, а повторное применение ничего не меняет.

### Backend: тесты

Тесты читают настройки из `backend/.env.test` (файл не хранится в репозитории). Значения — только тестовые:

```bash
cat > backend/.env.test <<'EOF'
NODE_ENV=test
DB_HOST=localhost
DB_PORT=5432
DB_NAME=restaurant_guide_test
DB_USER=postgres
DB_PASSWORD=postgres
DB_MIN_CONNECTIONS=2
DB_MAX_CONNECTIONS=10
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=1
JWT_SECRET=local-only-test-secret-at-least-32-characters-long
JWT_ACCESS_EXPIRY=4h
JWT_REFRESH_EXPIRY=30d
LOG_LEVEL=error
OPENROUTER_API_KEY=
CLOUDINARY_CLOUD_NAME=test
CLOUDINARY_API_KEY=000000000000000
CLOUDINARY_API_SECRET=ci-dummy-no-network-calls-in-tests
EOF

cd backend
npm ci
npm run lint
TZ=Europe/Minsk NODE_ENV=test node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand
TZ=UTC NODE_ENV=test node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --testPathPatterns booking
cd ..
```

- `--experimental-vm-modules` обязателен: backend написан на ES-модулях.
- `--runInBand`: все наборы работают с одной базой, параллельные процессы мешают друг другу.
- Часовой пояс задан намеренно. Основной прогон идёт под `Europe/Minsk`: один тест сверяет часы процесса и базы, поэтому под UTC он намеренно падает. Брони дополнительно проверяются под `UTC` — в этом поясе работает сервер.
- Windows: `npm test` здесь не сработает (скрипт начинается с `NODE_ENV=test`, а npm на Windows запускает его через `cmd`). Git Bash не передаёт процессу Node значение `TZ` вида `Europe/Minsk` (`TZ=UTC` проходит), поэтому основной прогон удобнее запускать из PowerShell, в каталоге `backend`:

  ```powershell
  $env:TZ = 'Europe/Minsk'; $env:NODE_ENV = 'test'
  node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand
  ```

### Backend: запуск сервера

```bash
docker exec rg-pg createdb -U postgres restaurant_guide_dev
for f in production_schema 031_seed_import_registry 032_password_reset_tokens \
         033_menu_push_preference 034_viewer_role 035_sessions_revoked_at; do
  docker exec -i rg-pg psql -U postgres -d restaurant_guide_dev -v ON_ERROR_STOP=1 -q \
    < backend/migrations/$f.sql
done

cp backend/.env.example backend/.env
# В backend/.env: DB_NAME=restaurant_guide_dev, DB_PASSWORD=postgres,
# JWT_SECRET — случайная строка от 32 символов:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

cd backend
npm ci
npm run dev     # сервер занимает этот терминал; следующие команды — в другом, из корня
```

```bash
curl http://localhost:3000/api/v1/health
```

Для старта нужны только PostgreSQL, Redis и `JWT_SECRET`. Без ключей Cloudinary, OpenRouter, Resend и Firebase сервер работает, но загрузка файлов, распознавание меню, разбор запросов моделью, письма и push недоступны. База после развёртывания пустая.

Учётная запись для панели модерации (скрипт берёт настройки базы из окружения, не из `.env`):

```bash
cd backend
DB_NAME=restaurant_guide_dev DB_PASSWORD=postgres \
  ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='<пароль>' node scripts/create-admin.js
cd ..
```

### Сайт (web)

```bash
cd web
npm ci
npm run lint
npm test
npx tsc --noEmit

cp .env.example .env.local
# в .env.local: API_URL=http://localhost:3000, SITE_URL=http://localhost:3001
npx next dev --port 3001        # сайт — http://localhost:3001
```

Без правки `API_URL` в `.env.local` сайт обращается к рабочему API.

`next build` требует доступного API: страницы публичной части при сборке запрашивают данные. Поэтому в CI вместо сборки проверяются типы (`tsc --noEmit`).

### Приложение и панель (Flutter)

```bash
cd admin-web        # или mobile
flutter pub get
flutter analyze
flutter test
cd ..
```

Панель с локальным API: `flutter run -d chrome --dart-define=ENV=local` в каталоге `admin-web` (адрес API — `http://localhost:3000`). По умолчанию обе Flutter-части смотрят на рабочий API.

Для сборки приложения нужны файлы, которых в репозитории нет намеренно: конфигурация Firebase (`mobile/android/app/google-services.json`) и ключ Yandex MapKit (`mobile/android/local.properties`, `mobile/ios/Flutter/Secrets.xcconfig` — образец в `Secrets.xcconfig.example`). Анализ и тесты работают без них.

## CI

`.github/workflows/ci.yml` запускается на каждый pull request и на push в `main`:

| Задача | Что проверяет |
|---|---|
| Backend — jest | lint и полный набор тестов на PostgreSQL + PostGIS и Redis; брони — ещё раз под UTC |
| Backend — уязвимости зависимостей | `npm audit` по lock-файлу; high и critical вне списка разобранных исключений останавливают гейт |
| Web | lint, тесты, проверка типов |
| Flutter — mobile, admin-web | `flutter analyze`, `flutter test`; для панели — ещё и сборка web-версии |

Второй workflow (`model-expiry.yml`) раз в неделю проверяет сроки жизни моделей ИИ, которые использует backend.

## Развёртывание

Railway, автоматически из `main`: три сервиса из этого репозитория (`backend/`, `web/`, `admin-web/`), PostgreSQL с PostGIS и Redis. Сборщик — Railpack (`railpack.json` в `backend/` и `web/`), панель собирается по `admin-web/Dockerfile`. Миграции применяются на сервере вручную скриптом `backend/scripts/apply-migration-production.js`; снимок `production_schema.sql` повторяет состав рабочей базы.

## Права

© 2025–2026 falyronencom. Все права защищены.

Код открыт для просмотра. Лицензия на использование, копирование и распространение не предоставляется.
