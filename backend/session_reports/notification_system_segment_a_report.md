# Notification System — Backend Infrastructure + Triggers (Segment A)

**Date:** 2026-03-09
**Type:** Leaf session (Protocol Informed v1.4)
**Directive:** Notification System Segment A
**Status:** Complete

## Changes Made

| File | Action |
|------|--------|
| `migrations/add_notifications.sql` | Created — table + 2 indexes |
| `migrations/production_schema.sql` | Updated — added notifications table for consistency |
| `src/models/notificationModel.js` | Created — 6 functions (create, getByUserId, getUnreadCount, markAsRead, markAllAsRead, deleteOld) |
| `src/services/notificationService.js` | Created — 5 core methods + 4 trigger helpers |
| `src/controllers/notificationController.js` | Created — 4 endpoint handlers |
| `src/routes/v1/notificationRoutes.js` | Created — 4 routes with rate limiting |
| `src/routes/v1/index.js` | Updated — import + mount `/notifications` |
| `src/services/adminService.js` | Updated — 3 notification triggers |
| `src/services/reviewService.js` | Updated — 2 notification triggers |
| `src/services/adminReviewService.js` | Updated — 2 notification triggers |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/notifications | Paginated list (page, limit, is_read, category) |
| GET | /api/v1/notifications/unread-count | Lightweight polling for badge |
| PUT | /api/v1/notifications/:id/read | Mark single as read |
| PUT | /api/v1/notifications/read-all | Mark all as read |

## Trigger Integration Points

1. **adminService.js: moderateEstablishment()** — after moderation (approve/reject) → notifyEstablishmentStatusChange
2. **adminService.js: suspendEstablishment()** — after suspend → notifyEstablishmentStatusChange('suspended', reason)
3. **adminService.js: unsuspendEstablishment()** — after unsuspend → notifyEstablishmentStatusChange('active')
4. **reviewService.js: createReview()** — after review created → notifyNewReview
5. **reviewService.js: addPartnerResponse()** — after response saved → notifyPartnerResponse
6. **adminReviewService.js: toggleVisibility()** — only when hiding → notifyReviewModerated('hidden')
7. **adminReviewService.js: deleteReview()** — after soft delete → notifyReviewModerated('deleted')

All triggers are non-blocking (`.catch(() => {})`) — notification failure never breaks primary operations.

## Notification Types

| Type | Title (Russian) | Recipient |
|------|----------------|-----------|
| establishment_approved | Заведение одобрено | Partner |
| establishment_rejected | Заведение отклонено | Partner |
| establishment_suspended | Заведение приостановлено | Partner |
| new_review | Новый отзыв | Partner |
| partner_response | Ответ на ваш отзыв | Review author |
| review_hidden | Отзыв скрыт модератором | Review author |
| review_deleted | Отзыв удалён модератором | Review author |

## Verification

- **Tests:** 33 suites, 785 passed, 0 regressions
- **Live server:** All 4 endpoints tested via curl against Docker pg-test + redis-test
- **Sanity check:** Confirmed toggleVisibility gap (no user_id fetch) — handled by trigger helper internally

## Key Decisions

- Trigger helpers do their own DB lookups (establishment name, partner_id, user_id) — keeps integration sites to 2-3 lines each
- Category filtering ("establishments" / "reviews") baked into model layer for mobile tab support
- Route `/read-all` registered before `/:id/read` to avoid Express route collision
- `deleteOld(daysThreshold)` included as future cleanup utility

## Notes for Segment B (Mobile)

- Migration must be applied on Railway production before mobile deployment
- Polling: `GET /unread-count` is lightweight (single COUNT query on partial index)
- Category param: `?category=establishments` or `?category=reviews` for tab filtering
- Response format: standard `{ items, pagination: { page, limit, total, pages } }`
