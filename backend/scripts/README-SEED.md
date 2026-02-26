# Seed Data Infrastructure - Restaurant Guide Belarus

**Version:** 2.0
**Created:** November 2025
**Purpose:** Comprehensive realistic test dataset for Flutter mobile development

---

## Strategic Value

This seed infrastructure creates production-quality test data enabling comprehensive mobile UI validation without dependency on manual data entry or production datasets. The infrastructure provides:

- **Mobile Development Unblocking:** Immediate availability of 75 realistic establishments for UI implementation testing
- **Comprehensive Test Coverage:** Explicit edge cases testing critical mobile layout behaviors (long text, maximum photos, sparse content, etc.)
- **Professional Quality:** Real Cloudinary-hosted media with three-tier resolution optimization
- **Reproducibility:** Consistent repeatable execution producing predictable results
- **Permanent Asset:** Reusable for onboarding, testing, demonstrations throughout project lifecycle

---

## Quick Start

### Prerequisites

1. **Database:** PostgreSQL with schema v2.0 applied
2. **Cloudinary Account:** Environment variables configured:
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
3. **Seed Images:** Pre-curated images in `backend/scripts/seed-images/` subdirectories:
   - `interiors/` - Restaurant interior photos (18 images provided)
   - `menus/` - Menu photos (9 images provided)

### Basic Execution

```bash
# Additive mode (preserve existing establishments)
node backend/scripts/seed-establishments.js

# Clean slate mode (delete existing seed data first)
node backend/scripts/seed-establishments.js --clean
```

### Expected Output

```
🌱 Restaurant Guide Belarus - Seed Data Generator

Mode: CLEAN (delete existing seed data)

✓ Database connection established

📸 Loading seed images...
  Interiors: 18 images
  Menus: 9 images

✓ Using existing seed partner account
✓ Deleted 75 existing seed establishments

🏪 Creating 75 establishments:

  ✓ 1/75: Семейный ресторан европейской и азиатской кухни "Вкусы мира" (Минск) [EDGE_CASE_1_MAXIMUM_PHOTOS]
  ✓ 2/75: Чай (Гродно) [EDGE_CASE_2_MINIMUM_CONTENT]
  ✓ 3/75: Ресторан традиционной белорусской кухни "Бабушкины рецепты" (Брест) [EDGE_CASE_3_VERY_LONG_NAME]
  ...
  ✓ 75/75: Letняя терраса (Бобруйск)

📊 Validation Results:

  Total establishments: 75

  Geographic distribution:
    Минск: 35
    Гродно: 7
    Брест: 7
    Гомель: 7
    Витебск: 7
    Могилев: 7
    Бобруйск: 7

  Category coverage:
    restaurant: 28
    cafe: 14
    bar: 8
    ...

  Price range distribution:
    $: 23
    $$: 38
    $$$: 14

  Edge cases detected:
    Семейный ресторан европейской и азиатской кухни "Вкусы мира" (Минск) - 40 photos, status: active
    Ресторан традиционной белорусской кухни "Бабушкины рецепты" (Брест) - 4 photos, status: active
    ...

  Total media records: 350

  Sample Cloudinary URL: https://res.cloudinary.com/.../establishments/...

✅ Seed process completed successfully!
```

---

## Architecture Overview

### File Structure

```
backend/scripts/
├── seed-establishments.js          # Main establishment seed (Cloudinary mode)
├── seed-establishments-placeholder.js  # Placeholder seed (no Cloudinary)
├── seed-reviews.js                 # Seed reviews & users (150-250 reviews)
├── clear-establishments.js         # Remove seed establishments
├── clear-reviews.js                # Remove seed reviews & users
├── seed-data/
│   ├── establishments-config.js    # 75 establishment templates
│   ├── content-templates.js        # Russian text generation
│   └── reviews-config.js           # 12 user profiles, review templates
├── seed-images/
│   ├── interiors/                  # Interior photos (18 provided)
│   ├── food/                       # Food photos (14 provided)
│   └── menus/                      # Menu photos (9 provided)
└── README-SEED.md                  # This file
```

### Execution Flow

1. **Connection & Validation**
   - Test database connectivity
   - Load seed images from local directories
   - Validate sufficient images available

2. **Partner Account Management**
   - Find or create dedicated seed partner: `seed.data.generator@restaurantguide.by`
   - All seed establishments owned by this partner for easy identification

3. **Clean Mode (--clean flag)**
   - Delete existing establishments owned by seed partner
   - Preserves manually created or partner-registered establishments

4. **Transaction Begin**
   - Atomic execution: all 75 establishments or rollback on error
   - Prevents partial corrupted database state

5. **Establishment Creation Loop (75 iterations)**
   - Generate establishment record from config template
   - Insert into `establishments` table
   - Upload media to Cloudinary
   - Generate three-tier resolution URLs
   - Insert media records into `establishment_media` table
   - Progress logging with edge case markers

6. **Validation Queries**
   - Confirm total count (75 expected)
   - Verify geographic distribution (35 Минск, 7 each for other cities)
   - Check category and cuisine coverage
   - Validate edge cases present
   - Test sample Cloudinary URLs

7. **Transaction Commit**
   - Commit successful or rollback on error
   - Close database connection

---

## Quantitative Distribution

### Geographic Distribution

| City | Count | Percentage |
|------|-------|-----------|
| Минск | 35 | 47% |
| Гродно | 7 | 9% |
| Брест | 7 | 9% |
| Гомель | 7 | 9% |
| Витебск | 7 | 9% |
| Могилев | 7 | 9% |
| Бобруйск | 7 | 9% |
| **Total** | **75** | **100%** |

### Category Coverage (All 13 Types)

- restaurant
- cafe
- bar
- pub
- fast_food
- pizzeria
- bakery
- canteen
- hookah_lounge
- bowling
- karaoke
- billiards
- nightclub

### Cuisine Coverage (All 10 Types)

- belarusian
- european
- italian
- asian
- american
- georgian
- indian
- mediterranean
- vegetarian
- international

### Price Range Distribution

- `$` (Budget): ~30% (23 establishments)
- `$$` (Medium): ~50% (38 establishments)
- `$$$` (Premium): ~20% (14 establishments)

### Media Distribution

- **Photo Count Variation:**
  - Minimal: 2 photos (1 interior, 1 menu) - Edge Case 2
  - Normal: 3-8 photos (2-5 interiors, 1-3 menus) - Most establishments
  - Rich: 13-18 photos (8-13 interiors, 5-9 menus) - Premium establishments
  - Maximum: 40 photos (20 interiors, 20 menus) - Edge Case 1

- **Total Media Records:** ~350 (varies based on randomization)

---

## Edge Cases Explicit Implementation

Seven specific establishments testing critical mobile UI scenarios:

### Edge Case 1: Maximum Photos
- **Establishment:** "Семейный ресторан европейской и азиатской кухни \"Вкусы мира\"" (Минск)
- **Scenario:** 20 interior + 20 menu photos (40 total)
- **Tests:** Gallery pagination, performance limits, UI behavior with extensive media
- **Identifier:** `EDGE_CASE_1_MAXIMUM_PHOTOS`

### Edge Case 2: Minimum Content
- **Establishment:** "Чай" (Гродно)
- **Scenario:** 1 interior + 1 menu photo, ~50 word description, minimal attributes
- **Tests:** Sparse data graceful display, layout stability with minimal content
- **Identifier:** `EDGE_CASE_2_MINIMUM_CONTENT`

### Edge Case 3: Very Long Name
- **Establishment:** "Ресторан традиционной белорусской кухни \"Бабушкины рецепты\"" (Брест)
- **Scenario:** Name length 64 characters (exceeds typical 40-50 char displays)
- **Tests:** Truncation logic, card layout behavior, detail view title display
- **Identifier:** `EDGE_CASE_3_VERY_LONG_NAME`

### Edge Case 4: Very Long Description
- **Establishment:** "Wine Gallery" (Гомель)
- **Scenario:** Description ~300+ words (extensive text content)
- **Tests:** Text expansion UI, scroll behavior in detail view, layout performance
- **Identifier:** `EDGE_CASE_4_VERY_LONG_DESCRIPTION`

### Edge Case 5: Diverse Attributes
- **Establishment:** "Веранда" (Витебск)
- **Scenario:** 9 simultaneous attributes (WiFi, parking, terrace, kids_area, pet_friendly, live_music, outdoor_seating, accepts_cards, reservation)
- **Tests:** Complex filter logic, attribute display overflow, multi-criteria search
- **Identifier:** `EDGE_CASE_5_DIVERSE_ATTRIBUTES`

### Edge Case 6: Multiple Categories
- **Establishment:** "Крыша" (Могилев)
- **Scenario:** 2 categories (restaurant + karaoke) - maximum allowed
- **Tests:** Multi-category filtering, category badge display, search logic
- **Identifier:** `EDGE_CASE_6_MULTIPLE_CATEGORIES`

### Edge Case 7: Temporarily Closed
- **Establishment:** "Coffee Room" (Бобруйск)
- **Scenario:** Status 'suspended' (semantic mapping for temporarily closed)
- **Tests:** Closed state display, filter exclusion, status badge rendering
- **Identifier:** `EDGE_CASE_7_TEMPORARILY_CLOSED`
- **Note:** Schema v2.0 uses 'suspended' status to represent temporarily closed state

---

## Customization Guide

### Adjusting Establishment Count

**File:** `backend/scripts/seed-data/establishments-config.js`

**Current:** 75 configurations

**Modify:** Add or remove configuration objects from `ESTABLISHMENT_CONFIGS` array

```javascript
export const ESTABLISHMENT_CONFIGS = [
  // Edge cases (7) - always keep these
  { ... },

  // Add your custom configurations here
  {
    city: 'Минск',
    categories: ['restaurant'],
    cuisines: ['italian'],
    price_range: '$$',
    nameIndex: 25, // Index into ESTABLISHMENT_NAMES
    descriptionLength: 'medium',
    workingHoursPattern: 'restaurant',
    photoCount: 'normal',
    attributes: { wifi: true, parking: true },
    status: 'active',
  },
];
```

### Adjusting Distribution

**Geographic:**
- Modify city values in configs
- Ensure cities match schema CHECK constraint: `('Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилев', 'Бобруйск')`

**Categories:**
- Change `categories` array (max 2 items)
- Valid values defined in `CATEGORIES` constant

**Cuisines:**
- Change `cuisines` array (max 3 items)
- Valid values defined in `CUISINES` constant

**Price Range:**
- Values: `'$'`, `'$$'`, `'$$$'`
- Target distribution: ~30% / ~50% / ~20%

### Adding Custom Names

**File:** `backend/scripts/seed-data/content-templates.js`

**Current:** 75 predefined names in `ESTABLISHMENT_NAMES` array

**Modify:**
```javascript
export const ESTABLISHMENT_NAMES = [
  'Старый Город',
  'Coffee Room',
  // Add your custom names here
  'Ваше новое название',
  'Another Custom Name',
  ...
];
```

**Reference:** Use `nameIndex` in config to select name from array

### Adjusting Photo Counts

**File:** `backend/scripts/seed-data/establishments-config.js`

**Modify:** `generatePhotoCount()` function

```javascript
export function generatePhotoCount(photoCount = 'normal') {
  const configs = {
    minimal: { interiors: 1, menus: 1 },
    normal: {
      interiors: Math.floor(Math.random() * 4) + 2, // 2-5
      menus: Math.floor(Math.random() * 3) + 1, // 1-3
    },
    rich: {
      interiors: Math.floor(Math.random() * 6) + 8, // 8-13
      menus: Math.floor(Math.random() * 5) + 5, // 5-9
    },
    maximum: { interiors: 20, menus: 20 },
  };

  return configs[photoCount] || configs.normal;
}
```

### Customizing Text Generation

**File:** `backend/scripts/seed-data/content-templates.js`

**Modify:** Template arrays for descriptions

```javascript
const ADJECTIVES = [
  'уютное',
  'современное',
  // Add your custom adjectives
];

const CUISINE_DESCRIPTIONS = [
  'разнообразное меню европейской кухни',
  // Add your custom cuisine descriptions
];
```

---

## Troubleshooting

### Common Issues

#### 1. Insufficient Seed Images Error

**Error:**
```
Insufficient seed images. Ensure backend/scripts/seed-images/ contains interiors/ and menus/ subdirectories with images.
```

**Solution:**
- Verify `backend/scripts/seed-images/interiors/` contains at least 1 image
- Verify `backend/scripts/seed-images/menus/` contains at least 1 image
- Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`

#### 2. Cloudinary Upload Failures

**Error:**
```
⚠️  Failed to upload interior photo 1: Cloudinary upload failed: ...
```

**Causes:**
- Invalid Cloudinary credentials
- Network connectivity issues
- Cloudinary quota exceeded

**Solutions:**
- Verify environment variables: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- Check Cloudinary dashboard for quota limits
- Test Cloudinary connection manually

**Note:** Script uses graceful degradation - individual upload failures logged but don't block entire seed process

#### 3. Database Connection Errors

**Error:**
```
❌ Seed process failed: Connection refused
```

**Solutions:**
- Verify PostgreSQL running: `pg_ctl status`
- Check environment variables: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- Test connection: `psql -h localhost -U postgres -d restaurant_guide_belarus`

#### 4. Schema Mismatch Errors

**Error:**
```
column "categories" of relation "establishments" does not exist
```

**Cause:** Database schema not v2.0

**Solution:**
- Apply schema migration: `docs/02_architecture/database_schema_v2.0.sql`
- Verify schema version with: `SELECT * FROM establishments LIMIT 1;`

#### 5. Transaction Rollback

**Behavior:** Script rolls back entire transaction on catastrophic error

**Recovery:**
1. Check error message in stack trace
2. Fix underlying issue (database schema, Cloudinary credentials, etc.)
3. Re-run script with `--clean` flag

---

## Validation Queries

### Verify Seed Data Quality

```sql
-- Total establishments count
SELECT COUNT(*) as total FROM establishments;
-- Expected: 75

-- Geographic distribution
SELECT city, COUNT(*) as count
FROM establishments
GROUP BY city
ORDER BY count DESC;
-- Expected: Минск=35, others=7 each

-- Category coverage
SELECT unnest(categories) as category, COUNT(*) as count
FROM establishments
GROUP BY category
ORDER BY count DESC;
-- Expected: All 13 categories present

-- Cuisine coverage
SELECT unnest(cuisines) as cuisine, COUNT(*) as count
FROM establishments
GROUP BY cuisine
ORDER BY count DESC;
-- Expected: All 10 cuisines present

-- Price range distribution
SELECT price_range, COUNT(*) as count
FROM establishments
WHERE price_range IS NOT NULL
GROUP BY price_range
ORDER BY price_range;
-- Expected: ~23 '$', ~38 '$$', ~14 '$$$'

-- Edge cases verification
SELECT name, city, status,
       (SELECT COUNT(*) FROM establishment_media WHERE establishment_id = establishments.id) as photo_count,
       array_length(categories, 1) as category_count
FROM establishments
WHERE LENGTH(name) > 50
   OR status = 'suspended'
   OR array_length(categories, 1) = 2
ORDER BY name;
-- Expected: 7 edge case establishments

-- Media records
SELECT COUNT(*) as total FROM establishment_media;
-- Expected: ~350 (varies based on randomization)

-- Cloudinary URL sample
SELECT url, thumbnail_url, preview_url
FROM establishment_media
LIMIT 3;
-- Expected: Valid res.cloudinary.com URLs
```

### Identify Seed Partner

```sql
-- Find seed partner account
SELECT id, email, name, role
FROM users
WHERE email = 'seed.data.generator@restaurantguide.by';

-- Count establishments owned by seed partner
SELECT COUNT(*) as seed_count
FROM establishments
WHERE partner_id = (
  SELECT id FROM users WHERE email = 'seed.data.generator@restaurantguide.by'
);
```

### Clean Seed Data Manually

```sql
-- Delete seed establishments (cascade deletes media)
DELETE FROM establishments
WHERE partner_id = (
  SELECT id FROM users WHERE email = 'seed.data.generator@restaurantguide.by'
);

-- Optional: Delete seed partner account
DELETE FROM users
WHERE email = 'seed.data.generator@restaurantguide.by';
```

---

## Integration with Mobile Development

### Flutter Mobile Team Usage

1. **Initial Setup:** Run seed script once to populate test database
   ```bash
   node backend/scripts/seed-establishments.js --clean
   ```

2. **API Endpoint Testing:** Use seeded data to test:
   - GET /api/v1/establishments (list with filters)
   - GET /api/v1/establishments/:id (detail view)
   - Filter combinations (category, cuisine, price range, city)
   - Search functionality
   - Radius-based queries

3. **Edge Case Testing:** Target specific establishments for UI validation:
   ```dart
   // Example: Test maximum photos gallery
   final edgeCase1 = await api.getEstablishment(
     where: 'name LIKE "%Семейный ресторан европейской%"'
   );
   ```

4. **Photo Gallery Testing:** Verify three-tier resolution loading:
   - Thumbnail: 200x150 (list views)
   - Preview: 800x600 (detail screens)
   - Original: 1920x1080 (full-screen viewing)

5. **Refresh Data:** Re-run with `--clean` flag to reset to known state
   ```bash
   node backend/scripts/seed-establishments.js --clean
   ```

### Continuous Integration

**Recommended:** Include seed script in CI pipeline for automated testing environments

```yaml
# .github/workflows/ci.yml example
- name: Seed test database
  run: node backend/scripts/seed-establishments.js --clean
  env:
    DB_HOST: localhost
    DB_NAME: test_database
    CLOUDINARY_CLOUD_NAME: ${{ secrets.CLOUDINARY_CLOUD_NAME }}
```

---

## Performance Characteristics

### Execution Time

- **Database operations:** ~2-3 seconds for 75 establishments
- **Cloudinary uploads:** ~5-10 minutes for ~350 images (network dependent)
- **Total duration:** ~6-12 minutes for complete seed process

### Optimization Opportunities

**Current Implementation:**
- Sequential Cloudinary uploads (safe, predictable)

**Potential Optimization:**
- Parallel Cloudinary uploads with Promise.all() (10x faster)
- Trade-off: More complex error handling, potential rate limiting

### Resource Usage

- **Database:** Minimal impact (<1MB data, ~425 records)
- **Cloudinary:** ~350 images × 3 resolutions = ~1050 stored transformations
- **Network:** ~350 upload requests (size varies by image)

---

## Reviews & Users Seed (v2.1)

### Overview

Completes the seed ecosystem by adding the human activity layer — reviews and users
that make the platform feel alive. Creates 12 seed users and 150-250 reviews with
partner responses across the 75 seed establishments.

### Quick Start

```bash
# Seed reviews (requires seed establishments to exist)
npm run seed:reviews

# Clear seed reviews and users only
npm run clear:reviews

# Full database reset (establishments + reviews)
npm run db:reset
```

### npm Scripts

| Command | Action |
|---------|--------|
| `npm run seed:reviews` | Create seed users + reviews |
| `npm run clear:reviews` | Remove seed reviews + users |
| `npm run db:reset` | Full cycle: clear all → seed establishments → seed reviews |

### Seed Users (12 accounts)

All seed users share password `SeedUser2026!` and email pattern `seed.user.N@restaurantguide.by`.

| # | Name | Email |
|---|------|-------|
| 1 | Анна Петрова | seed.user.1@restaurantguide.by |
| 2 | Дмитрий Козлов | seed.user.2@restaurantguide.by |
| 3 | Елена Новикова | seed.user.3@restaurantguide.by |
| 4 | Сергей Морозов | seed.user.4@restaurantguide.by |
| 5 | Ольга Васильева | seed.user.5@restaurantguide.by |
| 6 | Александр Лукашевич | seed.user.6@restaurantguide.by |
| 7 | Наталья Соколова | seed.user.7@restaurantguide.by |
| 8 | Иван Жуковский | seed.user.8@restaurantguide.by |
| 9 | Мария Карпович | seed.user.9@restaurantguide.by |
| 10 | Павел Шевченко | seed.user.10@restaurantguide.by |
| 11 | Татьяна Борисенко | seed.user.11@restaurantguide.by |
| 12 | Андрей Климович | seed.user.12@restaurantguide.by |

### Review Distribution

- **Rating skew:** 5★ (25%), 4★ (35%), 3★ (20%), 2★ (12%), 1★ (8%)
- **Minsk restaurants/cafes:** 5-10 reviews each
- **Minsk bars/entertainment:** 2-7 reviews each
- **Regional dining:** 1-5 reviews each
- **Regional other:** 0-3 reviews each
- **Partner responses:** ~25% of reviews
- **Date spread:** last 90 days, 8:00-22:00

### Review Content

Templates organized by category group and rating tier:

| Group | Categories | Positive | Neutral | Negative |
|-------|-----------|----------|---------|----------|
| dining | restaurant, cafe | 15 | 8 | 5 |
| drinks | bar, pub | 8 | 4 | 3 |
| quick | fast_food, pizzeria, canteen | 8 | 4 | 3 |
| bakery | bakery | 6 | 3 | 2 |
| entertainment | hookah, bowling, karaoke, billiards, nightclub | 8 | 4 | 3 |

### Idempotency

Script is safe to run multiple times:
1. Checks for existing seed users (reuses if found)
2. Deletes existing reviews by seed users
3. Creates fresh reviews with deterministic PRNG
4. Recalculates all establishment aggregates

### Aggregate Recalculation

After seeding, `average_rating` and `review_count` on establishments are recalculated
from actual reviews. Replaces any fake random values set by `seed-establishments-placeholder.js`.

---

## Future Enhancements

### Potential Improvements

1. ~~**Review Generation:** Add realistic reviews with varied ratings~~ ✅ Implemented (v2.1)
2. **Subscription Tiers:** Include basic/standard/premium tier establishments
3. **Special Hours:** Implement breakfast/lunch special hours for some establishments
4. **Favorites Simulation:** Pre-populate favorites for test users
5. **Analytics Data:** Generate historical view counts and trends
6. **Promotions:** Create active promotions for testing promotion display
7. **Programmatic Images:** If seed-images/ empty, generate placeholder images programmatically

### Extensibility Points

- **Custom Generators:** Add new generator functions in `content-templates.js` or `reviews-config.js`
- **Category Expansion:** Extend categories as schema evolves
- **Cuisine Additions:** Add new cuisine types maintaining distribution
- **Multi-Language:** Add English/other language content generation
- **Review Templates:** Add more templates in `reviews-config.js` for less repetition

---

## Project Context

**Methodology:** Distributed Intelligence v8.0
**Session Type:** Autonomous implementation with coordinator oversight
**Development Team:** Claude Code Extension (implementation), Всеволод (coordination)

**Related Documentation:**
- `docs/02_architecture/database_schema_v2.0.sql` - Schema definition
- `docs/02_architecture/api_specification_v2.0.yaml` - API contracts
- `backend/README.md` - Backend architecture overview

**Version History:**
- **v1.0 (October 2025):** Initial seed script for 30 Minsk establishments
- **v2.0 (November 2025):** Complete rewrite for schema v2.0, 75 establishments across 7 cities, Cloudinary integration, edge cases
- **v2.1 (February 2026):** Added seed-reviews.js + clear-reviews.js — 12 seed users, 150-250 reviews, partner responses, aggregate recalculation

---

## Support & Feedback

**Issues:** Report bugs or suggestions via project issue tracker
**Questions:** Contact development team coordinator
**Contributions:** Follow distributed intelligence methodology for enhancements

---

**Last Updated:** February 26, 2026
**Script Version:** 2.1
**Maintained By:** Restaurant Guide Belarus Development Team
