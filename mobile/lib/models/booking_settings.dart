/// Booking settings model for partner booking configuration.
/// Maps to backend booking_settings table.
class BookingSettings {
  final String id;
  final String establishmentId;
  final bool isEnabled;
  final int maxGuestsPerBooking;
  final int confirmationTimeoutHours;
  final int maxDaysAhead;
  final int minHoursBefore;
  final DateTime createdAt;
  final DateTime updatedAt;

  const BookingSettings({
    required this.id,
    required this.establishmentId,
    required this.isEnabled,
    this.maxGuestsPerBooking = 10,
    this.confirmationTimeoutHours = 4,
    this.maxDaysAhead = 7,
    this.minHoursBefore = 2,
    required this.createdAt,
    required this.updatedAt,
  });

  factory BookingSettings.fromJson(Map<String, dynamic> json) {
    return BookingSettings(
      id: (json['id'] ?? '').toString(),
      establishmentId:
          (json['establishment_id'] ?? json['establishmentId'] ?? '').toString(),
      isEnabled: json['is_enabled'] as bool? ?? false,
      maxGuestsPerBooking:
          json['max_guests_per_booking'] as int? ?? 10,
      confirmationTimeoutHours:
          json['confirmation_timeout_hours'] as int? ?? 4,
      maxDaysAhead: json['max_days_ahead'] as int? ?? 7,
      minHoursBefore: json['min_hours_before'] as int? ?? 2,
      createdAt: DateTime.parse(
        json['created_at'] as String? ?? DateTime.now().toIso8601String(),
      ),
      updatedAt: DateTime.parse(
        json['updated_at'] as String? ?? DateTime.now().toIso8601String(),
      ),
    );
  }
}
