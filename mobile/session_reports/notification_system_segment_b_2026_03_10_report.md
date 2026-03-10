# Notification System — Mobile UI + Polling (Segment B)
**Date:** March 10, 2026
**Type:** Feature implementation (Informed Directive)
**Directive:** Notification System — Mobile Client (Segment B)

## Changes Made

### Created (4 files):
- **notification_model.dart**: NotificationType enum (7 types), NotificationCategory (establishments/reviews), icon/color getters per type, fromJson factory (snake_case + camelCase), copyWith, Russian relative time formatter (pluralization: минут/минуты/минуту)
- **notification_service.dart**: Singleton service using ApiClient — getNotifications (paginated + category filter), getUnreadCount (silent on error), markAsRead, markAllAsRead
- **notification_provider.dart**: ChangeNotifier — unreadCount for badge, notifications list with pagination, category filter, Timer.periodic 30s polling (fetchUnreadCount only), optimistic markAsRead/markAllAsRead with rollback on failure, start/stop polling lifecycle
- **notification_list_screen.dart**: Full screen with AppBar ("Уведомления" + "Прочитать все" action), ChoiceChip filter row (Все/Мои заведения for partners/Мои отзывы), time-based grouping (Новые=unread, Сегодня, На этой неделе, Ранее), inline _NotificationCard widget, pull-to-refresh, scroll-based pagination, empty state, tap navigation (7 type-to-screen mappings)

### Modified (3 files):
- **main.dart**: Added NotificationProvider to MultiProvider (4th provider)
- **main_navigation.dart**: Consumer<NotificationProvider> wrapping BottomNavigationBar, red dot badge on Profile tab (Stack + Positioned), polling start in initState via addPostFrameCallback
- **profile_screen.dart**: Bell icon with unread count badge next to "Профиль" title (Row + Spacer + GestureDetector → NotificationListScreen), stopPolling() call on logout

## Key Decisions
1. **No timeago package** — manual Russian relative time formatter (~30 lines) with correct pluralization, avoids new dependency
2. **NotificationCard inline** — private widget in list screen file, not separate file (single consumer)
3. **Polling lifecycle**: startPolling in MainNavigationScreen.initState (post-auth), stopPolling on logout in profile_screen.dart alongside existing PartnerDashboardProvider.reset() and AuthProvider.logout()
4. **Navigation mapping**: approved/new_review/partner_response → EstablishmentDetailScreen, rejected/suspended → /partner/edit/:id, review_hidden/review_deleted → pop + switchToTab(4) Profile

## Verification
- `flutter analyze`: 0 errors, 0 warnings in new files (29 total issues — all pre-existing info-level)
- Commit: eaa53e1

## Notes
- Backend notification migration (add_notifications.sql) still needs to be applied on Railway before mobile can receive real data
- Settings stub "Уведомления" (profile_screen:409-422) intentionally not touched — reserved for Horizon 3 notification preferences
