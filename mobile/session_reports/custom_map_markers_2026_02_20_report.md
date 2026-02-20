# Custom Map Markers: Circle Badge Style

**Date:** February 20, 2026
**Protocol:** Protocol Autonomous v1.1
**Scope:** Replace orange dot markers with branded Circle Badge markers (open/closed states)

---

## Changes Made

### New Files
- `lib/widgets/map/map_marker_painter.dart` — CustomPainter for Circle Badge marker
  - Gradient circle (48px diameter), 3px white border
  - Fork-and-knife icon via Path operations (self-contained, no asset dependencies)
  - White triangular pointer beneath circle
  - Open state: `#FF8A5C` → `#E8622B` linear gradient, warm orange shadow
  - Closed state: `#B0BEC5` → `#94A3B8` linear gradient, neutral shadow
  - Future-ready: nullable `rating` parameter for rating badge evolution

- `lib/widgets/map/map_marker_generator.dart` — Bitmap generator with caching
  - Singleton pattern, pre-generates both variants on init
  - Renders via PictureRecorder → toImage → PNG bytes
  - devicePixelRatio-aware for sharp rendering on all devices
  - Cache key: `marker_open` / `marker_closed`

### Modified Files
- `lib/screens/map/map_screen.dart`
  - Replaced `_createMarkerIcon()` (single orange circle) with `MapMarkerGenerator`
  - Each marker now gets open/closed icon based on `establishment.isCurrentlyOpen`
  - Added 30% bounds buffer to `_fetchEstablishmentsForCurrentBounds()` — prevents marker disappearing at screen edges when panning

- `lib/screens/establishment/detail_screen.dart`
  - Replaced duplicated `_createMarkerIcon()` with shared `MapMarkerGenerator` singleton
  - Mini-map marker now shows correct open/closed state

---

## Architecture Decisions

1. **CustomPainter + toImage** over PNG assets — allows dynamic states without multiple asset files
2. **Singleton generator with caching** — 2 bitmaps generated once, reused for all 50+ markers
3. **Path-based icon** over TextPainter/IconData — self-contained, no font dependency
4. **Bounds buffer (30%)** — UX improvement to prevent marker flickering at screen edges

---

## Verification

- `flutter analyze` — 0 issues
- `flutter build apk --debug` — success
- Manual testing: markers display correctly, open/closed states work, panning stable
