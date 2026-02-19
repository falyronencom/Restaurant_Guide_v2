import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/partner_registration.dart';

/// Working Hours Selection Screen
/// Allows user to set working hours for each day of the week
/// Based on Figma design: Working Hours frame
class WorkingHoursScreen extends StatefulWidget {
  final WeeklyWorkingHours initialHours;

  const WorkingHoursScreen({
    super.key,
    required this.initialHours,
  });

  @override
  State<WorkingHoursScreen> createState() => _WorkingHoursScreenState();
}

class _WorkingHoursScreenState extends State<WorkingHoursScreen> {
  late WeeklyWorkingHours _hours;

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _lightOrange = AppTheme.primaryOrangeLight;
  static const Color _greyStroke = AppTheme.strokeGrey;
  static const Color _greyText = Color(0xFF9D9D9D);

  @override
  void initState() {
    super.initState();
    _hours = widget.initialHours;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            // Header
            _buildHeader(context),

            // Content
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 8),

                    // Section header
                    _buildSectionHeader(),

                    const SizedBox(height: 24),

                    // Days list
                    ...List.generate(7, (index) => _buildDayCard(index)),

                    const SizedBox(height: 100),
                  ],
                ),
              ),
            ),

            // Bottom navigation
            _buildBottomNavigation(context),
          ],
        ),
      ),
    );
  }

  /// Build header with back button and title
  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: const Icon(
              Icons.chevron_left,
              size: 28,
              color: AppTheme.textPrimary,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            'Ваше заведение',
            style: TextStyle(
              fontFamily: AppTheme.fontDisplayFamily,
              fontSize: 25,
              fontWeight: FontWeight.w400,
              color: _primaryOrange,
            ),
          ),
        ],
      ),
    );
  }

  /// Build section header
  Widget _buildSectionHeader() {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Время работы',
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w500,
            color: AppTheme.textPrimary,
          ),
        ),
        SizedBox(height: 4),
        Text(
          'Введите время открытия и закрытия заведения в разные дни',
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w400,
            color: AppTheme.textPrimary,
          ),
        ),
        SizedBox(height: 8),
        Divider(color: _greyStroke, height: 1),
      ],
    );
  }

  /// Build card for a single day
  Widget _buildDayCard(int dayIndex) {
    final dayHours = _hours.getDay(dayIndex);
    final dayName = DayNames.days[dayIndex];

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Day name and toggle
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                dayName,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w500,
                  color: AppTheme.textPrimary,
                ),
              ),
              Row(
                children: [
                  Text(
                    dayHours.isOpen ? 'Работаем' : 'Не работаем',
                    style: TextStyle(
                      fontSize: 15,
                      color: dayHours.isOpen ? _primaryOrange : _greyText,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Switch(
                    value: dayHours.isOpen,
                    onChanged: (value) => _toggleDay(dayIndex, value),
                    activeThumbColor: Colors.white,
                    activeTrackColor: _lightOrange,
                    inactiveThumbColor: Colors.white,
                    inactiveTrackColor: _greyStroke,
                  ),
                ],
              ),
            ],
          ),

          // Time pickers (only if day is open)
          if (dayHours.isOpen) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                // Open time
                Expanded(
                  child: _buildTimePicker(
                    label: 'Открытие',
                    time: dayHours.openTime ?? '09:00',
                    onTap: () => _selectTime(dayIndex, true),
                  ),
                ),
                const SizedBox(width: 16),
                // Close time
                Expanded(
                  child: _buildTimePicker(
                    label: 'Закрытие',
                    time: dayHours.closeTime ?? '22:00',
                    onTap: () => _selectTime(dayIndex, false),
                  ),
                ),
              ],
            ),
          ] else ...[
            const SizedBox(height: 8),
            const Text(
              'Закрыто',
              style: TextStyle(
                fontSize: 15,
                color: _greyText,
              ),
            ),
          ],

          const SizedBox(height: 12),
          const Divider(color: _greyStroke, height: 1),
        ],
      ),
    );
  }

  /// Build time picker button
  Widget _buildTimePicker({
    required String label,
    required String time,
    required VoidCallback onTap,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 13,
            color: _greyText,
          ),
        ),
        const SizedBox(height: 4),
        GestureDetector(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: AppTheme.backgroundPrimary,
              borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
              border: Border.all(color: _greyStroke),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  time,
                  style: const TextStyle(
                    fontSize: 15,
                    color: AppTheme.textPrimary,
                  ),
                ),
                const Icon(
                  Icons.access_time,
                  size: 20,
                  color: _greyText,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// Build bottom navigation
  Widget _buildBottomNavigation(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Colors.white.withValues(alpha: 0),
            AppTheme.primaryOrange.withValues(alpha: 0.15),
          ],
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Back button
          GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: Container(
              height: 42,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                border: Border.all(color: _greyStroke),
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.chevron_left, size: 25, color: _greyStroke),
                  SizedBox(width: 4),
                  Text(
                    'Назад',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: _greyStroke,
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Save button
          GestureDetector(
            onTap: () => _saveAndReturn(context),
            child: Container(
              height: 42,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: AppTheme.textPrimary,
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Сохранить',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                      color: _backgroundColor,
                    ),
                  ),
                  SizedBox(width: 4),
                  Icon(Icons.check, size: 25, color: _backgroundColor),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Toggle day open/closed
  void _toggleDay(int dayIndex, bool isOpen) {
    final currentDay = _hours.getDay(dayIndex);
    final updatedDay = currentDay.copyWith(
      isOpen: isOpen,
      openTime: isOpen ? (currentDay.openTime ?? '09:00') : null,
      closeTime: isOpen ? (currentDay.closeTime ?? '22:00') : null,
    );

    setState(() {
      _hours = _hours.updateDay(dayIndex, updatedDay);
    });
  }

  /// Select time using time picker
  Future<void> _selectTime(int dayIndex, bool isOpenTime) async {
    final currentDay = _hours.getDay(dayIndex);
    final currentTimeStr =
        isOpenTime ? currentDay.openTime : currentDay.closeTime;
    final parts = (currentTimeStr ?? '09:00').split(':');
    final initialTime = TimeOfDay(
      hour: int.parse(parts[0]),
      minute: int.parse(parts[1]),
    );

    final TimeOfDay? picked = await showTimePicker(
      context: context,
      initialTime: initialTime,
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: _primaryOrange,
              onPrimary: AppTheme.textOnPrimary,
              surface: _backgroundColor,
              onSurface: AppTheme.textPrimary,
            ),
          ),
          child: child!,
        );
      },
    );

    if (picked != null) {
      final timeStr =
          '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';

      final updatedDay = isOpenTime
          ? currentDay.copyWith(openTime: timeStr)
          : currentDay.copyWith(closeTime: timeStr);

      setState(() {
        _hours = _hours.updateDay(dayIndex, updatedDay);
      });
    }
  }

  /// Save and return to previous screen
  void _saveAndReturn(BuildContext context) {
    Navigator.of(context).pop(_hours);
  }
}