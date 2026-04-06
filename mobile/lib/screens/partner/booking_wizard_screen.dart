import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/providers/booking_settings_provider.dart';

/// Three-step booking activation wizard.
/// Step 1: Basic settings (max guests)
/// Step 2: Time constraints (days ahead, min hours, timeout)
/// Step 3: Confirmation summary
class BookingWizardScreen extends StatefulWidget {
  final String establishmentId;
  final String establishmentName;

  const BookingWizardScreen({
    super.key,
    required this.establishmentId,
    required this.establishmentName,
  });

  @override
  State<BookingWizardScreen> createState() => _BookingWizardScreenState();
}

class _BookingWizardScreenState extends State<BookingWizardScreen> {
  final PageController _pageController = PageController();
  int _currentStep = 0;

  // Step 1
  int _maxGuests = 10;

  // Step 2
  int _maxDaysAhead = 7;
  int _minHoursBefore = 2;
  int _confirmationTimeout = 4;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _nextStep() {
    if (_currentStep < 2) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
      setState(() => _currentStep++);
    }
  }

  void _prevStep() {
    if (_currentStep > 0) {
      _pageController.previousPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
      setState(() => _currentStep--);
    } else {
      Navigator.of(context).pop();
    }
  }

  Future<void> _activate() async {
    final provider = context.read<BookingSettingsProvider>();
    final success = await provider.activateBooking(
      widget.establishmentId,
      {
        'max_guests_per_booking': _maxGuests,
        'max_days_ahead': _maxDaysAhead,
        'min_hours_before': _minHoursBefore,
        'confirmation_timeout_hours': _confirmationTimeout,
      },
    );

    if (success && mounted) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundWarm,
      appBar: AppBar(
        title: const Text('Подключение бронирования'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: _prevStep,
        ),
      ),
      body: Column(
        children: [
          _buildStepIndicator(),
          Expanded(
            child: PageView(
              controller: _pageController,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                _buildStep1(),
                _buildStep2(),
                _buildStep3(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStepIndicator() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      child: Row(
        children: List.generate(3, (index) {
          final isActive = index <= _currentStep;
          return Expanded(
            child: Container(
              margin: EdgeInsets.only(right: index < 2 ? 8 : 0),
              height: 4,
              decoration: BoxDecoration(
                color: isActive ? AppTheme.primaryOrange : AppTheme.gray300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          );
        }),
      ),
    );
  }

  // =========================================================================
  // Step 1: Basic Settings
  // =========================================================================

  Widget _buildStep1() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Основные настройки',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          const Text(
            'Укажите максимальное количество гостей на одну бронь',
            style: TextStyle(fontSize: 15, color: AppTheme.gray600),
          ),
          const SizedBox(height: 24),
          const Text(
            'Макс. гостей на бронь',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 12),
          _buildChipSelector(
            values: [2, 4, 6, 8, 10, 12],
            labels: ['2', '4', '6', '8', '10', '12+'],
            selected: _maxGuests,
            onSelected: (v) => setState(() => _maxGuests = v),
          ),
          const SizedBox(height: 40),
          _buildNextButton('Далее', _nextStep),
        ],
      ),
    );
  }

  // =========================================================================
  // Step 2: Time Settings
  // =========================================================================

  Widget _buildStep2() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Время бронирования',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 24),

          // Days ahead
          const Text(
            'Бронирование на',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 12),
          _buildChipSelector(
            values: [0, 1, 3, 7, 14, 30],
            labels: ['Сегодня', '+1', '+3', '+7', '+14', '+30'],
            selected: _maxDaysAhead,
            onSelected: (v) => setState(() => _maxDaysAhead = v),
          ),
          const SizedBox(height: 24),

          // Min hours before
          const Text(
            'Минимум за',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 12),
          _buildChipSelector(
            values: [1, 2, 3, 6, 12, 24],
            labels: ['1ч', '2ч', '3ч', '6ч', '12ч', '24ч'],
            selected: _minHoursBefore,
            onSelected: (v) => setState(() => _minHoursBefore = v),
          ),
          const SizedBox(height: 24),

          // Confirmation timeout
          const Text(
            'Время на подтверждение',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 12),
          _buildChipSelector(
            values: [2, 4, 6],
            labels: ['2ч', '4ч', '6ч'],
            selected: _confirmationTimeout,
            onSelected: (v) => setState(() => _confirmationTimeout = v),
          ),
          const SizedBox(height: 24),

          // Booking hours toggle
          const Text(
            'Часы бронирования',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
              border: Border.all(color: AppTheme.gray300),
            ),
            child: const Row(
              children: [
                Icon(Icons.schedule, color: AppTheme.primaryOrange, size: 20),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Совпадают с часами работы',
                    style: TextStyle(fontSize: 15),
                  ),
                ),
                Icon(Icons.check_circle,
                    color: AppTheme.successGreen, size: 20),
              ],
            ),
          ),
          const SizedBox(height: 40),
          _buildNextButton('Далее', _nextStep),
        ],
      ),
    );
  }

  // =========================================================================
  // Step 3: Confirmation
  // =========================================================================

  Widget _buildStep3() {
    return Consumer<BookingSettingsProvider>(
      builder: (context, provider, _) {
        return SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Подтверждение',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                'Проверьте настройки бронирования для «${widget.establishmentName}»',
                style: const TextStyle(fontSize: 15, color: AppTheme.gray600),
              ),
              const SizedBox(height: 24),
              _buildSummaryCard(),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppTheme.primaryOrange.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.info_outline,
                        color: AppTheme.primaryOrange, size: 20),
                    SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Вы сможете изменить настройки в любой момент',
                        style: TextStyle(fontSize: 14),
                      ),
                    ),
                  ],
                ),
              ),
              if (provider.error != null) ...[
                const SizedBox(height: 16),
                Text(
                  provider.error!,
                  style: const TextStyle(color: AppTheme.errorRed),
                ),
              ],
              const SizedBox(height: 40),
              _buildNextButton(
                provider.isLoading ? 'Подключение...' : 'Подключить',
                provider.isLoading ? null : _activate,
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildSummaryCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        border: Border.all(color: AppTheme.gray200),
      ),
      child: Column(
        children: [
          _buildSummaryRow('Макс. гостей', '$_maxGuests'),
          const Divider(height: 24),
          _buildSummaryRow(
            'Бронирование на',
            _maxDaysAhead == 0 ? 'Только сегодня' : '$_maxDaysAhead дн. вперёд',
          ),
          const Divider(height: 24),
          _buildSummaryRow('Минимум за', '$_minHoursBefore ч'),
          const Divider(height: 24),
          _buildSummaryRow('Время на подтверждение', '$_confirmationTimeout ч'),
          const Divider(height: 24),
          _buildSummaryRow('Часы бронирования', 'По расписанию'),
        ],
      ),
    );
  }

  Widget _buildSummaryRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style: const TextStyle(color: AppTheme.gray600, fontSize: 15)),
        Text(value,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
      ],
    );
  }

  // =========================================================================
  // Shared Widgets
  // =========================================================================

  Widget _buildChipSelector({
    required List<int> values,
    required List<String> labels,
    required int selected,
    required ValueChanged<int> onSelected,
  }) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: List.generate(values.length, (i) {
        final isSelected = values[i] == selected;
        return ChoiceChip(
          label: Text(labels[i]),
          selected: isSelected,
          onSelected: (_) => onSelected(values[i]),
          selectedColor: AppTheme.primaryOrange,
          labelStyle: TextStyle(
            color: isSelected ? Colors.white : AppTheme.gray700,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
          ),
          backgroundColor: AppTheme.gray100,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
          ),
          side: BorderSide.none,
        );
      }),
    );
  }

  Widget _buildNextButton(String label, VoidCallback? onPressed) {
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: ElevatedButton(
        onPressed: onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: AppTheme.primaryOrange,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          ),
          elevation: 0,
        ),
        child: Text(label, style: const TextStyle(fontSize: 17)),
      ),
    );
  }
}
