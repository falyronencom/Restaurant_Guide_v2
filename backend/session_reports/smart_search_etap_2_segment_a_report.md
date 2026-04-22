# Smart Search Этап 2 — Segment A (OCR Core / Backend Foundation)

**Date:** 2026-04-22
**Mode:** Unified (Mode C) — single session Discovery + Implementation
**Commit:** `de68221`
**Directive:** Smart Search Этап 2 — Segment A (OCR Core / Backend Foundation)

---

## Objective (from Directive)

Реализовать backend-фундамент OCR pipeline для распознавания меню — таблицы,
модели, сервисы и конфигурацию — в изолированном сегменте, без интеграции
с поиском, без admin/partner endpoints, без UI. Pipeline должен работать
end-to-end при прямом программном вызове processJob, что подтверждается
интеграционными тестами.

## Key Architectural Decisions

**PostgreSQL job queue вместо BullMQ / Redis queue.** Избегаем нового
infrastructure layer. `ocr_jobs` таблица + `FOR UPDATE SKIP LOCKED` обеспечивают
concurrency-safe polling. Цена: сложнее горизонтально масштабировать в будущем,
но для Phase 1 объёмов — избыточно.

**Отдельная `getOcrConfig()` в openrouter.js вместо параметризации `getConfig()`.**
Нулевой риск регрессии для smartSearchService, который использует существующий
getConfig(). Оба читают общий OPENROUTER_API_KEY и baseUrl, но разные
env-переменные для model.

**pdf-parse через deep import `lib/pdf-parse.js`.** Bypass для известного
quirk'а: корневой index.js пытается открыть debug test-file при load.

**Trigram GIN индекс на menu_items.item_name** через pg_trgm extension.
Оптимально для ILIKE поиска с русским текстом в Segment B. Альтернатива
tsvector-FTS overkill для Phase 1.

**sanity_flag как first-matching-rule**, не массив всех причин. Упрощает
UI в Segment B. Расширяемо позже, если понадобится.

**Serial poller (один активный job в момент времени).** Горизонтально
масштабируется позже запуском нескольких pollers — SKIP LOCKED уже обрабатывает
concurrency.

## Implementation Summary

### Migration 024
- Таблицы `ocr_jobs`, `menu_items` с CHECK constraints и индексами
- Extension `pg_trgm` + trigram GIN на `menu_items.item_name`
- Расширение `promotions`: `valid_from_time`, `valid_until_time`, `menu_item_id`
  (FK ON DELETE SET NULL), `discount_price_byn`
- CASCADE цепочка: establishments → establishment_media → menu_items/ocr_jobs
- Rollback-файл с DO-блоками для идемпотентной обратимости

### Модели
- `ocrJobModel` (6 методов): enqueue с идемпотентностью active jobs,
  pickNextPending с атомарным status transition + attempts increment,
  markFailed с CASE retry логикой, getJobsByEstablishment для Segment B
- `menuItemModel` (6 методов): bulk INSERT через dynamic VALUES fragment,
  replaceForMedia в BEGIN/COMMIT транзакции (previousItems → DELETE → INSERT)

### OCR services (`src/services/ocr/`)
- `pdfTextExtractor` — fetch + pdf-parse + hasTextLayer эвристика
  (avg chars/page ≥ 50, digits ≥ 3, printable ratio ≥ 0.7)
- `visionOcrAdapter` — inline OpenRouter fetch, image_url array, 60s timeout
- `llmStructurer` — OpenRouter + Zod-валидация structured JSON
- `sanityChecker` — 4 правила (price_below/above_threshold, low_confidence,
  price_delta_anomaly ratio > 3.00)
- `ocrService` оркестратор — PDF try → fallback на vision → structure →
  sanity → replaceForMedia → markDone/markFailed
- `ocrJobPoller` — setInterval 10s (env POLLER_INTERVAL_MS), graceful
  start()/stop() с ожиданием in-flight job

### Config + Integration
- `openrouter.js` + `getOcrConfig()`
- `cloudinary.js` + `generatePdfPageImageUrl(pdfUrl, pageNum)` для Vision
  на scanned PDFs
- `server.js` — poller.start() после connectRedis, poller.stop() перед
  closePool в graceful shutdown
- `.env.example` — AI_OCR_MODEL, POLLER_INTERVAL_MS
- `package.json` — pdf-parse ^1.1.1 (npm resolved 1.1.4)

### Tests
- 4 unit: pdfTextExtractor (15), sanityChecker (22), llmStructurer (14),
  ocrJobModel (13) = 64 unit tests
- 1 integration: ocr-pipeline.test.js — 6 сценариев (happy path с text layer,
  vision fallback, retry при 500, permanent failure при max_attempts,
  enqueue идемпотентность, replaceForMedia delta detection)
- **Fix**: cloudinary mock в media.test.js + promotions.test.js дополнен
  новым экспортом generatePdfPageImageUrl (иначе ESM SyntaxError при
  импорте server.js в этих тестах)

## Process Lessons

- **Jest `resetMocks: true` vs mock factory implementations:** factory-level
  `jest.fn(() => ({...}))` обнуляется между тестами. Фикс — `mockReturnValue`
  в beforeEach. Сохранено в feedback memory
- **npm test на Windows через cmd.exe:** `NODE_ENV=test` префикс не работает.
  Запускать jest напрямую через bash. Сохранено в feedback memory
- **Shared test mocks при расширении config модулей:** добавление нового
  экспорта в cloudinary.js ломает 2+ test suites, которые мокают модуль
  без нового имени (ESM strict imports). Standard deploy-discipline

## Verification

- Migration 024 применена локально на pg-test, rollback проверен, re-apply успешен
- 70 новых тестов — 100% pass
- Full regression: 1174/1186 passing; 12 failures подтверждены pre-existing
  (10 bookingService локализация + 2 smart-search fallback) через
  `git stash` baseline
- ESLint clean на всех новых файлах
- Cascade + FK поведение верифицировано в replaceForMedia integration test

## Context Telemetry

- After Discovery: 8%
- Final (после commit + docs + memory): 27%
- Consumption Segment A: ~19% context для 15+ файлов, 2500+ строк кода

## Deployment Status

- Migration 024 применена локально
- На Railway production **не задеплоена** (отдельное действие Coordinator)
- Поведение после deploy: poller запускается, идёт опрос пустой очереди каждые
  10 секунд — никаких side effects, API calls не производятся (очередь пуста)

## Segment B/C Dependencies

Segment B (ожидает):
- OCR auto-trigger в mediaService после successful PDF/image upload
- Admin endpoints для item-level санкций (hide/unhide/dismiss-flag) — паттерн
  из suspendEstablishment (adminService.js:408-508)
- Partner endpoints: GET parsed items, edit inline, retry-ocr
- Smart Search JOIN интеграция — расширение AI intent schema
  (smartSearchService.js:40-49 Zod), встройка в buildSmartSearchFilters
  (smartSearchService.js:221-278), JOIN в searchByRadius/searchWithoutLocation
  (searchService.js:401, :670)
- Notification types: menu_parsed, menu_item_hidden_by_admin

Segment C (ожидает):
- Mobile: `_buildParsedMenuSection` в media_step.dart:186+
- Admin-web: новый пункт в admin_sidebar.dart:41-108 + экран «Подозрительные
  позиции меню»
- Зависит от endpoints из Segment B

## Commits

- `de68221 feat: OCR menu pipeline backend foundation (Smart Search Этап 2, Segment A)`
