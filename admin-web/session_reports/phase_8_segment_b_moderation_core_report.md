# Phase 8 Segment B: Admin Panel — Moderation Core

**Date**: Февраль 8, 2026
**Protocol**: Informed v1.2 (Leaf Execution)
**Status**: Завершён

---

## Scope

Implementation of the Moderation Core for the Admin Panel — the primary operational workflow enabling administrators to review, approve, or reject partner-submitted establishments. Follows the Informed Directive with Discovery Report from Figma Design Audit.

## Backend Implementation

### New Files (4)

| File | Purpose |
|------|---------|
| `backend/src/models/auditLogModel.js` | audit_log INSERT, non-blocking with graceful failure |
| `backend/src/services/adminService.js` | Business logic: list pending, get details, approve/reject with audit |
| `backend/src/controllers/adminModerationController.js` | 3 HTTP handlers (list, details, moderate) |

### Modified Files (2)

| File | Changes |
|------|---------|
| `backend/src/models/establishmentModel.js` | +3 functions: getPendingEstablishments, countPendingEstablishments, moderateEstablishment |
| `backend/src/routes/v1/adminRoutes.js` | +3 routes with authenticate + authorize(['admin']) middleware |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/establishments/pending` | Paginated list, FIFO (oldest first) |
| GET | `/api/v1/admin/establishments/:id` | Full details with media + partner docs |
| POST | `/api/v1/admin/establishments/:id/moderate` | Approve (→ active) or reject (→ draft) |

## Frontend Implementation

### New Files (8)

| File | Lines | Purpose |
|------|-------|---------|
| `lib/models/establishment.dart` | ~200 | EstablishmentListItem, EstablishmentDetail, MediaItem models |
| `lib/services/moderation_service.dart` | ~85 | 3 API endpoints via ApiClient singleton |
| `lib/providers/moderation_provider.dart` | ~255 | FieldReviewState, list/detail/review state, moderation actions |
| `lib/widgets/moderation/moderation_field_review.dart` | ~265 | Reusable per-field review widget (used 14x) |
| `lib/widgets/moderation/moderation_list_panel.dart` | ~265 | Card list panel (400px width) |
| `lib/widgets/moderation/moderation_detail_panel.dart` | ~850 | 4-tab detail panel + action bar |
| `lib/screens/moderation/pending_moderation_screen.dart` | ~45 | 3-panel layout screen |

### Modified Files (2)

| File | Changes |
|------|---------|
| `lib/config/router.dart` | Replaced PlaceholderScreen → PendingModerationScreen for /moderation/pending |
| `lib/main.dart` | Changed to MultiProvider, added ModerationProvider |

## Moderation Workflow

1. **Card list**: Name, category, cuisine tag, address, date, thumbnail, selection highlight (orange border)
2. **4 tabs**:
   - **Данные**: Legal name, UNP, registration doc, contact person, contact email (5 fields)
   - **О заведении**: Description, name, phone, website, working hours, price range + special hours, attributes (6 moderable + 2 info)
   - **Медиа**: Photos grid + menu files (2 fields)
   - **Адрес**: Address + map placeholder with coordinates (1 field)
3. **Per-field actions**: Approve (green bg), Reject (red bg + comment dialog), Comment (orange icon)
4. **Final actions**:
   - "Одобрить заведение" → status 'active', published_at set, audit_log entry, card removed
   - "Отклонить" → status 'draft', per-field notes stored, audit_log entry, card removed

## Design Implementation

- Figma MCP used for frame 93:1092 (primary moderation layout)
- Orange palette: #F06B32, #DB4F13, #EC723D
- Green approve: #3FD00D
- Card shadows matching Figma: 4px blur, #D35620 at 8% opacity
- Card height: 116px, thumbnail width: 107px
- List panel width: 400px

## Architecture Decisions

1. **Non-blocking audit log**: auditLogModel catches errors and returns null — moderation works even if audit_log table isn't deployed
2. **Parallel data fetching**: getEstablishmentForModeration loads establishment + media + partner docs via Promise.all
3. **Local field review state**: Per-field approve/reject/comment is UI-only state (Map in provider), collected into moderation_notes only on final action
4. **FIFO ordering**: Pending list sorted by updated_at ASC (oldest first) for fair review queue

## Next Steps

- **Segment C**: Одобренные + Отказанные screens (read-only views with filtering)
