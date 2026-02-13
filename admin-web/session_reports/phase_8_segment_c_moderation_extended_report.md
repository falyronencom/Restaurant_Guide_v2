# Phase 8 Segment C: Admin Panel — Moderation Extended + Content Management

**Date**: Февраль 13, 2026
**Protocol**: Informed v1.2 (Leaf Execution)
**Status**: Завершён

---

## Scope

Completes the moderation lifecycle by adding views for approved/rejected establishments and content management capabilities (search, suspend/unsuspend). After this segment, the admin has full visibility into all moderation states: pending → approve/reject → active list → suspend/unsuspend → rejection history.

## Backend Implementation

### Modified Files (5)

| File | Changes |
|------|---------|
| `backend/src/models/establishmentModel.js` | +5 methods: getActiveEstablishments, countActiveEstablishments, searchAllEstablishments, countSearchResults, changeEstablishmentStatus |
| `backend/src/models/auditLogModel.js` | +2 methods: getRejectionHistory (JOIN audit_log + establishments), countRejections |
| `backend/src/services/adminService.js` | +5 methods: getActiveEstablishments, getRejectedEstablishments, suspendEstablishment, unsuspendEstablishment, searchAllEstablishments |
| `backend/src/controllers/adminModerationController.js` | +5 handlers: listActiveEstablishments, listRejectedEstablishments, suspendEstablishment, unsuspendEstablishment, searchEstablishments |
| `backend/src/routes/v1/adminRoutes.js` | +5 routes (placed before `:id` param route to prevent Express matching issues) |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/establishments/active` | Paginated list, sort by newest/oldest/rating/views, city filter, name search |
| GET | `/api/v1/admin/establishments/rejected` | Rejection history from audit_log with per-field notes and current status |
| POST | `/api/v1/admin/establishments/:id/suspend` | Suspend active establishment (→ suspended), requires reason |
| POST | `/api/v1/admin/establishments/:id/unsuspend` | Reactivate suspended establishment (→ active) |
| GET | `/api/v1/admin/establishments/search` | Cross-status search with optional status/city filters |

## Frontend Implementation

### New Files (4)

| File | Purpose |
|------|---------|
| `lib/providers/approved_provider.dart` | State: active list, search mode, sort/filter, detail, suspend/unsuspend actions |
| `lib/providers/rejected_provider.dart` | State: rejection history list, detail, selected rejection item for notes |
| `lib/screens/moderation/approved_screen.dart` | Search + filter + card list + detail panel + suspend dialog |
| `lib/screens/moderation/rejected_screen.dart` | Rejection cards + readonly detail + rejection notes display |

### Modified Files (5)

| File | Changes |
|------|---------|
| `lib/models/establishment.dart` | +3 model classes: ActiveEstablishmentItem, RejectedEstablishmentItem, SearchResultItem |
| `lib/services/moderation_service.dart` | +5 API methods, +3 response wrappers (ActiveListResponse, RejectedListResponse, SearchListResponse) |
| `lib/widgets/moderation/moderation_field_review.dart` | +isReadOnly, +readOnlyComment params; hides action buttons in read-only mode |
| `lib/widgets/moderation/moderation_detail_panel.dart` | +DetailPanelMode enum (moderation/readonly/suspended), +onSuspend/onUnsuspend callbacks, +rejectionNotes, +external data params, +_HeaderActionBar, +_RejectionNotesHeader |
| `lib/config/router.dart` | Replaced 2 PlaceholderScreens with ApprovedScreen and RejectedScreen |
| `lib/main.dart` | Added ApprovedProvider and RejectedProvider to MultiProvider |

## Одобренные (Approved) Screen

1. **Search field**: searches across ALL statuses when active, returns to active-only list when cleared
2. **Filter bar**: sort dropdown (newest/oldest/rating/views), search result count indicator
3. **Card list**: shows metrics for active items (rating, views, favorites, reviews), status badges for search results
4. **Detail panel**: read-only mode for active/suspended items, shows all 4 tabs (Данные, О заведении, Медиа, Адрес)
5. **Suspend action**: orange "Приостановить" button → confirmation dialog with reason text field → removes from active list
6. **Unsuspend action**: green "Возобновить" button → direct API call → refreshes list

## Отказанные (Rejected) Screen

1. **Card list**: shows establishment name, city, rejection date, current status badge (Черновик/На модерации/Активно)
2. **Detail panel**: read-only mode with rejection notes section at top
3. **Rejection notes**: per-field reasons displayed with red styling, maps field keys to Russian labels
4. **Architecture**: queries `audit_log` table (action='moderate_reject'), NOT a status filter — 'rejected' is not a DB status

## Architecture Decisions

1. **Widget backward compatibility**: all new params on ModerationFieldReview and ModerationDetailPanel are optional with defaults — Segment B pending moderation screen is unaffected
2. **DetailPanelMode enum**: three modes (moderation, readonly, suspended) control visibility of action buttons, read-only state, and field review interactivity
3. **External data params**: ModerationDetailPanel accepts optional detail/isLoadingDetail/detailError/selectedId params — when provided, uses them directly; when null, falls back to ModerationProvider
4. **Express route ordering**: specific routes (/active, /rejected, /search) placed BEFORE /:id param route to prevent "active" being matched as an establishment ID
5. **changeEstablishmentStatus**: generic method with fromStatus guard — prevents suspending already-suspended items, etc.
6. **Rejected items from audit_log**: JOIN with establishments table provides current status, allowing admin to see if a previously rejected item has been resubmitted

## Next Steps

- **Segment D**: TBD (per Librarian session planning)
