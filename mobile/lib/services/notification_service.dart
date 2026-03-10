import 'package:restaurant_guide_mobile/models/notification_model.dart';
import 'package:restaurant_guide_mobile/services/api_client.dart';

/// Service for notification API operations
/// Handles fetching notifications, unread count, and marking as read
class NotificationService {
  final ApiClient _apiClient;

  // Singleton pattern
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;

  NotificationService._internal() : _apiClient = ApiClient();

  /// Fetch paginated notifications with optional filters
  /// Returns map with 'items' (List<NotificationModel>) and 'pagination' (Map)
  Future<Map<String, dynamic>> getNotifications({
    int page = 1,
    int limit = 20,
    bool? isRead,
    String? category,
  }) async {
    try {
      final queryParams = <String, dynamic>{
        'page': page,
        'limit': limit,
      };
      if (isRead != null) queryParams['is_read'] = isRead;
      if (category != null) queryParams['category'] = category;

      final response = await _apiClient.get(
        '/api/v1/notifications',
        queryParameters: queryParams,
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final responseData = data['data'] as Map<String, dynamic>? ?? data;

        final itemsList = responseData['items'] as List<dynamic>? ?? [];
        final notifications = itemsList
            .map((json) =>
                NotificationModel.fromJson(json as Map<String, dynamic>))
            .toList();

        final pagination =
            responseData['pagination'] as Map<String, dynamic>? ?? {};

        return {
          'items': notifications,
          'pagination': pagination,
        };
      }

      throw Exception('Failed to fetch notifications');
    } catch (e) {
      rethrow;
    }
  }

  /// Get count of unread notifications (lightweight call for badge)
  Future<int> getUnreadCount() async {
    try {
      final response = await _apiClient.get(
        '/api/v1/notifications/unread-count',
      );

      if (response.statusCode == 200 && response.data is Map<String, dynamic>) {
        final data = response.data as Map<String, dynamic>;
        final responseData = data['data'] as Map<String, dynamic>? ?? data;
        return responseData['count'] as int? ?? 0;
      }

      return 0;
    } catch (e) {
      // Silently return 0 on error — badge should not break the app
      return 0;
    }
  }

  /// Mark a single notification as read
  Future<bool> markAsRead(String notificationId) async {
    try {
      final response = await _apiClient.put(
        '/api/v1/notifications/$notificationId/read',
      );

      return response.statusCode == 200;
    } catch (e) {
      rethrow;
    }
  }

  /// Mark all notifications as read
  Future<bool> markAllAsRead() async {
    try {
      final response = await _apiClient.put(
        '/api/v1/notifications/read-all',
      );

      return response.statusCode == 200;
    } catch (e) {
      rethrow;
    }
  }
}
