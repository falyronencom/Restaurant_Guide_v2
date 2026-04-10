# Security Audit & Hardening — Session Report
**Date**: 2026-04-10
**Protocol**: Protocol_Autonomous v1.3 (ad-hoc task)
**Trigger**: Pre-App Store submission security review (public GitHub repo)

---

## Task Summary

Full security audit of public repository before App Store submission. Two blocks:
- **Block A**: Secret scanning, git history cleanup, key rotation
- **Block B**: Code security audit (auth, SQL injection, XSS, OWASP)

---

## Block A: Secrets & Configuration

### Findings (Pre-scan)

| Finding | Severity | Files |
|---------|----------|-------|
| Yandex MapKit API key hardcoded | CRITICAL | AppDelegate.swift, MainApplication.kt, AndroidManifest.xml |
| Firebase configs tracked in git | MEDIUM | GoogleService-Info.plist, google-services.json |
| Password `Test1453` in git history | HIGH | create-admin.js (commit 271830b, fixed in b35c330) |
| Password `AppleReview2026` in code | HIGH | create-review-user.js:6, :34 |
| Password `SeedUser2026!` fallback | HIGH | reviews-config.js:31 |
| `.env.test` tracked in git | MEDIUM | backend/.env.test |

### Remediation Applied

#### 1. Yandex MapKit Key — moved to build-time injection
- **Android**: `local.properties` → `build.gradle.kts` (manifestPlaceholders) → `AndroidManifest.xml` (`${YANDEX_MAPKIT_API_KEY}`) → `MainApplication.kt` (reads from meta-data)
- **iOS**: `Secrets.xcconfig` → `Debug/Release.xcconfig` (include) → `Info.plist` (`$(YANDEX_MAPKIT_API_KEY)`) → `AppDelegate.swift` (reads from Bundle)
- Both config files gitignored; `.example` template committed

#### 2. Passwords removed from code
- `create-review-user.js`: removed `AppleReview2026` from usage comment and fallback default; now requires `REVIEW_PASSWORD` env var
- `reviews-config.js`: removed `SeedUser2026!` fallback; now requires `SEED_PASSWORD` env var
- Both scripts exit with clear error message if env var missing

#### 3. .gitignore hardened
- Added: `**/GoogleService-Info.plist`, `**/google-services.json`, `**/Secrets.xcconfig`
- Changed: `.env.*.local` → `.env.*` (catches .env.test and all variants)
- Exception preserved: `!.env.example`

#### 4. Firebase files untracked
- `git rm --cached` for GoogleService-Info.plist and google-services.json
- Files remain on disk for local builds

#### 5. Git history rewritten
- Tool: `git-filter-repo` v2.47.0
- Actions: removed `docs/` folder from all history + replaced 4 secrets with `***REDACTED***` placeholders
- Result: 397 → 351 commits (46 docs-only commits eliminated)
- Backup: `C:\Users\Honor\Restaurant_Guide_Belarus_v2_BACKUP_20260410_162551.git`
- Force push to GitHub completed

#### 6. Key rotation (all 5 compromised keys)
| Key | Rotated | Where Updated |
|-----|---------|---------------|
| Yandex MapKit | New key generated | local.properties, Secrets.xcconfig |
| OpenRouter | New key generated | Railway env vars, backend/.env |
| Cloudinary | New secret generated | Railway env vars, backend/.env |
| JWT Secret | New 256-bit hex | Railway env vars, backend/.env |
| Admin password | New password set | Database (via upsert script) |

---

## Block B: Code Security Audit

### Overall Rating: 8.5/10

### Findings

| Area | Status | Details |
|------|--------|---------|
| JWT (HS256) | SECURE | Proper algorithm, 4h access + 30d refresh, rotation with replay detection |
| Password hashing | SECURE | Argon2id, 16MB memory cost, timing-attack prevention |
| SQL injection | SECURE | 100% parameterized queries in production code |
| XSS | LOW RISK | JSON API only, no HTML rendering |
| File upload | SECURE | MIME whitelist (JPEG/PNG/WebP), 5MB limit, UUID filenames |
| CORS | SECURE | Not wildcard, env-based whitelist |
| Helmet headers | SECURE | CSP, HSTS, X-Frame-Options |
| OAuth | SECURE | Email verification check prevents account takeover |
| authorize() | FIXED | String→array parameter in 6 route files (12 call sites) |

### authorize() Fix Details
- **Issue**: `authorize('partner')` passes string to `.includes()` — substring match instead of exact match
- **Risk**: Future role names that are substrings of existing roles would bypass checks
- **Fix**: Changed to `authorize(['partner'])` — array `.includes()` requires exact match
- **Scope**: 6 files, 12 call sites. `adminRoutes.js` and `reviewRoutes.js` already correct

---

## Additional Fix: create-admin.js

- **Problem**: Script used DELETE + INSERT, failed with FK constraint when admin had moderated establishments
- **Fix**: Changed to SELECT existing → UPDATE password if exists, INSERT if not
- **Result**: Admin password rotation now works on production database

---

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `005f760` | security | Remove hardcoded secrets, untrack sensitive config files |
| `618df36` | fix | create-admin script uses upsert instead of delete+insert |
| `9ed2ca0` | chore | Broaden .env gitignore pattern |
| `170ed2b` | security | Fix authorize() string→array parameter |

Note: git-filter-repo rewrote all commit hashes. Hashes above are post-rewrite.

---

## Verification

- `git log -p -S "e585b056"` → empty (Yandex key gone from history)
- `git log -p -S "Test1453"` → empty (admin password gone)
- `git log -p -S "AppleReview2026"` → empty (review password gone)
- `git log --all -- "docs/"` → empty (docs folder gone)
- `grep -r "authorize('" backend/src/routes/` → zero string-parameter calls
- All Firebase/secret files confirmed gitignored

---

## Notes for Future Work

1. **Flutter build command** now requires Yandex key:
   - Android: automatic from `local.properties`
   - iOS: automatic from `Secrets.xcconfig`
   - CI/CD: must inject via `--dart-define=YANDEX_MAPKIT_API_KEY=xxx`

2. **GitHub cache**: Old commits may be accessible by direct hash URL for some time. Options: contact GitHub support or recreate repository.

3. **Backup cleanup**: `Restaurant_Guide_Belarus_v2_BACKUP_20260410_162551.git` in `C:\Users\Honor\` — safe to delete after verifying everything works.
