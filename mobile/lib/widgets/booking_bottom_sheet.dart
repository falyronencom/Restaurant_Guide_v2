import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/models/booking_settings.dart';
import 'package:restaurant_guide_mobile/providers/booking_settings_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';

/// Modal bottom sheet for creating a booking.
/// Fetches settings on open, generates time slots from working_hours.
class BookingBottomSheet extends StatefulWidget {
  final Establishment establishment;

  const BookingBottomSheet({super.key, required this.establishment});

  /// Show the booking bottom sheet
  static Future<bool?> show(BuildContext context, Establishment establishment) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => BookingBottomSheet(establishment: establishment),
    );
  }

  @override
  State<BookingBottomSheet> createState() => _BookingBottomSheetState();
}

class _BookingBottomSheetState extends State<BookingBottomSheet> {
  final _commentController = TextEditingController();
  final _phoneController = TextEditingController();

  DateTime _selectedDate = DateTime.now();
  String? _selectedTime;
  int _guestCount = 2;
  bool _settingsLoaded = false;
  BookingSettings? _settings;

  static const _dayKeys = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ];

  @override
  void initState() {
    super.initState();
    _loadSettings();
    // Pre-fill phone from user profile
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final user = context.read<AuthProvider>().currentUser;
      if (user?.phone != null && user!.phone!.isNotEmpty) {
        _phoneController.text = user.phone!;
      }
    });
  }

  @override
  void dispose() {
    _commentController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    final provider = context.read<BookingSettingsProvider>();
    await provider.loadSettings(widget.establishment.id);
    if (mounted) {
      setState(() {
        _settings = provider.settings;
        _settingsLoaded = true;
        // Clamp guest count to max
        if (_settings != null && _guestCount > _settings!.maxGuestsPerBooking) {
          _guestCount = _settings!.maxGuestsPerBooking;
        }
      });
    }
  }

  List<String> _generateTimeSlots() {
    if (_settings == null || widget.establishment.workingHours == null)
      return [];

    final dayIndex = (_selectedDate.weekday - 1) % 7; // 0=Mon
    final dayKey = _dayKeys[dayIndex];
    final dayHours = Establishment.parseDayHours(
      widget.establishment.workingHours![dayKey],
    );

    if (dayHours == null || dayHours['is_open'] == false) return [];

    final openStr = dayHours['open'] as String?;
    final closeStr = dayHours['close'] as String?;
    if (openStr == null || closeStr == null) return [];

    final openParts = openStr.split(':');
    final closeParts = closeStr.split(':');
    if (openParts.length != 2 || closeParts.length != 2) return [];

    final openMinutes = int.parse(openParts[0]) * 60 + int.parse(openParts[1]);
    final closeMinutes =
        int.parse(closeParts[0]) * 60 + int.parse(closeParts[1]);

    final slots = <String>[];
    for (int m = openMinutes; m <= closeMinutes - 30; m += 30) {
      final h = (m ~/ 60).toString().padLeft(2, '0');
      final min = (m % 60).toString().padLeft(2, '0');
      slots.add('$h:$min');
    }

    return slots;
  }

  bool _isSlotDisabled(String slot) {
    if (_settings == null) return true;

    final now = DateTime.now();
    final isToday = _selectedDate.year == now.year &&
        _selectedDate.month == now.month &&
        _selectedDate.day == now.day;

    if (!isToday) return false;

    final parts = slot.split(':');
    final slotTime = DateTime(
      _selectedDate.year,
      _selectedDate.month,
      _selectedDate.day,
      int.parse(parts[0]),
      int.parse(parts[1]),
    );

    final minTime = now.add(Duration(hours: _settings!.minHoursBefore));
    return slotTime.isBefore(minTime);
  }

  Future<void> _submit() async {
    if (_selectedTime == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Выберите время')),
      );
      return;
    }

    final phone = _phoneController.text.trim();
    if (phone.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Укажите телефон')),
      );
      return;
    }

    final provider = context.read<BookingProvider>();
    final dateStr =
        '${_selectedDate.year}-${_selectedDate.month.toString().padLeft(2, '0')}-${_selectedDate.day.toString().padLeft(2, '0')}';

    final success = await provider.createBooking(
      establishmentId: widget.establishment.id,
      date: dateStr,
      time: _selectedTime!,
      guestCount: _guestCount,
      comment: _commentController.text.trim(),
      contactPhone: phone,
    );

    if (success && mounted) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: _settingsLoaded ? _buildForm() : _buildLoading(),
    );
  }

  Widget _buildLoading() {
    return const SizedBox(
      height: 200,
      child: Center(child: CircularProgressIndicator()),
    );
  }

  Widget _buildForm() {
    final slots = _generateTimeSlots();
    final isClosed = slots.isEmpty && _settingsLoaded;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          Center(
            child: Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: AppTheme.gray300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Title
          const Text(
            'Бронирование столика',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            '${widget.establishment.name} • ${widget.establishment.address}',
            style: const TextStyle(fontSize: 13, color: AppTheme.gray600),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 20),

          // Date picker
          _buildLabel('Дата'),
          const SizedBox(height: 8),
          _buildDateSelector(),
          const SizedBox(height: 16),

          // Time picker
          _buildLabel('Время'),
          const SizedBox(height: 8),
          if (isClosed)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppTheme.gray100,
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
              ),
              child: const Text(
                'Заведение не работает в этот день',
                style: TextStyle(color: AppTheme.gray600),
              ),
            )
          else
            _buildTimeSelector(slots),
          const SizedBox(height: 16),

          // Guest count
          _buildLabel('Гости'),
          const SizedBox(height: 8),
          _buildGuestStepper(),
          const SizedBox(height: 16),

          // Comment
          _buildLabel('Комментарий (необязательно)'),
          const SizedBox(height: 8),
          TextField(
            controller: _commentController,
            maxLines: 2,
            decoration: InputDecoration(
              hintText: 'Детское кресло, аллергии, повод...',
              hintStyle: const TextStyle(color: AppTheme.gray400),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                borderSide: const BorderSide(color: AppTheme.gray300),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                borderSide: const BorderSide(color: AppTheme.gray300),
              ),
              contentPadding: const EdgeInsets.all(12),
            ),
          ),
          const SizedBox(height: 16),

          // Phone
          _buildLabel('Телефон'),
          const SizedBox(height: 8),
          TextField(
            controller: _phoneController,
            keyboardType: TextInputType.phone,
            decoration: InputDecoration(
              hintText: '+375 __ _______',
              hintStyle: const TextStyle(color: AppTheme.gray400),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                borderSide: const BorderSide(color: AppTheme.gray300),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                borderSide: const BorderSide(color: AppTheme.gray300),
              ),
              contentPadding: const EdgeInsets.all(12),
            ),
          ),
          const SizedBox(height: 20),

          // Error message
          Consumer<BookingProvider>(
            builder: (context, provider, _) {
              if (provider.error != null) {
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    provider.error!,
                    style:
                        const TextStyle(color: AppTheme.errorRed, fontSize: 14),
                  ),
                );
              }
              return const SizedBox.shrink();
            },
          ),

          // Submit button
          Consumer<BookingProvider>(
            builder: (context, provider, _) {
              return SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  onPressed: provider.isLoading || isClosed ? null : _submit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryOrange,
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: AppTheme.gray300,
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(AppTheme.radiusMedium),
                    ),
                    elevation: 0,
                  ),
                  child: Text(
                    provider.isLoading ? 'Отправка...' : 'Отправить запрос',
                    style: const TextStyle(fontSize: 17),
                  ),
                ),
              );
            },
          ),

          // Disclaimer
          if (_settings != null) ...[
            const SizedBox(height: 12),
            Text(
              'Заведение подтвердит бронь в течение ${_settings!.confirmationTimeoutHours} часов. '
              'Администратор может связаться с вами для уточнения.',
              style: const TextStyle(fontSize: 12, color: AppTheme.gray500),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildLabel(String text) {
    return Text(
      text,
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
    );
  }

  Widget _buildDateSelector() {
    final maxDays = _settings?.maxDaysAhead ?? 7;
    final today = DateTime.now();
    final dates = List.generate(
      maxDays + 1,
      (i) => today.add(Duration(days: i)),
    );

    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

    return SizedBox(
      height: 64,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: dates.length,
        itemBuilder: (context, index) {
          final date = dates[index];
          final isSelected = date.year == _selectedDate.year &&
              date.month == _selectedDate.month &&
              date.day == _selectedDate.day;

          String label;
          if (index == 0) {
            label = 'Сегодня';
          } else if (index == 1) {
            label = 'Завтра';
          } else {
            label = '${dayNames[date.weekday - 1]}, ${date.day}';
          }

          return GestureDetector(
            onTap: () => setState(() {
              _selectedDate = date;
              _selectedTime = null; // Reset time on date change
            }),
            child: Container(
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: isSelected ? AppTheme.primaryOrange : AppTheme.gray100,
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: isSelected ? Colors.white : AppTheme.gray700,
                    ),
                  ),
                  if (index > 1) ...[
                    const SizedBox(height: 2),
                    Text(
                      '${date.day}.${date.month.toString().padLeft(2, '0')}',
                      style: TextStyle(
                        fontSize: 11,
                        color: isSelected
                            ? Colors.white.withValues(alpha: 0.8)
                            : AppTheme.gray500,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildTimeSelector(List<String> slots) {
    if (slots.isEmpty) {
      return const Text(
        'Нет доступных слотов',
        style: TextStyle(color: AppTheme.gray500),
      );
    }

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: slots.map((slot) {
        final disabled = _isSlotDisabled(slot);
        final isSelected = slot == _selectedTime;

        return GestureDetector(
          onTap: disabled ? null : () => setState(() => _selectedTime = slot),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: isSelected
                  ? AppTheme.primaryOrange
                  : disabled
                      ? AppTheme.gray100
                      : Colors.white,
              borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
              border: Border.all(
                color: isSelected
                    ? AppTheme.primaryOrange
                    : disabled
                        ? AppTheme.gray200
                        : AppTheme.gray300,
              ),
            ),
            child: Text(
              slot,
              style: TextStyle(
                fontSize: 14,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                color: isSelected
                    ? Colors.white
                    : disabled
                        ? AppTheme.gray400
                        : AppTheme.gray700,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildGuestStepper() {
    final max = _settings?.maxGuestsPerBooking ?? 10;
    return Row(
      children: [
        _buildStepperButton(
          Icons.remove,
          _guestCount > 1 ? () => setState(() => _guestCount--) : null,
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Text(
            '$_guestCount',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
          ),
        ),
        _buildStepperButton(
          Icons.add,
          _guestCount < max ? () => setState(() => _guestCount++) : null,
        ),
      ],
    );
  }

  Widget _buildStepperButton(IconData icon, VoidCallback? onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: onTap != null ? AppTheme.gray100 : AppTheme.gray200,
          borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
        ),
        child: Icon(
          icon,
          color: onTap != null ? AppTheme.gray700 : AppTheme.gray400,
        ),
      ),
    );
  }
}
