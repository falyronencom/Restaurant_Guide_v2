# Changelog

Full development history of Restaurant Guide Belarus. For project overview, see [README.md](README.md).

---

## Recent Updates

### Апрель 2026 — Horizon 3: User Experience & Engagement

#### Апрель 23, 2026 — Smart Search Этап 2: Segment C (UI Surface) — Component 8 завершён
- **Скоуп сегмента**: пользовательские интерфейсы для потребления API Segment B. После сегмента Component 8 (Smart Search Этап 2) feature-complete и готов к эмпирической калибровке Vision API на seed creation 500 карточек Минска
- **Block 4 backend corrective (Phase 1 policy change)**: `partnerMenuItemService.listMenuItems` flip `includeHidden: true → false` — партнёр больше не видит скрытых админом позиций (платформа несёт ответственность за качество; скрытое — не забота партнёра). Удалён IIFE-вызов `notifyMenuItemHidden` в `adminService.hideMenuItem` — notification о скрытии отсутствующей для партнёра позиции создавала бы cognitive dead-end. Хелпер в `notificationService` оставлен для возможного Phase 2. Defensive test запрещает случайное восстановление поведения
- **Block 1 — Mobile Partner «Меню»**: новый раздел в кабинете партнёра (edit_establishment_screen → новая строка «Меню» после «Медиа»), семантически отделённый от «Медиа» (сырые файлы) — здесь показываются структурированные OCR-данные. Option A упрощение состояний: SUCCESS (items есть), NOT_STARTED (items пусты) — retry OCR button всегда доступна, 400 NO_PDF_MENUS даёт friendly snackbar, 4 UI-состояния директивы схлопнуты в 2 без потери UX. Inline edit через bottom sheet с 3 полями (item_name, price_byn, category_raw), optimistic update + rollback на 4xx. Badge «Требует внимания» с раскрытием содержания `sanity_flag`. Rate limit 429 — backend Retry-After header парсится и форматируется в русскую строку без hardcode
- **Block 2 — Admin-web «Позиции меню»**: новый sidebar-пункт под «Модерация» (после «Приостановленные»), двухпанельный layout (List | Detail) по образцу existing moderation screens. Server-side `reason` filter + client-side фильтры по city/status/search (MVP trade-off: backend endpoint неизменен, per_page=50 покрывает Phase 1 volume). Hide dialog требует причину ≥10 символов. Детальная панель показывает sanity_flag в monospace JSON + hidden_reason при скрытии
- **Block 3 — Notification deep link**: новый тип `menuParsed` в `NotificationType` enum + handler в `notification_list_screen` → открывает `PartnerMenuScreen`. Push-ветка в `main_navigation.dart` не добавлена намеренно — `notifyMenuParsed` не отправляет push (Segment B решение: non-urgent event), FCM-handler был бы dead code
- **Новые файлы** (8 Flutter): mobile `models/partner_menu_item.dart`, `services/partner_menu_service.dart`, `providers/partner_menu_provider.dart`, `screens/partner/partner_menu_screen.dart`; admin-web `models/flagged_menu_item.dart`, `services/admin_menu_item_service.dart`, `providers/menu_items_moderation_provider.dart`, `screens/menu_items/menu_items_moderation_screen.dart`, `widgets/menu_items/flagged_menu_items_list_panel.dart`, `widgets/menu_items/menu_item_detail_panel.dart`
- **Тесты**: 17 новых всего — 1 backend defensive (no-notification-on-hide) + 6 mobile provider (fetch, optimistic update + rollback, 429 handling, group-by-category) + 10 admin-web provider (filters matrix, actions success/failure, dismissFlag removes item). Инфраструктура — `implements` fakes без mockito/mocktail. Обновлён 1 существующий backend-тест (partner-menu-items "returns all including hidden" → "returns only non-hidden") под Phase 1 semantic
- **Регрессия**: backend **1211/1228 passing** (baseline 1210 + 1 новый), 12 failures идентичны Segment A/B baseline (2 smart-search + 10 bookingService localization). Flutter analyze: admin-web clean, mobile — 1 pre-existing info-level в `edit_establishment_screen.dart:684` (scope discipline). 6/6 mobile + 10/10 admin-web новых тестов зелёные
- **Архитектурный принцип Phase 1**: платформа несёт ответственность за качество контента, модерационные действия не транслируются партнёру как его забота. Partner получает retry как возврат агентности через действие, а не через бюрократию оспаривания. Три следствия реализации: (a) filter `is_hidden_by_admin = FALSE` в service layer, (b) отсутствие badge «Скрыта админом» в UI, (c) отключение `notifyMenuItemHidden`
- **Deploy**: только Flutter изменения (backend Block 4 — code-level, миграции не меняются). Production deploy не требуется на этом этапе, mobile сборка через TestFlight/Google Play будет отдельной задачей

#### Апрель 23, 2026 — Smart Search Этап 2: Segment B (Integration & API Surface)
- **Скоуп сегмента**: соединение OCR pipeline с Smart Search, admin item-level санкции, partner управление распарсенным меню. Весь обмен через API (curl-verifiable) — UI откладывается на Segment C
- **Миграция 025 `add_hidden_reason_to_menu_items`**: `hidden_reason TEXT NULL` на `menu_items` — мотивация модератора при скрытии позиции, отделена от `sanity_flag` (JSONB живёт по OCR-lifecycle, `hidden_reason` — по admin-action lifecycle). Применена локально с rollback-проверкой
- **Группа 1 — OCR Auto-Trigger**: fire-and-forget `enqueue` в 3 точках — (a) `mediaService.uploadMedia` после PDF insert, (b) `establishmentService.createEstablishment` для temp media при финализации регистрации, (c) `adminService.moderateEstablishment` async IIFE backfill при approve (покрывает legacy establishments + retried failed jobs). Новые `ocrJobModel.hasCompletedJobForMedia`, `mediaModel.getPdfMediaByEstablishment`
- **Группа 2 — Smart Search dish-extension**: Zod schema расширена `dish: string | null`, prompt получил 6 примеров, явно разделяющих category vs dish (кофейня vs кофе, пиццерия vs пицца). `buildSmartSearchFilters` делит price routing: если dish → `priceMaxByn` (literal BYN на menu_items.price_byn), иначе → `priceRange` (legacy tier mapping). `searchService.searchByRadius`/`searchWithoutLocation` приняли `dish`/`priceMaxByn` params; при dish добавляется conditional `EXISTS` на `menu_items` с `is_hidden_by_admin = FALSE` + вложенным `EXISTS` на promotions time-window (позиция проходит если `price_byn ≤ priceMaxByn` OR есть активная акция с `discount_price_byn ≤ priceMaxByn` в текущий момент). Trigram GIN из mig 024 обслуживает ILIKE. Ranking без изменений (директива §2.5 запрещает новые tiebreakers)
- **Группа 3 — Admin endpoints (4)**: `POST /admin/menu-items/:id/hide|unhide|dismiss-flag`, `GET /admin/menu-items/flagged`. `adminService` получил 4 функции по паттерну `suspendEstablishment` (guard state, model update, non-blocking AuditLog, non-blocking notification). Новый `adminMenuItemController`. Dashboard list возвращает items с embedded establishment_name/city/status для UI
- **Группа 4 — Partner endpoints (3)**: `GET /partner/establishments/:id/menu-items` (includeHidden=true для отображения скрытых с меткой), `PATCH /partner/menu-items/:id` (allowed fields: item_name, price_byn, category_raw; side effect: обнуляет sanity_flag как partner-accepted; is_hidden_by_admin НЕ меняется), `POST /partner/establishments/:id/retry-ocr` (с rate limiter ocr_restart 5/day/partner через `createRateLimiter`). Новый `partnerMenuItemService` + Controller + Routes файл. Ownership check через `EstablishmentModel.checkOwnership`, cross-partner attempts → 404 (не 403, защита от ID-enumeration)
- **Группа 5 — Notifications**: `TITLES` +2 типа (`menu_parsed`, `menu_item_hidden_by_admin`), `CATEGORY_TYPES.establishments` extended. 2 trigger helper: `notifyMenuParsed(establishmentId, count)` без push (не-срочно), `notifyMenuItemHidden(menuItemId, partnerId, reason)` с push (требует внимания партнёра). Инъекция `notifyMenuParsed` в `ocrService.processJob` после successful markDone — единственная допустимая модификация Segment A, как предусмотрено директивой
- **Тесты**: **36 новых** (цель ≥20) — 7 unit `smartSearchFilters`, +7 unit `notificationService`, 11 integration `admin-menu-items`, 8 integration `partner-menu-items`, 3 integration `ocr-end-to-end` (multi-step full flow: approve → seed item → dish-search match → hide → dish-search exclude + promotion time-window + price routing). Regression: **12 failures идентичны Segment A baseline** (2 smart-search fallback + 10 bookingService localization), подтверждено `git stash`-сравнением. ESLint чист на всех 8 новых файлах
- **Scope discipline (не входит в Segment B)**: admin-web UI и mobile UI — Segment C. `menu_item_edited_by_partner` notification тип НЕ вводится (отложен до Segment C при реальной потребности). Единственная модификация Segment A файлов — notifyMenuParsed injection в ocrService
- **Production deploy**: миграции 024 и 025 применены на Railway 23 апреля 2026 через `scripts/apply-migration-production.js`
- **Коммит**: `abeb086`
- **Отчёт**: [backend/session_reports/smart_search_etap_2_segment_b_report.md](backend/session_reports/smart_search_etap_2_segment_b_report.md)

#### Апрель 22, 2026 — Smart Search Этап 2: Segment A (OCR Core / Backend Foundation)
- **Скоуп сегмента**: backend-фундамент OCR pipeline — таблицы, модели, сервисы, config, тесты. Без интеграции со Smart Search, без admin/partner endpoints, без UI (Segment B/C)
- **Миграция 024 `ocr_menu_pipeline`**: таблицы `ocr_jobs` (persistent PostgreSQL-based job queue, CHECK на status, индекс `(status, created_at)` для `FOR UPDATE SKIP LOCKED` polling), `menu_items` (денормализованный `establishment_id` для прямого JOIN в Smart Search; trigram GIN индекс на `item_name` для ILIKE-поиска в Segment B; CHECK на confidence 0.00-1.00). Расширение `promotions`: `valid_from_time`, `valid_until_time`, `menu_item_id` (FK ON DELETE SET NULL), `discount_price_byn`. Включена extension `pg_trgm`. Применена локально с rollback-проверкой
- **PostgreSQL job queue, не BullMQ**: сознательное решение — не вводить новую infrastructure-зависимость. `FOR UPDATE SKIP LOCKED` обеспечивает concurrency-safe polling
- **Модели**: `ocrJobModel` (enqueue с идемпотентностью для активного media, `pickNextPending` с атомарным status transition + attempts increment, `markFailed` с retry-логикой CASE когда attempts < max_attempts), `menuItemModel` (bulk INSERT через dynamic VALUES fragment, `replaceForMedia` в транзакции `BEGIN/COMMIT/ROLLBACK` для атомарного sanity-delta)
- **OCR services (`src/services/ocr/`)**: `pdfTextExtractor` (pdf-parse через deep import `lib/pdf-parse.js` для bypass debug-mode quirk; эвристика hasTextLayer: avg chars/page ≥ 50, digits ≥ 3, printable ratio ≥ 0.7), `visionOcrAdapter` (inline fetch к OpenRouter vision, массив image_url, 60s timeout), `llmStructurer` (fetch к OpenRouter + Zod-валидация структурированного JSON), `sanityChecker` (4 правила: price_below/above_threshold, low_confidence, price_delta_anomaly ratio > 3.00; первое совпадение побеждает), `ocrService` оркестратор (fetch media → PDF try/fallback на vision → structure → sanity с previousItems из replaceForMedia → markDone/markFailed), `ocrJobPoller` (setInterval 10с, serial processing, graceful start/stop)
- **Config**: `openrouter.js` расширен `getOcrConfig()` (отдельный от `getConfig()` для intent parser — нулевой риск регрессии); новые env `AI_OCR_MODEL` (fallback на AI_MODEL default), `POLLER_INTERVAL_MS`. Общий `OPENROUTER_API_KEY`
- **Cloudinary helper**: добавлен `generatePdfPageImageUrl(pdfUrl, pageNum)` для генерации pg_N image URL (нужен Vision pipeline для scanned PDFs)
- **Server integration**: poller стартует в `startServer` после connectRedis, останавливается в graceful shutdown ДО `closePool` (дожидается in-flight job). Охраняется `NODE_ENV !== 'test'` — тесты вызывают `processJob` напрямую
- **CASCADE цепочка**: `establishments → establishment_media → menu_items / ocr_jobs` (ON DELETE CASCADE) + `promotions.menu_item_id` с ON DELETE SET NULL (promotion переживает удаление элемента меню)
- **Scope discipline (не входит в Segment A)**: не триггерит OCR автоматически, не создаёт admin/partner endpoints, не модифицирует searchService, не добавляет notification types, не трогает mobile/admin-web
- **Тесты**: 4 unit (70 новых тестов: `pdfTextExtractor`, `sanityChecker`, `llmStructurer`, `ocrJobModel`) + 1 integration (`ocr-pipeline.test.js`, 6 сценариев: happy path PDF text layer, vision fallback, retry при 500, permanent failure при max_attempts, enqueue идемпотентность, replaceForMedia delta detection). Pre-existing failures в `smart-search` (2) и `bookingService` (10) не относятся к этому сегменту (проверено git stash baseline)
- **Production deploy**: миграция 024 применена на Railway 23 апреля 2026 (вместе с 025 в рамках Segment B deployment)
- **Dependency**: `pdf-parse@^1.1.1` (реально установлена 1.1.4 по semver)

#### Апрель 17-18, 2026 — Task 1: PDF Menu Upload (Phases A-D)
- **Контракт**: PDF-меню как first-class документ (не просто фото) — основа для Smart Search OCR Phase 2, где `pdf-parse` на векторных PDF даёт 100% точность текста против 90-95% OCR на фото
- **Phase A — Migration 023**: `file_type VARCHAR(10)` на `establishment_media` (CHECK 'image'|'pdf', DEFAULT 'image'), композитный индекс `(establishment_id, type, file_type)`. Применена локально на pg-test
- **Phase B — Backend pipeline**: `uploadPdf` в `cloudinary.js` с `resource_type: 'image'` (коррекция контракта — `'raw'` несовместимо с `pg_1`-трансформациями), thumbnail/preview URLs через `pg_1/f_jpg`, лимит 60MB. `mediaService.uploadMedia` ветвится по mimetype: PDF-путь требует type=menu, максимум 2 PDF/заведение. 3 новых теста, 41/41 media тестов проходят
- **Phase C — Mobile registration**: `file_picker` + `pdfx` + `path_provider`. `tempMediaRoutes.js` принимает PDF. `PartnerRegistration` модель получила класс `MenuPdf` + поле `menuPdfs`. `establishmentService.createEstablishment` обрабатывает `menu_pdfs` массив → создаёт media-записи с `file_type='pdf'`, caption=filename. `media_step.dart`: `_showPdfPlaceholder` заменён на реальный `_pickPdf` flow с тайлом (thumbnail + имя файла + delete)
- **Phase D — Detail screen + viewer**: `pdf_viewer_screen.dart` — `PdfControllerPinch` + `PdfViewPinch`, кэш в `getTemporaryDirectory/pdf_cache/{hash(url)}_{filename}`, page counter, pinch-to-zoom. Detail screen: PDF-карточки **отдельным блоком над** фото-каруселью меню (UX-решение — PDF это официальный документ, фото супплементарны; разное tap-поведение в одной ленте путает пользователей). `_PdfMenuCard` с Cloudinary превью первой страницы + filename + «Открыть PDF →»
- **Deviations (documented)**: Cloudinary `resource_type='image'` вместо `'raw'`, размер файла не персистируется (только имя), edit-flow PDF не затронут (использует direct endpoint из Phase B)
- **Production deploy**: миграция 023 пока только локально, не на Railway
- **Коммиты**: `bccd9a6`, `a440515`, `4df3693`, `fb167db`
- **Отчёт**: [mobile/session_reports/pdf_menu_upload_2026_04_18_report.md](mobile/session_reports/pdf_menu_upload_2026_04_18_report.md)

#### Апрель 17, 2026 — Time Picker Localization & Dial Fix (Partner Wizard)
- **Проблема**: На шаге «Время работы» партнёра все подписи TimePicker были на английском, клавиатурный ввод не работал, циферблат в 24-часовом режиме показывал перекрывающиеся цифры
- **Корни**: (1) в `MaterialApp` не было подключено `flutter_localizations` → отсутствие `MaterialLocalizations.ru`; (2) известный баг Flutter 3.35.2 в 24-часовом dial ([flutter#141501](https://github.com/flutter/flutter/issues/141501))
- **Fix локализации**: `flutter_localizations` (SDK) добавлен в `pubspec.yaml`, `intl` поднят `^0.18.1 → ^0.20.2`, в `MaterialApp` добавлены `locale: ru`, `localizationsDelegates` и `supportedLocales: [ru, en]`
- **Fix циферблата**: `working_hours_screen.dart` — `TimePickerEntryMode.input → inputOnly` (циферблат полностью отключён; для ввода рабочих часов клавиатура удобнее)
- **Verification**: собрано `flutter build apk --debug`, установлено на Samsung A72 через ADB, визуально подтверждено пользователем
- **Побочный эффект (позитивный)**: русская локаль теперь применяется ко всем Material-виджетам приложения, не только к TimePicker
- **Отчёт**: [mobile/session_reports/time_picker_localization_2026_04_17_report.md](mobile/session_reports/time_picker_localization_2026_04_17_report.md)

#### Апрель 10, 2026 — Security Audit & Hardening (Pre-App Store)
- **Блок A — Секреты**: Yandex MapKit API key вынесен из хардкода в `local.properties` (Android) и `Secrets.xcconfig` (iOS), инжектируется при сборке через `manifestPlaceholders` / `Info.plist` переменные
- **Блок A — Пароли**: Удалены захардкоженные пароли из seed-скриптов — теперь обязательные env vars с валидацией
- **Блок A — .gitignore**: Firebase конфиги (`GoogleService-Info.plist`, `google-services.json`), `Secrets.xcconfig`, `.env.test` сняты с отслеживания; `.env.*` паттерн покрывает все варианты
- **Блок A — Git history**: Полная очистка через `git-filter-repo` — удалены секреты из всей истории коммитов + папка `docs/` (внутренняя документация) убрана из публичного репо
- **Блок A — Ротация**: Все 5 скомпрометированных ключей ротированы (Yandex MapKit, OpenRouter, Cloudinary, JWT Secret, Admin password)
- **Блок B — Аудит кода**: Проверены auth/JWT, SQL-инъекции, XSS, CORS, загрузка файлов, rate limiting. Оценка 8.5/10
- **Блок B — Fix**: `authorize('partner')` → `authorize(['partner'])` в 6 route-файлах (12 call sites) — устранена потенциальная уязвимость substring-match в проверке ролей
- **Инфраструктура**: `create-admin.js` переписан на upsert (UPDATE if exists, INSERT if not) — исправлена FK constraint ошибка
- **Коммиты**: `005f760`, `618df36`, `9ed2ca0`, `170ed2b`

#### Апрель 9, 2026 — Component 7: Smart Search — AI Intent Parser (Segments A+B+C)
- **Discovery**: Full investigation of search pipeline (route→controller→service→SQL), enum mappings (15 categories, 12 cuisines — cyrillic in DB), mobile search flow (SearchHomeScreen→EstablishmentsProvider→EstablishmentsService→ApiClient), Redis usage, middleware chain, rate limiter factory, env vars pattern, promotions enrichment, home screen layout. 8 questions + 4 peripheral
- **Segment A (Backend)**: `openrouter.js` config (lazy env reading), `smartSearchService.js` (AI intent parsing via OpenRouter Gemini 2.5 Flash-Lite, Zod validation, Redis caching with 1hr TTL, filter builder price_max→price_range mapping), `smartSearchController.js` (POST handler, query sanitization 150 chars, coordinate validation), `POST /api/v1/search/smart` endpoint with custom rate limiter (30/min via `createRateLimiter`). Fallback to existing ILIKE + SEARCH_SYNONYMS when AI unavailable. `zod` added as dependency
- **Segments B+C (Mobile)**: `SmartSearchService` (Dio POST client), `SmartSearchProvider` (idle/loading/results/error states), `SmartSearchBar` (animated cycling placeholder: "С чего начнём?" → "кофе рядом" → ..., dual-mode button: chevron vs search icon), `SmartSearchSuggestions` (horizontal chips with slide-up animation), `SmartSearchPreview` (top-3 result cards with intent header, promo badges, distance/rating adaptive display, "Показать все (N)" button)
- **Backward compatible**: chevron without text → existing search flow (unchanged)
- **Tests**: 28 new (validation 6, fallback 5, response format 4, filter building 11, caching 2). ~1113 backend tests total, zero regressions
- **Key finding**: Production seed data uses English category IDs — AI parses to cyrillic correctly but no matches until real data added
- **Context telemetry**: Discovery 5% → Final ~18% of 1M context (Mode C unified session, 3 segments)

#### Апрель 6, 2026 — Component 6: Push Notifications (Segments A+B+C)
- **Discovery**: Full investigation of notification infrastructure (backend creation flow, mobile polling/display, 14 notification types, Firebase config status, user preferences, permission handling) + 4 peripheral (tests, PROJECT_MAP, packages, external API patterns). Directive Coherence Check identified missing Q1.5 (REST endpoints)
- **Migration 022**: `device_tokens` (UPSERT, UNIQUE user+token, platform CHECK) + `notification_preferences` (one row per user, 3 boolean categories)
- **Backend infrastructure**: firebaseAdmin.js (graceful fallback if no credentials), pushService.js (FCM multicast + stale token deactivation + category-based preference check), deviceTokenModel (UPSERT), deviceTokenService, 4 new REST endpoints (PUT/DELETE device-token, GET/PUT preferences)
- **Backend integration**: pushService.sendPush() wired into 11 of 14 trigger helpers (3 in-app only: claimed, review_hidden, review_deleted). booking_expired sends to both user + partner. Category mapping fixed to cover all 15 types across 4 categories
- **New type**: `promotion_new` — 15th notification type. Fan-out to all users who favorited the establishment via Promise.allSettled(). Trigger from promotionService.createPromotion()
- **Mobile**: Firebase core+messaging config, PushNotificationService (token lifecycle, permission request, foreground snackbar + badge refresh, background/terminated tap → deep link navigation), NotificationPreferencesProvider (optimistic updates), NotificationPreferencesScreen (3 SwitchListTile + booking disable warning), promotionNew enum type with icon/color/routing
- **Android**: Package renamed com.example.restaurant_guide_mobile → com.nirivio.app, POST_NOTIFICATIONS permission, google-services plugin
- **Tests**: 39 new unit tests (Segment A) + 19 new tests (Segment B) = 58 total new. 1085 backend tests passing, zero regressions
- **Context telemetry**: Discovery ~10% → Final ~21% of 1M context (Mode C unified session, 3 segments)

### Апрель 2026 — Horizon 2: Monetization Features

#### Апрель 4, 2026 — Component 5: Reservations / Booking System (Segments A+B+C)
- **Discovery**: Full investigation of 10 integration points + 4 peripheral (promotions hub, detail screen boundary, notification/analytics patterns, working_hours format, subscriptions table, migration state)
- **Migration 021**: `booking_settings` + `bookings` tables, `booking_enabled` on establishments, `booking_request_count`/`booking_confirmed_count` on analytics
- **Backend**: bookingSettingsModel (UPSERT), bookingModel (CRUD + lazy expiry), bookingSettingsService (transactional activate/deactivate), bookingService (full lifecycle with 9 validations: user limits, working hours, time constraints, status transitions), 12 endpoints (4 settings + 5 partner + 3 user), 5 notification types + helpers, 2 analytics tracking functions
- **Mobile Partner**: PromotionHubScreen (replaces direct PromotionsScreen navigation — Акции + Бронирование sections), BookingWizardScreen (3-step activation: settings → time → confirmation), BookingsManagementScreen (pending with countdown timers, confirmed grouped by date, history with filters), BookingSettingsProvider + BookingProvider
- **Mobile User**: BookingBottomSheet (date/time/guests picker with time slot generation from both working_hours formats), booking CTA "Хочу забронировать" on detail screen, "Онлайн бронь" indicator on search cards, UserBookingsScreen (active + history with cancel/retry/call actions), "Мои бронирования" in profile with active count badge
- **Notification sync**: +7 types in mobile enum (unsuspended, claimed, 5 booking types) — now 14 total
- **Tests**: 54 new backend unit tests (model + service + settings). 1032 total tests passing, zero regressions
- **Context telemetry**: Discovery ~14% → Final ~28% of 1M context (Mode C unified session, 3 segments)

#### Апрель 1, 2026 — Component 4: Promotions (Segments A+B)
- **Discovery**: Full investigation of subscription fields, media/Cloudinary patterns, search query structure, partner dashboard, detail screen (8 questions + 4 peripheral)
- **Migration 020**: Modified `promotions` table — added image_url/thumbnail_url/preview_url, replaced is_active→status (active/expired/hidden_by_admin), nullable valid_until for indefinite promotions
- **Backend CRUD**: promotionModel + promotionService + promotionController + promotionRoutes — create/list/update/deactivate with ownership verification, Cloudinary image upload, max 3 active limit per establishment
- **Search enrichment**: Post-query enrichment adds has_promotion/promotion_count to all 3 search paths without touching ORDER BY queries (non-blocking — search never breaks from promotion issues)
- **Detail endpoint**: Parallel fetch of promotions array alongside media, included in public detail response
- **Analytics**: trackPromotionView UPSERT into existing promotion_view_count column, public endpoint POST /analytics/promotion-view
- **Mobile model**: Promotion.dart + Establishment model updated with hasPromotion, promotionCount, promotions fields
- **Search card**: [АКЦИЯ] badge overlay on image when hasPromotion=true
- **Detail screen**: Promotion trigger banner below hero → carousel bottom sheet (PageView with indicator dots, auto-generated visuals for imageless promotions, per-slide analytics tracking)
- **Partner UI**: PromotionsScreen (active N/3 + expired sections, edit/deactivate), CreatePromotionScreen (title, description, image picker, date pickers), PromotionProvider with full CRUD
- **Tests**: 24 new integration tests (CRUD, limits, search enrichment, detail inclusion, analytics, ownership, lazy expiry, auth). 973 total tests passing, zero regressions
- **Context telemetry**: Discovery ~15% → Final ~18% of 1M context (Mode C unified session)

### Март 2026 — Production Deployment + TestFlight

#### Март 24, 2026 — Ranking Core: Bayesian Weighted Rating, Completeness Score, Geolocation Fix
- **Discovery**: Full map of search algorithm — 4 query paths, buildOrderByClause, mobile geolocation flow (8 questions + 4 peripheral)
- **Bayesian weighted rating**: Replaced two-tier sort (caused 3.0★×4 > 5.0★×2 bug) with `(v×R + 5×3.5)/(v+5)` — industry-standard formula per monetization strategy v0.5 §2.5
- **Completeness score**: `calculateCompletenessScore()` (100pts max: description 25, price 25, attributes 20, phone 15, email 10, website 5), integrated into create/update paths
- **Migration 018**: Backfill base_score for all 92 establishments (production applied)
- **Price NULL fix**: `ELSE 5` — establishments without price_range sort last in both directions
- **Geolocation "тихий Минск" fix**: Removed hardcoded Minsk fallback coordinates — GPS denied now activates searchWithoutLocation path
- **City persistence**: SharedPreferences — selected city survives app restart
- **Smart defaults**: GPS on → sort by distance, GPS off → sort by rating, distance sort/filter greyed out without GPS
- **Location banner**: "Включите геолокацию" once per session, opens app settings on deniedForever
- **City list deduplicated**: `config/cities.dart` — single source of truth (was in 2 files)
- **Backend tests**: 46 new (buildOrderByClause 21 + completenessScore 20 + updated 5), 481 unit tests passing
- **Context telemetry**: Discovery 14% → Final ~20% of 1M context

#### Март 22, 2026 — Partner Analytics: Activate Ghost Table, Time-Series Endpoints, Mobile Charts
- **Discovery**: Full audit of partner analytics infrastructure (8 questions + 4 peripheral scan)
- **Migration 017**: Added `call_count` column + composite index to `establishment_analytics` (ghost table activated)
- **Event tracking**: Dual-write views (cumulative + per-day UPSERT), favorites (+1/-1 UPSERT), phone call clicks (new endpoint)
- **Backend endpoints (3 new)**: `GET /partner/analytics/overview` (metrics with period comparison), `GET /partner/analytics/trends` (gap-filled time-series), `GET /partner/analytics/ratings` (distribution)
- **Backend model/service/controller/routes**: `partnerAnalyticsModel.js`, `partnerAnalyticsService.js`, `partnerAnalyticsController.js`, `partnerAnalyticsRoutes.js`
- **Backend tests**: 27 unit tests (partnerAnalyticsModel + partnerAnalyticsService), all existing 869 tests passing
- **Mobile models**: `partner_analytics.dart` (EstablishmentOverview, AnalyticsTrends, TrendPoint, AnalyticsRatings)
- **Mobile service**: 4 new API methods in `partner_service.dart` + fire-and-forget `trackCall()`
- **Mobile provider**: `partner_dashboard_provider.dart` — analytics state, `fetchAnalytics()` method
- **Mobile UI**: `partner_statistics_screen.dart` rewritten — functional period selector (7d/30d/90d), fl_chart bar chart replacing placeholder, change% badges, "Звонки" section
- **Detail screen**: Phone number now tappable (tel: URI + call tracking via POST /track-call)
- **Methodology**: Discovered "Directive Coherence Check" — Librarian Step 0 for analyzing directives before execution (candidate for Protocol Informed v1.5)
- **Session stats**: Discovery + Segment A + Segment B in single session, 15% of 1M context used

#### Март 17, 2026 — Category & Cuisine Audit: Add Кафе, Китайская, Восточная; Remove Континентальная
- **Category audit**: Reviewed all 14 establishment categories and 11 cuisine types for Belarus market relevance
- **Added establishment category**: `Кафе` (cafe_dining) — positioned after Кофейня in all UI lists. SVG icon `Кафе.svg` already existed
- **Added cuisine types**: `Китайская` (chinese), `Восточная` (eastern) — new SVG placeholder icons created
- **Removed cuisine**: `Континентальная` — redundant with Европейская, removed from all validators/services/mappings (was already absent from mobile UI)
- **Removed from seed**: `indian` (Индийская), `mediterranean` (Средиземноморская) — never in validators, only in seed data
- **Backend** (7 files): establishmentValidation.js, establishmentService.js, searchValidation.js (3 locations incl. getValidationConstants), establishments-config.js, normalize-cuisine-categories.sql, run-normalize.js, establishments.test.js
- **Mobile** (6 files): filter_options.dart, partner_registration.dart, establishment.dart, filter_screen.dart, category_step.dart, cuisine_step.dart
- **Admin-web** (1 file): establishments_analytics_tab.dart
- **Assets** (2 new): Китайская.svg, Восточная.svg (placeholder icons for designer replacement)
- **Bonus fix**: searchValidation.js `getValidationConstants()` was missing Клуб in categories and Европейская in cuisines (stale since Клуб addition)
- **Tests**: 109 passed (51 establishments + 20 search + 38 service unit), 0 failures
- **Totals**: 15 establishment categories, 12 cuisine types

#### Март 14, 2026 — Analytics: Visibility Consistency & Performance Indexes
- **analyticsModel.js**: Added `AND is_visible = true` to all 5 review-related analytics queries (`getReviewCounts`, `countReviewsInPeriod`, `getReviewTimeline`, `getGlobalRatingDistribution`, `getResponseStats`) — dashboard metrics now consistent with establishment-level aggregates (commit ad04f16 fix)
- **013_add_analytics_indexes.sql** (new migration): B-tree indexes on `users(created_at)`, `establishments(created_at)`, `audit_log(created_at)`, and partial index `reviews(created_at) WHERE is_deleted=false AND is_visible=true` for analytics timeline query performance
- **admin-analytics.test.js**: +5 integration tests — hidden review excluded from overview total, reviews total, rating distribution, timeline counts, response stats. Total: 869 tests (35 suites)

#### Март 10, 2026 — Admin Reviews: Moderation Quality Fixes
- **reviewModel.js**: `updateEstablishmentAggregates()` and `getRatingDistribution()` now filter `AND is_visible = true` — hidden reviews no longer inflate establishment ratings/counts
- **adminReviewModel.js**: `toggleVisibility` RETURNING clause includes `establishment_id` for post-toggle aggregate recalculation
- **adminReviewService.js**: `toggleVisibility` calls `updateEstablishmentAggregates()` after toggling — ratings update immediately
- **admin_reviews_provider.dart**: Converted `toggleVisibility` and `deleteReview` to true optimistic updates with rollback on API failure
- **reviews_management_screen.dart**: Added confirmation dialog "Скрыть отзыв?" for hide action; show (un-hide) remains immediate
- **admin-reviews.test.js**: +3 integration tests (#17) — hidden reviews excluded from aggregates, toggle triggers recalculation, rating distribution excludes hidden. Total: 858 tests (35 suites), flutter analyze clean
- Commit: `ad04f16`

#### Март 10, 2026 — Admin Moderation Notification Polish
- **notificationService.js**: Added `extractRejectionReason()` helper — parses field-level rejection comments from `moderation_notes` object (priority: `rejection_reason` key → first `"rejected:"` field → generic fallback). Added `establishment_unsuspended` type with title "Заведение возобновлено" and message "«{name}» снова активно"
- **adminService.js**: Reject notification now passes full `moderation_notes` object (was `.rejection_reason` only). Unsuspend uses `'unsuspended'` status (was `'active'` → misleading "Заведение одобрено")
- **notificationService.test.js**: +5 new tests (field-level rejection extraction, rejection_reason key priority, empty notes fallback, empty object fallback, unsuspended notification). Total: 44 notification tests, 855 full suite

#### Март 10, 2026 — Notification System Mobile UI + Polling (Segment B)
- **notification_model.dart** (new): NotificationType enum (7 types), NotificationCategory, icon/color getters, fromJson (snake_case + camelCase), Russian relative time formatter
- **notification_service.dart** (new): Singleton, ApiClient-based — getNotifications (paginated), getUnreadCount, markAsRead, markAllAsRead
- **notification_provider.dart** (new): ChangeNotifier — unread count badge, 30s polling (Timer.periodic), pagination, category filter, optimistic mark-as-read with rollback
- **notification_list_screen.dart** (new): AppBar + "Прочитать все", ChoiceChip filters (Все/Мои заведения/Мои отзывы), time grouping (Новые/Сегодня/На этой неделе/Ранее), NotificationCard widget, pull-to-refresh, scroll pagination, empty state, tap → navigate to target
- **main.dart**: Added NotificationProvider to MultiProvider
- **main_navigation.dart**: Red dot badge on Profile tab via Consumer<NotificationProvider>, polling start in initState
- **profile_screen.dart**: Bell icon with unread count badge (Row + Spacer layout), stopPolling on logout

#### Март 9, 2026 — Notification System Backend (Segment A)
- **Migration**: `add_notifications.sql` — notifications table (UUID PK, user_id FK, type, title, message, establishment_id FK, review_id FK, is_read, created_at) + 2 indexes (partial unread, user+created_at DESC)
- **notificationModel.js** (new): create, getByUserId (paginated + category filter), getUnreadCount, markAsRead, markAllAsRead, deleteOld
- **notificationService.js** (new): 5 core methods + 4 non-blocking trigger helpers (notifyEstablishmentStatusChange, notifyNewReview, notifyPartnerResponse, notifyReviewModerated)
- **notificationController.js + notificationRoutes.js** (new): GET /notifications, GET /unread-count, PUT /:id/read, PUT /read-all — rate limited (100/50 req/min)
- **Trigger integration**: adminService.js (3 triggers: moderate, suspend, unsuspend), reviewService.js (2: createReview, addPartnerResponse), adminReviewService.js (2: toggleVisibility hide-only, deleteReview)
- All 785 existing tests green, 4 endpoints verified on live server (Docker pg-test + redis-test)

#### Март 6, 2026 — OAuth Mobile Integration (Segment B)
- **pubspec.yaml**: added `google_sign_in ^6.2.1` + `flutter_web_auth_2 ^4.0.1` (for Yandex browser-based OAuth)
- **auth_service.dart**: `loginWithGoogle()` (Google Sign-In SDK → ID token → POST /auth/oauth) + `loginWithYandex()` (browser OAuth flow → access token → POST /auth/oauth) + shared `_authenticateWithOAuth()` helper
- **auth_provider.dart**: `loginWithGoogle()` / `loginWithYandex()` mirroring existing `login()` pattern + OAuth-specific error messages (cancelled, not configured)
- **method_selection_screen.dart**: converted to StatefulWidget, Google button activated, Yandex button added, loading state during OAuth, Apple button stays placeholder
- **login_screen.dart**: Google button activated, Yandex button added, loading state disables all inputs during OAuth
- **environment.dart**: `GOOGLE_CLIENT_ID`, `YANDEX_CLIENT_ID` env vars + redirect scheme config
- **Platform config**: Android `AndroidManifest.xml` — CallbackActivity for Yandex redirect scheme; iOS `Info.plist` — URL scheme `restaurantguide` for OAuth callbacks
- Both flows use backend endpoint `POST /api/v1/auth/oauth { provider, token }` from Segment A

#### Март 6, 2026 — OAuth Backend Infrastructure (Segment A)
- **Migration**: `add_oauth_provider_id.sql` — added `oauth_provider_id VARCHAR(255)` to users table + unique compound index `(auth_method, oauth_provider_id)`
- **oauthService.js** (new): `verifyGoogleToken()` (google-auth-library) + `verifyYandexToken()` (native fetch to Yandex Login API)
- **authService.js**: `authenticateWithOAuth()` — 3 scenarios: existing OAuth user login, email-match account linking (verified only), new user creation (password_hash=NULL)
- **authController.js**: `oauthLogin()` endpoint with full error handling (invalid token, no email, unverified email, deactivated account, race condition)
- **authValidation.js**: `validateOAuthLogin` — provider enum (google/yandex) + token string validation
- **authRoutes.js**: `POST /api/v1/auth/oauth` with 20 req/min/IP rate limit
- **package.json**: added `google-auth-library ^9.14.0`
- All 747 existing tests green, no regressions. 38 media.test.js failures pre-existing (cloudinary export issue)

#### Март 6, 2026 — Avatar Storage Migration: Local Disk → Cloudinary
- **cloudinary.js**: avatar config (256×256, fill crop, face detection) + `uploadAvatar(filePath, userId)` function
- **upload.js**: avatar multer destination switched from `uploads/avatars/` to `tmp/uploads/` (temp before Cloudinary transfer)
- **authController.js**: refactored `uploadAvatar` — Cloudinary upload, old avatar deletion, temp file cleanup in `finally`
- Legacy relative URLs still served via express.static fallback. No mobile changes needed (`fullAvatarUrl` already handles absolute URLs)
- Commit: `eb63a85`

#### Март 5, 2026 — QA Étape 3: Validator Sync & Review Model Coverage
- **reviewValidation.test.js**: 62 новых unit-тестов — подтверждение удаления 20-char минимума, рейтинг 1-5, UUID, пагинация, партнёрский ответ
- **reviewModel.test.js**: 59 новых unit-тестов — все 17 методов модели (partner responses, aggregation, soft/hard delete, transactions, error paths)
- **Skipped/TODO review**: 5 test.todo в search.test.js — документированы как unimplemented features; 34 skipped из Feb 24 — отсутствуют в коде
- Unit-тесты: 217 → 338 (+121). Итого с интеграцией: 664 + 121 = 785. 0 регрессий
- Файлы: `reviewValidation.test.js`, `reviewModel.test.js`, `search.test.js` (comments only)

#### Март 5, 2026 — Media Module: Testing & Critical Bug Fix (QA Segment A)
- **Phase 1 — Mock Infrastructure**: Создан `tests/mocks/cloudinary.js` (7 mock-экспортов + `resetCloudinaryMocks()`), добавлен `createMockMedia()` хелпер
- **Phase 2 — Fix Existing Tests**: Исправлены и разблокированы 31 тест в `media.test.js` (2 `describe.skip` → working). Баги: mock name (`generateMediaUrls` → `generateAllResolutions`), table name (`media` → `establishment_media`), response format (`data.media` → `data`), HTTP method (PATCH → PUT), tier counting (aggregated → per-type)
- **Phase 3 — Production Bug Fix**: `setPrimaryPhoto()` теперь синхронизирует `establishments.primary_image_url` — обёрнут в транзакцию (BEGIN/COMMIT/ROLLBACK). `deleteMedia()` очищает `primary_image_url = NULL` при удалении последнего фото
- **4 новых теста**: sync primary_image_url при upload/update/delete/last-photo-deleted
- **Итого**: 38 media тестов, 664 всего (было 626). 0 failed
- Файлы: `mediaModel.js`, `mediaService.js`, `media.test.js`, `mocks/cloudinary.js`, `mocks/helpers.js`

#### Март 4, 2026 — iOS Detail Screen: Three Bug Fixes
- **Fix 1 — Distance Consistency**: detail screen теперь получает distanceKm из экрана поиска через route arguments. Приоритет: переданное → backend → client-side → null
- **Fix 2 — Gallery Primary Image**: фотогалерея сортируется с primary image (thumbnailUrl) на первой позиции. Карточка и галерея показывают одно фото
- **Fix 3 — Mini-Map iOS Race Condition**: YandexMap извлечён в отдельный `_EstablishmentMiniMap` StatefulWidget. Parent setState() больше не пересоздаёт нативный map view. Gate flag `_mapReady` предотвращает дублирование позиционирования
- Файлы: `detail_screen.dart`, `results_list_screen.dart`, `main.dart`
- `flutter analyze`: 0 новых issues

#### Март 4, 2026 — Safe Seed Data Cleanup (--seed-only)
- Добавлен флаг `--seed-only` в `clear-establishments.js` — удаляет только тестовые заведения (seed.data.generator), сохраняя карточки реальных партнёров
- Новый npm script: `npm run clear-data:seed`
- Подготовка к наполнению базы реальными заведениями параллельно с Closing QA

#### Март 3, 2026 — Claude Code Memory Architecture
- Реорганизация auto-memory: 3-файловая архитектура (MEMORY.md, session_history.md, lessons_learned.md)
- Обновление Protocol Autonomous v1.2 и Protocol Informed v1.3 — добавлены правила ведения Claude Code memory
- Commits: `c903cc7`, `5a538f8`

#### Февраль–Март 2026 — Railway Production Deployment
- **Backend**: Railway deployment (Node.js + PostGIS + Redis) — Hobby Plan
- **Database**: PostGIS proxy `turntable.proxy.rlwy.net:44099`, SSL с `rejectUnauthorized: false`
- **Seed data**: 77 establishments (7 cities), 281 reviews, 546 media
- **iOS fixes**: map zoom retry for all cities, Могилёв ё/е в backend validators, CORS localhost for admin-web
- **TestFlight**: Apple approved for external testing (Apple ID: 6759831819)
- Commits: `bf6c200`, `757a3c8`, `0a8e4fd`

### Февраль 28, 2026 — Figma Design Snapshots Archive (Post-MVP Screens)
- **Архивация**: 7 дизайн-контекстов из Figma перед завершением подписки
- **Новости** (4 файла): главная лента (таб New), шаблон статьи, таб События, таб Интересное
- **Избранное** (1 файл): папки-коллекции с круглыми превью
- **Продвижение** (2 файла): выбор подписки (3 тарифа), текущий план + 5 типов акций
- Расположение: `docs/figma_snapshots/01-07_*.json`
- Данные включают: design tokens, typography, layout specs, interactions, reference code
- Commit: `929f4d6`

### Февраль 26, 2026 — Seed Establishment Visual Quality Fixes
- **Fix 1**: `primary_image_url` теперь заполняется в обоих seed-скриптах (placeholder + Cloudinary) — карточки поиска показывают изображения
- **Fix 3**: Разброс координат уменьшен с ±0.05° (~5.5 км) до ±0.005° (~500 м) — пины на карте попадают в застроенную зону
- Файлы: `seed-establishments-placeholder.js`, `seed-establishments.js`, `content-templates.js`
- Верификация: DB-запросы (77/77 URL заполнены, max offset 0.00496°), API endpoint подтверждён
- Commit: `801b3fc`

### Февраль 24, 2026 — Pre-Existing Test Failures Fix (92 failures → 0)
- **Migration 011**: sync 4 missing columns in test DB (`location`, `average_check_byn`, `is_24_hours`, `primary_image_url`) — root cause of 81 cascade failures
- **Mock fixes**: searchController (`searchWithoutLocation`), favoriteService (`updateEstablishmentFavoriteCount`), establishmentService (`MediaModel`, `PartnerDocumentsModel`, `ReviewModel`)
- **Assertion updates**: ORDER BY default changed, authorization auto-upgrade (403→201), city bounds test data, distance ordering
- **Result**: 626 tests passed, 0 failed (30 suites green, 1 skipped)
- **Zero production code changes** — all fixes are test infrastructure
- Commits: `25e217a`, `d44e9f8`

### Февраль 24, 2026 — Admin Backend Test Coverage Segment C (QA Complete)
- Backend QA: 97 новых тестов (29 unit + 41 analytics integration + 27 audit log)
- **Всего admin тестов**: 211 (Segments A+B+C), все 17 admin эндпоинтов покрыты
- **Покрытие**: 61.52% statements, 55.78% branches, 62.39% functions, 61.88% lines
- Unit tests (`analyticsService.test.js`): `parsePeriod`, `getAggregationType`, `computeChangePercent`, `fillDateGaps` — timezone-independent assertions
- Integration tests (`admin-analytics.test.js`): #10–#13 — overview, users, establishments, reviews analytics с auth guards и aggregation validation
- Integration tests (`admin-audit-log.test.js`): #17 — pagination, filtering, sort, include_metadata, auth guards
- **Bug fix** `analyticsModel.js`: неверное имя колонки `partner_responded_at` → `partner_response_at` (migration 009)
- **Bug fix** `analyticsModel.js`: невалидный SQL `ROUND() FILTER (WHERE ...)` → `FILTER` перенесён на `AVG()` (PostgreSQL: FILTER только на агрегатах)
- Оба бага приводили к 500 на `GET /api/v1/admin/analytics/reviews`
- Session Report: [backend/session_reports/segment_c_completion_report.md](backend/session_reports/segment_c_completion_report.md)
- Commit: `794c253`

### Февраль 20, 2026 — Custom Map Markers (Circle Badge)
- Mobile: New `MapMarkerPainter` — CustomPainter drawing gradient circle with white border, fork-and-knife icon, and triangular pointer
- Mobile: New `MapMarkerGenerator` — singleton bitmap renderer with caching (pre-generates open + closed variants)
- Mobile: Map markers now show open/closed state in real-time — orange gradient (open) vs grey gradient (closed)
- Mobile: Replaced duplicated `_createMarkerIcon()` in both map_screen.dart and detail_screen.dart with shared generator
- Mobile: Added 30% bounds buffer for map API requests — markers no longer disappear at edges when panning
- Architecture ready for future rating badge (nullable `rating` parameter in painter)
- **4 files changed**: 2 new (map_marker_painter.dart, map_marker_generator.dart) + 2 modified (map_screen.dart, detail_screen.dart)

### Февраль 20, 2026 — Text Search Implementation + Search UI Fixes
- Backend: Full text search via `search` query parameter across all 3 search endpoints (searchByRadius, searchWithoutLocation, searchByBounds)
- Backend: `SEARCH_SYNONYMS` map (25 keywords) — maps food terms to categories/cuisines (e.g., "пицца" → Пиццерия + Итальянская, "суши" → Японская + Азиатская)
- Backend: `addSearchConditions()` helper — ILIKE on name/description/categories/cuisines + synonym expansion
- Mobile: Search bar UI — flush input+button join (pencil+eraser geometry) on home screen
- Mobile: Search bar UI — back button moved inside input field on results screen (prefixIcon)
- Mobile: Map screen now receives `searchQuery` from provider, filters map markers by search text
- **6 files changed**: 2 backend (searchController.js, searchService.js) + 4 mobile (search_home_screen.dart, results_list_screen.dart, map_screen.dart, establishments_service.dart)

### Февраль 18, 2026 — Testing Session 2: Profile Edit & Avatar Upload
- Backend: `PUT /api/v1/auth/profile` — update name/avatar_url (authService + authController + authRoutes)
- Backend: `POST /api/v1/auth/avatar` — multipart image upload via multer (upload.js middleware, 5MB limit, JPEG/PNG/WebP)
- Backend: Static file serving for `/uploads/` directory (server.js)
- Mobile: Fixed `rootNavigator: true` for edit profile navigation
- Mobile: Fixed response parsing in `auth_service.dart` — navigate `data.user` wrapper correctly
- Mobile: `User.fullAvatarUrl` getter resolves relative backend paths to full URLs
- Mobile: `EditProfileScreen` — avatar upload on image pick, `FileImage` for local preview, wider name input field
- Mobile: Removed "{Гость}" label from profile detail screen

### Февраль 13, 2026 - Фаза 8 Segment E: Admin Panel — Utility Screens
- Segment E Utility Screens полностью реализован (Protocol Informed v1.2)
- Backend (5 new files, 2 modified):
  * `auditLogModel.js` — extended with `getAuditLogEntries(filters)` and `countAuditLogEntries(filters)`: dynamic WHERE builder, JOIN with users for admin name/email, server-side human-readable summary via CASE expression, conditional ip_address/user_agent inclusion
  * `adminReviewModel.js` — new model: `getAdminReviews(filters)` with JOINs (users + establishments), status mapping (visible/hidden/deleted), ILIKE search, multi-sort; `countAdminReviews(filters)`, `toggleReviewVisibility(id)`, `getReviewForAdmin(id)`
  * `auditLogService.js` — pagination clamping, parallel model calls
  * `adminReviewService.js` — review listing, visibility toggle with audit_log write, delete with aggregate recalculation and audit_log write
  * `auditLogController.js`, `adminReviewController.js` — thin HTTP handlers with asyncHandler
  * `adminRoutes.js` — +4 routes: `/audit-log`, `/reviews`, `/reviews/:id/toggle-visibility`, `/reviews/:id/delete`
- Backend Endpoints:
  * `GET /api/v1/admin/audit-log` — paginated audit entries with action/entity_type/user_id/date range filters, human-readable summary, optional metadata
  * `GET /api/v1/admin/reviews` — all reviews (including deleted/hidden) with author + establishment info, status/rating/search/sort/date filters
  * `POST /api/v1/admin/reviews/:id/toggle-visibility` — toggle is_visible, write audit_log
  * `POST /api/v1/admin/reviews/:id/delete` — soft-delete + recalculate establishment aggregates, write audit_log with reason
- Admin-Web Frontend (10 new files, 3 modified):
  * **Models**: AuditLogEntry, AdminReviewItem (with copyWith for optimistic updates, statusLabel getter)
  * **Services**: AuditLogService, AdminReviewService (singleton pattern, Dio-based)
  * **Providers**: AuditLogProvider (filters, pagination, expandable rows), AdminReviewsProvider (list+detail, search, toggle/delete with optimistic updates)
  * **Screens**: AuditLogScreen (table + filter bar + PeriodSelector reuse + expandable JSON details + pagination), ReviewsManagementScreen (list+detail panel, status badges, action buttons with confirmation dialog), NotificationsScreen ("coming soon"), PaymentsScreen ("coming soon")
  * **Router**: `/audit-log` → AuditLogScreen, replaced all 3 PlaceholderScreens
  * **Sidebar**: Added "Аудит" section with "Журнал действий" nav item
  * **main.dart**: Registered AuditLogProvider + AdminReviewsProvider
- Key Features:
  * Zero PlaceholderScreens remaining — all sidebar items route to functional screens
  * Audit log: expandable rows show old_data/new_data JSON, graceful null handling ("Нет данных")
  * Reviews: status badges (Активен green / Скрыт yellow / Удалён red), delete confirmation with optional reason
  * New audit actions (review_hide, review_show, review_delete) populate old_data/new_data correctly
  * Professional "coming soon" screens for Notifications and Payments with feature descriptions
- **Status**: All screens functional, `flutter analyze` 0 errors, admin panel MVP complete
- **Next**: Closed testing phase

### Февраль 13, 2026 - Фаза 8 Segment D: Admin Panel — Analytics & Dashboard
- Segment D Analytics & Dashboard полностью реализован (Protocol Informed v1.2)
- Backend (3 new files, 1 modified):
  * `analyticsModel.js` — 14 SQL aggregation functions: counts, timelines (day/week/month GROUP BY), distributions (role/status/city/category/rating), partner response stats, moderation stats
  * `analyticsService.js` — period parsing (7d/30d/90d/custom with comparison), auto-aggregation (day ≤30d, week 31-90d, month >90d), date gap filling, change_percent with null-safe division
  * `analyticsController.js` — 4 endpoint handlers with asyncHandler pattern
  * `adminRoutes.js` — +4 routes: `/analytics/overview`, `/analytics/users`, `/analytics/establishments`, `/analytics/reviews`
- Backend Endpoints:
  * `GET /api/v1/admin/analytics/overview` — dashboard metric cards (users, establishments, reviews, moderation)
  * `GET /api/v1/admin/analytics/users` — registration timeline + role distribution
  * `GET /api/v1/admin/analytics/establishments` — creation timeline + status/city/category distributions
  * `GET /api/v1/admin/analytics/reviews` — review timeline (dual-axis: count + avg rating) + rating distribution + response stats
- Admin-Web Frontend (19 new files, 5 modified):
  * **Dependencies**: fl_chart ^0.69.2 (pure-Dart charts: Line, Pie, Bar)
  * **Models**: 12 data classes (OverviewData, UsersAnalyticsData, EstablishmentsAnalyticsData, ReviewsAnalyticsData + sub-models)
  * **Services**: AnalyticsService (singleton, 4 API methods with period params)
  * **Widgets** (5): PeriodSelector (chips + date range picker), MetricCard (value + change%), TimelineChart (LineChart + optional dual-axis), DistributionChart (donut PieChart + RatingDistributionChart), HorizontalBarChartWidget (horizontal BarChart)
  * **Providers** (4): DashboardProvider, EstablishmentsAnalyticsProvider, UsersAnalyticsProvider, ReviewsAnalyticsProvider
  * **Screens**: DashboardScreen (4 metric cards + timeline), AnalyticsContainerScreen (TabBar), 3 tab screens (Заведения, Пользователи, Отзывы и оценки)
  * **Router**: `/` → Dashboard, `/settings/analytics` → AnalyticsContainerScreen (replaced PlaceholderScreen)
  * **Sidebar**: Added "Панель управления" nav item at top
- Key Features:
  * Period selector shared across all screens (7/30/90 дней + произвольный период)
  * Auto-aggregation: by days (≤30d), weeks (31-90d), months (>90d) with aggregation field in response
  * Date gap filling: continuous zero-filled series for charts (no gaps)
  * change_percent: null when previous=0 (frontend shows "Новый показатель")
  * Rating distribution percentages guaranteed to sum to 100%
  * Empty states with friendly messages instead of empty charts
  * All SQL parameterized ($1, $2) — zero string interpolation
- **Status**: Dashboard + Analytics fully functional, `flutter analyze` 0 errors
- **Next**: Segment E — TBD

### Февраль 13, 2026 - Фаза 8 Segment C: Admin Panel — Moderation Extended + Content Management
- Segment C Moderation Extended полностью реализован (Protocol Informed v1.2)
- Backend (4 modified files):
  * `establishmentModel.js` — +5 methods: getActiveEstablishments, countActiveEstablishments, searchAllEstablishments, countSearchResults, changeEstablishmentStatus
  * `auditLogModel.js` — +2 methods: getRejectionHistory (JOIN audit_log + establishments), countRejections
  * `adminService.js` — +5 methods: getActiveEstablishments, getRejectedEstablishments, suspendEstablishment, unsuspendEstablishment, searchAllEstablishments
  * `adminModerationController.js` — +5 HTTP handlers (list active, list rejected, suspend, unsuspend, search)
  * `adminRoutes.js` — +5 routes with authenticate + authorize(['admin']) middleware
- Backend Endpoints:
  * `GET /api/v1/admin/establishments/active` — paginated list with sort (newest/oldest/rating/views), city filter, search
  * `GET /api/v1/admin/establishments/rejected` — rejection history from audit_log with per-field notes
  * `POST /api/v1/admin/establishments/:id/suspend` — suspend active establishment with reason
  * `POST /api/v1/admin/establishments/:id/unsuspend` — reactivate suspended establishment
  * `GET /api/v1/admin/establishments/search` — cross-status search with optional status/city filters
- Admin-Web Frontend (4 new files, 5 modified):
  * **Models**: ActiveEstablishmentItem (extends EstablishmentListItem + metrics), RejectedEstablishmentItem (audit_log based), SearchResultItem (with status badge)
  * **Services**: ModerationService +5 API methods, +3 response wrapper classes
  * **Widgets**: ModerationFieldReview +isReadOnly/readOnlyComment params; ModerationDetailPanel +DetailPanelMode enum (moderation/readonly/suspended), +onSuspend/onUnsuspend callbacks, +rejectionNotes display, +external data params for reuse
  * **Providers**: ApprovedProvider (active list, search mode, sort/filter, suspend/unsuspend), RejectedProvider (rejection history, detail)
  * **Screens**: ApprovedScreen (search + filter + card list + detail + suspend dialog), RejectedScreen (rejection cards + readonly detail + rejection notes)
  * **Router**: Replaced PlaceholderScreens for /moderation/approved and /moderation/rejected
  * **main.dart**: Added ApprovedProvider and RejectedProvider to MultiProvider
- Key Features:
  * Одобренные screen: search across all statuses with status badges, sort by date/rating/views, city filter, suspend with reason dialog, unsuspend for suspended items
  * Отказанные screen: rejection history from audit_log (not a status filter), per-field rejection reasons display, current status badge, read-only detail view
  * Widget backward compatibility: all new params optional with defaults, existing Segment B code unaffected
- **Status**: Full moderation lifecycle complete (pending → approve/reject → active list → suspend/unsuspend → rejected history)
- **Next**: Segment D — TBD

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
