# Smart Search Этап 2 — Segment C (UI Surface) — Component 8 Complete

**Date:** 2026-04-23
**Mode:** Informed (Mode A) — new Leaf session receiving Informed Directive + Segment A + Segment B Completion Reports
**Directive:** Smart Search Этап 2 — Segment C: UI Surface
**Base commit:** `8102aa9` (docs Segment B), after `abeb086` (Segment B code)

---

## Objective (from Directive)

Построить пользовательские интерфейсы для потребления API-поверхности,
созданной в Segment B. По завершении партнёр имеет раздел «Меню» в
редактировании заведения с просмотром/редактированием распарсенных позиций
плюс retry OCR, а админ имеет экран «Подозрительные позиции меню» с
модерационными действиями. Component 8 полностью завершён после этого сегмента.

## Key Architectural Decisions

**Option A — 3 UI-состояния вместо 4 (OCR state inference).** Директива
перечисляла 4 состояния (NOT_STARTED / IN_PROGRESS / SUCCESS / FAILED), но
backend не экспонирует OCR job status партнёру и запрещено добавлять новые
endpoints (кроме Block 4). Вместо distinguishing IN_PROGRESS vs FAILED
(технически невозможного без backend change) схлопнули в единый EMPTY state
с постоянно доступной retry button. 400 `NO_PDF_MENUS` от retry даёт
friendly snackbar — инструментируем разницу «PDF есть / нет» через
обратную связь при попытке retry, а не через условный UI. Простота, не
требует backend modification, матчит Phase 1 дух директивы о retry как
возврате агентности.

**Phase 1 policy: админское скрытие не видно партнёру.** Директива
обозначила архитектурный принцип: платформа несёт ответственность за
качество контента, модерационные действия не транслируются партнёру как
его забота. Три следствия в коде: (a) `partnerMenuItemService.listMenuItems`
flip `includeHidden: true → false` (Block 4 corrective), (b) отсутствие
badge «Скрыта админом» в UI, (c) отключение `notifyMenuItemHidden` IIFE в
`adminService.hideMenuItem`. Хелпер `notifyMenuItemHidden` в
`notificationService` ОСТАВЛЕН в коде (закомментированный вызов, не
удалён сам helper) — для возможного Phase 2 переиспользования.

**Defensive test против случайной регрессии notification-vызова.**
В `admin-menu-items.test.js` добавлен тест, явно проверяющий что
`notifications` таблица пустая после hide action для типа
`menu_item_hidden_by_admin`. Предотвращает случайное восстановление
поведения будущим разработчиком.

**Server-side `reason` filter + client-side city/status для admin
dashboard.** Директива требовала фильтры по городу, заведению, статусу,
но backend `getFlaggedItems` (Segment B) поддерживает только `reason`.
Constraints запрещают backend modification. Компромисс: server-side
pagination + `reason`, client-side остальные фильтры поверх fetched
page (`per_page=50`). Для Phase 1 volume этого достаточно (flagged items
— малое подмножество всех menu_items); если объём вырастет, расширение
backend endpoint станет явным Segment D/Phase 2 задачей.

**In-app deep link only (no FCM).** Segment B сознательно сделал
`notifyMenuParsed` без push (`no push`, non-urgent event). Соответственно
Block 3 добавляет обработчик ТОЛЬКО в `notification_list_screen`
(in-app list tap), но НЕ в `main_navigation.dart` onMessageTap (FCM bubble
tap) — FCM handler был бы dead code для этого типа. Если будущая Phase
изменит политику и добавит push для `menu_parsed`, добавление FCM-ветки —
одна строка.

**Use `implements`, не `extends` для test fakes.** Оба провайдера
(`PartnerMenuProvider`, `MenuItemsModerationProvider`) принимают service
через конструктор. Fakes реализуют интерфейс сервиса через `implements`
(не `extends`) чтобы не зависеть от приватного singleton-конструктора
реального сервиса. Это исключает потребность в mockito/mocktail и
сохраняет нулевую mock-dependency policy проекта.

**DropdownButton в InputDecorator, не DropdownButtonFormField.** Latest
Flutter deprecated `DropdownButtonFormField.value` в пользу `initialValue`
(несовместимо с controlled state через provider). Использовали более
стабильный паттерн `InputDecorator(child: DropdownButtonHideUnderline(...))`
который поддерживает controlled value без deprecation warning.

## Implementation Summary

### Block 4 (Setup / Backend Corrective)
- `partnerMenuItemService.listMenuItems`: `includeHidden: false` + JSDoc
  обновлён с Phase 1 policy обоснованием
- `adminService.hideMenuItem`: удалён IIFE с `notifyMenuItemHidden`
  (строки 1136-1155), заменён на Phase 1 inline comment
- `admin-menu-items.test.js`: +1 defensive test (no notification created)
- `partner-menu-items.test.js`: обновлён 1 существующий тест под новую
  Phase 1 semantic (returns only non-hidden items)

### Block 1 — Mobile Partner: раздел «Меню»
**Новые файлы:**
- `mobile/lib/models/partner_menu_item.dart` — модель с hasSanityFlag helper
- `mobile/lib/services/partner_menu_service.dart` — API client +
  `RetryOcrResult` tagged-union (success / rateLimited / failure) с
  парсингом `Retry-After` header на 429
- `mobile/lib/providers/partner_menu_provider.dart` — state + 30s polling +
  optimistic update + rollback на 4xx + itemsByCategory grouping
- `mobile/lib/screens/partner/partner_menu_screen.dart` — главный экран:
  empty state, list с группировкой по category_raw, inline edit via
  bottom sheet (item_name, price_byn, category_raw), retry bar внизу
  с friendly message на 429/NO_PDF_MENUS

**Модификации:**
- `edit_establishment_screen.dart`: пункт «Меню» в _buildEditMenu (после
  «Медиа»), case `'menu'` в `_navigateToEditStep` (push PartnerMenuScreen,
  НЕ PartnerRegistrationScreen — parsed items живут отдельно от wizard)
- `main.dart`: регистрация PartnerMenuProvider в MultiProvider

### Block 2 — Admin-web: «Позиции меню»
**Новые файлы:**
- `admin-web/lib/models/flagged_menu_item.dart` — модель + flagSnippet
  helper для list preview + copyWithAdminUpdate для immutable-update
- `admin-web/lib/services/admin_menu_item_service.dart` — 4 метода
  (getFlaggedItems, hideItem, unhideItem, dismissFlag)
- `admin-web/lib/providers/menu_items_moderation_provider.dart` — state +
  client-side filters (city/status/search) + actions с in-place update
  (dismissFlag removes item когда sanity_flag обнуляется)
- `admin-web/lib/screens/menu_items/menu_items_moderation_screen.dart` —
  Row(ListPanel | Divider | DetailPanel)
- `admin-web/lib/widgets/menu_items/flagged_menu_items_list_panel.dart` —
  filters header + scrollable cards с селекцией (левый orange border)
- `admin-web/lib/widgets/menu_items/menu_item_detail_panel.dart` —
  header + core fields (price, category, confidence) + sanity_flag
  monospace JSON + hidden state section + 3 actions (Hide dialog с
  mandatory reason ≥10 chars, Unhide confirm dialog, Dismiss confirm
  dialog)

**Модификации:**
- `admin_sidebar.dart`: пункт «Позиции меню» под «Модерация» после
  «Приостановленные» → `/moderation/menu-items`
- `config/router.dart`: GoRoute для нового пути
- `admin-web/lib/main.dart`: регистрация MenuItemsModerationProvider

### Block 3 — Mobile notification deep link
- `models/notification_model.dart`: добавлен `NotificationType.menuParsed`
  + ветви в fromString / category / icon / color. Все 4 switch'а
  обновлены (exhaustive matching).
- `screens/notifications/notification_list_screen.dart`: case
  `menuParsed` → push `PartnerMenuScreen(establishmentId)` через
  rootNavigator
- `main_navigation.dart` (FCM handler): НЕ модифицирован по обоснованию
  "dead code for no-push type"

## Tests

| Файл | Тип | Тестов |
|---|---|---|
| `backend/tests/integration/admin-menu-items.test.js` | integration | +1 (defensive) |
| `backend/tests/integration/partner-menu-items.test.js` | integration | 1 обновлён (semantic change) |
| `mobile/test/providers/partner_menu_provider_test.dart` | unit | 6 |
| `admin-web/test/providers/menu_items_moderation_provider_test.dart` | unit | 10 |
| **Итого новых** | — | **17** |

## Verification

- **Backend full regression**: `1211/1228 passing` (baseline 1210 + 1
  новый defensive test). 12 failures identical to Segment A/B baseline
  (2 smart-search fallback + 10 bookingService localization). 5 todo
  entries unchanged
- **Mobile provider tests**: 6/6 passing
- **Admin-web provider tests**: 10/10 passing
- **Flutter analyze admin-web**: clean (0 issues)
- **Flutter analyze mobile**: 1 info-level `use_build_context_synchronously`
  на pre-existing строке `edit_establishment_screen.dart:684` (не моё
  изменение, per Segment B "pre-existing violations не fix'ил по принципу
  минимизации scope")
- **Filter flip verified**: partner-menu-items test обновлён и подтверждает
  что админ-скрытые позиции исключены из partner view

## Process Lessons

- **Option A как principled simplification.** Директива требовала 4
  UI-состояния, но backend не давал разрешающей семантики для их
  distinguishing. Вместо lobby-ing за backend change в рамках Sanity
  Check, предложили простое схлопывание 3→2 states которое сохраняет
  ключевую функциональность (retry agency) без усложнения. Coordinator
  одобрил. Это показывает ценность Sanity Check для surfacing таких
  mismatch'ей ДО имплементации, а не после
- **Duplicate deprecation issue solved идиоматически.** Flutter deprecated
  API `DropdownButtonFormField.value` не имеет прямого drop-in replacement
  для controlled state. Вместо подавления warning'а или игнорирования
  (info-level severity) использовали более старый но стабильный паттерн
  `InputDecorator` + `DropdownButtonHideUnderline` + `DropdownButton` —
  идентичный UX, нулевой deprecation output
- **`implements` для fakes vs. reworking singleton constructor.** Первая
  попытка использовать `extends` требовала добавления `noop` constructor
  в production код (violation of minimum scope). Переключение на
  `implements` решило без трогания сервиса. Такие trade-off'ы (симметрия
  fake-vs-service surface) не всегда очевидны заранее; pre-existing
  constraint surface'ится через compiler error и требует тактического
  маневра
- **Test update vs. deletion decision.** При изменении semantic (hidden
  items excluded) существующий тест "returns all items including hidden"
  стал семантически неверным. Обновили assertion (не удалили тест) —
  тест-as-documentation ценен как свидетель policy-change. Это помогает
  будущему разработчику понять что flip был намеренным

## Deployment Status

- Нет миграций к применению
- Backend deploy: Block 4 — code-level change (policy flip + IIFE
  removal), не требует миграции. Deploy на Railway можно провести в
  следующем релизе без отдельной синхронизации
- Mobile build: новые файлы ждут TestFlight/Play build в отдельной
  сессии
- Admin-web build: новый маршрут станет доступен после следующего deploy
  admin-web в продакшен

## Component 8 Status

**Feature-complete.** Smart Search Этап 2 завершён по всем трём
сегментам (A: Core/Backend Foundation, B: Integration/API Surface,
C: UI Surface). Следующий логический этап — эмпирическая калибровка
качества Vision API во время seed creation 500 карточек Минска.

## Commits

- Setup + Block 1 + Block 2 + Block 3 + Tests + Docs — single commit
  (TBD)
