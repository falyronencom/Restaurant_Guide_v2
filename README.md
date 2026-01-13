# Restaurant Guide Belarus v2.0

Современная мобильная платформа для поиска и выбора заведений общепита в Беларуси.

## О проекте

Restaurant Guide Belarus — это кроссплатформенное мобильное приложение (iOS/Android) и веб-панель администрирования, созданные для решения проблемы отсутствия единой современной платформы поиска ресторанов, кафе и баров в Беларуси, адаптированной под местную специфику.

**Целевой рынок**: 7 крупных городов Беларуси (Минск, Гродно, Брест, Гомель, Витебск, Могилев, Бобруйск)

**Ключевые возможности**:
- Геолокационный поиск с умным ранжированием заведений
- Детальная информация о меню, ценах, часах работы
- Система отзывов и рейтингов с защитой от злоупотреблений
- Избранное для быстрого доступа к любимым местам
- Инструменты продвижения для партнеров (владельцев заведений)
- Модерируемая экосистема для поддержания качества контента

## Архитектура проекта

Проект использует методологию распределенного интеллекта **v8.0 "Agentic Framework"** для организации разработки с участием AI-ассистентов. Эта методология реализует двухуровневую агентную модель, где стратегическое планирование и автономное выполнение работают как связанные, но независимые слои.

**Ключевые принципы методологии v8.0**:
- **Двухуровневая архитектура**: Strategic Trunk (Web) → Autonomous Leaf (CLI)
- **Human Coordination**: Координатор как мост между Trunk и Leaf агентами
- **GitHub** как primary truth source для кода и версионирования
- **Claude Projects** как knowledge layer для межсессионной памяти
- **Autonomous Execution Cycle**: Discovery → Planning → Implementation → Delivery
- **Context Management**: Четырёхзонная система (Green/Yellow/Orange/Red zones)

### Технологический стек

**Mobile (iOS/Android)**:
- Flutter 3.x
- Provider/Riverpod для state management
- Dio для HTTP запросов
- Cached Network Image для оптимизации изображений

**Web Admin Panel**:
- Flutter Web (shared codebase с mobile)
- Responsive design для desktop/tablet
- PWA для возможности установки

**Backend**:
- Node.js 18+ с Express framework
- PostgreSQL 15+ с PostGIS для геопространственных запросов
- Redis 7+ для кэширования и rate limiting
- JWT для авторизации с refresh token rotation
- Layered architecture: routes → controllers → services → models

**Infrastructure**:
- Cloudinary для хранения и оптимизации изображений
- SendGrid для email уведомлений
- Google Maps API / OpenStreetMap для карт
- Docker для контейнеризации
- GitHub Actions для CI/CD
- Хостинг в регионе (Литва/Польша для низкой латентности)

## Структура репозитория

```
restaurant-guide-belarus/
├── docs/                  # Документация проекта
│   ├── 00_methodology/   # Методология разработки v8.0
│   ├── 01_specifications/# Функциональные спецификации
│   └── 02_architecture/  # Архитектурные решения, API, схема БД
├── backend/              # Backend API (Node.js/Express)
│   ├── src/
│   │   ├── models/      # Модели данных
│   │   ├── controllers/ # Обработчики запросов
│   │   ├── services/    # Бизнес-логика
│   │   ├── middleware/  # Аутентификация и авторизация
│   │   ├── routes/      # Определение API endpoints
│   │   ├── config/      # Конфигурация БД, Redis и Cloudinary
│   │   └── utils/       # Вспомогательные функции
│   ├── migrations/      # Миграции базы данных
│   └── tests/           # Тесты backend
├── mobile/              # Flutter мобильное приложение (iOS/Android)
│   ├── lib/
│   │   ├── config/      # Конфигурация: theme, dimensions, environment
│   │   ├── models/      # Модели данных (Establishment, Review, User)
│   │   ├── providers/   # State management (Provider pattern)
│   │   ├── screens/     # UI экраны организованные по фичам
│   │   │   ├── search/  # Поиск заведений
│   │   │   ├── news/    # Новости и акции
│   │   │   ├── map/     # Карта заведений
│   │   │   ├── favorites/ # Избранное
│   │   │   ├── profile/ # Профиль пользователя
│   │   │   └── debug/   # Validation экран для тестирования
│   │   ├── services/    # API клиент, Auth service, Establishments service
│   │   └── widgets/     # Переиспользуемые компоненты (EstablishmentCard)
│   └── test/            # Widget tests и integration tests
└── admin-web/           # Flutter Web админ-панель
    └── lib/             # Переиспользует код из mobile
```

## Начало работы

### Предварительные требования

- Flutter SDK 3.x
- Node.js 18+
- PostgreSQL 15+ с расширением PostGIS
- Redis 7+
- Git

### Локальная разработка

**Database Setup**:

Перед запуском backend необходимо настроить PostgreSQL с PostGIS:

```bash
# 1. Запустить PostgreSQL с PostGIS через Docker
docker-compose up -d postgres

# 2. Применить миграции базы данных
cd backend/migrations
# Следуйте инструкциям в MIGRATION_GUIDE.md

# 3. Заполнить тестовыми данными
cd backend
npm run seed
```

📖 Подробное руководство: **[Database Migration Guide](backend/migrations/MIGRATION_GUIDE.md)**

**Backend**:
```bash
cd backend
npm install
npm run dev
```

**Mobile App**:
```bash
cd mobile
flutter pub get
flutter run

# Для запуска на конкретном устройстве
flutter devices              # Список доступных устройств
flutter run -d <device_id>   # Запуск на конкретном устройстве

# Сборка APK для Android
flutter build apk --debug    # Debug build
flutter build apk --release  # Release build
```

**Admin Web**:
```bash
cd admin-web
flutter pub get
flutter run -d chrome
```

## Flutter Mobile Application

### Архитектура и Дизайн

Flutter мобильное приложение реализовано с использованием **Phase One Foundation Architecture**, которая обеспечивает производственно-готовую основу для всех последующих функций.

**Ключевые архитектурные решения**:
- **State Management**: Provider pattern с ChangeNotifier для reactive state updates
- **API Layer**: Dio HTTP client с автоматическими interceptors для JWT, retry logic, и error handling
- **Navigation**: Flutter Navigator 2.0 с bottom tab navigation и независимыми навигационными стеками
- **Design System**: Material Design 3 с кастомной цветовой палитрой и консистентными размерами
- **Image Optimization**: CachedNetworkImage для эффективной загрузки изображений из Cloudinary
- **Security**: flutter_secure_storage для безопасного хранения JWT tokens

**Layered Architecture**:
```
┌─────────────────────────────────────┐
│  UI Layer (Screens + Widgets)      │ ← Presentation
├─────────────────────────────────────┤
│  State Management (Providers)       │ ← Business Logic
├─────────────────────────────────────┤
│  Service Layer (API Services)       │ ← Data Access
├─────────────────────────────────────┤
│  API Client (Dio + Interceptors)    │ ← Network
└─────────────────────────────────────┘
```

### Реализованные возможности (Phase One Foundation) ✅

**Phase A - Project Structure & Configuration**:
- ✅ Flutter 3.x project initialization
- ✅ Dependencies configuration (Provider, Dio, CachedNetworkImage, flutter_secure_storage)
- ✅ Platform-specific setup для iOS и Android
- ✅ Google Maps API integration placeholders
- ✅ Location permissions для geospatial features
- ✅ Environment configuration (development/production)

**Phase B - Design System & Theme Foundation**:
- ✅ Material Design 3 theme implementation
- ✅ Кастомная цветовая схема:
  * Primary Orange (#FF6B35) - бренд цвет
  * Success Green (#4CAF50) - позитивные действия
  * Full Material 3 color system (primary, secondary, tertiary с tonal палитрами)
- ✅ Typography scale: 11 текстовых стилей от displayLarge до bodySmall
- ✅ Dimensions system: консистентные spacing, padding, radius, icon sizes
- ✅ Component theme configuration для Card, Button, AppBar, NavigationBar

**Phase C - API Client Infrastructure**:
- ✅ Dio HTTP client singleton с базовой конфигурацией
- ✅ Interceptors:
  * Request Interceptor: автоматически добавляет JWT Bearer token из secure storage
  * Response Interceptor: обрабатывает token refresh при 401 errors
  * Error Interceptor: retry logic с exponential backoff для network failures
- ✅ Data Models с JSON serialization:
  * `Establishment` - полное mapping backend данных
  * `Review` - отзывы с автором и партнёрскими ответами
  * `User` - пользовательская модель
- ✅ Service Layer:
  * `EstablishmentsService` - search, get details, toggle favorite
  * `AuthService` - login, registration, token refresh, logout
- ✅ Error handling с локализованными сообщениями

**Phase D - State Management Foundation**:
- ✅ Provider setup с MultiProvider в main.dart
- ✅ `AuthProvider`:
  * Authentication state management
  * Login/logout flows с persistent token storage
  * User profile state
- ✅ `EstablishmentsProvider`:
  * Search state с фильтрами (city, category, cuisine, price range, rating)
  * Establishments list с pagination support
  * Favorite management с optimistic UI updates
  * Loading/error states для UI feedback
- ✅ Reactive UI updates через ChangeNotifier pattern
- ✅ Business logic отделена от presentation layer

**Phase E - Navigation Framework**:
- ✅ Bottom Tab Navigation с 5 главными секциями:
  * 🔍 Поиск заведений (Search)
  * 📰 Новости и акции (News)
  * 🗺️ Карта заведений (Map)
  * ⭐ Избранное (Favorites)
  * 👤 Профиль пользователя (Profile)
- ✅ Independent navigation stacks для каждой вкладки
- ✅ State preservation через IndexedStack
- ✅ Android back button handling с PopScope
- ✅ Route definitions и navigation helpers
- ✅ Placeholder screens для всех секций
- ✅ Future-ready для deep linking и push notifications

**Phase F - Reusable Components & Validation**:
- ✅ `EstablishmentCard` - production-ready компонент:
  * Thumbnail с CachedNetworkImage и placeholder
  * Название с ellipsis overflow
  * Rating badge с звёздочкой
  * Category и cuisine tags
  * Price range indicator
  * Open/Closed status с цветовой индикацией
  * Address с ellipsis
  * Distance indicator (опционально)
  * Favorite toggle button
  * Полная поддержка Material Design 3 theming
- ✅ `ValidationScreen` - End-to-End Integration Testing:
  * Загружает реальные seed data из backend (Минск, 35 establishments)
  * Отображает establishments через EstablishmentCard
  * Тестирует все слои: UI → Provider → Service → API
  * Pull-to-refresh functionality
  * Loading/Error/Empty states
  * ✅ **Validation Results**: Успешная загрузка 35 заведений из Минска
- ✅ Widget tests для app launch и tab navigation

### Доступные экраны

**Production Screens**:
1. **Main Navigation** ([main_navigation.dart](mobile/lib/screens/main_navigation.dart))
   - Bottom tab bar с 5 секциями
   - Independent navigation stacks
   - State preservation

2. **Search Home** ([search_home_screen.dart](mobile/lib/screens/search/search_home_screen.dart))
   - Placeholder для search functionality (Phase Three)
   - Кнопка доступа к Validation Screen

3. **Validation Screen** ([validation_screen.dart](mobile/lib/screens/debug/validation_screen.dart))
   - Backend integration testing
   - Live data from Minsk establishments
   - Full stack validation (UI → API → Database)

**Placeholder Screens** (готовы для Phase Three implementation):
- News Screen
- Map Screen
- Favorites Screen
- Profile Screen

### Тестирование

**Widget Tests** ([test/widget_test.dart](mobile/test/widget_test.dart)):
```bash
cd mobile
flutter test
```

Текущие тесты:
- ✅ App launches successfully with navigation
- ✅ Bottom navigation bar с 5 вкладками
- ✅ Tab switching functionality

**Manual Validation**:
1. Запустите backend: `cd backend && npm run dev`
2. Запустите mobile app: `cd mobile && flutter run`
3. Нажмите кнопку "Test Backend Integration"
4. Проверьте загрузку 35 establishments из Минска
5. Проверьте отображение карточек с изображениями из Cloudinary
6. Тестируйте favorite toggle и pull-to-refresh

**Validation Results** (Leaf Session Mobile Phase One):
- ✅ Backend API connectivity established
- ✅ 35 establishments successfully loaded from Минск
- ✅ Cloudinary images displayed correctly
- ✅ EstablishmentCard component renders all data fields
- ✅ Provider state management working correctly
- ✅ Favorite toggle functionality operational
- ✅ Error handling и loading states verified

### Технические детали

**Dependencies** ([pubspec.yaml](mobile/pubspec.yaml)):
```yaml
dependencies:
  flutter: sdk: flutter
  provider: ^6.1.2              # State management
  dio: ^5.7.0                   # HTTP client
  cached_network_image: ^3.4.1 # Image caching
  flutter_secure_storage: ^9.2.2 # Secure token storage
  intl: ^0.19.0                 # Internationalization
  google_maps_flutter: ^2.9.0  # Maps integration (placeholder)
```

**Configuration Files**:
- [config/theme.dart](mobile/lib/config/theme.dart) - Complete Material 3 theme (423 lines)
- [config/dimensions.dart](mobile/lib/config/dimensions.dart) - Design system constants (180 lines)
- [config/environment.dart](mobile/lib/config/environment.dart) - Environment URLs

**Key Implementation Files**:
- [services/api_client.dart](mobile/lib/services/api_client.dart) - Dio client с interceptors (390 lines)
- [providers/establishments_provider.dart](mobile/lib/providers/establishments_provider.dart) - Search state (345 lines)
- [providers/auth_provider.dart](mobile/lib/providers/auth_provider.dart) - Auth state (296 lines)
- [widgets/establishment_card.dart](mobile/lib/widgets/establishment_card.dart) - Reusable card component (290 lines)

**Code Metrics** (Phase One Foundation):
- **Total Lines**: ~3,200 production code
- **Files Created**: 24 files
- **Test Coverage**: Basic widget tests (expandable в Phase Three)
- **Git Commits**: 6 checkpoint commits (one per phase)

### Документация

**Session Report**: [session_report.md](session_report.md)
Comprehensive documentation всего Phase One Foundation с:
- Детальное описание всех 6 фаз (A-F)
- Implementation highlights
- Validation results
- Code metrics
- Known issues
- Lessons learned
- Next steps для Phase Two-Three

**Architecture Decisions**:
- Provider chosen over Riverpod/Bloc для простоты и production-readiness
- Navigator 2.0 для future-ready routing
- Feature-first directory structure для scalability
- Repository pattern для service layer abstraction
- Optimistic UI updates для better UX

### Known Issues и Limitations

**Current Limitations**:
1. Google Maps API key является placeholder - требуется real key для production
2. Search functionality в placeholder mode (будет реализован в Phase Three)
3. Authentication flow базовый - full UI будет в Phase Two
4. Offline support foundation заложен, но full implementation в Phase Four
5. Android SDK components автоматически загружаются при первой сборке

**Resolved Issues**:
- ✅ Type mismatch в api_client.dart (fixed with explicit cast)
- ✅ Enum index conflict в routes.dart (fixed using built-in index)
- ✅ Test failures after navigation changes (updated test expectations)
- ✅ Android build errors with Maps API key (using placeholder)

### Next Steps (Phase Two - Core Search UI)

Следующая фаза разработки сосредоточится на реализации core search functionality:

**Priority Tasks**:
1. Search home screen с city selection и filters UI
2. Establishments list screen с pagination
3. Establishment detail screen с full information
4. Filter panel implementation (category, cuisine, price range, rating)
5. Sort options (distance, rating, price)
6. Search result state management
7. Error handling и empty states
8. Pull-to-refresh для search results

## Ключевые документы

Рекомендуем начать изучение проекта в следующем порядке:

1. **[Методология разработки v8.0](docs/00_methodology/methodology_v8.0.md)** — The Agentic Framework для координации Strategic Trunk и Autonomous Leaf сессий
2. **[Функциональная спецификация v3](docs/01_specifications/functional_spec_v3.md)** — полное описание функциональности и бизнес-требований
3. **[Схема базы данных v2.0](docs/02_architecture/database_schema_v2.0.sql)** — структура данных и отношения
4. **[API Спецификация v2.0](docs/02_architecture/api_specification_v2.0.yaml)** — OpenAPI описание всех endpoints
5. **[API Architecture Review](docs/01_specifications/api_architecture_review_v1.1.md)** — архитектурный обзор критических решений
6. **[Database Migration Guide](backend/migrations/MIGRATION_GUIDE.md)** — руководство по миграции PostGIS для геопространственного поиска
7. **[Establishments Handoff Documentation](backend/HANDOFF_ESTABLISHMENTS.md)** — техническая документация системы управления заведениями
8. **[Testing Guide](docs/testing/TESTING_GUIDE.md)** — 🆕 Comprehensive руководство по тестированию backend (patterns, best practices, 400+ test scenarios)
9. **[Production Readiness Guide](docs/deployment/PRODUCTION_READINESS.md)** — 🆕 Deployment checklist и recommendations для production deployment
10. **[Troubleshooting Bank](docs/troubleshooting_bank.md)** — 🆕 База решений для common issues и error handling
11. **[Mobile Phase One Session Report](session_report.md)** — Comprehensive отчёт о реализации Flutter Foundation Architecture (6 фаз, validation results, lessons learned)

## Текущий статус проекта

**Фаза**: Mobile Development Phase (Фаза 5) - Sub-Phase 1-2 ✅ Завершены, Sub-Phase 3.1-3.3 ✅ Complete
**Последнее обновление**: Январь 13, 2026
**Backend Status**: Production-ready с comprehensive test coverage (64%, 400+ tests)
**Mobile Foundation**: Production-ready architecture с полной backend интеграцией
**Mobile Authentication**: Complete authentication flows (email, phone, login) ready для backend API integration

### Реализованные компоненты ✅

**Backend Infrastructure**:
- Express сервер с production-ready middleware stack
- PostgreSQL connection pooling с автоматическим мониторингом производительности
- Redis интеграция для кэширования и rate limiting
- Cloudinary интеграция для хранения и оптимизации изображений
- Graceful shutdown handlers и error handling
- Layered architecture с чётной separation of concerns

**Authentication System** (Leaf Session 1):
- JWT-based авторизация с access и refresh tokens
- Strict refresh token rotation для повышения безопасности
- Multi-method registration: email, phone (SMS), OAuth (Google, Yandex)
- Role-based access control (user, partner, admin)
- Belarus-specific телефонная валидация
- Two-tier rate limiting (10 requests/15 min для sensitive endpoints)

**Search & Discovery** (Leaf Session 2):
- Геопространственные запросы через PostGIS
- Radius-based search для list view
- Bounds-based search для map view
- Intelligent ranking: distance + rating + review count + boost_score
- Фильтрация: категории, кухни, price range, ratings, amenities
- Pagination с оптимизацией производительности
- Proper indexing для быстрых результатов при больших датасетах

**Reviews System** (Leaf Session 3):
- CRUD операции для отзывов с rich responses
- Rate limiting: 10 reviews per day per user
- Duplicate prevention: one review per user per establishment
- Aggregate statistics caching для производительности
- Partner response functionality для взаимодействия с клиентами
- Soft deletion для восстановления и audit trail
- Comprehensive validation и error handling

**Favorites System** (Leaf Session 4):
- Add/remove establishments to/from favorites
- Get user favorites с pagination
- Check single/batch favorite status для UI state
- Statistics endpoint для aggregate metrics
- Idempotent operations для better UX
- Rich establishment details в responses для минимизации API calls

**Establishments Management System** (Leaf Sessions 5-6):
- Complete partner registration flow с multi-step validation
- Establishment CRUD operations с draft-pending-active workflow
- Belarus-specific validation: cities, coordinates (51-56°N / 23-33°E), categories, cuisines
- Ownership verification per partner для безопасности
- Automatic status transitions при major changes
- Media management с Cloudinary integration:
  * Three-resolution system: original (1920x1080), preview (800x600), thumbnail (200x150)
  * Automatic optimization: WebP, quality_auto, progressive loading
  * Tier-based upload limits (Free: 10+10, Basic: 15+15, Standard: 20+20, Premium: 30+30)
  * Primary photo management с automatic promotion
  * Cascading delete (Cloudinary + Database)
- Moderation workflow: draft → pending → active → suspended
- Comprehensive validation и error handling
- Full integration testing completed

**Database Schema**:
- Complete schema с всеми таблицами и relationships
- PostGIS spatial indexes для географических запросов
- Proper constraints и foreign keys
- Migration scripts для version control
- Optimized indexes для performance

**Quality Assurance**:
- ✅ Production-grade testing coverage: 64% overall (75%+ expected after Cloudinary integration)
- ✅ Three-phase testing initiative completed (December 2025)
- ✅ 400+ comprehensive test scenarios across all critical modules
- ✅ Perfect coverage (100%) for Favorites and Establishments controllers
- ✅ All tests passing consistently, zero flaky tests
- ✅ CI/CD ready with automated regression protection

**Mobile Phase One Foundation** (Leaf Session - Ноябрь 2025):
- ✅ Flutter project structure и configuration (Phase A)
- ✅ Material Design 3 theme system с кастомной палитрой (Phase B)
- ✅ Dio API client с JWT interceptors и retry logic (Phase C)
- ✅ Provider state management для Auth и Establishments (Phase D)
- ✅ Navigator 2.0 с bottom tab navigation (Phase E)
- ✅ EstablishmentCard reusable component (Phase F)
- ✅ ValidationScreen для end-to-end integration testing (Phase F)
- ✅ Full stack validation: UI → Provider → Service → API → Database
- ✅ **Validation Results**: 35 establishments loaded from Минск with Cloudinary images
- ✅ Widget tests для app launch и navigation
- ✅ 6 Git commits (one per phase) + comprehensive session report
- **Code Metrics**: ~3,200 lines, 24 files created

**Mobile Phase Two Authentication** (VSCode Session - Декабрь 2025):
- ✅ Enhanced AuthProvider с comprehensive auth methods (Phase A)
- ✅ Form components: CustomTextField, PhoneInputField, PasswordStrengthIndicator, ErrorBanner (Phase B)
- ✅ Email registration flow: registration + 6-digit verification (Phase C)
- ✅ Phone registration flow: Belarus +375 format + 5-digit SMS verification (Phase D)
- ✅ Login screen: combined email/phone input с flexible validation (Phase E)
- ✅ Complete navigation integration и testing (Phase F)
- ✅ Pixel-perfect Figma design implementation с Figma MCP
- ✅ 7 authentication screens, 5 reusable widgets
- ✅ 5 Git commits + comprehensive handoff report
- **Code Metrics**: ~2,000 lines, 12 new files created
- 📄 Comprehensive handoff documentation ([PHASE_TWO_COMPLETION_REPORT.md](PHASE_TWO_COMPLETION_REPORT.md))

## Testing Coverage and Quality Assurance

Backend прошёл систематическую трёхфазную инициативу по улучшению тестирования, достигнув production-grade покрытия по всем критическим модулям. Работы по тестированию завершены в декабре 2025 года с использованием методологии распределённого интеллекта и координации множественных AI-агентов.

### Coverage Metrics by Module

**Authentication & Security (Production-Ready)**
- authService: 87% statements / 87% branches / 100% functions
- authController: 86% statements / 83% branches
- Coverage: Registration flows, login security, token rotation, session management, rate limiting, SQL injection protection

**Search & Discovery (Production-Ready)**
- searchService: 83.9% statements / 88.3% branches / 100% functions
- searchController: 88% across all metrics
- Coverage: Geospatial calculations, filter combinations, pagination, ranking algorithms, error handling

**Reviews System (Production-Ready)**
- reviewService: 97.46% statements
- reviewController: 100% coverage
- Coverage: Full CRUD operations, daily quota enforcement (10 reviews/day), partner responses feature, rating aggregation, authorization, validation
- **Partner Responses**: Partners can officially respond to reviews on their establishments
  * POST /api/v1/reviews/:id/response — add response
  * DELETE /api/v1/reviews/:id/response — remove response
  * Ownership verification ensures partners can only respond to their own establishment reviews
- Integration tests: 39 comprehensive test scenarios all passing

**Favorites Management (Production-Ready)**
- favoriteService: 100% coverage (perfect)
- favoriteController: 100% coverage (perfect)
- Coverage: Idempotent operations, concurrent handling, batch operations, user isolation

**Establishments CRUD (Production-Ready)**
- establishmentService: 91.67% statements
- establishmentController: 100% coverage
- Coverage: Moderation workflow, partner authorization, validation, state transitions, soft delete

**Overall Project Coverage:** 64% statements (excluding intentionally skipped media modules pending Cloudinary integration)

### Test Suite Characteristics

- **Total Tests:** 400+ comprehensive test scenarios
- **Test Types:** Integration tests with real database, E2E user journey tests, Unit tests with mocked dependencies
- **Stability:** All tests passing consistently, zero flaky tests
- **Execution Time:** Full test suite completes in under 5 minutes
- **CI/CD Ready:** Automated regression protection for all core features

### Known Issues and Limitations

- Media upload endpoints intentionally skipped pending Cloudinary integration completion in test environment
- When media integration tests complete, overall coverage expected to exceed seventy-five percent

### Testing Documentation

- [docs/testing/TESTING_GUIDE.md](docs/testing/TESTING_GUIDE.md) - Comprehensive testing patterns and practices guide
- [docs/troubleshooting_bank.md](docs/troubleshooting_bank.md) - Solutions database for common issues
- [docs/deployment/PRODUCTION_READINESS.md](docs/deployment/PRODUCTION_READINESS.md) - Deployment checklist and monitoring recommendations

### Production Readiness Assessment

Core backend modules (authentication, search, reviews with partner responses, favorites, establishments) thoroughly tested and ready for production deployment. All critical bugs resolved. Zero ESLint errors across codebase.

### В разработке ⏳

**Mobile Sub-Phase 3: Core Search UI** (текущий приоритет):
- Search home screen с city selection и filters
- Establishments list screen с pagination
- Establishment detail screen с full information
- Filter panel implementation (category, cuisine, price range, rating)
- Sort options (distance, rating, price)
- Search result state management
- Error handling и empty states

### Запланировано 📋

**Partner Features**:
- Analytics dashboard
- Subscription management system
- Promotion system
- Advanced review response management

**Admin Panel**:
- Web admin interface с Flutter Web
- Content moderation workflow
- User management tools
- Analytics and reporting
- System monitoring dashboard

**Advanced Features**:
- Push notifications
- In-app messaging
- Advanced search filters
- Personalized recommendations
- Social features

## Roadmap по фазам

### ✅ Фаза 1: Архитектурный фундамент (Завершена)
- Методология распределённого интеллекта v8.0 (Agentic Framework)
- Функциональная спецификация v3.0
- API спецификация v2.0
- Схема базы данных v2.0
- Структура репозитория

### ✅ Фаза 2: Backend Core (Завершена)
- Backend infrastructure setup
- Authentication system
- Search & discovery
- Reviews system
- Favorites system

### ✅ Фаза 3: Quality Assurance - Backend Core (Завершена - Декабрь 2025)
- ✅ Three-phase testing initiative (Authentication & Search, Reviews, Favorites & Establishments)
- ✅ 400+ comprehensive test scenarios с integration, E2E, и unit tests
- ✅ Production-grade coverage: 64% overall (75%+ expected after Cloudinary integration)
- ✅ Perfect coverage (100%) для Favorites и Establishments controllers
- ✅ Zero flaky tests, all tests passing consistently
- ✅ CI/CD ready с automated regression protection
- ✅ Comprehensive testing documentation (TESTING_GUIDE.md, PRODUCTION_READINESS.md, troubleshooting_bank.md)

### ✅ Фаза 4: Establishments Management (Завершена)
- Partner registration flow
- Establishment CRUD operations
- Media management с Cloudinary integration
- Moderation workflow
- Comprehensive testing

### ⏳ Фаза 5: Mobile MVP Frontend (Текущая фаза)

**Sub-Phase 1: Foundation Architecture** ✅ (Завершена - Ноябрь 2025)
- ✅ Flutter project setup с dependencies
- ✅ Material Design 3 theme system
- ✅ API integration layer (Dio + interceptors)
- ✅ State management implementation (Provider)
- ✅ Navigation framework (Navigator 2.0 + bottom tabs)
- ✅ Reusable components (EstablishmentCard)
- ✅ End-to-end validation screen
- ✅ Widget tests для core functionality
- 📄 Comprehensive session report ([session_report.md](session_report.md))

**Sub-Phase 2: Authentication Flows** ✅ (Завершена - Декабрь 2025)
- ✅ Enhanced AuthProvider с login, registration, verification методами
- ✅ Reusable form components (CustomTextField, PhoneInputField, PasswordStrengthIndicator, ErrorBanner)
- ✅ Email registration + 6-digit email verification
- ✅ Phone registration (Belarus +375) + 5-digit SMS verification
- ✅ Login screen с combined email/phone input
- ✅ Complete navigation integration
- ✅ Pixel-perfect Figma design implementation
- 📄 Handoff documentation ([PHASE_TWO_COMPLETION_REPORT.md](PHASE_TWO_COMPLETION_REPORT.md))

**Sub-Phase 3: Core Search UI** ✅ (Завершена - Январь 2026)
- ✅ **Phase 3.1: Results List** - Establishments list screen с pagination, sorting, favorites (Январь 2026)
- ✅ **Phase 3.2: Filter System** - Comprehensive filter panel с 6 секциями фильтров (Январь 2026)
- ✅ **Phase 3.3: Search Home & Detail View** - Search home screen с city selector + Establishment detail screen (Январь 2026)
- ✅ Error handling и empty states (реализовано в 3.1-3.3)

**Sub-Phase 4: Extended Features** 📋 (Запланировано)
- Map view с establishment markers
- Favorites screen implementation
- Profile screen implementation
- News screen implementation
- Image gallery для establishments
- Maps integration (Google Maps)
- Offline support foundation

### 📋 Фаза 6: User Features Integration
- Authentication flow в mobile app
- Reviews создание и просмотр
- Favorites management
- User profile management
- Push notifications setup

### 📋 Фаза 7: Partner Mobile Features
- Partner dashboard в mobile
- Establishment management
- Analytics viewing
- Notifications

### 📋 Фаза 8: Admin Web Panel
- Flutter Web admin interface
- Content moderation dashboard
- User management
- Analytics and reporting
- System monitoring

### 📋 Фаза 9: Testing & Polish
- Comprehensive E2E testing
- Performance optimization
- UX refinement
- Bug fixes
- Security audit

### 📋 Фаза 10: Launch Preparation
- Production deployment setup
- Monitoring и logging
- Marketing materials
- Beta testing program
- App Store submission

Детальная дорожная карта доступна в [функциональной спецификации](docs/01_specifications/functional_spec_v3.md) и [Implementation Summary](backend/IMPLEMENTATION_SUMMARY.md).

## Ключевые метрики успеха

**Технические**:
- Время загрузки главного экрана < 2 секунд
- Crash-free rate > 99%
- API response time < 500ms для 95-го перцентиля
- Размер приложения < 50MB

**Пользовательские**:
- 250-500 заведений к моменту публичного запуска
- 1000+ активных пользователей к концу 2-го месяца
- Retention Day 7 > 20%

**Бизнес**:
- 10+ платных подписок к концу 3-го месяца
- Конверсия из триала в платную подписку > 30%

## Методология разработки

Проект использует **Distributed Intelligence Methodology v8.0 (Agentic Framework)**, которая реализует двухуровневую модель координации между человеком и автономными AI-агентами.

**Двухуровневая Agentic Architecture**:
- **Tier 1 — Strategic Trunk (Web Interface)**: Архитектор и планировщик. Поддерживает глобальный контекст, анализирует session reports, формулирует высокоуровневые директивы для Leaf выполнения
- **Tier 2 — Autonomous Leaf (Local Execution)**: Строитель и тестировщик. Прямой доступ к codebase, автономное планирование, выполнение, верификация через тесты, интеграция через Git commits

**Human Coordinator Role**:
- **Strategic Vision Keeper**: Поддержание архитектурной coherence
- **Context Bridge**: Передача директив между Trunk (Web) и Leaf (CLI)
- **Safety Gate**: Одобрение file operations
- **Resource Manager**: Мониторинг context utilization и планирование handoffs
- **Scope Authority**: Авторизация proactive scope extensions

**Knowledge Management**:
- **GitHub** как primary truth source для кода и версионирования
- **Claude Projects** как knowledge layer для межсессионной памяти
- **Session Reports** для continuity и traceability
- **Bank of Failures** для troubleshooting knowledge accumulation

**Autonomous Execution Cycle**:
1. **Discovery (Read-Only)**: Изучение текущего состояния codebase
2. **Planning**: Предложение implementation approach для coordinator approval
3. **Implementation**: Создание/редактирование файлов с автономной self-correction
4. **Delivery**: Git commit + comprehensive session report

**Context Management System**:
- **Green Zone (<70%)**: Normal operation, full creative freedom
- **Yellow Zone (70-85%)**: Warning, завершение current unit, no expansion
- **Orange Zone (85-90%)**: Mandatory commit и handoff preparation
- **Red Zone (>90%)**: Emergency stop, WIP commit, session terminates

Полная методология описана в **[Methodology v8.0](docs/00_methodology/methodology_v8.0.md)**.

## Текущие приоритеты для Mobile Development

На данный момент backend полностью готов для интеграции. Все необходимые API endpoints реализованы и протестированы. Следующий этап — создание мобильного приложения на Flutter, которое будет потреблять эти endpoints.

**Критические задачи для Фазы 5**:

1. **Flutter Project Initialization**:
   - Настройка project structure согласно best practices
   - Конфигурация для iOS и Android
   - Интеграция зависимостей (Dio, Provider/Riverpod, Cached Network Image)

2. **API Integration Layer**:
   - HTTP client setup с базовой конфигурацией
   - Authentication interceptors для JWT tokens
   - Error handling и retry logic
   - Response models синхронизированные с backend

3. **Core Screens Implementation**:
   - Стартовый экран с city selection и filters
   - Список заведений с pagination
   - Детальная карточка заведения с gallery
   - Map view с establishment markers
   - User profile и favorites

4. **State Management**:
   - Provider/Riverpod setup для global state
   - Authentication state management
   - Caching strategy для offline support

5. **Maps Integration**:
   - Google Maps SDK integration для iOS/Android
   - Custom markers для establishments
   - Location services и permissions

**Документация для Mobile Development**:
- [Functional Specification v3](docs/01_specifications/functional_spec_v3.md) — детальные UI/UX требования
- [API Specification v2.0](docs/02_architecture/api_specification_v2.0.yaml) — все доступные endpoints
- Backend handoff документы для понимания data structures

## Contributing

Проект находится в стадии активной разработки. Методология работы с AI-ассистентами описана в документации по методологии. При внесении изменений:

1. Следуйте установленным архитектурным паттернам
2. Добавляйте comprehensive inline comments
3. Обновляйте соответствующую документацию
4. Создавайте descriptive commit messages с references на originating sessions
5. Для Flutter development: всегда явно указывайте paradigm (Flutter/Dart, не Web)

## Testing Guidelines

**Backend Testing**:
- Smoke tests для critical paths
- Integration tests для all endpoints
- Следуйте testing guides в backend/TESTING_*.md

**Mobile Testing** (upcoming):
- Widget tests для UI components
- Integration tests для user flows
- Platform-specific testing (iOS/Android)

## License

Proprietary - все права защищены.

## Контакты

**Основатель проекта**: Всеволод
**Архитектурный координатор**: Claude (Anthropic AI)
**Методология**: Distributed Intelligence v8.0 (Agentic Framework)

---

## Recent Updates

### Январь 13, 2026 - Mobile Phase 3.3: Search Home & Detail View Complete
- ✅ **Phase 3.3 Search Home & Detail View** полностью реализована (VSCode Session)
  * Phase A: Search Home Screen с NIRIVIO branding, city selector, search bar
  * Phase B: Establishment Detail View Core с hero section и info overlay
  * Phase C: Photo Gallery с PageView, swipe navigation, fullscreen viewer
  * Phase D: Reviews Section и Map placeholder
  * Phase E: Integration Testing и City Selector refinement
- ✅ **Search Home Screen**:
  * Full-screen background image с dark overlay
  * NIRIVIO logo + tagline "Мы скажем, куда сходить"
  * City selector button → modal с 7 городами Беларуси
  * Filter button с badge для active filters
  * Search input с orange submit button
- ✅ **City Selector Modal** (Figma-accurate):
  * Header: "Местоположение" + chevron back + "Сброс"
  * Section title: "Ваш город"
  * Cities с областями (Минск, Гродно, Брест, Гомель, Витебск, Могилёв, Бобруйск)
  * Orange checkboxes (#EC723D) для selection
  * "Применить" button (#DB4F13) с bottom gradient
- ✅ **Establishment Detail Screen** (1367 lines):
  * Hero section (657px) с photo gallery PageView
  * Info overlay: name, category, cuisine, status, address, phone, Instagram
  * Rating badge (green square) + price indicator
  * Menu section с working hours и photo carousel
  * Attributes section с Material Icons в circles
  * Map section placeholder
  * Reviews section (dark background) с horizontal carousel
  * Fullscreen gallery с InteractiveViewer и pinch-to-zoom
- ✅ **New Files Created**:
  * `lib/screens/establishment/detail_screen.dart` - Detail view (1367 lines)
  * `lib/models/review.dart` - Review model
  * `lib/services/reviews_service.dart` - Reviews API service
  * `mobile/session_reports/phase_3_3_search_detail_report.md` - Session report
- ✅ **Files Modified**:
  * `lib/screens/search/search_home_screen.dart` - Complete rewrite
  * `lib/main.dart` - onGenerateRoute для `/establishment/:id`
  * `lib/screens/search/results_list_screen.dart` - Navigation to detail
  * `pubspec.yaml` - Assets configuration
- ✅ **Build**: app-debug.apk успешно собран
- ✅ **1 Git commit** + comprehensive session report
- 📄 **Session Report**: [mobile/session_reports/phase_3_3_search_detail_report.md](mobile/session_reports/phase_3_3_search_detail_report.md)
- **Code Metrics**: +2,327 lines, 9 files changed
- 🎯 **Status**: Sub-Phase 3 (Core Search UI) полностью завершена
- 🎯 **Next**: Sub-Phase 4 (Extended Features: Map, Favorites, Profile screens)

### Январь 13, 2026 - Mobile Phase 3.2: Filter System Implementation Complete
- ✅ **Phase 3.2 Filter System** полностью реализована (VSCode Session)
  * Phase A: Filter enums (DistanceOption, PriceRange, HoursFilter) + FilterConstants
  * Phase B: Filter panel screen layout с Figma-based styling
  * Phase C: Filter section UI components (merged with Phase B)
  * Phase D: Integration с results list - filter badge в AppBar
  * Phase E: Testing и session report
- ✅ **6 Filter Sections Implemented**:
  * Расстояние от вас (6 опций, single-select checkboxes)
  * Средний чек ($, $$, $$$, multi-select cards)
  * Время работы (До 22:00, До утра, 24ч., single-select buttons)
  * Категория заведения (13 категорий, grid с "Все" toggle)
  * Категория кухни (10 кухонь, grid с "Все" toggle)
  * Дополнительно (14 amenities, checkbox list)
- ✅ **Figma MCP Integration**: Pixel-perfect design implementation
  * Colors: #F4F1EC background, #FD5F1B primary, #DB4F13 selected
  * Unified outline selection style для категорий (per coordinator request)
  * Fixed "Применить" button at bottom
- ✅ **EstablishmentsProvider Extended**:
  * Advanced filter state с Set-based collections
  * Toggle methods для multi-select filters
  * `hasActiveFilters` и `activeFilterCount` getters
  * Filter parameter integration с API
- ✅ **4 Git commits** (Phases A, B, D, E) + comprehensive session report
- 📄 **Session Report**: [mobile/session_reports/phase_3_2_filter_system_report.md](mobile/session_reports/phase_3_2_filter_system_report.md)
- **Files Created/Modified**:
  * `lib/models/filter_options.dart` - Enums и FilterConstants (NEW)
  * `lib/providers/establishments_provider.dart` - Extended filter state
  * `lib/screens/search/filter_screen.dart` - Full filter panel UI (NEW, 770 lines)
  * `lib/screens/search/results_list_screen.dart` - Filter badge в AppBar
  * `lib/main.dart` - /filter route
- 🎯 **Status**: Filter system production-ready
- 🎯 **Next**: Phase 3.3 (Search Home + Establishment Detail)

### Январь 12-13, 2026 - Mobile Phase 3.1: Results List Enhancement Complete
- ✅ **Phase 3.1 Results List Enhancement** полностью завершена (VSCode Session)
  * Phase A: Enhanced EstablishmentsProvider с SortOption enum, isLoadingMore state, setSort() method
  * Phase B: Results list screen с ScrollController pagination (200px threshold)
  * Phase C: Pull-to-refresh (RefreshIndicator) + Sort options bottom sheet
  * Phase D: Empty states, error handling, favorites integration с authentication check
  * Phase E: Integration testing и Figma MCP UI polish
- ✅ **Key Features Implemented**:
  * Infinite scroll pagination с efficient lazy loading
  * 4 sort options: По расстоянию, По рейтингу, По цене ↑, По цене ↓
  * Sort bottom sheet с checkbox-style selection (Figma design)
  * Favorites toggle с login prompt для unauthenticated users
  * Optimistic UI updates с automatic rollback on failure
  * Russian localization для всех UI элементов
- ✅ **Figma MCP Integration**: UI elements refined using Figma design context
  * Sort button стиль (swap_vert icon + text)
  * Sort bottom sheet с X button и centered title
  * Checkbox indicators для selected sort option
  * Favorite icon color: orange (#FF6B35) per brand guidelines
- ✅ **5 Git commits** (one per phase A-E) + comprehensive session report
- 📄 **Session Report**: [mobile/session_reports/phase_3_1_results_list_report.md](mobile/session_reports/phase_3_1_results_list_report.md)
- **Files Modified/Created**:
  * `lib/providers/establishments_provider.dart` - SortOption, pagination states
  * `lib/services/establishments_service.dart` - sortBy parameter
  * `lib/screens/search/results_list_screen.dart` - New results list screen
  * `lib/widgets/establishment_card.dart` - Favorite button color fix
  * `lib/main.dart` - /search/results route
- 🎯 **Status**: Results list production-ready, 77 establishments across 7 cities
- 🎯 **Next**: Phase 3.2 (Filtering) или Phase 3.3 (Search Home/Detail View)

### Декабрь 16, 2025 - Mobile Phase Two: Authentication Flows Complete
- ✅ **Phase Two Mobile Development** полностью завершена (VSCode Integration Session)
  * Phase A: Enhanced AuthProvider с comprehensive authentication methods
  * Phase B: Reusable form components (CustomTextField, PhoneInputField, PasswordStrengthIndicator, ErrorBanner, SubmitButton)
  * Phase C: Email registration flow (EmailRegistrationScreen + EmailVerificationScreen с 6-digit code)
  * Phase D: Phone registration flow (PhoneRegistrationScreen + PhoneVerificationScreen с 5-digit SMS code)
  * Phase E: Login screen с combined email/phone input и flexible validation
  * Phase F: Complete navigation integration и testing (flutter analyze passed)
- ✅ **7 Authentication Screens** pixel-perfect Figma implementation:
  * MethodSelectionScreen (from Phase One)
  * EmailRegistrationScreen, EmailVerificationScreen
  * PhoneRegistrationScreen, PhoneVerificationScreen
  * LoginScreen
  * Complete navigation flows validated
- ✅ **5 Reusable Form Widgets** для consistency across app
- ✅ **Belarus-Specific Features**: +375 phone format auto-formatting, operator validation (25/29/33/44)
- ✅ **Key Differences**: Phone verification uses 5 digits (SMS), email uses 6 digits
- ✅ **5 Git commits** (one per phase A-E) + comprehensive handoff documentation
- ✅ **Figma MCP Integration**: Pixel-perfect design implementation from Figma frames
- 📄 **Handoff Report**: [PHASE_TWO_COMPLETION_REPORT.md](PHASE_TWO_COMPLETION_REPORT.md) для Trunk coordination
- **Code Metrics**: ~2,000 lines, 12 new files, 11 non-critical style warnings
- 🎯 **Status**: Authentication flows production-ready, awaiting backend API integration
- 🎯 **Next**: Sub-Phase 3 - Core Search UI implementation

### Декабрь 2025 - Codex Max Integration Session
- ✅ **Three-Directive Session** с GPT-5.1 Codex Max координируемая Claude Opus 4.5
  * Directive 1: Исправлен production bug с 500 ошибками в review update/delete endpoints
  * Directive 2: Реализованы Daily Quota тесты (10 reviews/day limit, quota exceeded, midnight reset)
  * Directive 3: Реализована новая фича Partner Responses (миграция 009, полный стек, 2 новых endpoint)
  * Final: Достигнуто zero ESLint errors across entire backend codebase
- ✅ **Partner Responses Feature** полностью реализована:
  * POST /api/v1/reviews/:id/response — добавление ответа партнёра
  * DELETE /api/v1/reviews/:id/response — удаление ответа партнёра
  * Ownership verification: партнёр может отвечать только на отзывы своего заведения
  * 6 новых интеграционных тестов для авторизации и функциональности
- ✅ **Reviews Module Complete**: 39 интеграционных тестов, все проходят
- ✅ **Code Quality**: Zero ESLint errors в production и test файлах
- ✅ **Three-Agent Coordination** validated: Human Coordinator + Trunk (Claude) + Leaf (Codex Max)
- 🎯 **Backend Status**: All core modules production-ready including new Partner Responses feature

### Декабрь 2025 - Backend Testing Initiative Completed
- ✅ **Three-Phase Testing Initiative** successfully completed
  * Phase 1: Authentication & Search testing (87% auth, 83.9% search coverage)
  * Phase 2: Reviews testing (97.46% service, 100% controller coverage)
  * Phase 3: Favorites & Establishments testing (100% favorites, 91.67% establishments coverage)
- ✅ **Production-Grade Coverage**: 64% overall (75%+ expected after Cloudinary integration)
- ✅ **400+ comprehensive test scenarios** across all critical modules
- ✅ **Zero flaky tests**, full test suite completes in under 5 minutes
- ✅ **CI/CD ready** with automated regression protection
- ✅ **Testing documentation** created: TESTING_GUIDE.md, troubleshooting_bank.md, PRODUCTION_READINESS.md
- 🎯 **Backend Status**: All core modules production-ready for mobile integration

### Ноябрь 2025 - Mobile Phase One Foundation
- ✅ **Flutter Mobile Phase One Foundation** полностью реализована (Leaf Session)
  * Phase A: Project structure & configuration
  * Phase B: Material Design 3 theme system
  * Phase C: Dio API client с JWT interceptors
  * Phase D: Provider state management
  * Phase E: Navigator 2.0 с bottom tab navigation
  * Phase F: EstablishmentCard component + ValidationScreen
- ✅ **End-to-End Validation** успешно завершена:
  * Полная интеграция: Flutter UI → Provider → Service → API → PostgreSQL
  * 35 establishments загружены из Минска
  * Cloudinary images отображаются корректно
  * Favorite toggle functionality работает
- ✅ **6 Git commits** (one per phase) + comprehensive session report
- ✅ **Widget tests** для app launch и tab navigation
- 🎯 **Next**: Mobile Phase Two - Core Search UI (awaiting Figma mockups)

### Ноябрь 2025 - Backend Completion
- ✅ **Establishments Management System** полностью реализована и протестирована
- ✅ Media management с Cloudinary integration завершён
- ✅ Comprehensive testing для Establishments выполнен
- ✅ Backend готов для mobile integration

### Октябрь 2025
- ✅ Reviews System implementation
- ✅ Favorites System implementation
- ✅ Authentication System с refresh token rotation
- ✅ Search & Discovery с PostGIS

### Сентябрь 2025
- ✅ Backend infrastructure setup
- ✅ Database schema design
- ✅ API specification v2.0

---

*Последнее обновление: Январь 13, 2026 (Phase 3.3 Search Home & Detail View Complete)*
*Статус документа: Production-Ready*
*Next Review: После завершения Sub-Phase 4 (Extended Features)*