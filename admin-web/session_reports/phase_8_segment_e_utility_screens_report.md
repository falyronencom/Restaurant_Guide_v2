# Phase 8 — Segment E: Utility Screens (Admin Panel)

**Date:** February 13, 2026
**Protocol:** Protocol Informed v1.2
**Segment:** E — Utility Screens (Audit Log, Reviews Management, Placeholder screens)
**Status:** Complete

---

## Objective
Complete the admin panel by adding the remaining screens: functional Audit Log viewer, Reviews Management screen, and professional "coming soon" placeholder screens for Notifications and Payment History. After this segment, all sidebar navigation items lead to functional screens and the admin panel is ready for closed testing.

---

## Changes Made

### Backend (7 files: 5 created, 2 modified)

| File | Action | Description |
|------|--------|-------------|
| `models/auditLogModel.js` | MODIFIED | Added `getAuditLogEntries(filters)`, `countAuditLogEntries(filters)`, internal `buildAuditLogWhere()` helper. Dynamic WHERE builder with action, entity_type, user_id, date range filters. Server-side human-readable summary via SQL CASE expression. Conditional ip_address/user_agent via `include_metadata` flag. |
| `models/adminReviewModel.js` | CREATED | Admin review queries with JOINs (users + establishments). `getAdminReviews(filters)` with status mapping, ILIKE search, multi-sort. `countAdminReviews(filters)`, `toggleReviewVisibility(reviewId)`, `getReviewForAdmin(reviewId)`. |
| `services/auditLogService.js` | CREATED | `getAuditLog()` — pagination clamping (max 50), parallel model calls, returns `{ entries, meta }`. |
| `services/adminReviewService.js` | CREATED | `getReviews()`, `toggleVisibility()` (toggle + audit_log write), `deleteReview()` (soft-delete + updateEstablishmentAggregates + audit_log write with reason). |
| `controllers/auditLogController.js` | CREATED | `listAuditLog()` — query param extraction, service delegation, structured logging. |
| `controllers/adminReviewController.js` | CREATED | `listReviews()`, `toggleVisibility()`, `deleteReview()` — all with asyncHandler pattern. |
| `routes/v1/adminRoutes.js` | MODIFIED | +4 routes: `GET /audit-log`, `GET /reviews`, `POST /reviews/:id/toggle-visibility`, `POST /reviews/:id/delete`. All protected with authenticate + authorize(['admin']). |

### Frontend (13 files: 10 created, 3 modified)

| File | Action | Description |
|------|--------|-------------|
| `models/audit_log_entry.dart` | CREATED | `AuditLogEntry` data class + `AuditLogListResponse` wrapper. |
| `models/admin_review_item.dart` | CREATED | `AdminReviewItem` data class with `statusLabel` getter, `copyWith()` for optimistic updates, `AdminReviewListResponse` wrapper. |
| `services/audit_log_service.dart` | CREATED | Singleton service, `getAuditLog()` with action/date filters. |
| `services/admin_review_service.dart` | CREATED | Singleton service, `getReviews()`, `toggleVisibility()`, `deleteReview()`. |
| `providers/audit_log_provider.dart` | CREATED | List state, filters (action, date range), pagination, expandable row tracking. |
| `providers/admin_reviews_provider.dart` | CREATED | List+detail state, filters (status, rating, search, sort, date), action state (toggle/delete with optimistic updates). |
| `screens/audit_log/audit_log_screen.dart` | CREATED | Table layout with filter bar (action dropdown + PeriodSelector reuse), expandable rows for JSON details, pagination controls. |
| `screens/reviews/reviews_management_screen.dart` | CREATED | List+detail panel (400px + Expanded), search header, filter bar (status/rating/sort dropdowns), review cards with status badges, detail panel with action buttons, delete confirmation dialog with optional reason. |
| `screens/notifications/notifications_screen.dart` | CREATED | Professional "coming soon" screen with bell icon, feature description, estimated timeline. |
| `screens/payments/payments_screen.dart` | CREATED | Professional "coming soon" screen with payment icon, feature description. |
| `config/router.dart` | MODIFIED | Added `/audit-log` route. Replaced all 3 PlaceholderScreen references with actual screens. |
| `widgets/admin_sidebar.dart` | MODIFIED | Added "Аудит" section with "Журнал действий" nav item. |
| `main.dart` | MODIFIED | Registered `AuditLogProvider` and `AdminReviewsProvider` in MultiProvider. |

---

## API Endpoints Added

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/audit-log` | Paginated audit entries with filters (action, entity_type, user_id, date range, sort, include_metadata) |
| GET | `/api/v1/admin/reviews` | All reviews (including deleted/hidden) with author/establishment info and filters |
| POST | `/api/v1/admin/reviews/:id/toggle-visibility` | Toggle review is_visible, write audit_log |
| POST | `/api/v1/admin/reviews/:id/delete` | Soft-delete review, recalculate aggregates, write audit_log with optional reason |

---

## Patterns Reused

- **PeriodSelector** widget from Segment D → audit log date filtering
- **ApprovedScreen** list+detail Row layout → reviews management screen
- **ApprovedProvider** state management pattern → both new providers
- **ModerationService** singleton pattern → both new services
- **reviewModel.softDeleteReview** + **updateEstablishmentAggregates** → review delete flow
- **auditLogModel.createAuditLog** (non-blocking) → review moderation audit writes
- **asyncHandler** middleware wrapper → all new controllers
- Design tokens: Orange #DB4F13/#F06B32 for active states, badges, icons

---

## Verification

- `flutter analyze`: 0 errors, 0 warnings (1 pre-existing info-level `avoid_print` in api_client.dart)
- All sidebar navigation items now route to functional screens
- Zero PlaceholderScreens remaining in router

---

## File Count Summary

| Layer | New | Modified | Total |
|-------|-----|----------|-------|
| Backend | 5 | 2 | 7 |
| Frontend | 10 | 3 | 13 |
| Docs | 2 | 0 | 2 |
| **Total** | **17** | **5** | **22** |

---

## Notes for Future Work
- Notifications: when push notification infrastructure is built, replace NotificationsScreen with real functionality
- Payments: when monetization system launches, replace PaymentsScreen with subscription management
- Review restoration (undelete) was intentionally excluded from MVP scope
- The `include_metadata=true` parameter on audit-log endpoint exposes ip_address/user_agent — only for admin debugging
- Consider adding full-text search index on reviews.content if search performance degrades at scale
