# Testing Session 2 Report — 2026-02-18

## Session Type: Profile Edit Backend + Avatar Upload

### Summary
Implemented the missing `PUT /api/v1/auth/profile` endpoint (Level B handoff from Testing Session 1) and added full avatar upload functionality with `POST /api/v1/auth/avatar`.

### Changes Made

#### Backend (4 files)

| File | Change |
|------|--------|
| `backend/src/services/authService.js` | Added `updateUserProfile(userId, { name, avatarUrl })` — dynamic SET clause, validation (name ≤100, avatar_url ≤500) |
| `backend/src/controllers/authController.js` | Added `updateProfile()` and `uploadAvatar()` controller methods |
| `backend/src/routes/v1/authRoutes.js` | Added `PUT /profile` and `POST /avatar` routes with authenticate middleware + multer error handling |
| `backend/src/middleware/upload.js` | New file — multer config for avatar uploads (5MB limit, JPEG/PNG/WebP, disk storage in `uploads/avatars/`) |
| `backend/src/server.js` | Added `express.static` for `/uploads` directory |

#### Mobile (5 files)

| File | Change |
|------|--------|
| `mobile/lib/services/auth_service.dart` | Fixed `updateProfile` response parsing (`data.user` wrapper); added `uploadAvatar(filePath)` with `FormData` |
| `mobile/lib/providers/auth_provider.dart` | Added `uploadAvatar(filePath)` wrapper method |
| `mobile/lib/screens/profile/edit_profile_screen.dart` | Avatar upload on image pick (replaces "coming soon"); `FileImage` for local preview; wider name input |
| `mobile/lib/screens/profile/profile_screen.dart` | Fixed `rootNavigator: true` for edit navigation; removed "{Гость}" label; use `fullAvatarUrl` |
| `mobile/lib/models/user.dart` | Added `fullAvatarUrl` getter — resolves relative paths from backend using `Environment.apiBaseUrl` |

### Bugs Fixed
1. **Edit profile navigation broken** — `pushNamed('/profile/edit')` without `rootNavigator: true` in nested tab navigator
2. **Name not saving** — `auth_service.dart` parsed `responseData['data']` (wrapper) instead of `responseData['data']['user']` (actual user object)
3. **Avatar not displaying after navigation** — backend stores relative paths (`/uploads/avatars/...`), `CachedNetworkImageProvider` needs full URL

### New Endpoints
- `PUT /api/v1/auth/profile` — update name and/or avatar_url
- `POST /api/v1/auth/avatar` — multipart image upload, returns updated user

### Verification
All changes verified by coordinator via manual testing on Android emulator:
- Name edit: saves and persists across screens
- Avatar upload: image picker → upload → display on all profile screens
- Navigation: edit button opens EditProfileScreen correctly
