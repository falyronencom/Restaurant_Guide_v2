import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/booking.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';

/// Partner bookings management screen.
/// Three sections: pending requests, confirmed, history.
class BookingsManagementScreen extends StatefulWidget {
  final String establishmentId;
  final String establishmentName;

  const BookingsManagementScreen({
    super.key,
    required this.establishmentId,
    required this.establishmentName,
  });

  @override
  State<BookingsManagementScreen> createState() =>
      _BookingsManagementScreenState();
}

class _BookingsManagementScreenState extends State<BookingsManagementScreen> {
  Timer? _expiryTimer;
  String _historyFilter = 'all';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context
          .read<BookingProvider>()
          .loadPartnerBookings(widget.establishmentId);
    });
    // Refresh countdown timers every 30 seconds
    _expiryTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) {
        if (mounted) setState(() {});
      },
    );
  }

  @override
  void dispose() {
    _expiryTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundWarm,
      appBar: AppBar(
        title: const Text('Бронирования'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0,
      ),
      body: Consumer<BookingProvider>(
        builder: (context, provider, _) {
          if (provider.isLoading && provider.pendingBookings.isEmpty) {
            return const Center(child: CircularProgressIndicator());
          }

          if (provider.error != null &&
              provider.pendingBookings.isEmpty &&
              provider.confirmedBookings.isEmpty) {
            return Center(
              child: Text(provider.error!,
                  style: TextStyle(color: AppTheme.gray600)),
            );
          }

          return RefreshIndicator(
            onRefresh: () =>
                provider.loadPartnerBookings(widget.establishmentId),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _buildPendingSection(provider),
                const SizedBox(height: 24),
                _buildConfirmedSection(provider),
                const SizedBox(height: 24),
                _buildHistorySection(provider),
                const SizedBox(height: 34),
              ],
            ),
          );
        },
      ),
    );
  }

  // =========================================================================
  // Pending Section
  // =========================================================================

  Widget _buildPendingSection(BookingProvider provider) {
    final bookings = provider.pendingBookings;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Новые запросы (${bookings.length})',
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        if (bookings.isEmpty)
          _buildEmptyCard('Нет новых запросов')
        else
          ...bookings.map((b) => _buildPendingCard(b)),
      ],
    );
  }

  Widget _buildPendingCard(Booking booking) {
    final remaining = booking.timeUntilExpiry;
    final isExpiringSoon = remaining.inMinutes <= 60 && remaining.inMinutes > 0;
    final isCritical = remaining.inMinutes <= 30 && remaining.inMinutes > 0;

    Color timerColor = AppTheme.gray600;
    if (isCritical) {
      timerColor = AppTheme.errorRed;
    } else if (isExpiringSoon) {
      timerColor = AppTheme.primaryOrange;
    }

    String timerText;
    if (remaining.isNegative) {
      timerText = 'Истекает...';
    } else if (remaining.inHours > 0) {
      timerText = '${remaining.inHours}ч ${remaining.inMinutes % 60}мин';
    } else {
      timerText = '${remaining.inMinutes}мин';
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        border: Border.all(
          color: isCritical
              ? AppTheme.errorRed.withValues(alpha: 0.3)
              : AppTheme.gray200,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header: name + timer
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  booking.userName ?? 'Гость',
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w600),
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: timerColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.schedule, size: 14, color: timerColor),
                    const SizedBox(width: 4),
                    Text(
                      timerText,
                      style: TextStyle(
                        color: timerColor,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Details
          _buildDetailRow(Icons.calendar_today, booking.bookingDate),
          const SizedBox(height: 6),
          _buildDetailRow(Icons.access_time, booking.bookingTime),
          const SizedBox(height: 6),
          _buildDetailRow(
            Icons.people,
            '${booking.guestCount} гост.',
          ),
          if (booking.comment != null && booking.comment!.isNotEmpty) ...[
            const SizedBox(height: 6),
            _buildDetailRow(Icons.comment, booking.comment!),
          ],
          const SizedBox(height: 6),
          GestureDetector(
            onTap: () => _callPhone(booking.contactPhone),
            child: _buildDetailRow(
              Icons.phone,
              booking.contactPhone,
              isLink: true,
            ),
          ),

          const SizedBox(height: 16),

          // Action buttons
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _showDeclineDialog(booking),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.errorRed,
                    side: const BorderSide(color: AppTheme.errorRed),
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(AppTheme.radiusSmall),
                    ),
                  ),
                  child: const Text('Отклонить'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: () => _confirmBooking(booking),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.successGreen,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(AppTheme.radiusSmall),
                    ),
                  ),
                  child: const Text('Подтвердить'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // =========================================================================
  // Confirmed Section
  // =========================================================================

  Widget _buildConfirmedSection(BookingProvider provider) {
    final bookings = provider.confirmedBookings;

    // Group by relative date
    final today = DateTime.now();
    final tomorrow = today.add(const Duration(days: 1));

    final todayBookings = bookings.where((b) {
      final d = DateTime.tryParse(b.bookingDate);
      return d != null &&
          d.year == today.year &&
          d.month == today.month &&
          d.day == today.day;
    }).toList();

    final tomorrowBookings = bookings.where((b) {
      final d = DateTime.tryParse(b.bookingDate);
      return d != null &&
          d.year == tomorrow.year &&
          d.month == tomorrow.month &&
          d.day == tomorrow.day;
    }).toList();

    final laterBookings = bookings.where((b) {
      final d = DateTime.tryParse(b.bookingDate);
      if (d == null) return false;
      return d.isAfter(DateTime(tomorrow.year, tomorrow.month, tomorrow.day));
    }).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Подтверждённые (${bookings.length})',
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        if (bookings.isEmpty) _buildEmptyCard('Нет подтверждённых броней'),
        if (todayBookings.isNotEmpty) ...[
          _buildDateGroupHeader('Сегодня'),
          ...todayBookings.map((b) => _buildConfirmedItem(b)),
        ],
        if (tomorrowBookings.isNotEmpty) ...[
          _buildDateGroupHeader('Завтра'),
          ...tomorrowBookings.map((b) => _buildConfirmedItem(b)),
        ],
        if (laterBookings.isNotEmpty) ...[
          _buildDateGroupHeader('Позже'),
          ...laterBookings.map((b) => _buildConfirmedItem(b)),
        ],
      ],
    );
  }

  Widget _buildDateGroupHeader(String label) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: AppTheme.gray600,
        ),
      ),
    );
  }

  Widget _buildConfirmedItem(Booking booking) {
    // Check if booking time has passed (for no-show button)
    final now = DateTime.now();
    final bookingDt = DateTime.tryParse(
        '${booking.bookingDate}T${booking.bookingTime}:00');
    final isPast = bookingDt != null && bookingDt.isBefore(now);

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: Row(
        children: [
          // Time
          Text(
            booking.bookingTime,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(width: 16),
          // Name + guest count
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  booking.userName ?? 'Гость',
                  style: const TextStyle(fontSize: 15),
                ),
                Text(
                  '${booking.guestCount} гост.',
                  style: TextStyle(fontSize: 13, color: AppTheme.gray500),
                ),
              ],
            ),
          ),
          // No-show button (only after time passed)
          if (isPast)
            TextButton(
              onPressed: () => _markNoShow(booking),
              style: TextButton.styleFrom(
                foregroundColor: AppTheme.gray600,
                textStyle: const TextStyle(fontSize: 13),
              ),
              child: const Text('Не пришёл'),
            ),
        ],
      ),
    );
  }

  // =========================================================================
  // History Section
  // =========================================================================

  Widget _buildHistorySection(BookingProvider provider) {
    var bookings = provider.historyBookings;

    if (_historyFilter != 'all') {
      bookings = bookings.where((b) => b.status == _historyFilter).toList();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'История',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        // Filter chips
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              _buildFilterChip('Все', 'all'),
              const SizedBox(width: 8),
              _buildFilterChip('Завершённые', 'completed'),
              const SizedBox(width: 8),
              _buildFilterChip('Отменённые', 'cancelled'),
              const SizedBox(width: 8),
              _buildFilterChip('Неявки', 'no_show'),
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (bookings.isEmpty)
          _buildEmptyCard('Нет записей')
        else
          ...bookings.map((b) => _buildHistoryItem(b)),
      ],
    );
  }

  Widget _buildFilterChip(String label, String value) {
    final isSelected = _historyFilter == value;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (_) => setState(() => _historyFilter = value),
      selectedColor: AppTheme.primaryOrange,
      labelStyle: TextStyle(
        color: isSelected ? Colors.white : AppTheme.gray700,
        fontSize: 13,
      ),
      backgroundColor: AppTheme.gray100,
      side: BorderSide.none,
    );
  }

  Widget _buildHistoryItem(Booking booking) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${booking.bookingDate} • ${booking.bookingTime}',
                  style: TextStyle(fontSize: 13, color: AppTheme.gray500),
                ),
                const SizedBox(height: 4),
                Text(
                  booking.userName ?? 'Гость',
                  style: const TextStyle(fontSize: 15),
                ),
              ],
            ),
          ),
          _buildStatusBadge(booking),
        ],
      ),
    );
  }

  Widget _buildStatusBadge(Booking booking) {
    Color bgColor;
    Color textColor;

    switch (booking.status) {
      case 'completed':
        bgColor = AppTheme.successGreen.withValues(alpha: 0.1);
        textColor = AppTheme.successGreen;
      case 'cancelled':
        bgColor = AppTheme.gray200;
        textColor = AppTheme.gray600;
      case 'no_show':
        bgColor = AppTheme.errorRed.withValues(alpha: 0.1);
        textColor = AppTheme.errorRed;
      case 'declined':
        bgColor = AppTheme.errorRed.withValues(alpha: 0.1);
        textColor = AppTheme.errorRed;
      case 'expired':
        bgColor = AppTheme.gray200;
        textColor = AppTheme.gray600;
      default:
        bgColor = AppTheme.gray200;
        textColor = AppTheme.gray600;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: Text(
        booking.statusLabel,
        style: TextStyle(
          color: textColor,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  // =========================================================================
  // Shared Widgets
  // =========================================================================

  Widget _buildEmptyCard(String text) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
      ),
      child: Center(
        child: Text(text, style: TextStyle(color: AppTheme.gray500)),
      ),
    );
  }

  Widget _buildDetailRow(IconData icon, String text, {bool isLink = false}) {
    return Row(
      children: [
        Icon(icon, size: 16, color: AppTheme.gray500),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: 14,
              color: isLink ? AppTheme.primaryOrange : null,
              decoration: isLink ? TextDecoration.underline : null,
            ),
          ),
        ),
      ],
    );
  }

  // =========================================================================
  // Actions
  // =========================================================================

  Future<void> _confirmBooking(Booking booking) async {
    final provider = context.read<BookingProvider>();
    await provider.confirmBooking(widget.establishmentId, booking.id);
  }

  void _showDeclineDialog(Booking booking) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Причина отклонения'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: 'Укажите причину...',
            border: OutlineInputBorder(),
          ),
          maxLines: 3,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Отмена'),
          ),
          ElevatedButton(
            onPressed: () async {
              final reason = controller.text.trim();
              if (reason.isEmpty) return;
              Navigator.pop(ctx);
              final provider = context.read<BookingProvider>();
              await provider.declineBooking(
                widget.establishmentId,
                booking.id,
                reason,
              );
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.errorRed,
            ),
            child: const Text('Отклонить'),
          ),
        ],
      ),
    ).then((_) => controller.dispose());
  }

  Future<void> _markNoShow(Booking booking) async {
    final provider = context.read<BookingProvider>();
    await provider.markNoShow(widget.establishmentId, booking.id);
  }

  Future<void> _callPhone(String phone) async {
    final uri = Uri.parse('tel:$phone');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }
}
