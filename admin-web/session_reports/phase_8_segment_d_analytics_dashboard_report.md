# Phase 8 Segment D: Admin Panel — Analytics & Dashboard

**Date**: Февраль 13, 2026
**Protocol**: Informed v1.2 (Leaf Execution)
**Status**: Завершён

---

## Scope

Provide the admin with a data-driven overview of platform health through aggregated metrics, trend charts, and distribution visualizations. Dashboard shows at-a-glance metrics; three analytics tabs (Заведения, Пользователи, Отзывы и оценки) provide detailed breakdowns with configurable time periods.

## Backend Implementation

### New Files (3)

| File | Description |
|------|-------------|
| `backend/src/models/analyticsModel.js` | 14 SQL aggregation functions: user/establishment/review counts, timelines (GROUP BY DATE/WEEK/MONTH), distributions (role/status/city/category/rating), partner response stats, moderation stats |
| `backend/src/services/analyticsService.js` | Period parsing (7d/30d/90d/custom), auto-aggregation, date gap filling, change% calculation, 4 orchestrator functions |
| `backend/src/controllers/analyticsController.js` | 4 endpoint handlers following asyncHandler + logger pattern |

### Modified Files (1)

| File | Changes |
|------|---------|
| `backend/src/routes/v1/adminRoutes.js` | +4 routes with authenticate + authorize(['admin']) middleware |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/analytics/overview` | Dashboard metrics: users, establishments, reviews, moderation counts with change% |
| GET | `/api/v1/admin/analytics/users` | Registration timeline + role distribution |
| GET | `/api/v1/admin/analytics/establishments` | Creation timeline + status/city/category distributions |
| GET | `/api/v1/admin/analytics/reviews` | Review timeline (count + avg rating) + rating distribution + response stats |

All endpoints accept `?period=7d|30d|90d` or `?from=2026-01-01&to=2026-01-31` for custom ranges.

### Key Backend Decisions

- **No new tables**: All analytics built on existing tables (users, establishments, reviews, audit_log) via SQL aggregation
- **Auto-aggregation**: Period ≤30 days → GROUP BY DATE, 31-90 → GROUP BY week, >90 → GROUP BY month
- **Date gap filling**: Service layer fills missing dates with zero-count entries for continuous chart series
- **change_percent**: `null` when previous period count is 0 (avoids Infinity)
- **Rating distribution**: Percentages guaranteed to sum to exactly 100% (largest slice adjusted for rounding)
- **Parameterized queries**: All SQL uses $1, $2 — zero string interpolation of dates

## Frontend Implementation

### New Files (19)

| Category | File | Description |
|----------|------|-------------|
| Models | `lib/models/analytics_models.dart` | 12 data classes for all analytics responses |
| Services | `lib/services/analytics_service.dart` | Singleton API service, 4 methods |
| Widgets | `lib/widgets/analytics/period_selector.dart` | Chips: 7d/30d/90d/custom + DateRangePicker |
| Widgets | `lib/widgets/analytics/metric_card.dart` | Dashboard card with value + change% arrow |
| Widgets | `lib/widgets/analytics/timeline_chart.dart` | fl_chart LineChart with optional dual-axis |
| Widgets | `lib/widgets/analytics/distribution_chart.dart` | Donut PieChart + RatingDistributionChart |
| Widgets | `lib/widgets/analytics/bar_chart_widget.dart` | Horizontal BarChart for categories |
| Providers | `lib/providers/dashboard_provider.dart` | DashboardProvider (overview + timeline) |
| Providers | `lib/providers/establishments_analytics_provider.dart` | EstablishmentsAnalyticsProvider |
| Providers | `lib/providers/users_analytics_provider.dart` | UsersAnalyticsProvider |
| Providers | `lib/providers/reviews_analytics_provider.dart` | ReviewsAnalyticsProvider |
| Screens | `lib/screens/dashboard/dashboard_screen.dart` | 4 metric cards grid + registration timeline |
| Screens | `lib/screens/analytics/analytics_container_screen.dart` | TabBar/TabBarView container (3 tabs) |
| Screens | `lib/screens/analytics/establishments_analytics_tab.dart` | Timeline + status/city/category distributions |
| Screens | `lib/screens/analytics/users_analytics_tab.dart` | Registration timeline + role distribution |
| Screens | `lib/screens/analytics/reviews_analytics_tab.dart` | Dual-axis timeline + rating distribution + response stats |

### Modified Files (5)

| File | Changes |
|------|---------|
| `pubspec.yaml` | Added `fl_chart: ^0.69.2` |
| `lib/config/router.dart` | Added `/` → DashboardScreen, replaced PlaceholderScreen for `/settings/analytics` |
| `lib/widgets/admin_sidebar.dart` | Added "Панель управления" nav item at top |
| `lib/main.dart` | Registered 4 new providers (Dashboard, EstablishmentsAnalytics, UsersAnalytics, ReviewsAnalytics) |
| `lib/models/establishment.dart` | IDE auto-formatting (library directive, line wrapping) |

### Key Frontend Decisions

- **fl_chart ^0.69.2**: Pure-Dart chart library — no JavaScript interop, supports Line/Pie/Bar
- **Shared PeriodSelector**: Same component across Dashboard and all 3 analytics tabs
- **Empty states**: Friendly "Нет данных за выбранный период" instead of empty charts
- **Dual-axis chart**: Reviews tab shows count (line) + average rating (dashed line, scaled to same Y range)
- **Responsive layout**: Distribution charts stack vertically on narrow screens, side-by-side on >900px

## Verification

- `flutter analyze --no-pub`: 0 errors, 0 warnings (1 pre-existing info in api_client.dart)
- `flutter pub get`: fl_chart resolved successfully
- All 4 backend endpoints follow established patterns (asyncHandler, logger, { success: true, data })

## Commit

- **Hash**: 40006d8
- **Message**: `feat: implement Segment D — Analytics & Dashboard (admin panel)`
- **Stats**: 27 files changed, +3589 lines

## Notes for Future Work

- **establishment_analytics table**: Ghost table in schema, never populated. Could be used for view count time-series in future (cron job or event-driven population)
- **DAU/MAU**: Not possible with current schema — `last_login_at` is destructive (overwrites on each login). Would need login event logging for true time-series
- **Subscription analytics**: Tables exist but no backend code writes to them. Analytics will show data once subscription management is implemented
- **Performance**: Current GROUP BY queries are fine for MVP scale. At scale, consider indexes on `DATE(created_at)` or materialized views
