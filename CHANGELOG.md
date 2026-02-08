# Changelog

Full development history of Restaurant Guide Belarus. For project overview, see [README.md](README.md).

---

## Recent Updates

### Февраль 8, 2026 - Фаза 8 Segment B: Admin Panel — Moderation Core
- Segment B Moderation Core полностью реализован (Protocol Informed v1.2)
- Backend (4 new files, 2 modified):
  * `adminService.js` — business logic: list pending, get details for moderation, execute approve/reject with audit logging
  * `adminModerationController.js` — 3 HTTP handlers (list pending, get details, moderate)
  * `auditLogModel.js` — audit_log INSERT (non-blocking, graceful failure)
  * `establishmentModel.js` — added `getPendingEstablishments()`, `countPendingEstablishments()`, `moderateEstablishment()`
  * `adminRoutes.js` — 3 new routes with authenticate + authorize(['admin']) middleware
- Backend Endpoints:
  * `GET /api/v1/admin/establishments/pending` — paginated list, FIFO sort (oldest first)
  * `GET /api/v1/admin/establishments/:id` — full details with media + partner docs for 4-tab review
  * `POST /api/v1/admin/establishments/:id/moderate` — approve (→ active) or reject (→ draft) with per-field notes + audit log
- Admin-Web Frontend (8 new files, 2 modified):
  * **Models**: EstablishmentListItem, EstablishmentDetail, MediaItem with JSON parsing
  * **Services**: ModerationService (3 API endpoints via ApiClient)
  * **State**: ModerationProvider (pending list, selected detail, per-field review state Map, moderation actions)
  * **Widgets**: ModerationFieldReview (reusable, used 14x), ModerationListPanel (card list), ModerationDetailPanel (4 tabs + action bar)
  * **Screen**: PendingModerationScreen (3-panel layout: sidebar + list + detail)
  * **Router**: Replaced PlaceholderScreen for /moderation/pending
  * **main.dart**: Added ModerationProvider to MultiProvider
- Moderation Workflow:
  * Card list: name, category, cuisine tag, address, date, thumbnail, selection highlight
  * 4 tabs: Данные (5 fields), О заведении (6 moderable + 2 info), Медиа (photos + menu), Адрес (address + map placeholder)
  * Per-field: approve (green), reject (red + comment dialog), comment (orange) — visual state management
  * Actions: "Одобрить заведение" / "Отклонить" with confirmation dialogs
  * approve → status 'active', published_at set, audit_log entry, card removed from list
  * reject → status 'draft', per-field notes stored, audit_log entry, card removed from list
- **Status**: Pending moderation screen fully functional, end-to-end workflow complete
- **Next**: Segment C — Одобренные + Отказанные screens (read-only views)

### Февраль 8, 2026 - Фаза 8 Segment A: Admin Panel Foundation + Login Complete
- Admin Panel Segment A полностью реализован (VSCode Session, Protocol Informed v1.1)
  * Backend: admin login endpoint с role verification
  * Frontend: Flutter Web admin panel foundation
- Backend Changes (3 files):
  * `adminController.js` — admin login handler reusing existing authService, role gate (user.role !== 'admin' -> 403)
  * `adminRoutes.js` — `POST /api/v1/admin/auth/login` с strict rate limiting (5/min)
  * `index.js` — mounted admin routes
  * `.env` — CORS updated for Flutter Web port 8080
- Admin-Web Frontend (12 new files):
  * **Config**: Environment (localhost:3000 for dev), GoRouter с auth redirect guard
  * **Models**: User (dual JSON field support), AuthResponse
  * **Services**: ApiClient (Dio singleton, 3 interceptors: token inject, token extract, 401 refresh+retry), AuthService (login/logout/getCurrentUser)
  * **State**: AuthProvider (ChangeNotifier, 3 states: unauthenticated/authenticating/authenticated)
  * **UI**: LoginScreen (centered card, email+password), AdminShell (sidebar+content), AdminSidebar (363px, 7 nav items, logo, logout), PlaceholderScreen
  * **main.dart**: StatefulWidget с Provider + MaterialApp.router
- Sidebar Navigation (from Figma Discovery Report):
  * Модерация: Ожидают просмотра, Одобренные, Отказанные
  * Настройки: Статистика и аналитика, Отзывы, История платежей, Уведомления
  * Active item highlighting + chevron icon
  * Logout button at bottom
- Build: `flutter build web` successful, `flutter analyze` 0 errors / 0 warnings (6 info only)
- Architecture: Follows mobile patterns exactly (singleton services, ChangeNotifier providers, layered architecture)
- Discovery Report: [docs/handoffs/admin-panel-figma-audit.md](docs/handoffs/admin-panel-figma-audit.md) — Figma Design Audit (8 frames, coverage matrix, implementation order)
- **Status**: Admin panel foundation ready, all 7 sidebar routes lead to placeholder screens
- **Next**: Segment B — Moderation Workflow (requires Figma MCP for pixel-accurate UI)

### Январь 19, 2026 - Phase 5.1: Partner Registration Complete
- Phase 5.1 Partner Registration полностью реализована (3 Multi-Session Implementation)
  * Segment 5.1a: PartnerRegistration model, Provider, Wizard Container, CategoryStep, CuisineStep
  * Segment 5.1b: BasicInfoStep с working hours, MediaStep с photo upload
  * Segment 5.1c: AddressStep, LegalInfoStep, SummaryStep, EstablishmentPreviewScreen
- 7-Step Registration Wizard:
  * Step 1: Категория заведения (до 2 категорий)
  * Step 2: Категория кухни (до 3 типов)
  * Step 3: Основная информация (название, описание, контакты, часы работы, атрибуты)
  * Step 4: Медиа (фото интерьера до 50, фото меню до 20, выбор главного фото)
  * Step 5: Адрес (город, улица, дом, корпус)
  * Step 6: Юридическая информация (юр. название, УНП, контактные данные)
  * Step 7: Сводка и превью (чеклист шагов, кнопки Preview и Submit)
- Establishment Preview Screen (780 lines):
  * Полный preview карточки заведения как она будет выглядеть после модерации
  * Photo galleries, working hours, attributes, map placeholder
  * "ПРЕВЬЮ" badge для визуального отличия
- Technical Highlights:
  * WeeklyWorkingHours model с 7 днями недели
  * WorkingHoursScreen для детальной настройки времени работы
  * ImagePicker integration для загрузки фото
  * UNP validation (9 digits)
  * createEstablishment() API method с mock support
- Build: flutter analyze passed, APK successfully built
- Files Created: 12 new files (~4,800 lines)
- Final Report: [mobile/session_reports/phase_5_1_partner_registration_report.md](mobile/session_reports/phase_5_1_partner_registration_report.md)

### Январь 19, 2026 - Phase 5.2b: Partner Dashboard (Segment 2) Complete
- Phase 5.2b Partner Dashboard полностью реализована (Segment 2 of 2)
  * Phase D: PartnerStatisticsScreen - детальная аналитика заведения
  * Phase E: PartnerReviewsScreen - просмотр отзывов с фильтрацией по дате
  * Phase F: EditEstablishmentScreen - меню редактирования параметров заведения
- PartnerStatisticsScreen Features (~700 lines):
  * Карточка заведения с названием и статусом
  * Период выбора (Неделя, Месяц, Год)
  * Метрики: просмотры, репосты, в избранном, переходы по ссылке
  * Гистограмма посещений по дням недели
  * Распределение оценок (5 звёзд - 1 звезда)
  * Кнопка "Просмотр отзывов" внизу экрана
- PartnerReviewsScreen Features (~480 lines):
  * Фильтр по дате (от/до) с DatePicker
  * Сортировка: по дате (новые/старые), по рейтингу (высокий/низкий)
  * Карточки отзывов с аватаром, именем, рейтингом, датой, текстом
  * Pull-to-refresh для обновления списка
  * Empty state для периодов без отзывов
- EditEstablishmentScreen Features (~590 lines):
  * Header с названием заведения и статусом
  * Секция "Информация" (7 пунктов меню)
  * Секция "Статус заведения" с возможностью приостановки/удаления
  * Навигация к существующим экранам регистрации для редактирования
  * Disabled state для заведений на модерации
- Session Report: [mobile/session_reports/phase_5_2_partner_dashboard_report.md](mobile/session_reports/phase_5_2_partner_dashboard_report.md)

### Январь 19, 2026 - Phase 5.2a: Partner Dashboard (Segment 1) Complete
- Phase 5.2a Partner Dashboard частично реализована (Segment 1 of 2)
  * Phase A: PartnerEstablishment model с EstablishmentStatus enum, EstablishmentStats model
  * Phase B: PartnerDashboardProvider с establishments list state management
  * Phase C: PartnerEstablishmentCard widget + ProfileScreen integration
- Partner Establishments in Profile:
  * ProfileScreen расширен для отображения секции "Основные заведения"
  * PartnerEstablishmentCard с метриками (views, shares, favorites)
  * Status badge под карточкой (На модерации / Одобрено / Отклонено)
  * "+ Добавить заведение" кнопка для создания новых заведений
- PartnerService с mock data support
- Build: flutter analyze passed, APK successfully built

### Январь 15, 2026 - Mobile Phase 4.4: Profile Management Complete
- Phase 4.4 Profile Management полностью реализована (VSCode Session)
  * ProfileScreen with two internal screens (main profile + profile detail)
  * EditProfileScreen with avatar section and form fields
  * Navigation integration (/profile/edit route)
- ProfileScreen Features:
  * Main profile tab: settings menu, profile card, partner section
  * Profile detail screen: user stats, user's reviews list
  * Logout confirmation dialog, avatar with initials fallback
- EditProfileScreen Features:
  * Large avatar with "Поменять фото" button
  * Form fields: Name, Location, Email (read-only), Phone (read-only)
  * ImagePicker integration for avatar selection
- Session Report: [mobile/session_reports/phase_4_4_profile_management_report.md](mobile/session_reports/phase_4_4_profile_management_report.md)

### Январь 15, 2026 - Mobile Phase 4.3: Map Tab with Yandex MapKit Complete
- Phase 4.3 Map Tab полностью реализована (VSCode Session)
  * Yandex MapKit Flutter integration
  * Map markers for establishments
  * Marker clustering для производительности
  * Info panel при выборе маркера
  * Navigation to detail screen from map
- Session Report: [mobile/session_reports/phase_4_3_map_tab_report.md](mobile/session_reports/phase_4_3_map_tab_report.md)

### Январь 14, 2026 - Mobile Phase 4.2: Write Review & Reviews List Complete
- Phase 4.2 Write Review & Reviews List полностью реализована (VSCode Session)
  * WriteReviewScreen с star rating selector (5 звёзд)
  * ReviewsListScreen с pagination, сортировкой, лайками/дизлайками
  * Error handling для 409 (duplicate) и 429 (quota) responses
- WriteReviewScreen: 5-star rating, text field с counter (0/1000), form validation, submit with loading
- ReviewsListScreen: Dark theme, review cards, like/dislike reactions, sort options, infinite scroll
- Session Report: [mobile/session_reports/phase_4_2_write_review_report.md](mobile/session_reports/phase_4_2_write_review_report.md)

### Январь 14, 2026 - Mobile Phase 4.1: Favorites Tab Implementation Complete
- Phase 4.1 Favorites Tab полностью реализована (VSCode Session)
  * 5 screen states: Loading, Empty (unauth), Empty (auth), Error, Data
  * Pull-to-refresh, optimistic UI updates, snackbar feedback
  * Extended EstablishmentsProvider с favorites list state
- Session Report: [mobile/session_reports/phase_4_1_favorites_tab_report.md](mobile/session_reports/phase_4_1_favorites_tab_report.md)

### Январь 13, 2026 - Mobile Phase 3.3: Search Home & Detail View Complete
- Phase 3.3 Search Home & Detail View полностью реализована (VSCode Session)
  * Search Home Screen с NIRIVIO branding, city selector, search bar
  * Establishment Detail View (1367 lines) с hero section, photo gallery, reviews
  * City Selector Modal (Figma-accurate) с 7 городами Беларуси
  * Fullscreen gallery с InteractiveViewer и pinch-to-zoom
- Session Report: [mobile/session_reports/phase_3_3_search_detail_report.md](mobile/session_reports/phase_3_3_search_detail_report.md)

### Январь 13, 2026 - Mobile Phase 3.2: Filter System Implementation Complete
- Phase 3.2 Filter System полностью реализована (VSCode Session)
  * 6 Filter Sections: расстояние, средний чек, время работы, категория заведения, категория кухни, дополнительно
  * Figma MCP Integration: Pixel-perfect design implementation
  * EstablishmentsProvider Extended с advanced filter state
- Session Report: [mobile/session_reports/phase_3_2_filter_system_report.md](mobile/session_reports/phase_3_2_filter_system_report.md)

### Январь 12-13, 2026 - Mobile Phase 3.1: Results List Enhancement Complete
- Phase 3.1 Results List Enhancement полностью завершена (VSCode Session)
  * Infinite scroll pagination, 4 sort options, favorites toggle
  * Figma MCP Integration для UI refinement
  * Optimistic UI updates с automatic rollback on failure
- Session Report: [mobile/session_reports/phase_3_1_results_list_report.md](mobile/session_reports/phase_3_1_results_list_report.md)

### Декабрь 16, 2025 - Mobile Phase Two: Authentication Flows Complete
- Phase Two Mobile Development полностью завершена (VSCode Integration Session)
  * 7 Authentication Screens pixel-perfect Figma implementation
  * 5 Reusable Form Widgets для consistency across app
  * Belarus-Specific Features: +375 phone format, operator validation
  * Figma MCP Integration
- Code Metrics: ~2,000 lines, 12 new files
- Handoff Report: [mobile/session_reports/phase_2_auth_flows_report.md](mobile/session_reports/phase_2_auth_flows_report.md)

### Декабрь 2025 - Codex Max Integration Session
- Three-Directive Session с GPT-5.1 Codex Max координируемая Claude Opus 4.5
  * Directive 1: Исправлен production bug с 500 ошибками в review update/delete endpoints
  * Directive 2: Реализованы Daily Quota тесты (10 reviews/day limit)
  * Directive 3: Реализована Partner Responses feature (миграция 009, полный стек, 2 новых endpoint)
  * Final: Zero ESLint errors across entire backend codebase
- Partner Responses Feature: POST/DELETE /api/v1/reviews/:id/response
- Reviews Module Complete: 39 интеграционных тестов, все проходят

### Декабрь 2025 - Backend Testing Initiative Completed
- Three-Phase Testing Initiative successfully completed
  * Phase 1: Authentication & Search testing (87% auth, 83.9% search coverage)
  * Phase 2: Reviews testing (97.46% service, 100% controller coverage)
  * Phase 3: Favorites & Establishments testing (100% favorites, 91.67% establishments coverage)
- Production-Grade Coverage: 64% overall
- 400+ comprehensive test scenarios, zero flaky tests
- CI/CD ready with automated regression protection

### Ноябрь 2025 - Mobile Phase One Foundation
- Flutter Mobile Phase One Foundation полностью реализована (Leaf Session)
  * 6 Phases (A-F): Project setup, theme, API client, state management, navigation, components
  * End-to-End Validation: 35 establishments loaded from Минск
  * 6 Git commits + comprehensive session report
- Session Report: [mobile/session_reports/phase_1_foundation_report.md](mobile/session_reports/phase_1_foundation_report.md)

### Ноябрь 2025 - Backend Completion
- Establishments Management System полностью реализована и протестирована
- Media management с Cloudinary integration завершён
- Backend готов для mobile integration

### Октябрь 2025
- Reviews System implementation
- Favorites System implementation
- Authentication System с refresh token rotation
- Search & Discovery с PostGIS

### Сентябрь 2025
- Backend infrastructure setup
- Database schema design
- API specification v2.0

---

*Full development history. For project overview, see [README.md](README.md).*
