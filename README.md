# Restaurant Guide Belarus v2.0

Современная мобильная платформа для поиска и выбора заведений общепита в Беларуси.

## О проекте

Restaurant Guide Belarus — кроссплатформенное мобильное приложение (iOS/Android) и веб-панель администрирования для поиска ресторанов, кафе и баров в 7 крупных городах Беларуси (Минск, Гродно, Брест, Гомель, Витебск, Могилев, Бобруйск).

**Ключевые возможности**:
- Геолокационный поиск с умным ранжированием заведений (PostGIS)
- Система отзывов и рейтингов с защитой от злоупотреблений
- Избранное, карта с кластеризацией маркеров, фильтры
- 7-шаговый визард регистрации заведений для партнёров
- Панель аналитики для партнёров (статистика, отзывы, редактирование)
- Веб-панель администрирования с модерацией контента

**Текущий этап**: Фаза 8 — Admin Web Panel (Segment A Foundation complete)

## Технологический стек

| Слой | Технологии |
|------|-----------|
| **Mobile** | Flutter 3.x, Provider, Dio, CachedNetworkImage, Yandex MapKit |
| **Admin Web** | Flutter Web, GoRouter, Provider, Dio |
| **Backend** | Node.js 18+, Express, JWT (access + refresh rotation) |
| **Database** | PostgreSQL 15+ с PostGIS, Redis 7+ |
| **Media** | Cloudinary (3 резолюции, WebP, progressive loading) |
| **Infrastructure** | Docker, GitHub Actions CI/CD, SendGrid |

## Структура репозитория

```
restaurant-guide-belarus/
├── docs/                    # Документация проекта
│   ├── 00_methodology/      # Методология разработки v8.6
│   ├── 01_specifications/   # Функциональные спецификации
│   ├── 02_architecture/     # Архитектура API
│   ├── 03_coordination/     # Координационные документы
│   ├── handoffs/            # Активные handoff-документы
│   └── reports/             # Отчёты мобильного тестирования
├── backend/                 # Backend API (Node.js/Express)
│   ├── src/
│   │   ├── models/          # Модели данных
│   │   ├── controllers/     # Обработчики запросов
│   │   ├── services/        # Бизнес-логика
│   │   ├── middleware/      # Auth, rate limiting, validation
│   │   ├── routes/          # API endpoints (v1)
│   │   ├── config/          # PostgreSQL, Redis, Cloudinary
│   │   └── utils/           # JWT, logger, helpers
│   ├── migrations/          # Миграции БД (PostGIS)
│   └── tests/               # Тесты backend
├── mobile/                  # Flutter мобильное приложение
│   ├── lib/
│   │   ├── config/          # Theme, dimensions, environment
│   │   ├── models/          # Establishment, Review, User, Partner
│   │   ├── providers/       # State management (Provider)
│   │   ├── screens/         # UI по фичам (search, map, profile, partner)
│   │   ├── services/        # API services
│   │   └── widgets/         # Reusable components
│   └── session_reports/     # Отчёты сессий разработки
└── admin-web/               # Flutter Web админ-панель
    ├── lib/
    │   ├── config/          # GoRouter, environment
    │   ├── providers/       # AuthProvider
    │   ├── screens/         # Login, placeholder screens
    │   ├── services/        # ApiClient, AuthService
    │   └── widgets/         # AdminShell, AdminSidebar
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
| **Backend API** | Production-ready | 64% coverage, 400+ тестов, все модули complete |
| **Mobile Foundation** | Production-ready | Theme, API client, navigation, state management |
| **Mobile Auth** | Production-ready | Email + phone registration, login, JWT |
| **Mobile Search** | Production-ready | Results list, filters (6 секций), detail view, city selector |
| **Mobile Extended** | Production-ready | Favorites, reviews, map (Yandex), profile, partner flows |
| **Admin Web** | Segment A done | Login, sidebar, auth guard, placeholder screens |

### Реализованные модули Backend

- **Authentication**: JWT с refresh token rotation, role-based access (user/partner/admin), Belarus phone validation
- **Search & Discovery**: PostGIS geospatial, ranking algorithm (distance + quality + subscription), cursor pagination
- **Reviews**: CRUD, daily quota (10/day), partner responses, aggregate caching, soft deletion
- **Favorites**: Idempotent operations, batch status check, rich responses
- **Establishments**: CRUD с draft-pending-active workflow, Belarus validation, Cloudinary media (3 resolutions), tier-based limits
- **Admin Auth**: Admin login endpoint с role gate

### Реализованные экраны Mobile (Phase 5)

- Search Home с NIRIVIO branding и city selector (7 городов)
- Results List с infinite scroll и 4 опциями сортировки
- Filter Panel (6 секций: расстояние, чек, время, категория, кухня, доп.)
- Establishment Detail (hero gallery, info, menu, reviews, map)
- Favorites Tab (5 states, optimistic UI)
- Write Review и Reviews List (star rating, pagination, reactions)
- Map Tab (Yandex MapKit, clustering, info panel)
- Profile + Edit Profile (avatar, user reviews, settings)
- Partner Registration (7-step wizard, ~4,800 lines)
- Partner Dashboard (statistics, reviews, edit establishment)

## Roadmap

| Фаза | Статус | Описание |
|------|--------|----------|
| 1. Архитектурный фундамент | Завершена | Методология, спецификации, схема БД |
| 2. Backend Core | Завершена | Auth, search, reviews, favorites |
| 3. Quality Assurance | Завершена | 400+ тестов, 64% coverage |
| 4. Establishments | Завершена | CRUD, media, moderation |
| 5. Mobile MVP | Завершена | Foundation, auth, search, extended features, partner |
| 6. User Features Integration | Запланировано | Auth flow integration, push notifications |
| 7. Partner Mobile Features | Запланировано | Dashboard, analytics, notifications |
| 8. Admin Web Panel | В работе | Segment A done, B-E planned |
| 9. Testing & Polish | Запланировано | E2E, performance, UX |
| 10. Launch Preparation | Запланировано | Deploy, monitoring, beta |

Подробный roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)

## Тестирование

**Backend** (400+ тестов, 64% overall coverage):

| Модуль | Coverage | Тесты |
|--------|----------|-------|
| Auth | 87% statements | Registration, login, token rotation, rate limiting |
| Search | 83.9% statements | Geospatial, filters, pagination, ranking |
| Reviews | 97.46% service / 100% controller | CRUD, quota, partner responses, aggregates |
| Favorites | 100% | Idempotent ops, batch, concurrent handling |
| Establishments | 91.67% service / 100% controller | Workflow, validation, media, authorization |

```bash
cd backend
npm test                   # Полный тестовый набор (<5 минут)
npm run test:coverage      # С отчётом покрытия
```

**Mobile**: Widget tests для core functionality. Запуск: `cd mobile && flutter test`

## Документация

| Документ | Описание |
|----------|----------|
| [docs/00_methodology/Methodology_v8.6.md](docs/00_methodology/Methodology_v8.6.md) | Методология разработки (Distributed Intelligence) |
| [docs/01_specifications/functional_spec_v3.md](docs/01_specifications/functional_spec_v3.md) | Функциональная спецификация |
| [docs/02_architecture/api_endpoints_overview.md](docs/02_architecture/api_endpoints_overview.md) | Обзор API endpoints |
| [docs/01_specifications/api_architecture_review_v1.1.md](docs/01_specifications/api_architecture_review_v1.1.md) | Архитектурный обзор API |
| [backend/ARCHITECTURE.md](backend/ARCHITECTURE.md) | Архитектура backend |
| [backend/SETUP.md](backend/SETUP.md) | Руководство по настройке backend |
| [backend/IMPLEMENTATION_SUMMARY.md](backend/IMPLEMENTATION_SUMMARY.md) | Сводка реализации backend |
| [backend/migrations/MIGRATION_GUIDE.md](backend/migrations/MIGRATION_GUIDE.md) | Руководство по миграции PostGIS |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Подробная дорожная карта |
| [CHANGELOG.md](CHANGELOG.md) | Полная история обновлений |

## Методология разработки

Проект использует **Distributed Intelligence Methodology v8.6**, реализующую двухуровневую модель координации:

- **Strategic Trunk** (Web Interface): архитектурное планирование, анализ session reports, формулирование директив
- **Autonomous Leaf** (CLI/VSCode): автономное выполнение — discovery, planning, implementation, delivery через Git
- **Human Coordinator**: мост между Trunk и Leaf, safety gate, scope authority

Execution cycle: Discovery (read-only) -> Planning -> Implementation -> Delivery (commit + report)

Context management: Green (<70%) -> Yellow (70-85%) -> Orange (85-90%) -> Red (>90%, emergency stop)

Полная методология: [docs/00_methodology/Methodology_v8.6.md](docs/00_methodology/Methodology_v8.6.md)

## Последнее обновление

**Февраль 8, 2026** — Admin Panel Segment A: Foundation + Login

- Backend: admin login endpoint (`POST /api/v1/admin/auth/login`) с role gate
- Admin-Web: Flutter Web project (GoRouter, Provider, Dio) — 15 files, ~1,800 lines
- LoginScreen, AdminShell (363px sidebar), 7 navigation items, auth guard
- Build: `flutter build web` successful, 0 errors

Полная история обновлений: [CHANGELOG.md](CHANGELOG.md)

## License

Proprietary — все права защищены.

## Контакты

**Основатель проекта**: Всеволод
**Архитектурный координатор**: Claude (Anthropic AI)
**Методология**: Distributed Intelligence v8.6

---

*Последнее обновление: Февраль 8, 2026*
