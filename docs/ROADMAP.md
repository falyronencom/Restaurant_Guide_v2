# Roadmap — Restaurant Guide Belarus

Подробная дорожная карта разработки по фазам. Для общего обзора проекта см. [README.md](../README.md).

---

## Фаза 1: Архитектурный фундамент (Завершена)
- Методология распределённого интеллекта v8.0 (Agentic Framework)
- Функциональная спецификация v3.0
- API спецификация v2.0
- Схема базы данных v2.0
- Структура репозитория

## Фаза 2: Backend Core (Завершена)
- Backend infrastructure setup
- Authentication system
- Search & discovery
- Reviews system
- Favorites system

## Фаза 3: Quality Assurance - Backend Core (Завершена - Декабрь 2025)
- Three-phase testing initiative (Authentication & Search, Reviews, Favorites & Establishments)
- 400+ comprehensive test scenarios с integration, E2E, и unit tests
- Production-grade coverage: 64% overall (75%+ expected after Cloudinary integration)
- Perfect coverage (100%) для Favorites и Establishments controllers
- Zero flaky tests, all tests passing consistently
- CI/CD ready с automated regression protection

## Фаза 4: Establishments Management (Завершена)
- Partner registration flow
- Establishment CRUD operations
- Media management с Cloudinary integration
- Moderation workflow
- Comprehensive testing

## Фаза 5: Mobile MVP Frontend (Текущая фаза)

### Sub-Phase 1: Foundation Architecture (Завершена - Ноябрь 2025)
- Flutter project setup с dependencies
- Material Design 3 theme system
- API integration layer (Dio + interceptors)
- State management implementation (Provider)
- Navigation framework (Navigator 2.0 + bottom tabs)
- Reusable components (EstablishmentCard)
- End-to-end validation screen
- Widget tests для core functionality
- Session report: [mobile/session_reports/phase_1_foundation_report.md](../mobile/session_reports/phase_1_foundation_report.md)

### Sub-Phase 2: Authentication Flows (Завершена - Декабрь 2025)
- Enhanced AuthProvider с login, registration, verification методами
- Reusable form components (CustomTextField, PhoneInputField, PasswordStrengthIndicator, ErrorBanner)
- Email registration + 6-digit email verification
- Phone registration (Belarus +375) + 5-digit SMS verification
- Login screen с combined email/phone input
- Complete navigation integration
- Pixel-perfect Figma design implementation
- Handoff report: [mobile/session_reports/phase_2_auth_flows_report.md](../mobile/session_reports/phase_2_auth_flows_report.md)

### Sub-Phase 3: Core Search UI (Завершена - Январь 2026)
- **Phase 3.1: Results List** - Establishments list screen с pagination, sorting, favorites
- **Phase 3.2: Filter System** - Comprehensive filter panel с 6 секциями фильтров
- **Phase 3.3: Search Home & Detail View** - Search home screen с city selector + Establishment detail screen
- Error handling и empty states (реализовано в 3.1-3.3)

### Sub-Phase 4: Extended Features (Завершена - Январь 2026)
- **Phase 4.1: Favorites Tab** - Full favorites screen с 5 states, pull-to-refresh, optimistic UI
- **Phase 4.2: Write Review & Reviews List** - Write review screen с star rating, reviews list с reactions
- **Phase 4.3: Map Tab** - Yandex MapKit integration с markers и clustering
- **Phase 4.4: Profile Management** - ProfileScreen + EditProfileScreen с user reviews list
- Phase 4.5: News screen implementation (запланировано)
- Offline support foundation (запланировано)

### Phase 5.1: Partner Registration (Завершена - Январь 19, 2026)
- **Segment 5.1a**: Data Model, Provider, Wizard Container, Steps 1-2 (Category, Cuisine)
- **Segment 5.1b**: Step 3 (BasicInfoStep), Step 4 (MediaStep), WorkingHoursScreen
- **Segment 5.1c**: Step 5 (AddressStep), Step 6 (LegalInfoStep), Step 7 (SummaryStep), Preview Screen
- 7-Step Wizard: Complete partner registration flow с validation на каждом шаге
- Establishment Preview: Full preview screen
- API Integration: createEstablishment() method с mock support
- Code Metrics: ~4,800 lines, 12 files created across 3 sessions
- Final Report: [mobile/session_reports/phase_5_1_partner_registration_report.md](../mobile/session_reports/phase_5_1_partner_registration_report.md)

### Phase 5.2: Partner Dashboard (Завершена - Январь 19, 2026)
- **Segment 5.2a**: PartnerEstablishment model, PartnerService, PartnerDashboardProvider, PartnerEstablishmentCard
- **Segment 5.2b**: PartnerStatisticsScreen, PartnerReviewsScreen, EditEstablishmentScreen
- Statistics Screen: Detailed analytics с metrics, charts, rating distribution
- Reviews Screen: Partner reviews list с date filter и sorting options
- Edit Menu Screen: Menu-style screen для редактирования параметров заведения
- ProfileScreen Integration: Partner establishments section в профиле
- Code Metrics: ~2,300 lines, 7 files created
- Session Report: [mobile/session_reports/phase_5_2_partner_dashboard_report.md](../mobile/session_reports/phase_5_2_partner_dashboard_report.md)

## Фаза 6: User Features Integration (Запланировано)
- Authentication flow в mobile app
- Reviews создание и просмотр
- Favorites management
- User profile management
- Push notifications setup

## Фаза 7: Partner Mobile Features (Запланировано)
- Partner dashboard в mobile
- Establishment management
- Analytics viewing
- Notifications

## Фаза 8: Admin Web Panel (Текущая фаза)

### Segment A: Foundation + Login (Завершён - Февраль 8, 2026)
- Backend: admin login endpoint (`POST /api/v1/admin/auth/login`) с role gate
- Admin-web: Flutter Web project setup с GoRouter, Provider, Dio
- Login screen с error handling
- AdminShell layout: 363px sidebar + content area
- Sidebar navigation: Модерация (3 items) + Настройки (4 items)
- Auth guard: protected routes + session persistence
- Placeholder screens для всех разделов
- Files Created: 15 new files (~1,800 lines)
- Discovery Report: [docs/handoffs/admin-panel-figma-audit.md](handoffs/admin-panel-figma-audit.md)

### Segment B: Moderation Workflow (Запланировано)
- Content moderation dashboard (Ожидают просмотра, Одобренные, Отказанные)
- Per-field approve/reject/comment actions
- 4 tabs: Данные, О заведении, Медиа, Адрес

### Segment C: Analytics & Statistics (Запланировано)
- Statistics screens (Заведения, Пользователи, Отзывы/оценки)
- Charts: line, bar, donut
- Dashboard with key metrics

### Segment D: Content Management (Запланировано)
- Reviews management
- Payment history
- Notifications

### Segment E: Security & Polish (Запланировано)
- 2FA implementation
- Audit log
- Final polish

## Фаза 9: Testing & Polish (Запланировано)
- Comprehensive E2E testing
- Performance optimization
- UX refinement
- Bug fixes
- Security audit

## Фаза 10: Launch Preparation (Запланировано)
- Production deployment setup
- Monitoring и logging
- Marketing materials
- Beta testing program
- App Store submission

---

Детальная спецификация доступна в [функциональной спецификации](01_specifications/functional_spec_v3.md) и [Implementation Summary](../backend/IMPLEMENTATION_SUMMARY.md).
