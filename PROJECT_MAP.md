# Project Map — Restaurant Guide Belarus

Navigation document for agent orientation.
Answers: **if I need to work on X, which files do I open?**

---

## Layer 1: Directory Semantics

### Backend

| Directory | Role | When to look here |
|-----------|------|-------------------|
| `backend/src/routes/v1/` | HTTP entry points — URL → controller binding, middleware chain | Adding/changing endpoints, fixing 404s, checking auth requirements |
| `backend/src/controllers/` | Request handling — parse input, call service, format response | Fixing HTTP-level issues (status codes, validation, response shape) |
| `backend/src/services/` | Business logic — rules, validation, orchestration | Fixing logic bugs, changing business rules, debugging data flow |
| `backend/src/models/` | Database queries — SQL, transactions, aggregates | Fixing query bugs, adding columns, debugging data persistence |
| `backend/src/middleware/` | Auth (JWT verify), error handling, rate limiting, file upload | Auth failures, 401/403 issues, rate limit tuning, upload bugs |
| `backend/src/utils/` | JWT generation/verification, Winston logger | Token issues, logging changes |
| `backend/src/config/` | DB pool, Redis connection, Cloudinary pipeline | Connection issues, pool tuning, image upload config |
| `backend/migrations/` | Schema evolution (base + 12 migrations) | Adding columns, changing constraints, debugging schema mismatches |
| `backend/src/tests/` | Jest test suites (30 suites, 626 tests) | Running/fixing tests, adding coverage |

### Mobile (Flutter)

| Directory | Role | When to look here |
|-----------|------|-------------------|
| `mobile/lib/screens/` | UI by feature (auth, search, map, favorites, partner, profile) | Fixing UI bugs, adding screens, changing layouts |
| `mobile/lib/providers/` | State management — 4 ChangeNotifiers | State bugs, data flow issues, provider not updating |
| `mobile/lib/services/` | API singletons — Dio HTTP calls | API integration bugs, request/response issues |
| `mobile/lib/models/` | Data classes (7 files) | Parsing bugs, missing fields, serialization |
| `mobile/lib/widgets/` | Reusable components (cards, forms, map widgets) | Shared UI changes, component bugs |
| `mobile/lib/config/` | Theme (design tokens), routes (GoRouter), environment (API URL) | Theming, navigation, environment switching |

### Admin Web (Flutter)

| Directory | Role | When to look here |
|-----------|------|-------------------|
| `admin-web/lib/screens/` | Desktop-first UI (363px sidebar + content) — 15 screens | Admin UI bugs, adding admin features |
| `admin-web/lib/providers/` | 10 ChangeNotifiers (per-status moderation, analytics, audit) | Admin state bugs, list/filter issues |
| `admin-web/lib/services/` | 6 API singletons | Admin API integration |
| `admin-web/lib/models/` | 6 model files (analytics, audit, reviews, auth, establishment) | Admin data parsing |
| `admin-web/lib/widgets/` | AdminShell, sidebar, charts (fl_chart), moderation panels | Layout issues, chart bugs, shared admin components |
| `admin-web/lib/config/` | GoRouter + auth redirect guard, environment | Admin routing, auth redirect, API URL |

---

## Layer 2: Module Flow Maps

### Auth
```
Route:      backend/src/routes/v1/authRoutes.js
            POST /register, POST /login, POST /refresh, POST /logout, GET /me, PUT /profile, POST /avatar
Controller: backend/src/controllers/authController.js
            register, login, refresh, logout, getCurrentUser, updateProfile, uploadAvatar
Service:    backend/src/services/authService.js
            createUser, verifyCredentials, generateTokenPair, refreshAccessToken,
            invalidateRefreshToken, findUserById, updateUserProfile, upgradeUserToPartner
Model:      (no dedicated model — DB access in service)
```
Bug hints:
- Login fails → `authService.verifyCredentials()` — checks password hash via argon2
- Token expired / 401 → `middleware/auth.js` `authenticate()` — JWT verification
- Refresh loop → `authService.refreshAccessToken()` — token rotation chain in `refresh_tokens` table
- Avatar not updating → `authController.uploadAvatar()` + `middleware/upload.js` (multer, 5MB, JPEG/PNG/WebP)

### Establishments (Partner CRUD)
```
Route:      backend/src/routes/v1/establishmentRoutes.js
            GET /partner/establishments, POST /partner/establishments,
            GET /:id, PUT /:id, POST /:id/submit, POST /:id/suspend, POST /:id/resume, DELETE /:id
Controller: backend/src/controllers/establishmentController.js
            createEstablishment, listPartnerEstablishments, getEstablishmentDetails,
            updateEstablishment, submitForModeration, suspendEstablishment, resumeEstablishment
Service:    backend/src/services/establishmentService.js
            BELARUS_BOUNDS, CITY_BOUNDS, validateCityCoordinates,
            createEstablishment, updateEstablishment, submitEstablishmentForModeration
Model:      backend/src/models/establishmentModel.js
            createEstablishment, findEstablishmentById, updateEstablishment,
            submitForModeration, moderateEstablishment, changeEstablishmentStatus
```
Bug hints:
- Status transition fails → `establishmentModel.moderateEstablishment()` — status CHECK constraint
- Coordinates rejected → `establishmentService.validateCityCoordinates()` + `CITY_BOUNDS` map
- Two-step creation not working → POST creates 'draft', then POST `/:id/submit` moves to 'pending'
- Могилёв/Могилев mismatch → `CITY_BOUNDS` must have BOTH ё/е variants

### Search (Public)
```
Route:      backend/src/routes/v1/searchRoutes.js
            GET /search/health, GET /search/establishments, GET /search/establishments/:id, GET /search/map
Controller: backend/src/controllers/searchController.js
            searchEstablishments, searchMap, getEstablishmentById, searchHealth
Service:    backend/src/services/searchService.js
            searchByRadius, searchWithoutLocation, searchByBounds, getEstablishmentById
Model:      (no dedicated model — PostGIS queries in service)
```
Bug hints:
- Wrong distance results → `searchService.searchByRadius()` — PostGIS `ST_DSTWithin` / `ST_Distance`
- Text search no results → `searchService.addSearchConditions()` + `SEARCH_SYNONYMS` map (25 keywords)
- Map markers missing → `searchService.searchByBounds()` — bounds query + 30% buffer

### Reviews
```
Route:      backend/src/routes/v1/reviewRoutes.js
            GET /quota, POST /, GET /:id, PUT /:id, DELETE /:id,
            POST /:id/response, DELETE /:id/response,
            GET /establishments/:id/reviews, GET /users/:id/reviews
Controller: backend/src/controllers/reviewController.js
            createReview, getReview, getEstablishmentReviews, getUserReviews,
            updateReview, deleteReview, getReviewQuota, addPartnerResponse
Service:    backend/src/services/reviewService.js
            createReview, getReviewById, updateReview, deleteReview,
            getEstablishmentAggregates, getUserReviewQuota, addPartnerResponse
Model:      backend/src/models/reviewModel.js
            createReview, findReviewById, updateReview, softDeleteReview,
            updateEstablishmentAggregates, addPartnerResponse, executeInTransaction
```
Bug hints:
- Rating mismatch → `reviewModel.updateEstablishmentAggregates()` — recalculates avg from all active reviews
- Duplicate review 409 → partial unique index on `(user_id, establishment_id) WHERE is_deleted = FALSE`
- Quota exceeded 429 → `reviewService.getUserReviewQuota()` — 10 reviews/day limit

### Favorites
```
Route:      backend/src/routes/v1/favoriteRoutes.js
            POST /, DELETE /:establishmentId, GET /,
            GET /check/:establishmentId, POST /check-batch, GET /stats
Controller: backend/src/controllers/favoriteController.js
            addFavorite, removeFavorite, getUserFavorites,
            checkFavoriteStatus, checkBatchFavoriteStatus, getFavoritesStats
Service:    backend/src/services/favoriteService.js
            addToFavorites, removeFromFavorites, getUserFavorites,
            checkFavoriteStatus, checkMultipleFavoriteStatus
Model:      backend/src/models/favoriteModel.js
            addFavorite, removeFavorite, getUserFavorites, isFavorite,
            updateEstablishmentFavoriteCount
```
Bug hints:
- Favorite count wrong → `favoriteModel.updateEstablishmentFavoriteCount()` — denormalized counter
- Batch check fails → `favoriteService.checkMultipleFavoriteStatus()` — array of establishment IDs

### Media / Images
```
Route:      backend/src/routes/v1/mediaRoutes.js
            POST /partner/establishments/:id/media, GET /partner/establishments/:id/media,
            PUT /:id/media/:mediaId, DELETE /:id/media/:mediaId
Controller: backend/src/controllers/mediaController.js
            uploadMedia, getMedia, updateMedia, deleteMedia
Service:    backend/src/services/mediaService.js
            uploadMedia, getMediaList, updateMediaDetails, deleteMedia
Model:      backend/src/models/mediaModel.js
            createMedia, getEstablishmentMedia, findMediaById, updateMedia,
            deleteMedia, setPrimaryPhoto, getPrimaryPhoto
```
Bug hints:
- Image not showing → `config/cloudinary.js` `generateAllResolutions()` — 3 sizes: original 1920x1080, preview 800x600, thumbnail 200x150
- Primary photo missing → `mediaModel.setPrimaryPhoto()` / `hasPrimaryPhoto()`
- Upload fails → `middleware/upload.js` — multer config, 5MB max, UUID filenames

### Admin Moderation
```
Route:      backend/src/routes/v1/adminRoutes.js
            POST /admin/auth/login,
            GET /admin/establishments/pending|active|rejected|suspended|search,
            GET /admin/establishments/:id,
            POST /:id/moderate, POST /:id/suspend, POST /:id/unsuspend, PATCH /:id/coordinates
Controller: backend/src/controllers/adminModerationController.js
            listPendingEstablishments, getEstablishmentDetails, moderateEstablishment,
            listActiveEstablishments, listRejectedEstablishments, listSuspendedEstablishments,
            suspendEstablishment, unsuspendEstablishment, updateCoordinates, searchEstablishments
Service:    backend/src/services/adminService.js
            getPendingEstablishments, getEstablishmentForModeration, moderateEstablishment,
            getActiveEstablishments, getRejectedEstablishments, suspendEstablishment,
            unsuspendEstablishment, getSuspendedEstablishments, searchAllEstablishments
Model:      (uses establishmentModel.js — shared with Partner CRUD)
```
Bug hints:
- Moderation action fails → `adminService.moderateEstablishment()` — approve/reject with audit log
- Suspended list wrong → `establishmentModel.getSuspendedEstablishments()` — status filter
- Admin vs self-suspend confusion → `moderation_notes.suspend_reason` differentiates; admin: edit+resubmit, self: resume to active

### Admin Analytics
```
Route:      backend/src/routes/v1/adminRoutes.js
            GET /admin/analytics/overview|users|establishments|reviews
Controller: backend/src/controllers/analyticsController.js
            getOverview, getUsersAnalytics, getEstablishmentsAnalytics, getReviewsAnalytics
Service:    backend/src/services/analyticsService.js
            parsePeriod, getAggregationType, computeChangePercent, fillDateGaps,
            getOverview, getUsersAnalytics, getEstablishmentsAnalytics, getReviewsAnalytics
Model:      backend/src/models/analyticsModel.js
            countUsersInPeriod, getEstablishmentCounts, getReviewCounts,
            getUserRegistrationTimeline, getStatusDistribution, getCityDistribution,
            getReviewTimeline, getGlobalRatingDistribution, getResponseStats
```
Bug hints:
- Analytics 500 error → check column names in `analyticsModel.js` (previously: `partner_responded_at` → `partner_response_at`)
- Wrong aggregation → `analyticsService.getAggregationType()` — day ≤30d, week 31-90d, month >90d
- Chart gaps → `analyticsService.fillDateGaps()` — zero-fills missing dates

### Audit Log
```
Route:      backend/src/routes/v1/adminRoutes.js
            GET /admin/audit-log
Controller: backend/src/controllers/auditLogController.js
            listAuditLog
Service:    backend/src/services/auditLogService.js
            getAuditLog
Model:      backend/src/models/auditLogModel.js
            createAuditLog, getRejectionHistory, countRejections,
            getAuditLogEntries, countAuditLogEntries
```
Bug hints:
- Audit entries missing → `auditLogModel.createAuditLog()` — non-blocking, fails silently. Check if called in service
- Response format different → audit log uses `{ data: entries[], meta }` not standard `{ items, pagination }`

### Admin Reviews
```
Route:      backend/src/routes/v1/adminRoutes.js
            GET /admin/reviews, POST /:id/toggle-visibility, POST /:id/delete
Controller: backend/src/controllers/adminReviewController.js
            listReviews, toggleVisibility, deleteReview
Service:    backend/src/services/adminReviewService.js
            getReviews, toggleVisibility, deleteReview
Model:      backend/src/models/adminReviewModel.js
            getAdminReviews, countAdminReviews, toggleReviewVisibility, getReviewForAdmin
```
Bug hints:
- Review visibility not changing → `adminReviewModel.toggleReviewVisibility()` — flips `is_visible`
- Aggregates stale after delete → `adminReviewService.deleteReview()` must call `reviewModel.updateEstablishmentAggregates()`

---

## Layer 3: Cross-Cutting Concerns

### Middleware Chain
```
Request → rateLimiter → authenticate/optionalAuth → authorize(roles) → controller → asyncHandler → errorHandler
```
- `rateLimiter.js`: Redis-backed. Auth: 100/min, unauth: 300/hr. Fails open if Redis down
- `auth.js`: `authenticate` (strict 401), `optionalAuth` (permissive), `authorize(roles)` (403)
- `errorHandler.js`: `asyncHandler` wraps controllers, `errorHandler` catches all, `notFoundHandler` for 404

### Error Handling Pattern
```
Controller function wrapped in asyncHandler(async (req, res) => { ... })
  → throw new AppError(message, statusCode)
  → caught by errorHandler middleware
  → formatted as { success: false, error: { message, statusCode } }
```
- `AppError` class in `middleware/errorHandler.js`
- Production: no stack traces. Development: includes stack

### Audit Logging
Actions that trigger audit_log writes:
- Moderation: approve, reject (`adminService.moderateEstablishment`)
- Suspension: suspend, unsuspend (`adminService.suspendEstablishment/unsuspendEstablishment`)
- Reviews: toggle visibility, delete (`adminReviewService.toggleVisibility/deleteReview`)
- All writes are non-blocking (fire-and-forget via `auditLogModel.createAuditLog`)

### Authentication Flow
```
Register → createUser (argon2 hash) → generateTokenPair (accessToken 4h + refreshToken 30d)
Login → verifyCredentials → generateTokenPair → set refreshToken in httpOnly cookie
Request → authenticate middleware → verifyAccessToken (JWT) → attach req.user
Refresh → POST /refresh → validate refreshToken → rotate (old invalidated, new issued)
Logout → invalidateRefreshToken (or invalidateAllUserTokens)
```
- Access token: JWT, 4h expiry, in Authorization header
- Refresh token: 64-char hex, 30d expiry, in httpOnly cookie + DB `refresh_tokens` table
- Token rotation: `replaced_by` self-referential column tracks chain

### Database Patterns
- Pool: `config/database.js` — min 2, max 10 connections
- Transactions: `getClient()` → `BEGIN` → queries → `COMMIT/ROLLBACK` → `client.release()`
- Slow query logging: >100ms threshold
- Response format: `{ success: true, data: { items, pagination } }` for lists
- Exception: audit log returns `{ data: entries[], meta }` (different wrapper)

### Image Pipeline
```
Upload → middleware/upload.js (multer, 5MB, UUID name)
  → config/cloudinary.js uploadImage()
  → generateAllResolutions():
    - original: 1920x1080
    - preview:  800x600
    - thumbnail: 200x150
  → mediaModel.createMedia() (stores all 3 URLs)
Delete → cloudinary.deleteImage() + mediaModel.deleteMedia()
```

### Frontend State Pattern (Mobile)
```
Screen (Widget)
  → Provider (ChangeNotifier) — holds state, exposes methods
    → Service (Singleton) — HTTP calls via ApiClient
      → ApiClient (Dio) — token inject/extract/refresh interceptors
        → Backend API
```
- 4 providers: auth, establishments, partner_dashboard, partner_registration
- `notifyListeners()` after every state mutation
- Provider stale selection fix: verify `_selectedId` exists in list after reload

### Frontend State Pattern (Admin)
```
Same pattern as Mobile, with differences:
- 10 providers (dedicated per-status: moderation, approved, rejected, suspended + analytics + audit + reviews)
- Desktop layout: AdminShell (AppBar + 363px Sidebar + content area)
- GoRouter with auth redirect guard (unauthenticated → /login)
```

---

## Appendix: Database Schema Quick Reference

### Tables
| Table | Key Purpose |
|-------|-------------|
| `users` | UUID PK, email/phone/password_hash, role (user/partner/admin), avatar_url |
| `establishments` | UUID PK, partner_id→users, name/city/address/lat/lng, location (GEOGRAPHY), status, moderation_notes (TEXT!) |
| `establishment_media` | Photos: url + thumbnail_url + preview_url, is_primary, position ordering |
| `reviews` | rating 1-5, content, is_visible, is_deleted, partner_response |
| `favorites` | UNIQUE(user_id, establishment_id), hard delete |
| `refresh_tokens` | Token rotation chain: token (unique), expires_at, replaced_by→self |
| `audit_log` | action, entity_type/id, old_data/new_data (JSONB), non-blocking writes |
| `partner_documents` | company_name, tax_id, contact_person — legal verification |
| `promotions` | Future: title, valid_from/until, is_active |
| `subscriptions` | Future: tier, duration_type, started_at, expires_at |
| `establishment_analytics` | Ghost table — exists in schema but not used by models |

### Critical Constraints
- **City CHECK**: includes BOTH `Могилев` AND `Могилёв` (ё/е fix)
- **Review unique**: partial unique index on `(user_id, establishment_id) WHERE is_deleted = FALSE`
- **moderation_notes**: TEXT column, NOT JSONB — must `JSON.stringify()` on write, `JSON.parse()` on read
- **Auto-metrics trigger**: `update_establishment_metrics()` auto-updates `review_count` & `average_rating`
- **Status enum**: draft → pending → active → rejected/suspended/archived

### Relationships
```
users
  ├─→ establishments (partner_id)
  │     ├─→ establishment_media
  │     ├─→ reviews (+ user_id → users)
  │     ├─→ favorites (+ user_id → users)
  │     ├─→ promotions
  │     ├─→ subscriptions
  │     └─→ partner_documents
  ├─→ refresh_tokens (+ self-ref replaced_by)
  └─→ audit_log (admin user_id)
```

### Migrations (12 total)
| # | Purpose |
|---|---------|
| 001 | Token rotation: used_at, replaced_by |
| 002 | PostGIS extension |
| 003 | location GEOGRAPHY(Point, 4326) |
| 004 | Renamed category columns to cuisines |
| 005 | Denormalized: primary_image_url, average_check_byn, is_24_hours |
| 006 | Comprehensive indexing (GIN, composite) |
| 007 | Reviews: content column, is_deleted soft deletion |
| 008 | Fixed price_range VARCHAR(4) |
| 009 | Partner response fields |
| 010 | audit_log table |
| 011 | Test DB column sync |
| 012 | Added rejected to status CHECK |

---

*Navigation document. Updated during Documentation Hygiene Checkpoints. See Methodology v9.1 Section 1.9.1 for maintenance rules.*
