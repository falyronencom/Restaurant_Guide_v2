/// Booking model for reservation records.
/// Maps to backend bookings table.
class Booking {
  final String id;
  final String establishmentId;
  final String userId;
  final String bookingDate;
  final String bookingTime;
  final int guestCount;
  final String? comment;
  final String contactPhone;
  final String status;
  final String? declineReason;
  final DateTime expiresAt;
  final DateTime? confirmedAt;
  final DateTime? cancelledAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  // Display fields from API joins
  final String? userName;
  final String? userPhone;
  final String? establishmentName;
  final String? establishmentAddress;
  final String? establishmentPhone;

  const Booking({
    required this.id,
    required this.establishmentId,
    required this.userId,
    required this.bookingDate,
    required this.bookingTime,
    required this.guestCount,
    this.comment,
    required this.contactPhone,
    required this.status,
    this.declineReason,
    required this.expiresAt,
    this.confirmedAt,
    this.cancelledAt,
    required this.createdAt,
    required this.updatedAt,
    this.userName,
    this.userPhone,
    this.establishmentName,
    this.establishmentAddress,
    this.establishmentPhone,
  });

  bool get isPending => status == 'pending';
  bool get isConfirmed => status == 'confirmed';
  bool get isDeclined => status == 'declined';
  bool get isCancelled => status == 'cancelled';
  bool get isExpired => status == 'expired';
  bool get isNoShow => status == 'no_show';
  bool get isCompleted => status == 'completed';
  bool get isActive => isPending || isConfirmed;

  /// Time remaining until expiry (for pending bookings)
  Duration get timeUntilExpiry => expiresAt.difference(DateTime.now());
  bool get isExpiringSoon =>
      isPending && timeUntilExpiry.inMinutes <= 60 && timeUntilExpiry.inMinutes > 0;

  factory Booking.fromJson(Map<String, dynamic> json) {
    return Booking(
      id: (json['id'] ?? '').toString(),
      establishmentId:
          (json['establishment_id'] ?? json['establishmentId'] ?? '').toString(),
      userId: (json['user_id'] ?? json['userId'] ?? '').toString(),
      bookingDate: (json['booking_date'] ?? json['bookingDate'] ?? '').toString(),
      bookingTime: (json['booking_time'] ?? json['bookingTime'] ?? '').toString(),
      guestCount: json['guest_count'] as int? ?? json['guestCount'] as int? ?? 1,
      comment: json['comment'] as String?,
      contactPhone:
          (json['contact_phone'] ?? json['contactPhone'] ?? '').toString(),
      status: json['status'] as String? ?? 'pending',
      declineReason:
          json['decline_reason'] as String? ?? json['declineReason'] as String?,
      expiresAt: DateTime.parse(
        json['expires_at'] as String? ?? DateTime.now().toIso8601String(),
      ),
      confirmedAt: json['confirmed_at'] != null
          ? DateTime.parse(json['confirmed_at'] as String)
          : null,
      cancelledAt: json['cancelled_at'] != null
          ? DateTime.parse(json['cancelled_at'] as String)
          : null,
      createdAt: DateTime.parse(
        json['created_at'] as String? ?? DateTime.now().toIso8601String(),
      ),
      updatedAt: DateTime.parse(
        json['updated_at'] as String? ?? DateTime.now().toIso8601String(),
      ),
      userName: json['user_name'] as String?,
      userPhone: json['user_phone'] as String?,
      establishmentName: json['establishment_name'] as String?,
      establishmentAddress: json['establishment_address'] as String?,
      establishmentPhone: json['establishment_phone'] as String?,
    );
  }

  /// Russian status label
  String get statusLabel {
    switch (status) {
      case 'pending':
        return 'Ожидает';
      case 'confirmed':
        return 'Подтверждена';
      case 'declined':
        return 'Отклонена';
      case 'cancelled':
        return 'Отменена';
      case 'expired':
        return 'Истекла';
      case 'no_show':
        return 'Неявка';
      case 'completed':
        return 'Завершена';
      default:
        return status;
    }
  }
}
