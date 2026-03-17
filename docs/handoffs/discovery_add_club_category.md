# Discovery Report: Add "Клуб" (Club) — 14th Establishment Category

**Branch:** `experiment/unified-leaf`
**Date:** 2026-03-16
**Role:** Librarian (Investigation Only)

---

## Answers to Discovery Questions

### Q1: Where are establishment categories defined in the backend?

Categories are defined in **4 separate backend locations** with **two naming conventions** (English for seed/storage, Russian for validation/API):

**Location 1 — Seed data config (English keys, 13 items):**
[establishments-config.js:19-33](backend/scripts/seed-data/establishments-config.js#L19-L33)
```javascript
export const CATEGORIES = [
  'restaurant', 'cafe', 'bar', 'fast_food', 'pizzeria',
  'bakery', 'pub', 'canteen', 'hookah_lounge', 'bowling',
  'karaoke', 'billiards', 'nightclub',
];
```
> **NOTE:** Seed data already includes `'nightclub'` as the 13th category. There are currently 2 seed establishments using it (Минск line 765, Бобруйск line 1227).

**Location 2 — Establishment validation (Russian, 13 items):**
[establishmentValidation.js:29-43](backend/src/validators/establishmentValidation.js#L29-L43)
```javascript
const VALID_CATEGORIES = [
  'Ресторан', 'Кофейня', 'Фаст-фуд', 'Бар', 'Кондитерская',
  'Пиццерия', 'Пекарня', 'Паб', 'Столовая', 'Кальян',
  'Боулинг', 'Караоке', 'Бильярд',
];
```
> **Missing `'Клуб'`** — partner creation will reject this category.

**Location 3 — Establishment service (Russian, 13 items):**
[establishmentService.js:29-43](backend/src/services/establishmentService.js#L29-L43)
```javascript
const VALID_CATEGORIES = [
  'Ресторан', 'Кофейня', 'Фаст-фуд', 'Бар', 'Кондитерская',
  'Пиццерия', 'Пекарня', 'Паб', 'Столовая', 'Кальян',
  'Боулинг', 'Караоке', 'Бильярд',
];
```
> **Missing `'Клуб'`** — service-level validation also rejects.

**Location 4 — Search validation (Russian, 13 items, DUPLICATED in 2 places):**
[searchValidation.js:47-51](backend/src/validators/searchValidation.js#L47-L51) (validateListSearch)
[searchValidation.js:205-209](backend/src/validators/searchValidation.js#L205-L209) (validateMapSearch)
```javascript
const validCategories = [
  'Ресторан', 'Кофейня', 'Фаст-фуд', 'Бар', 'Кондитерская',
  'Пиццерия', 'Пекарня', 'Паб', 'Столовая', 'Кальянная',
  'Боулинг', 'Караоке', 'Бильярд',
];
```
> **Missing `'Клуб'`** — search filter will reject this category.

**Normalization script (already handles nightclub → Клуб):**
[normalize-cuisine-categories.sql:46](backend/scripts/normalize-cuisine-categories.sql#L46)
```sql
UPDATE establishments SET categories = array_replace(categories, 'nightclub', 'Клуб')
  WHERE 'nightclub' = ANY(categories);
```

**Run script (already has mapping):**
[run-normalize.js:57](backend/scripts/run-normalize.js#L57)
```javascript
['nightclub', 'Клуб'],
```

→ **Summary:** The English `'nightclub'` key exists in seed data + normalization. The Russian `'Клуб'` is **missing from all 4 validation arrays**.

---

### Q2: How are categories validated when a partner creates or edits an establishment?

**Double validation** — both middleware and service layer:

**Layer 1 — Express-validator middleware:**
[establishmentValidation.js:170-180](backend/src/validators/establishmentValidation.js#L170-L180)
```javascript
body('categories')
  .isArray({ min: 1, max: 2 })
  .withMessage('Categories must be an array with 1-2 items')
  .custom((categories) => {
    const invalidCategories = categories.filter(cat => !VALID_CATEGORIES.includes(cat));
    if (invalidCategories.length > 0) {
      throw new Error(`Invalid categories: ${invalidCategories.join(', ')}`);
    }
    return true;
  }),
```
- Validates against hardcoded `VALID_CATEGORIES` array (line 29-43)
- Constraint: 1-2 categories per establishment
- Error: 422 Unprocessable Entity via `handleValidationErrors`

**Layer 2 — Service-level validation:**
[establishmentService.js:178-188](backend/src/services/establishmentService.js#L178-L188)
```javascript
if (!categories || categories.length === 0 || categories.length > 2) {
  throw new AppError('Categories must contain 1-2 items', 400, 'INVALID_CATEGORIES_LENGTH');
}
const invalidCategories = categories.filter(cat => !VALID_CATEGORIES.includes(cat));
if (invalidCategories.length > 0) {
  throw new AppError(
    `Invalid categories: ${invalidCategories.join(', ')}. Valid categories: ${VALID_CATEGORIES.join(', ')}`,
    400, 'INVALID_CATEGORY'
  );
}
```
- Same hardcoded list, separate copy (line 29-43)
- Also validates on update: [establishmentService.js:640-650](backend/src/services/establishmentService.js#L640-L650)

→ **To add 'Клуб': Both VALID_CATEGORIES arrays must be updated (validator + service).**

---

### Q3: Does the category field participate in any database indexes, constraints, or PostGIS queries?

**Schema definition:**
[production_schema.sql:66](backend/migrations/production_schema.sql#L66)
```sql
categories VARCHAR(50)[],          -- Array of categories (max 2)
```

**GIN index (array operations):**
[production_schema.sql:110](backend/migrations/production_schema.sql#L110)
```sql
CREATE INDEX idx_establishments_categories ON establishments USING GIN (categories);
```

**No CHECK constraint, no DB ENUM type.** Categories are free-form `VARCHAR(50)[]` — validation is purely application-level.

→ **No migration needed for adding a new category value.** The GIN index automatically covers new array values. No schema change required.

---

### Q4: Are categories used in the search/filter API endpoint?

**Endpoint:** `GET /api/v1/search/establishments?category=Клуб`

**Query parameter parsing:**
[searchController.js:73-76](backend/src/controllers/searchController.js#L73-L76)
```javascript
const categoryList = categories
  ? (Array.isArray(categories) ? categories : categories.split(',')).map(c => c.trim()).filter(Boolean)
  : null;
```

**SQL filter application (radius search):**
[searchService.js:229-234](backend/src/services/searchService.js#L229-L234)
```javascript
if (categories && categories.length > 0) {
  conditions.push(`e.categories && $${paramIndex}::varchar[]`);
  params.push(categories);
  paramIndex++;
}
```
Uses PostgreSQL array overlap operator (`&&`) — works with any string values in the array.

**Validation (blocks unknown categories):**
[searchValidation.js:47-51](backend/src/validators/searchValidation.js#L47-L51) — inline `validCategories` in `validateListSearch`
[searchValidation.js:205-209](backend/src/validators/searchValidation.js#L205-L209) — inline `validCategories` in `validateMapSearch`

→ **Both search validators need `'Клуб'` added.** The SQL layer needs no changes.

---

### Q5: Where is the category filter list defined in the mobile app?

[filter_options.dart:127-141](mobile/lib/models/filter_options.dart#L127-L141)
```dart
static const List<String> categories = [
  'Ресторан', 'Кофейня', 'Фаст-фуд', 'Пиццерия', 'Бар',
  'Паб', 'Кондитерская', 'Пекарня', 'Караоке', 'Столовая',
  'Кальянная', 'Боулинг', 'Бильярд',
];
```

**API mapping (Russian → English):**
[filter_options.dart:144-158](mobile/lib/models/filter_options.dart#L144-L158)
```dart
static const Map<String, String> categoryMapping = {
  'Ресторан': 'restaurant',
  'Кофейня': 'cafe',
  // ... 11 more ...
  'Бильярд': 'billiards',
};
```

**Conversion method:**
[filter_options.dart:161-165](mobile/lib/models/filter_options.dart#L161-L165) — `categoriesToApi()` maps Russian names before sending to backend.

→ **Hardcoded, not fetched from API.** Need to add `'Клуб'` to `categories` list + `'Клуб': 'nightclub'` to `categoryMapping`.

---

### Q6: How are category filters displayed to the user?

**UI Component:** Wrap grid of animated SVG cards with selection outline.

**Section builder:**
[filter_screen.dart:199-220](mobile/lib/screens/search/filter_screen.dart#L199-L220) — `_buildCategoriesSection()`
- Title: "Категория заведения"
- "Все" toggle switch (lines 206-209)
- `_CategoryGrid` widget (lines 570-596)

**Individual card:**
[filter_screen.dart:599-664](mobile/lib/screens/search/filter_screen.dart#L599-L664) — `_CategoryCard`
- GestureDetector + AnimatedContainer
- SVG icon 40×40px with color tint (orange when selected)
- Russian name text below icon
- Orange outline border on selection

→ **Adding a category means adding one more card to the grid. The Wrap layout auto-reflows.**

---

### Q7: Is there a category icon or visual marker system?

**YES — SVG icon system with two separate mappings.**

**Filter screen mapping (Russian name → SVG filename):**
[filter_screen.dart:667-696](mobile/lib/screens/search/filter_screen.dart#L667-L696)
```dart
static String _getSvgPath(String label) {
  const labelToFile = {
    'Ресторан': 'Ресторан',
    'Кофейня': 'Кофейня',
    // ... 11 more ...
    'Бильярд': 'Бильярд',
  };
  final fileName = labelToFile[label] ?? label;
  return 'assets/icons/$fileName.svg';
}
```

**Partner registration mapping (icon key → SVG filename):**
[category_step.dart:172-187](mobile/lib/screens/partner/steps/category_step.dart#L172-L187)
```dart
const iconToFile = {
  'restaurant': 'Ресторан',
  'coffee': 'Кофейня',
  // ... 12 more ...
  'billiards': 'Бильярд',
};
```

**SVG assets directory:** `mobile/assets/icons/` — 13 category SVGs exist (Cyrillic filenames).

→ **`Клуб.svg` does NOT exist.** A new SVG icon asset must be created and added to `mobile/assets/icons/Клуб.svg`, registered in `pubspec.yaml` (if not using wildcard), and mapped in both `_getSvgPath()` and `_buildCategoryIcon()`.

---

### Q8: Where does the partner select a category during establishment registration?

**Step 1 of 7-step registration flow:**
[category_step.dart:11-72](mobile/lib/screens/partner/steps/category_step.dart#L11-L72) — `CategoryStep` ConsumerWidget

**Category data source:**
[partner_registration.dart:530-548](mobile/lib/models/partner_registration.dart#L530-L548)
```dart
class CategoryOptions {
  static const List<CategoryItem> items = [
    CategoryItem(id: 'restaurant', name: 'Ресторан', icon: 'restaurant'),
    CategoryItem(id: 'coffee', name: 'Кафейня', icon: 'coffee'),
    // ... 11 more ...
    CategoryItem(id: 'billiards', name: 'Бильярд', icon: 'billiards'),
  ];
  static const int maxSelection = 2;
}
```

**Category → backend conversion:**
[partner_registration.dart:394-411](mobile/lib/models/partner_registration.dart#L394-L411)
```dart
static String _categoryIdToName(String id) {
  const mapping = {
    'restaurant': 'Ресторан',
    'coffee': 'Кофейня',
    // ... 11 more ...
    'hookah': 'Кальян',    // ← sends 'Кальян' to backend
    'billiards': 'Бильярд',
  };
  return mapping[id] ?? id;
}
```

**UI:** 2-column GridView, 64×64px SVG icons, max 2 selections, AnimatedContainer with orange border.

→ **Need to add `CategoryItem(id: 'nightclub', name: 'Клуб', icon: 'nightclub')` to items list, and `'nightclub': 'Клуб'` to `_categoryIdToName()` mapping, and icon mapping in `category_step.dart`.**

---

### Q9: Is the category list in the partner registration flow the same data source as the user-facing filter list?

**NO — Completely separate data sources:**

| Aspect | User Filter | Partner Registration |
|--------|-------------|---------------------|
| **File** | `filter_options.dart` | `partner_registration.dart` |
| **Class** | `FilterConstants` | `CategoryOptions` |
| **Data Type** | `List<String>` (Russian names) | `List<CategoryItem>` (id, name, icon) |
| **API Mapping** | `categoryMapping` (Russian → English) | `_categoryIdToName()` (internal ID → Russian) |
| **Icon Mapping** | `filter_screen.dart:_getSvgPath()` | `category_step.dart:_buildCategoryIcon()` |
| **Max Selection** | Unlimited | 2 |

→ **Both systems must be updated independently. There is no shared category constant.**

---

### Q10: Are there any tests that specifically cover category-related behavior?

**YES — Significant test coverage across 5 files:**

**1. Integration — Establishments API:**
[establishments.test.js:358-447](backend/src/tests/integration/establishments.test.js#L358-L447)
- "Categories Validation" suite: accept 1 cat, accept 2 cats, reject 0, reject 3+, accept all 13 valid, reject invalid
- **Line 415:** Hardcoded list of all valid categories — needs `'Клуб'` added

**2. Unit — Establishment Service:**
[establishmentService.test.js:163-215](backend/src/tests/unit/establishmentService.test.js#L163-L215)
- Category length validation (0 and 3+), invalid values, valid 1-2 categories
- **Line 608-615:** Update category validation

**3. Integration — Search:**
[search.test.js:189-218](backend/src/tests/integration/search.test.js#L189-L218)
- Filter by single category, filter by multiple categories
- **Line 252-259:** Combined filter tests

**4. E2E — Search Discovery Journey:**
[search-discovery-journey.test.js:176](backend/src/tests/e2e/search-discovery-journey.test.js#L176)
- User filters by category (Кофейня) in E2E flow

**5. Test Fixtures:**
[establishments.js:23-98](backend/src/tests/fixtures/establishments.js#L23-L98)
- All fixtures use Russian category names: `['Ресторан']`, `['Ресторан', 'Бар']`, etc.

→ **Tests that enumerate "all valid categories" (integration test line 415) must be updated. Fixture data can optionally include Клуб.**

---

### Q11: Does the admin panel reference or display establishment categories?

**YES — 4 locations in admin-web:**

**1. Analytics — Category translation map (ALREADY HAS 'nightclub': 'Клуб'):**
[establishments_analytics_tab.dart:20-36](admin-web/lib/screens/analytics/establishments_analytics_tab.dart#L20-L36)
```dart
const _categoryToRussian = {
  // ... 12 entries ...
  'hookah_bar': 'Кальянная',
  'hookah_lounge': 'Кальянная',
  'bowling': 'Боулинг',
  'billiards': 'Бильярд',
  'nightclub': 'Клуб',       // ← ALREADY PRESENT
};
```

**2. Moderation list panel — displays first category:**
[moderation_list_panel.dart:214-221](admin-web/lib/widgets/moderation/moderation_list_panel.dart#L214-L221)
- Shows `item.categories.first.toLowerCase()` — works dynamically, no hardcoded list.

**3. Approved/Rejected screens — display first category:**
[approved_screen.dart:381-383](admin-web/lib/screens/moderation/approved_screen.dart#L381-L383)
[rejected_screen.dart:252-254](admin-web/lib/screens/moderation/rejected_screen.dart#L252-L254)
- Also dynamic — no changes needed.

**4. Establishment model — parses categories from API:**
[establishment.dart:11-392](admin-web/lib/models/establishment.dart)
- Multiple model variants parse `categories` as `List<String>` from JSON — fully dynamic.

→ **Admin panel already handles 'Клуб' in analytics. Moderation screens are dynamic and need no changes.**

---

### Q12: Are categories referenced in seed data or test fixtures?

**Seed data — already includes nightclub:**
[establishments-config.js:765](backend/scripts/seed-data/establishments-config.js#L765) — Минск nightclub establishment
[establishments-config.js:1227](backend/scripts/seed-data/establishments-config.js#L1227) — Бобруйск nightclub establishment
Both use `categories: ['nightclub']` (English key, normalized to Russian via script).

**Working hours pattern:**
[establishments-config.js:98](backend/scripts/seed-data/establishments-config.js#L98)
```javascript
nightclub: () => generateHours('20:00', '06:00', 0, 60),
```

**Review config — nightclub mapped to 'entertainment' review group:**
[reviews-config.js:50](backend/scripts/seed-data/reviews-config.js#L50)
```javascript
nightclub: 'entertainment',
```

**Test fixtures:**
[establishments.js](backend/src/tests/fixtures/establishments.js) — all use Russian names (`['Ресторан']`, etc.), no nightclub fixture currently.

→ **Seed infrastructure fully supports nightclub. Test fixtures may optionally get a Клуб entry.**

---

### Q13: Does PROJECT_MAP.md contain navigation hints relevant to the category system?

**Limited but useful:**
[PROJECT_MAP.md:359](PROJECT_MAP.md#L359) — Migration 004 row notes "Renamed category columns to cuisines" (historical, `categories` and `cuisines` are now separate arrays).

The module flow sections (lines 67-101) trace:
- Establishments module: validator → service → controller → model
- Search module: validator → controller → service

No explicit "category data flow" section in PROJECT_MAP.md.

→ **PROJECT_MAP.md does not need updating for this change (no structural changes).**

---

## Additional Findings

### CRITICAL: Pre-existing Кальян/Кальянная Inconsistency

| Location | Value Used |
|----------|-----------|
| `establishmentValidation.js:39` | `'Кальян'` |
| `establishmentService.js:39` | `'Кальян'` |
| `searchValidation.js:49, 207` | `'Кальянная'` |
| `mobile/filter_options.dart:138` | `'Кальянная'` |
| `mobile/partner_registration.dart:405` | `'Кальян'` (sent to backend) |
| `mobile/filter_screen.dart:681` | `'Кальянная'` (SVG lookup) |
| `normalization script` | `hookah_lounge → Кальянная` |

**Impact:** Partner registration sends `'Кальян'` (accepted by establishment validator), but search filter sends `'Кальянная'` (accepted by search validator). If DB stores `'Кальян'`, search for `'Кальянная'` won't match. This is a **pre-existing bug unrelated to Клуб** but should be noted for Trunk.

### Partner Registration Typo: "Кафейня" instead of "Кофейня"
[partner_registration.dart:533](mobile/lib/models/partner_registration.dart#L533)
```dart
CategoryItem(id: 'coffee', name: 'Кафейня', icon: 'coffee'),
// Should be: 'Кофейня'
```
This is cosmetic (display only) but worth noting — the `_categoryIdToName()` mapping (line 397) correctly sends `'Кофейня'` to the backend.

### Admin Analytics Already Prepared
The `_categoryToRussian` map in admin analytics already contains `'nightclub': 'Клуб'` — suggesting this category was planned from the start.

### Seed Data Already Has nightclub
The seed config defines 13 CATEGORIES including `'nightclub'`, with 2 seed establishments and working hours. The normalization script maps `nightclub → Клуб`. The gap is only in the validation/UI layers.

---

## Navigation for Implementer

### Relevant Files (by change type)

**Backend — Add 'Клуб' to validation arrays (4 edits in 3 files):**
- [establishmentValidation.js:29-43](backend/src/validators/establishmentValidation.js#L29-L43) — add `'Клуб'` to VALID_CATEGORIES
- [establishmentService.js:29-43](backend/src/services/establishmentService.js#L29-L43) — add `'Клуб'` to VALID_CATEGORIES
- [searchValidation.js:47-51](backend/src/validators/searchValidation.js#L47-L51) — add `'Клуб'` to validCategories (validateListSearch)
- [searchValidation.js:205-209](backend/src/validators/searchValidation.js#L205-L209) — add `'Клуб'` to validCategories (validateMapSearch)

**Mobile — Filter UI (3 edits in 2 files):**
- [filter_options.dart:127-141](mobile/lib/models/filter_options.dart#L127-L141) — add `'Клуб'` to categories list
- [filter_options.dart:144-158](mobile/lib/models/filter_options.dart#L144-L158) — add `'Клуб': 'nightclub'` to categoryMapping
- [filter_screen.dart:668-683](mobile/lib/screens/search/filter_screen.dart#L668-L683) — add `'Клуб': 'Клуб'` to labelToFile in _getSvgPath()

**Mobile — Partner registration (3 edits in 2 files):**
- [partner_registration.dart:531-545](mobile/lib/models/partner_registration.dart#L531-L545) — add CategoryItem for nightclub
- [partner_registration.dart:394-411](mobile/lib/models/partner_registration.dart#L394-L411) — add `'nightclub': 'Клуб'` to _categoryIdToName()
- [category_step.dart:172-187](mobile/lib/screens/partner/steps/category_step.dart#L172-L187) — add `'nightclub': 'Клуб'` to iconToFile

**Mobile — New SVG asset:**
- `mobile/assets/icons/Клуб.svg` — **must be created** (new file)

**Backend tests (1-2 edits):**
- [establishments.test.js:415](backend/src/tests/integration/establishments.test.js#L415) — add `'Клуб'` to valid categories list in test

**No changes needed:**
- Admin panel (already handles 'nightclub' → 'Клуб' in analytics; moderation is dynamic)
- Database schema (VARCHAR[] with GIN index — no migration needed)
- Seed data (already has nightclub establishments)
- Normalization scripts (already maps nightclub → Клуб)

### Data Flow

```
[Seed: 'nightclub'] → [normalize: 'Клуб'] → [DB: categories VARCHAR[]]
                                                      ↓
[Partner reg: CategoryItem 'nightclub'] → [_categoryIdToName: 'Клуб'] → [POST API]
                                                      ↓
                              [establishmentValidation.js VALID_CATEGORIES] ← must include 'Клуб'
                              [establishmentService.js VALID_CATEGORIES]    ← must include 'Клуб'
                                                      ↓
                                              [DB stores 'Клуб']
                                                      ↓
[Search API: ?category=Клуб] → [searchValidation.js validCategories] ← must include 'Клуб'
                              → [searchService.js: e.categories && $N::varchar[]]
                              → [Results returned]
                                                      ↓
[Mobile filter UI: FilterConstants.categories] ← must include 'Клуб'
[Filter screen: _getSvgPath('Клуб')] → [assets/icons/Клуб.svg] ← must exist
[Partner step: iconToFile] → [assets/icons/Клуб.svg] ← must exist
```

### Recommended Reading Order

1. [establishmentValidation.js](backend/src/validators/establishmentValidation.js) — start here: the primary validation gate, shows the pattern for adding a category
2. [filter_options.dart](mobile/lib/models/filter_options.dart) — the mobile filter constants + API mapping pattern
3. [partner_registration.dart](mobile/lib/models/partner_registration.dart) — the separate partner data model + conversion pipeline
4. [category_step.dart](mobile/lib/screens/partner/steps/category_step.dart) — partner UI icon mapping
5. [filter_screen.dart](mobile/lib/screens/search/filter_screen.dart) — filter UI icon mapping
6. [establishments.test.js](backend/src/tests/integration/establishments.test.js) — test that enumerates all categories

### Change Count Summary

| Layer | Files | Edits |
|-------|-------|-------|
| Backend validation | 3 | 4 |
| Mobile filter UI | 2 | 3 |
| Mobile partner reg | 2 | 3 |
| Mobile asset | 1 | 1 (new SVG) |
| Backend tests | 1 | 1 |
| **Total** | **9** | **12** |
