# Nirivio — Restaurant Guide Belarus v2.0

Современная мобильная платформа для поиска и выбора заведений общепита в Беларуси.

## О проекте

Nirivio (Restaurant Guide Belarus) — кроссплатформенное мобильное приложение (iOS/Android) и веб-панель администрирования для поиска ресторанов, кафе и баров в 7 крупных городах Беларуси (Минск, Гродно, Брест, Гомель, Витебск, Могилёв, Бобруйск).

**Ключевые возможности**:
- Геолокационный поиск с умным ранжированием заведений (PostGIS, байесовский рейтинг)
- AI-поиск по естественному языку (Smart Search через OpenRouter)
- Система отзывов и рейтингов с защитой от злоупотреблений
- Избранное, карта с кластеризацией маркеров (Yandex MapKit), фильтры
- Система бронирования столиков (онлайн-букинг)
- Акции партнёров с Cloudinary-медиа и поисковым продвижением
- Push-уведомления (FCM) — 15 типов событий
- 7-шаговый визард регистрации заведений для партнёров
- Панель аналитики для партнёров (графики, тренды, просмотры акций)
- OAuth авторизация (Google + Яндекс)
- Веб-панель администрирования с модерацией, аналитикой и аудит-логом

**Текущий этап**: Horizon 3 завершён, подготовка к Horizon 4 — Public Web Platform (Next.js)

## Технологический стек

| Слой | Технологии |
|------|-----------|
| **Mobile** | Flutter 3.x, Provider, Dio, CachedNetworkImage, Yandex MapKit, Firebase (FCM) |
| **Admin Web** | Flutter Web, GoRouter, Provider, Dio, fl_chart |
| **Backend** | Node.js 18+, Express, JWT (access + refresh rotation), Zod |
| **Database** | PostgreSQL 15+ с PostGIS, Redis 7+ |
| **AI** | OpenRouter (Gemini 2.5 Flash-Lite) — Smart Search intent parsing |
| **Media** | Cloudinary (3 резолюции, WebP, progressive loading) |
| **Infrastructure** | Railway (production), Firebase, SendGrid |

## Структура репозитория

```
restaurant-guide-belarus/
├── backend/                 # Backend API (Node.js/Express)
│   ├── src/
│   │   ├── models/          # Модели данных (15 файлов)
│   │   ├── controllers/     # Обработчики запросов (20 файлов)
│   │   ├── services/        # Бизнес-логика (19 файлов)
│   │   ├── middleware/      # Auth, rate limiting, validation, upload
│   │   ├── routes/v1/       # API endpoints (13 route-файлов)
│   │   ├── config/          # PostgreSQL, Redis, Cloudinary, Firebase, OpenRouter
│   │   └── utils/           # JWT, logger, helpers
│   ├── migrations/          # 22 миграции БД (PostGIS)
│   └── src/tests/           # 48 test suites (~1100 тестов)
├── mobile/                  # Flutter мобильное приложение (com.nirivio.app)
│   ├── lib/
│   │   ├── config/          # Theme, dimensions, environment, cities, routes
│   │   ├── models/          # 12 моделей (establishment, booking, promotion...)
│   │   ├── providers/       # 10 ChangeNotifiers
│   │   ├── screens/         # UI по фичам (auth, search, map, favorites, partner, booking, notifications, profile)
│   │   ├── services/        # 11 API services (вкл. smart search, push, media)
│   │   └── widgets/         # Reusable components (smart search, booking, map, forms)
│   └── session_reports/     # Отчёты сессий разработки
└── admin-web/               # Flutter Web админ-панель
    ├── lib/
    │   ├── config/          # GoRouter + auth guard, environment
    │   ├── models/          # 6 моделей (analytics, audit, reviews, auth, establishment, user)
    │   ├── providers/       # 11 ChangeNotifiers (auth, moderation ×4, analytics ×3, audit, dashboard, reviews)
    │   ├── screens/         # Dashboard, moderation, analytics, audit, reviews, notifications, payments
    │   ├── services/        # 6 API singletons
    │   └── widgets/         # AdminShell, sidebar, charts (fl_chart), moderation panels
    └── web/                 # Flutter Web entry point
```

## Начало работы

### Предварительные требования

- Flutter SDK 3.x
- Node.js 18+
- PostgreSQL 15+ с расширением PostGIS
- Redis 7+

### Запуск

**Backend**:
```bash
cd backend
cp .env.example .env       # Настройте переменные окружения
npm install
npm run migrate            # Применить миграции с PostGIS
npm run seed               # Заполнить тестовыми данными
npm run dev                # Запуск сервера (порт 3000)
```

Подробное руководство: [backend/SETUP.md](backend/SETUP.md) | Миграции: [backend/migrations/MIGRATION_GUIDE.md](backend/migrations/MIGRATION_GUIDE.md)

**Mobile**:
```bash
cd mobile
flutter pub get
flutter run
```

**Admin Web**:
```bash
cd admin-web
flutter pub get
flutter run -d chrome --web-port=8080   # Порт 8080 для CORS
```

## Текущий статус

| Слой | Статус | Детали |
|------|--------|--------|
| **Backend API** | Production (Railway) | ~1100 тестов, 48 test suites, 22 миграции |
| **Mobile App** | TestFlight (iOS) | 13 экранных модулей, 10 провайдеров, 12 моделей |
| **Admin Web** | Production (Railway) | Модерация, аналитика, аудит-лог, отзывы |
| **Security** | Аудит пройден (8.5/10) | Секреты вынесены, git-history очищена, ключи ротированы |

### Реализованные модули Backend

- **Authentication**: JWT с refresh token rotation, role-based access (user/partner/admin), OAuth (Google + Yandex), Belarus phone validation
- **Search & Discovery**: PostGIS geospatial, байесовский рейтинг `(v×R + m×C)/(v+m)`, completeness score, cursor pagination
- **Smart Search**: AI intent parsing (OpenRouter + Gemini 2.5 Flash-Lite), Redis-кеш (1hr TTL), fallback на ILIKE + синонимы
- **Reviews**: CRUD, daily quota (10/day), partner responses, aggregate caching, soft deletion
- **Favorites**: Idempotent operations, batch status check, rich responses
- **Establishments**: CRUD с draft-pending-active workflow, Belarus validation, Cloudinary media (3 resolutions), tier-based limits
- **Promotions**: CRUD с Cloudinary images, search enrichment (has_promotion badge), max 3 active, lazy expiry
- **Bookings**: Настройки бронирования, полный lifecycle (9 валидаций), working hours, partner management, user booking flow
- **Notifications**: 15 типов, 30-сек polling, группировка по времени
- **Push Notifications**: FCM multicast, device tokens (UPSERT), preference categories, stale token cleanup
- **Partner Analytics**: Overview с period comparison, gap-filled time-series, ratings distribution, call tracking
- **Admin**: Login, moderation (full lifecycle), analytics (4 endpoints), audit log, review management, claiming

### Реализованные экраны Mobile

- Search Home с Nirivio branding и city selector (7 городов)
- Smart Search Bar (animated placeholder, AI intent parsing, suggestion chips, preview cards)
- Results List с infinite scroll и 4 опциями сортировки
- Filter Panel (6 секций: расстояние, чек, время, категория, кухня, доп.)
- Establishment Detail (hero gallery, info, menu, reviews, map, бронирование, акции)
- Favorites Tab (5 states, optimistic UI)
- Write Review и Reviews List (star rating, pagination, reactions)
- Map Tab (Yandex MapKit, clustering, info panel)
- Booking (выбор даты/времени/гостей, активные/история бронирований, cancel/retry)
- Notifications (15 типов, push + in-app, deep link navigation, preferences)
- Profile + Edit Profile (avatar, user reviews, settings, мои бронирования)
- Partner Registration (7-step wizard, ~4,800 lines)
- Partner Dashboard (statistics с fl_chart, reviews, edit, акции, бронирования)

## Roadmap

| Фаза | Статус | Описание |
|------|--------|----------|
| 1. Архитектурный фундамент | Завершена | Методология, спецификации, схема БД |
| 2. Backend Core | Завершена | Auth, search, reviews, favorites |
| 3. Quality Assurance | Завершена | 400+ тестов, 64% coverage |
| 4. Establishments | Завершена | CRUD, media, moderation |
| 5. Mobile MVP | Завершена | Foundation, auth, search, extended features, partner |
| 8. Admin Web Panel | Завершена | Segments A-E, модерация, аналитика, аудит-лог, отзывы |
| Horizon 2: Monetization | Завершён | Акции (Component 4), бронирование (Component 5) |
| Horizon 3: UX & Engagement | Завершён | Push-уведомления (Component 6), Smart Search (Component 7) |
| Component 8: Organic Growth | Запланировано | QR-коды заведений, deep links (nirivio.app/r/{id}) |
| Horizon 4: Public Web | Запланировано | Next.js SSR-сайт, SEO, partner cabinet, 500 seed-карточек |
| 9. Testing & Polish | Запланировано | E2E, performance, UX |
| 10. Launch | Запланировано | App Store + Google Play + сайт — одновременный запуск |

Подробный roadmap хранится в внутренней документации проекта.

## Тестирование

**Backend** (~1100 тестов, 48 test suites):

| Модуль | Тесты | Описание |
|--------|-------|----------|
| Auth | unit + integration + E2E | Registration, login, token rotation, OAuth, rate limiting |
| Search | unit + integration | Geospatial, filters, pagination, ranking, buildOrderByClause |
| Smart Search | 28 integration | Validation, fallback, filter building, caching |
| Reviews | unit + integration | CRUD, quota, partner responses, aggregates, validation (62 tests) |
| Favorites | unit + integration | Idempotent ops, batch, concurrent handling |
| Establishments | unit + integration | Workflow, validation, media, authorization |
| Promotions | 24 integration | CRUD, limits, search enrichment, ownership, lazy expiry |
| Bookings | unit (56 tests) | Model, service, settings — lifecycle, validations |
| Notifications | unit (63+26+8) | Service, model, preferences — 15 типов |
| Push | 19 unit | FCM multicast, token cleanup, category mapping |
| Partner Analytics | 27 unit | Model, service — overview, trends, ratings |
| Admin | 211 integration | Auth, moderation, analytics, audit log, reviews, claiming |

```bash
cd backend
npm test                   # Полный тестовый набор
npm run test:coverage      # С отчётом покрытия
```

**Mobile**: Widget tests для core functionality. Запуск: `cd mobile && flutter test`

## Документация

| Документ | Описание |
|----------|----------|
| [backend/ARCHITECTURE.md](backend/ARCHITECTURE.md) | Архитектура backend |
| [backend/SETUP.md](backend/SETUP.md) | Руководство по настройке backend |
| [backend/IMPLEMENTATION_SUMMARY.md](backend/IMPLEMENTATION_SUMMARY.md) | Сводка реализации backend |
| [backend/migrations/MIGRATION_GUIDE.md](backend/migrations/MIGRATION_GUIDE.md) | Руководство по миграции PostGIS (22 миграции) |
| [PROJECT_MAP.md](PROJECT_MAP.md) | Навигация по кодовой базе |
| [CHANGELOG.md](CHANGELOG.md) | Полная история обновлений |

## Методология разработки

Проект использует **Distributed Intelligence Methodology v9.4**, реализующую модульную систему протоколов:

- **Protocol Unified (Mode C)**: основной рабочий режим — Discovery → Planning → Implementation → Delivery в одной сессии
- **Protocol Autonomous (Mode B)**: полностью автономное выполнение по директивам
- **Protocol Informed (Mode A)**: пошаговое выполнение с подтверждениями
- **Human Coordinator**: мост между Trunk и Leaf, safety gate, scope authority

Execution cycle: Discovery (read-only) -> Planning -> Implementation -> Delivery (commit + report)

Context management: Green (<70%) -> Yellow (70-85%) -> Orange (85-90%) -> Red (>90%, emergency stop)

Методология хранится в внутренней документации проекта (docs/, не включена в публичный репозиторий).

## Последнее обновление

**Апрель 2026** — MVP функционально завершён, приложение в TestFlight, security audit пройден

- **Smart Search** (Component 7): AI intent parsing через OpenRouter, animated search bar, preview cards
- **Push Notifications** (Component 6): FCM multicast, 15 типов событий, deep link navigation, preferences
- **Bookings** (Component 5): полный lifecycle бронирования — partner wizard, user booking flow, 9 валидаций
- **Promotions** (Component 4): CRUD, Cloudinary images, search enrichment, карусель на карточке
- **Security Audit**: секреты вынесены из кода, git-history очищена, 5 ключей ротированы, аудит 8.5/10
- **Ranking**: байесовский рейтинг (m=5, C=3.5), completeness score, GPS-aware сортировка
- **Partner Analytics**: графики (fl_chart), тренды, просмотры акций, call tracking
- **Admin Panel**: модерация (full lifecycle), аналитика, аудит-лог, отзывы, claiming
- **~1100 backend тестов** (48 suites), функциональная спецификация v3.4

Полная история обновлений: [CHANGELOG.md](CHANGELOG.md)

## License

Proprietary — все права защищены.

## Контакты

**Основатель проекта**: Всеволод
**Архитектурный координатор**: Claude (Anthropic AI)
**Методология**: Distributed Intelligence v9.4

---

*Последнее обновление: Апрель 16, 2026*
