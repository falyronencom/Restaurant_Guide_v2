# Testing Session Report — 2026-02-18

## Session Type: Bug Fixes from Manual Testing

### Changes Made

#### Commit 1: fix: city-based coordinates & auto-submit for moderation
**Files:** 4 mobile files, 0 backend

| File | Change |
|------|--------|
| `mobile/lib/models/partner_registration.dart` | Added `CityOptions._cityCoordinates` mapping + `coordinatesFor()` method; replaced hardcoded Minsk (53.9, 27.5667) fallback in `toJson()` with city-based lookup |
| `mobile/lib/screens/partner/steps/address_step.dart` | City dropdown `onChanged` now auto-sets coordinates from `CityOptions.coordinatesFor()` |
| `mobile/lib/services/establishments_service.dart` | Added `submitForModeration()` method — calls `POST /:id/submit` |
| `mobile/lib/providers/partner_registration_provider.dart` | `submit()` chains `createEstablishment()` + `submitForModeration()` for draft→pending flow |

**Bugs fixed:**
- COORDINATES_CITY_MISMATCH — all cities got Minsk coordinates
- Establishments stuck in "Черновик" — never called submit endpoint

#### Commit 2: fix: profile reviews, metrics & navigation (this commit)
**Files:** 3 mobile files, 0 backend

| File | Change |
|------|--------|
| `mobile/lib/services/reviews_service.dart` | Fixed URL `/users/me/reviews` → `/users/$userId/reviews`; fixed param `per_page` → `limit` |
| `mobile/lib/models/review.dart` | Fixed `UserReviewsResponse.fromJson` for nested `data.reviews` + `data.pagination`; fixed `UserReview.fromJson` for nested `establishment` object |
| `mobile/lib/screens/profile/profile_screen.dart` | Pass `userId` to API; use `total` for review count; rename "Оценок"→"В избранном"; fix `rootNavigator: true` on review card tap |

**Bugs fixed:**
- "Отзывов: 0" — wrong URL + broken response parsing
- "Оценок: 4" — showed favorites count with wrong label
- Review card tap navigated back — missing `rootNavigator: true`

### Verification
All changes verified by coordinator via manual testing on device.

---

# Handoff: Profile Edit (Level B)

## Problem Model
The "Редактировать" button on the extended profile screen (`_ProfileDetailScreen`) navigates to `EditProfileScreen` which calls `AuthService.updateProfile()` → `PUT /api/v1/auth/profile`. This backend endpoint **does not exist**. The mobile UI is complete but the backend is missing.

## Verified Facts
- `EditProfileScreen` exists at `mobile/lib/screens/profile/edit_profile_screen.dart` (532 lines)
- Route `/profile/edit` registered in `main.dart:82`
- Screen supports editing: name, avatar upload (image picker), location (placeholder)
- Email and phone shown as read-only
- Save calls `AuthProvider.updateProfile()` (auth_provider.dart:400-424) → `AuthService.updateProfile()` (auth_service.dart:315-344)
- `AuthService.updateProfile()` sends `PUT /api/v1/auth/profile` with `{ name, avatar_url }`
- Backend has `GET /api/v1/auth/me` (authRoutes.js:138-142) but NO PUT/PATCH endpoint
- Backend `routes/v1/index.js:227-231` has a TODO comment for future `userRoutes` module
- User table has `name` and `avatar_url` columns (schema lines 11-26)

## Eliminated Hypotheses
- "Edit button doesn't navigate" — WRONG, route exists and works, screen opens
- "Frontend is broken" — WRONG, EditProfileScreen UI is complete, save logic is implemented
- Root cause is purely missing backend endpoint

## Dependency Graph
```
EditProfileScreen → AuthProvider.updateProfile() → AuthService.updateProfile()
                                                      ↓
                                              PUT /api/v1/auth/profile  ← MISSING
                                                      ↓
                                              authRoutes.js → authController → authService → userModel
```

## Semantic Anchors
- `AuthService.updateProfile()` (auth_service.dart:315): already sends `{ name, avatar_url }` — backend just needs to receive it
- `AuthProvider.updateProfile()` (auth_provider.dart:400): updates local `_currentUser` on success
- User table: `name VARCHAR(100)`, `avatar_url VARCHAR(500)` — both updatable
- `authenticate` middleware: extracts `userId` from JWT — available in `req.user.userId`

## Implementation Approach
Backend needs:
1. Add `PUT /api/v1/auth/profile` route in `authRoutes.js` (behind `authenticate` middleware)
2. Add controller method in `authController.js` — extract `name`/`avatar_url` from body
3. Add service method in `authService.js` — validate + update user
4. Add model method in `userModel.js` (or use existing pool query) — `UPDATE users SET name=$1, avatar_url=$2 WHERE id=$3`

Estimated: ~50 lines backend code across 4 files. No mobile changes needed.

## Current State
- Files modified: none pending (all committed)
- What works: edit screen opens, form renders, fields are editable
- What doesn't: save button triggers API call that returns 404/error

## Continuation Point
- Open: `backend/src/routes/v1/authRoutes.js`
- First action: Add `PUT` route for `/profile` after the existing `GET /me` route
- Expected outcome: `EditProfileScreen` save button successfully updates name
