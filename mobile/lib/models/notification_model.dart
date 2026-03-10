import 'package:flutter/material.dart';

/// Notification type enum matching backend notification types
enum NotificationType {
  establishmentApproved,
  establishmentRejected,
  establishmentSuspended,
  newReview,
  partnerResponse,
  reviewHidden,
  reviewDeleted;

  static NotificationType fromString(String value) {
    switch (value) {
      case 'establishment_approved':
        return NotificationType.establishmentApproved;
      case 'establishment_rejected':
        return NotificationType.establishmentRejected;
      case 'establishment_suspended':
        return NotificationType.establishmentSuspended;
      case 'new_review':
        return NotificationType.newReview;
      case 'partner_response':
        return NotificationType.partnerResponse;
      case 'review_hidden':
        return NotificationType.reviewHidden;
      case 'review_deleted':
        return NotificationType.reviewDeleted;
      default:
        return NotificationType.newReview;
    }
  }
}

/// Category for filtering notifications
enum NotificationCategory {
  establishments,
  reviews;
}

/// Notification model matching backend API response
class NotificationModel {
  final String id;
  final String userId;
  final NotificationType type;
  final String title;
  final String? message;
  final String? establishmentId;
  final String? reviewId;
  final bool isRead;
  final DateTime createdAt;

  const NotificationModel({
    required this.id,
    required this.userId,
    required this.type,
    required this.title,
    this.message,
    this.establishmentId,
    this.reviewId,
    required this.isRead,
    required this.createdAt,
  });

  /// Category based on notification type (for filtering)
  NotificationCategory get category {
    switch (type) {
      case NotificationType.establishmentApproved:
      case NotificationType.establishmentRejected:
      case NotificationType.establishmentSuspended:
      case NotificationType.newReview:
        return NotificationCategory.establishments;
      case NotificationType.partnerResponse:
      case NotificationType.reviewHidden:
      case NotificationType.reviewDeleted:
        return NotificationCategory.reviews;
    }
  }

  /// Icon for notification type
  IconData get icon {
    switch (type) {
      case NotificationType.establishmentApproved:
        return Icons.check_circle;
      case NotificationType.establishmentRejected:
        return Icons.cancel;
      case NotificationType.establishmentSuspended:
        return Icons.pause_circle;
      case NotificationType.newReview:
        return Icons.star;
      case NotificationType.partnerResponse:
        return Icons.chat_bubble;
      case NotificationType.reviewHidden:
        return Icons.visibility_off;
      case NotificationType.reviewDeleted:
        return Icons.delete_outline;
    }
  }

  /// Color for notification type icon
  Color get color {
    switch (type) {
      case NotificationType.establishmentApproved:
        return const Color(0xFF4CAF50);
      case NotificationType.establishmentRejected:
        return const Color(0xFFF44336);
      case NotificationType.establishmentSuspended:
        return const Color(0xFFF06B32);
      case NotificationType.newReview:
        return const Color(0xFFFFC107);
      case NotificationType.partnerResponse:
        return const Color(0xFF2196F3);
      case NotificationType.reviewHidden:
      case NotificationType.reviewDeleted:
        return const Color(0xFF9E9E9E);
    }
  }

  /// Factory from JSON — handles both snake_case and camelCase keys
  factory NotificationModel.fromJson(Map<String, dynamic> json) {
    return NotificationModel(
      id: (json['id'] ?? json['notificationId'] ?? '').toString(),
      userId: (json['user_id'] ?? json['userId'] ?? '').toString(),
      type: NotificationType.fromString(
        json['type'] as String? ?? 'new_review',
      ),
      title: json['title'] as String? ?? '',
      message: json['message'] as String?,
      establishmentId:
          (json['establishment_id'] ?? json['establishmentId'])?.toString(),
      reviewId: (json['review_id'] ?? json['reviewId'])?.toString(),
      isRead: json['is_read'] as bool? ?? json['isRead'] as bool? ?? false,
      createdAt: DateTime.parse(
        json['created_at'] as String? ??
            json['createdAt'] as String? ??
            DateTime.now().toIso8601String(),
      ),
    );
  }

  /// Create a copy with updated read status
  NotificationModel copyWith({bool? isRead}) {
    return NotificationModel(
      id: id,
      userId: userId,
      type: type,
      title: title,
      message: message,
      establishmentId: establishmentId,
      reviewId: reviewId,
      isRead: isRead ?? this.isRead,
      createdAt: createdAt,
    );
  }
}

/// Russian relative time formatting
String formatRelativeTime(DateTime dateTime) {
  final now = DateTime.now();
  final diff = now.difference(dateTime);

  if (diff.inSeconds < 60) return 'Только что';
  if (diff.inMinutes < 60) return _pluralMinutes(diff.inMinutes);
  if (diff.inHours < 24) return _pluralHours(diff.inHours);

  // Check if yesterday
  final yesterday = DateTime(now.year, now.month, now.day - 1);
  if (dateTime.year == yesterday.year &&
      dateTime.month == yesterday.month &&
      dateTime.day == yesterday.day) {
    return 'Вчера';
  }

  if (diff.inDays < 7) return _pluralDays(diff.inDays);

  // Older: show date
  const months = [
    '', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return '${dateTime.day} ${months[dateTime.month]}';
}

String _pluralMinutes(int n) {
  final mod10 = n % 10;
  final mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return '$n минуту назад';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return '$n минуты назад';
  }
  return '$n минут назад';
}

String _pluralHours(int n) {
  final mod10 = n % 10;
  final mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return '$n час назад';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return '$n часа назад';
  }
  return '$n часов назад';
}

String _pluralDays(int n) {
  final mod10 = n % 10;
  final mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return '$n день назад';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return '$n дня назад';
  }
  return '$n дней назад';
}
