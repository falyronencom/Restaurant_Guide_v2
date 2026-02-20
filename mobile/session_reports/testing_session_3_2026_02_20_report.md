# Testing Session 3: Text Search + Search UI

**Date:** February 20, 2026
**Protocol:** Protocol Autonomous v1.1
**Scope:** Search bar UI fixes + full text search implementation

---

## Changes Made

### UI Fixes (Mobile)

#### 1. Search Home Screen — Input + Button Geometry
- **File:** `mobile/lib/screens/search/search_home_screen.dart`
- **Change:** `BorderRadius.circular(9)` → `BorderRadius.only()` on both input and button
- Input: rounded only left (topLeft, bottomLeft)
- Button: rounded only right (topRight, bottomRight)
- Result: flush join — "pencil + eraser" geometry per Figma mockup

#### 2. Results Screen — Back Button Inside Search Field
- **File:** `mobile/lib/screens/search/results_list_screen.dart`
- **Change:** Moved `chevron_left` icon from separate Container into TextField's `prefixIcon`
- Applied in both `_ResultsListScreenState._buildSearchBar()` and `_CollapsingHeaderDelegate._buildSearchBar()`
- Layout changed from `< [ text ]` to `[< text ]`

### Text Search (Backend)

#### 3. Search Controller
- **File:** `backend/src/controllers/searchController.js`
- Extracted `search` from `req.query`
- Passed `search?.trim() || null` to `searchByRadius()`, `searchWithoutLocation()`, and `searchByBounds()`

#### 4. Search Service — ILIKE + Synonyms
- **File:** `backend/src/services/searchService.js`
- Added `SEARCH_SYNONYMS` map (25 keywords → categories/cuisines)
- Added `addSearchConditions()` helper function
- Integrated into all 3 search methods: `searchByRadius`, `searchWithoutLocation`, `searchByBounds`

**SQL generated for search "пицца":**
```sql
AND (
  e.name ILIKE '%пицца%'
  OR e.description ILIKE '%пицца%'
  OR e.categories::text ILIKE '%пицца%'
  OR e.cuisines::text ILIKE '%пицца%'
  OR e.categories && '{Пиццерия}'::varchar[]
  OR e.cuisines && '{Итальянская}'::varchar[]
)
```

### Map Integration (Mobile)

#### 5. Map Screen — Search Query Passthrough
- **File:** `mobile/lib/screens/map/map_screen.dart`
- Read `provider.searchQuery` before async operations
- Passed as `search` parameter to `searchByMapBounds()`

#### 6. Establishments Service — Map Bounds Search
- **File:** `mobile/lib/services/establishments_service.dart`
- Added `search` parameter to `searchByMapBounds()` method
- Sends as `queryParams['search']` to `/api/v1/search/map`

---

## Architecture

Search text now flows through all 3 search paths:

```
[List Search]    TextField → provider.setSearchQuery → GET /search/establishments?search=...
[Map Search]     provider.searchQuery → GET /search/map?search=...
[Both paths]     → searchController → searchService.addSearchConditions() → SQL WHERE
```

All existing filters (city, categories, cuisines, price, hours, features, distance) combine with text search via AND logic.

---

## Synonym Map Coverage

| Keyword | Categories | Cuisines |
|---------|-----------|----------|
| пицца/пиццу | Пиццерия | Итальянская |
| суши/ролл/роллы | — | Японская, Азиатская |
| бургер/бургеры | Фаст-фуд | Американская |
| хинкали/хачапури/шашлык | — | Грузинская |
| кофе | Кофейня | — |
| пиво | Бар, Паб | — |
| кальян | Кальянная, Кальян | — |
| драники | — | Народная |
| + 12 more entries | ... | ... |

---

## Verification
- Tested search by name: returns matching establishment cards
- Tested search + city filter: correctly narrows results
- Tested search + price/cuisine filters: AND logic works
- Tested map view with search: markers filtered by search text
- All existing filter functionality preserved (no regressions)

---

## Files Changed (6 total)

| File | Type | Changes |
|------|------|---------|
| `mobile/lib/screens/search/search_home_screen.dart` | UI | BorderRadius fix |
| `mobile/lib/screens/search/results_list_screen.dart` | UI | Back button → prefixIcon (2 places) |
| `mobile/lib/screens/map/map_screen.dart` | Data | searchQuery passthrough |
| `mobile/lib/services/establishments_service.dart` | Data | search param in map bounds |
| `backend/src/controllers/searchController.js` | API | search param extraction + forwarding |
| `backend/src/services/searchService.js` | Core | SEARCH_SYNONYMS + addSearchConditions + integration |
