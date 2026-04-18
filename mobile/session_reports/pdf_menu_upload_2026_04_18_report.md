# PDF Menu Upload (Task 1) — 2026-04-17 — 2026-04-18

## Context

Architectural contract from 2026-04-17: PDF menu upload for partner establishments, positioned as the foundation for the planned Smart Search OCR Phase 2 (pdf-parse on vector PDFs gives 100% accurate text; photos via OCR give 90-95% with character confusion). Implementation spanned two sessions (2026-04-17 planning/A-B, 2026-04-18 C-D).

Scope: end-to-end PDF upload — partner registration, backend storage, establishment detail screen display, embedded viewer. Contract also prescribed the UX shape (separate PDF block, not mixed with photos) and the choice of pdfx as viewer (decided together 2026-04-17).

## Phases

### Phase A — Migration 023 (file_type column)
- `023_add_file_type_to_media.sql`: `file_type VARCHAR(10) NOT NULL DEFAULT 'image' CHECK (file_type IN ('image', 'pdf'))` on `establishment_media`. Composite index `(establishment_id, type, file_type)` to support the detail screen's menu-block filtering.
- Rollback: `023_rollback_file_type.sql` with DO-block existence checks, matching the project's migration style.
- Tested on local pg-test (Docker container). CHECK constraint correctly rejects non-`image`/`pdf` values.
- Commit `bccd9a6`.

### Phase B — Backend upload pipeline
- **Contract correction discovered during implementation**: contract specified `resource_type: 'raw'` for Cloudinary storage, but `pg_1` transformations (required for first-page thumbnails) only work on `resource_type: 'image'`. Using `image` preserves the intent (full PDF downloadable + first-page thumbnail) via Cloudinary's native PDF support. Flagged to coordinator, correction approved.
- `cloudinary.js`: `uploadPdf` (resource_type=image), `generatePdfThumbnailUrl` (pg_1 + c_fill 200x150), `generatePdfPreviewUrl` (pg_1 + c_fit 800x600), `isValidPdfType`, `isValidPdfSize` (60MB).
- `mediaRoutes.js`: multer fileFilter accepts `application/pdf`, size ceiling raised to 60MB (images still capped to 10MB in service).
- `mediaModel.js`: `createMedia` + all SELECTs now include `file_type`; `getMediaCountByType` filters `file_type='image'` so PDFs don't deplete image tier limits; new `countPdfMedia`.
- `mediaService.js`: `uploadMedia` branches on mimetype. PDF path enforces `type='menu'`, 60MB size limit, max 2 PDFs per establishment. `is_primary` forced false for PDFs (they're not the establishment's primary photo — `position` differentiates primary/supplementary PDFs).
- Tests: 3 new PDF tests added to `media.test.js` (success with type=menu, rejection with non-menu type, 3rd-PDF rejection). 41/41 media integration tests pass.
- Commit `a440515`.

### Phase C — Mobile upload UI (partner registration)
Discovered during implementation that partner registration uses a **separate** temp upload endpoint (`/api/v1/partner/media/upload` → `tempMediaRoutes.js`), not the direct establishment endpoint updated in Phase B. Scope expanded to cover:

- **Backend**:
  - `tempMediaRoutes.js`: multer accepts PDF, 60MB ceiling. Handler branches on mimetype — PDF path routes through `uploadPdf` + thumbnail/preview URL generation, returns `file_type` field.
  - `establishmentService.js`: `createEstablishment` now accepts `menu_pdfs` array (objects with url, thumbnail_url, preview_url, file_name). Persists to `establishment_media` with `file_type='pdf'`, caption stores filename for detail screen display. Caps at 2 per establishment.

- **Mobile**:
  - `pubspec.yaml`: `file_picker ^8.1.7`, `pdfx ^2.7.0`.
  - `models/partner_registration.dart`: new `MenuPdf` value class (url, thumbnail, preview, fileName) + `menuPdfs` field on `PartnerRegistration`. Serializes to `menu_pdfs` in `toJson`.
  - `providers/partner_registration_provider.dart`: `addMenuPdf`/`removeMenuPdf` with client-side 2-file cap.
  - `services/media_service.dart`: `uploadPdf(filePath)` method hits the temp endpoint with `type='menu'`. `UploadedMedia` gained optional `fileType` field.
  - `screens/partner/steps/media_step.dart`: `_showPdfPlaceholder` (snackbar placeholder) replaced with `_pickPdf` — FilePicker (`.pdf` only) → client-side 60MB guard → backend upload → provider update. New `_PdfTile` widget: Cloudinary first-page thumbnail + filename + delete button.

- Backend: 130/130 establishments + media integration tests pass.
- Flutter analyze clean.
- Commit `4df3693`.

### Phase D — Detail screen + embedded PDF viewer
- **Mobile model**: `EstablishmentMedia` gained `fileType` (default 'image' for legacy rows) + `caption` + `isPdf` getter. Backend already returns `file_type` via the Phase B SELECT updates.
- **PDF viewer** (`screens/establishment/pdf_viewer_screen.dart`, new): `PdfControllerPinch` + `PdfViewPinch` from pdfx. On first open, downloads PDF via Dio to `getTemporaryDirectory()/pdf_cache/{hash(url)}_{filename}` — repeat opens skip the network. AppBar shows page counter, background is black, pinch-to-zoom enabled by the Pinch variant.
- **Detail screen layout** (UX decision from 2026-04-17 discussion): PDF cards render **above** the photo carousel, never mixed with photos. When both exist, a `_MenuSubsectionLabel` ("Фото меню") divides them. `_buildMenuCarousel` and `_openMenuGallery` filter out PDFs to keep tap behavior unambiguous.
- **`_PdfMenuCard` widget**: 100px-high card with Cloudinary first-page thumbnail (76px) + filename (from caption) + "Открыть PDF →" affordance. Tap navigates to `PdfViewerScreen`.
- Commit `fb167db`.

## Contract Deviations (Documented)

1. **Cloudinary `resource_type`**: `'image'` instead of `'raw'`. Preserves full PDF + enables pg_1 transformations. Coordinator approved.
2. **Filesize on tile**: not persisted. Tile shows filename + thumbnail + delete only. Avoided schema bloat; minor UX trade-off.
3. **Edit-flow PDF support**: not addressed. Partner edit uses the direct `/establishments/:id/media` endpoint which already supports PDF from Phase B. `updateEstablishment`'s `menu_pdfs` sync (analogous to `menu_photos` sync) was not implemented — deferred as a follow-up if needed.

## Verification

- **Backend**: 130/130 establishments + media tests pass. Pre-existing 10 bookingService test failures (Russian localization mismatch from commit `7c662f9`) are unrelated and were observed before my changes.
- **Frontend**: `flutter analyze` clean on the full project.
- **Migration**: applied cleanly on local pg-test; CHECK constraint verified to reject invalid values.
- **Production deploy**: migration 023 **not yet applied** on Railway. Requires deploy when task 1 features are released.

## Architectural Notes

- **Why PDF is not legacy**: vector PDF text extraction (`pdf-parse`) is 100% accurate; photo OCR is 90-95% with character confusion (8/B/В, 5/S, 0/O) and loses structure. PDF is therefore the foundation for Smart Search Phase 2, not a convenience feature.
- **Position vs is_primary for PDFs**: `is_primary` is reserved for establishment's primary photo (establishment card cover). For PDFs, the "primary PDF vs supplementary PDF" distinction (contract: 1 primary + 1 supplementary) uses `position` instead — primary gets position 0, supplementary gets 1.
- **Caching strategy**: PDF viewer caches by URL hash + last path segment. Eviction deferred to OS temp directory lifecycle. If cache grows unboundedly, consider explicit cleanup in future.

## Files Changed

**Backend** (6):
- `backend/migrations/023_add_file_type_to_media.sql` (new)
- `backend/migrations/023_rollback_file_type.sql` (new)
- `backend/src/config/cloudinary.js`
- `backend/src/routes/v1/mediaRoutes.js`
- `backend/src/routes/v1/tempMediaRoutes.js`
- `backend/src/models/mediaModel.js`
- `backend/src/services/mediaService.js`
- `backend/src/services/establishmentService.js`
- `backend/src/tests/integration/media.test.js`

**Mobile** (7):
- `mobile/pubspec.yaml` + `pubspec.lock`
- `mobile/lib/models/partner_registration.dart`
- `mobile/lib/models/establishment.dart`
- `mobile/lib/providers/partner_registration_provider.dart`
- `mobile/lib/services/media_service.dart`
- `mobile/lib/screens/partner/steps/media_step.dart`
- `mobile/lib/screens/establishment/detail_screen.dart`
- `mobile/lib/screens/establishment/pdf_viewer_screen.dart` (new)

## Commits

- `bccd9a6` Phase A — migration 023
- `a440515` Phase B — backend upload pipeline
- `4df3693` Phase C — mobile upload UI + registration flow
- `fb167db` Phase D — detail screen PDF block + embedded viewer
