# iOS Detail Screen — Three Bug Fixes
**Date:** March 4, 2026
**Type:** Bugfix (TestFlight feedback)
**Directive:** iOS Detail Screen — Three Bug Fixes (Informed)

## Changes Made

### Fix 1: Distance Consistency
- **Problem:** Detail screen recalculated distance client-side, producing different values than the search results card
- **Solution:** Pass pre-calculated `distanceKm` from search results via route arguments
- **Files modified:**
  - `detail_screen.dart`: Added `distanceKm` constructor param; `_getDistanceText()` now has 4-tier priority (passed → backend → client-side → null)
  - `results_list_screen.dart`: `_navigateToDetail()` accepts and passes `distanceKm`
  - `main.dart`: `onGenerateRoute` extracts `distanceKm` from `settings.arguments`
- **Note:** `map_screen.dart` not modified per directive constraint — falls back to client-side calculation

### Fix 2: Gallery Primary Image First
- **Problem:** Gallery showed photos in position order (upload order). Card showed `primary_image_url`. If primary was not first uploaded, they differed
- **Solution:** Added `_getSortedPhotos()` helper that moves photo matching `thumbnailUrl` to index 0
- **Files modified:**
  - `detail_screen.dart`: New `_getSortedPhotos()` method; used in both `_buildHeroSection()` and `_openFullscreenGallery()`
- **Note:** `EstablishmentMedia` lacks `isPrimary` field — matching by URL against `thumbnailUrl`

### Fix 3: Mini-Map iOS Race Condition
- **Problem:** Parent `setState()` from `_loadData()` and `_initMarkers()` rebuilt the YandexMap widget, destroying the controller during positioning. No gate flag to prevent duplicate positioning
- **Solution:** Extracted `_EstablishmentMiniMap` StatefulWidget with own state; added `_mapReady` gate flag
- **Files modified:**
  - `detail_screen.dart`: Removed `_miniMapController`, `_markerGenerator`, `_initMarkers()`, `_positionMiniMap()` from parent. New `_EstablishmentMiniMap` widget with own `MapMarkerGenerator`, `_mapReady` flag, and `_positionMap()` with immediate + 250ms retry
- **Pattern source:** `map_screen.dart` lines 53-56, 358-374

## Verification
- `flutter analyze`: 29 issues (all pre-existing), 0 errors, 0 new warnings

## Key Decisions
- `_mapReady` flag used as guard in `_positionMap()` to prevent duplicate positioning calls (satisfies both gate pattern requirement and analyzer)
- Retry delay reduced from 600ms to 250ms for mini-map (smaller view, faster init than full map)
- `_getSortedPhotos()` preserves relative order of non-primary photos (stable sort behavior)
