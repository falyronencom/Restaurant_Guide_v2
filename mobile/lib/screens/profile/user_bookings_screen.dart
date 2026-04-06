import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/booking.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';

/// User's bookings screen — active and history.
class UserBookingsScreen extends StatefulWidget {
  const UserBookingsScreen({super.key});

  @override
  State<UserBookingsScreen> createState() => _UserBookingsScreenState();
}

class _UserBookingsScreenState extends State<UserBookingsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<BookingProvider>().loadUserBookings();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundWarm,
      appBar: AppBar(
        title: const Text('Мои бронирования'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0,
      ),
      body: Consumer<BookingProvider>(
        builder: (context, provider, _) {
          if (provider.isLoading && provider.userBookings.isEmpty) {
            return const Center(child: CircularProgressIndicator());
          }

          final active = provider.userActiveBookings;
          final history = provider.userHistoryBookings;

          if (active.isEmpty && history.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.calendar_today, size: 48, color: AppTheme.gray400),
                  const SizedBox(height: 16),
                  Text(
                    'У вас пока нет бронирований',
                    style: TextStyle(fontSize: 16, color: AppTheme.gray600),
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => provider.loadUserBookings(),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (active.isNotEmpty) ...[
                  const Text(
                    'Активные',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 12),
                  ...active.map((b) => _buildActiveCard(b)),
                  const SizedBox(height: 24),
                ],
                if (history.isNotEmpty) ...[
                  const Text(
                    'История',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 12),
                  ...history.map((b) => _buildHistoryCard(b)),
                ],
                const SizedBox(height: 34),
              ],
            ),
          );
        },
      ),
    );
  }

  // =========================================================================
  // Active booking cards
  // =========================================================================

  Widget _buildActiveCard(Booking booking) {
    final isPending = booking.isPending;
    final statusColor = isPending
        ? const Color(0xFFFFC107) // yellow
        : AppTheme.successGreen; // green

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        border: Border.all(color: statusColor.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header: name + status
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  booking.establishmentName ?? 'Заведение',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              _buildStatusBadge(booking.statusLabel, statusColor),
            ],
          ),
          const SizedBox(height: 12),

          // Details
          _buildDetailRow(Icons.calendar_today, booking.formattedDate),
          const SizedBox(height: 6),
          _buildDetailRow(Icons.access_time, booking.formattedTime),
          const SizedBox(height: 6),
          _buildDetailRow(Icons.people, '${booking.guestCount} гост.'),

          const SizedBox(height: 12),

          // Status-specific content
          if (isPending) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF8E1),
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
              ),
              child: const Text(
                'Ожидает подтверждения. Заведение ответит в ближайшее время.',
                style: TextStyle(fontSize: 13),
              ),
            ),
          ] else ...[
            // Confirmed
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.successGreen.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
              ),
              child: Text(
                'Бронь подтверждена! Вас ждут: ${booking.formattedDate}, ${booking.formattedTime}, ${booking.guestCount} гост.',
                style: const TextStyle(fontSize: 13),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: () => _cancelBooking(booking),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTheme.errorRed,
                  side: const BorderSide(color: AppTheme.errorRed),
                  shape: RoundedRectangleBorder(
                    borderRadius:
                        BorderRadius.circular(AppTheme.radiusSmall),
                  ),
                ),
                child: const Text('Отменить бронь'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  // =========================================================================
  // History booking cards
  // =========================================================================

  Widget _buildHistoryCard(Booking booking) {
    Color statusColor;
    switch (booking.status) {
      case 'completed':
        statusColor = AppTheme.successGreen;
      case 'declined':
        statusColor = AppTheme.errorRed;
      case 'cancelled':
      case 'expired':
      case 'no_show':
      default:
        statusColor = AppTheme.gray500;
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  booking.establishmentName ?? 'Заведение',
                  style: const TextStyle(fontSize: 15),
                ),
              ),
              _buildStatusBadge(booking.statusLabel, statusColor),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '${booking.formattedDate} • ${booking.formattedTime} • ${booking.guestCount} гост.',
            style: TextStyle(fontSize: 13, color: AppTheme.gray500),
          ),

          // Declined — show reason + retry
          if (booking.isDeclined) ...[
            if (booking.declineReason != null) ...[
              const SizedBox(height: 8),
              Text(
                'Причина: ${booking.declineReason}',
                style: TextStyle(fontSize: 13, color: AppTheme.gray600),
              ),
            ],
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: () => _navigateToEstablishment(booking),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTheme.primaryOrange,
                  side: const BorderSide(color: AppTheme.primaryOrange),
                  shape: RoundedRectangleBorder(
                    borderRadius:
                        BorderRadius.circular(AppTheme.radiusSmall),
                  ),
                ),
                child: const Text('Выбрать другое время'),
              ),
            ),
          ],

          // Expired — retry + call
          if (booking.isExpired) ...[
            const SizedBox(height: 8),
            Text(
              'Заведение не успело ответить',
              style: TextStyle(fontSize: 13, color: AppTheme.gray600),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => _navigateToEstablishment(booking),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.primaryOrange,
                      side: const BorderSide(color: AppTheme.primaryOrange),
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(AppTheme.radiusSmall),
                      ),
                    ),
                    child: const Text('Попробовать снова'),
                  ),
                ),
                if (booking.establishmentPhone != null) ...[
                  const SizedBox(width: 12),
                  OutlinedButton(
                    onPressed: () => _callPhone(booking.establishmentPhone!),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.gray600,
                      side: BorderSide(color: AppTheme.gray400),
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(AppTheme.radiusSmall),
                      ),
                    ),
                    child: const Text('Позвонить'),
                  ),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }

  // =========================================================================
  // Shared Widgets
  // =========================================================================

  Widget _buildStatusBadge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _buildDetailRow(IconData icon, String text) {
    return Row(
      children: [
        Icon(icon, size: 16, color: AppTheme.gray500),
        const SizedBox(width: 8),
        Text(text, style: const TextStyle(fontSize: 14)),
      ],
    );
  }

  // =========================================================================
  // Actions
  // =========================================================================

  Future<void> _cancelBooking(Booking booking) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Отменить бронь?'),
        content: Text(
          '${booking.establishmentName}, ${booking.formattedDate} в ${booking.formattedTime}',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Нет'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.errorRed,
            ),
            child: const Text('Отменить'),
          ),
        ],
      ),
    );

    if (confirm == true && mounted) {
      await context.read<BookingProvider>().cancelBooking(booking.id);
    }
  }

  void _navigateToEstablishment(Booking booking) {
    Navigator.of(context, rootNavigator: true).pushNamed(
      '/establishment/${booking.establishmentId}',
    );
  }

  Future<void> _callPhone(String phone) async {
    final uri = Uri.parse('tel:$phone');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }
}
