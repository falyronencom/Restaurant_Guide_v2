# Partner Analytics Enhancement — Segments A+B Report

**Date:** March 22, 2026
**Type:** Feature Implementation (Mode C — Discovery + Implementation in single session)
**Context used:** 15% of 1M (153.6k tokens)

## Discovery Phase

Full Librarian investigation (8 questions + 4 peripheral scan) via subagent:
- Confirmed `establishment_analytics` is a ghost table (schema exists, no backend writes)
- Confirmed view tracking is cumulative-only (no per-day data)
- Confirmed phone number is not tappable (no `tel:` URI, no call tracking)
- Confirmed mobile statistics screen has cosmetic-only period selector
- Mapped admin analytics patterns for reuse (parsePeriod, fillDateGaps, etc.)

**Directive Coherence Check (new methodology):** Analyzed directive before execution, found Mission mentions "views, favorites, calls" but no Q covered call tracking. Added Q8, expanded search scopes. This step is now a candidate for Protocol Informed v1.5.

## Segment A (Backend)

### Migration
- `017_activate_partner_analytics.sql`: ADD COLUMN call_count, composite index (establishment_id, date)
- Deployed to Railway production via psql proxy

### Event Tracking (dual-write)
- `establishmentModel.js:656` — view increment now also UPSERTs into establishment_analytics
- `favoriteService.js` — trackFavorite(+1/-1) on add/remove (fire-and-forget)
- `POST /establishments/:id/track-call` — new public endpoint

### Partner Analytics Endpoints
| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /partner/analytics/overview?period=30d` | partner | Per-establishment metrics with change% |
| `GET /partner/analytics/trends?establishment_id=X&period=30d` | partner | Gap-filled time-series |
| `GET /partner/analytics/ratings?establishment_id=X` | partner | Rating distribution 1-5 |

Reuses `parsePeriod`, `fillDateGaps`, `getAggregationType`, `computeChangePercent` from analyticsService.js.

### New Files
- `backend/src/models/partnerAnalyticsModel.js` — UPSERT tracking + analytics SQL queries
- `backend/src/services/partnerAnalyticsService.js` — orchestration with ownership verification
- `backend/src/controllers/partnerAnalyticsController.js` — thin HTTP layer
- `backend/src/routes/v1/partnerAnalyticsRoutes.js` — partner auth + 3 routes

### Tests
- `partnerAnalyticsModel.test.js` — 18 unit tests (UPSERT, queries, ownership, error handling)
- `partnerAnalyticsService.test.js` — 9 unit tests (orchestration, auth scoping, edge cases)
- All 27 new + 869 existing tests passing

## Segment B (Mobile)

### API Integration
- `partner_service.dart` — 4 new methods: getAnalyticsOverview, getAnalyticsTrends, getAnalyticsRatings, trackCall
- Fire-and-forget pattern for call tracking via `.ignore()`

### State Management
- `partner_dashboard_provider.dart` — new state: analyticsOverview, analyticsTrends, analyticsPeriod, isLoadingAnalytics
- `fetchAnalytics(establishmentId, period)` — loads overview + trends

### UI Changes
- `partner_statistics_screen.dart` — full rewrite:
  - Period selector triggers real API calls (7d/30d/90d)
  - fl_chart bar chart replaces "Детализация по дням скоро будет доступна"
  - Change% badges next to metrics
  - "Взаимодействия" group replaced with single "Звонки" row (no duplication)
  - X-axis: all labels for <=7 days, data-aware thinning for longer periods
- `detail_screen.dart` — phone number tappable (tel: URI + POST /track-call)

### New Files
- `mobile/lib/models/partner_analytics.dart` — EstablishmentOverview, AnalyticsTrends, TrendPoint, AnalyticsRatings

### Dependencies
- `fl_chart: ^0.69.2` added to pubspec.yaml

## Post-Deploy Testing

Verified on emulator with production data (Test Push establishment):
- Analytics table has 1 row (date of deploy) with 2 views — matches UI
- All cumulative counters match (28 views, 1 favorite, 1 review, 5.0 rating)
- Chart correctly shows single bar on deploy date
- 0% change percentages expected (no comparison data yet)

## UI Fixes After Testing
1. X-axis labels: show all for <=7 days, ensure labels on bars with data
2. Removed "Взаимодействия" wrapper — "Звонки" shown directly (was duplicating)

## Commit
- `8434778` feat: partner analytics — activate ghost table, time-series endpoints, mobile charts
