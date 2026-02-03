# Handoff: Map Filters Integration

## Problem Model
MapScreen загружает заведения только по географическим bounds, игнорируя фильтры из EstablishmentsProvider. Пользователь, применивший фильтры на экране поиска и открывший карту, ожидает видеть отфильтрованные результаты — но видит все заведения в области.

## Verified Facts
- `MapScreen` использует `EstablishmentsService.searchByMapBounds()` напрямую: [map_screen.dart:225-230](../mobile/lib/screens/map/map_screen.dart#L225-L230)
- `searchByMapBounds()` принимает только bounds (north, south, east, west): [establishments_service.dart:144-191](../mobile/lib/services/establishments_service.dart#L144-L191)
- Фильтры хранятся в `EstablishmentsProvider`: city, categories, cuisines, priceRanges, distance, hours, amenities
- API endpoint `/api/v1/search/map` существует и работает

## Dependency Graph
```
ResultsListScreen (has filters)
    ↓ tap "Map" button
MapScreen (ignores filters)
    ↓ calls
EstablishmentsService.searchByMapBounds(bounds only)
    ↓ API
GET /api/v1/search/map?neLat=...&swLat=...
```

## Semantic Anchors
- `EstablishmentsProvider` — source of truth для фильтров (используется в results_list_screen)
- `_fetchEstablishmentsForCurrentBounds()` — метод в MapScreen который нужно модифицировать
- `searchByMapBounds()` — метод сервиса, нужно расширить параметрами фильтров

## Implementation Options

### Option A: Pass filters through Provider (Recommended)
1. MapScreen слушает EstablishmentsProvider через Consumer/context.watch
2. При fetch передаёт текущие фильтры в сервис
3. Сервис добавляет фильтры к API запросу

**Pros:** Консистентность с остальным приложением, single source of truth
**Cons:** Нужно проверить что backend поддерживает фильтры на /search/map

### Option B: Pass filters as MapScreen parameters
1. При навигации на карту передавать фильтры как параметры
2. MapScreen хранит их локально

**Pros:** Изолированность, не зависит от provider
**Cons:** Дублирование логики, фильтры "замораживаются" при открытии

## Files to Modify
1. `mobile/lib/screens/map/map_screen.dart` — добавить чтение фильтров
2. `mobile/lib/services/establishments_service.dart` — расширить searchByMapBounds()
3. Возможно `backend/` — если /search/map не поддерживает фильтры

## Continuation Point
- Open: `mobile/lib/screens/map/map_screen.dart`
- First action: Проверить backend endpoint /search/map — поддерживает ли фильтры
- Expected outcome: Понимание нужны ли изменения на backend

## Session Context
- Реализована фича "Contextual Map Exploration" (Booking-style) — commit 6141d17
- MapScreen теперь принимает `focusedEstablishment` параметр
- При открытии с detail screen центрируется на заведении и показывает превью
