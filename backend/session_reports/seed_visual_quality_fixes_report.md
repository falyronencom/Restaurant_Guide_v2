# Session Report: Seed Establishment Visual Quality Fixes
**Date:** February 26, 2026
**Commit:** `801b3fc`

## Task
Fix two visual quality problems in seed-generated establishments:
1. Search cards show no images (blank) — `primary_image_url` not populated
2. Map pins land in water/fields — coordinate offset too large (±5.5 km)

## Root Cause Analysis

### Fix 1: primary_image_url
Both seed scripts (`seed-establishments-placeholder.js` and `seed-establishments.js`) inserted media records into `establishment_media` table but never set `primary_image_url` on the establishment itself. Mobile app's search cards read from `establishments.primary_image_url`, not from `establishment_media` — so cards appeared blank.

A separate utility `seed-media-update.js` existed that could populate this field (using Unsplash URLs), but it was not part of the `db:reset` pipeline and had to be run manually.

### Fix 3: Coordinate spread
`generateCoordinates()` in `content-templates.js` added `(Math.random() - 0.5) * 0.1` to city center coordinates, producing ±0.05° offset (~5.5 km radius). For smaller cities like Бобруйск, this placed pins well outside the built-up area.

## Changes Made

### seed-establishments-placeholder.js
- `addEstablishmentMedia()`: captures `preview_url` (800x600) of the primary media record
- After media insertion loop: `UPDATE establishments SET primary_image_url` with captured URL
- Safety check: UPDATE only if `primaryImageUrl !== null`

### seed-establishments.js (Cloudinary mode)
- `uploadEstablishmentMedia()`: same pattern — captures first uploaded photo's `preview_url`
- After upload loops: same UPDATE query
- Handles edge case where only menu photos exist (no interiors)

### content-templates.js
- `generateCoordinates()`: offset multiplier `0.1` → `0.01`
- Effective range: ±0.05° (~5.5 km) → ±0.005° (~500 m)
- JSDoc and inline comments updated

## Verification

### Fix 1 — DB verification
```
Seed establishments WITH primary_image_url: 77/77 (100%)
Sample: https://picsum.photos/seed/600/800/600
```

### Fix 1 — API verification
```
GET /api/v1/search/establishments?city=Минск
→ primary_image_url field present and populated for new seed entries
```

### Fix 3 — DB verification
```
Max latitude offset:  0.00496° (< 0.005° limit)
Max longitude offset: 0.00493° (< 0.005° limit)
```

### Full reseed
```
npm run clear + placeholder --clean + seed-reviews
Result: 80 establishments (77 seed + 3 manual), 561 media, 281 reviews
```

## Files Modified
| File | Lines changed |
|------|--------------|
| `backend/scripts/seed-establishments-placeholder.js` | +13 |
| `backend/scripts/seed-establishments.js` | +17, -2 |
| `backend/scripts/seed-data/content-templates.js` | +3, -3 |

## Notes
- `db:reset` npm script uses `seed-establishments.js` (Cloudinary), which requires local images in `seed-images/`. For development without Cloudinary, use `seed-establishments-placeholder.js --clean` directly
- Pre-existing `seed-media-update.js` is now redundant for new seed runs, but still useful as a standalone tool to update images on existing data
- Manual establishments created before the Geocoding Session (Feb 25) may still show incorrect coordinates (Кульмана street) — this is legacy data, not a bug
