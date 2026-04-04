# Component 5: Reservations — Session Report
**Date:** April 4, 2026
**Mode:** C (Unified) — Discovery → Implementation in single session
**Segments:** A (Backend) + B (Mobile Partner) + C (Mobile User)

## Context Telemetry
- After Discovery: ~14%
- After Segment A: ~19%
- After Segment B: ~22% (estimated)
- Final: ~28% of 1M context

## Segment A: Backend Infrastructure

### Migration 021
- `booking_settings` table: per-establishment config (max guests, timeout, days ahead, min hours before)
- `bookings` table: 7-status lifecycle (pending → confirmed → completed/cancelled/no_show/declined/expired)
- `establishments.booking_enabled` BOOLEAN (denormalized, transactional sync)
- `establishment_analytics` +booking_request_count, +booking_confirmed_count

### Models
- `bookingSettingsModel.js`: CRUD + UPSERT with optional client parameter for transactions
- `bookingModel.js`: CRUD + lazy expiry (checks expires_at < NOW() before every read)

### Services
- `bookingSettingsService.js`: activate/deactivate use BEGIN/COMMIT transactions (getClient pattern from claiming)
- `bookingService.js`: 9 validations in createBooking (establishment active, booking enabled, guest count, date range, working hours dual format, min hours before, 2-booking limit, 1-per-establishment, required fields)

### Notifications
- 5 new types: booking_received, booking_confirmed, booking_declined, booking_expired (both user+partner), booking_cancelled
- Non-blocking helpers following establishment_claimed pattern

### Analytics
- trackBookingRequest + trackBookingConfirmed (UPSERT pattern from trackCall)

### Routes
- 4 booking settings endpoints (partner auth)
- 5 partner booking endpoints (confirm, decline, no-show, complete, list)
- 3 user booking endpoints (create, list, cancel)

### Tests
- 54 new unit tests (bookingModel: 13, bookingService: 27, bookingSettingsService: 14)
- ESM mock pattern: `jest.fn(() => Promise.resolve())` + re-mock in beforeEach after clearAllMocks

## Segment B: Mobile Partner

### Hub Refactoring
- `PromotionHubScreen` replaces direct PromotionsScreen navigation
- Two sections: Акции (active count N/3 + manage button) and Бронирование (invitation or active state)
- Single navigation change in profile_screen.dart line 443

### Wizard
- 3-step PageView: basic settings → time constraints → confirmation summary
- Chip selectors for allowed values, "Совпадают с часами работы" default for booking hours

### Management
- Pending cards with countdown timer (30-sec refresh), color transitions (default → orange <1h → red <30min)
- Confirmed grouped by relative date (Сегодня, Завтра, Позже)
- History with filter chips (Все/Завершённые/Отменённые/Неявки)

### Notification Enum
- +7 types in batch: establishmentUnsuspended, establishmentClaimed, 5 booking types
- Updated exhaustive switches: category, icon, color

## Segment C: Mobile User

### Establishment Model
- `bookingEnabled: json['booking_enabled'] == true` (follows hasPromotion pattern)

### Detail Screen
- Booking CTA "Хочу забронировать" between map and reviews (conditional on bookingEnabled)
- "Написать отзыв" adapts: secondary (outlined) when CTA present, primary (filled) when absent

### Booking Bottom Sheet
- Date selector (horizontal scroll, max_days_ahead range)
- Time slots generated from working_hours (both string and object formats via parseDayHours)
- Slots before minHoursBefore greyed out
- Guest stepper (1 to maxGuestsPerBooking)
- Phone pre-filled from user profile
- Server error extraction from DioException response

### Search Cards
- "Онлайн бронь" text below address (successGreen, 12px)

### User Bookings Screen
- Active section: pending (yellow badge) + confirmed (green badge, cancel button)
- History: declined (show reason + "Выбрать другое время"), expired ("Попробовать снова" + "Позвонить")

## Files Changed (total)

| Category | Files | Lines |
|----------|-------|-------|
| Backend (new) | 9 | ~1800 |
| Backend (modified) | 3 | ~240 |
| Mobile (new) | 9 | ~2700 |
| Mobile (modified) | 5 | ~320 |
| Migration | 1 | ~75 |
| Tests | 3 | ~800 |
| **Total** | **30** | **~5900** |

## Production Deployment
- Migration 021 applied to Railway (turntable.proxy.rlwy.net:44099)
- Tables verified: booking_settings, bookings, establishments.booking_enabled

## Lessons
- ESM mocks with `jest.unstable_mockModule`: functions returning Promises get cleared by `clearAllMocks()` — must re-set with `mockImplementation()` in beforeEach
- `||` treats 0 as falsy — use `??` for nullable defaults where 0 is valid (maxGuestsPerBooking: 0)
- booking_enabled flows through `...row` spread in searchService without any searchService changes
