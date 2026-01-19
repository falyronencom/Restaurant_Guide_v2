import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';

/// Partner Statistics Screen - detailed analytics for establishment
/// Figma design: Statistics frame
/// Phase 5.2b - Partner Dashboard
class PartnerStatisticsScreen extends StatefulWidget {
  final int establishmentId;

  const PartnerStatisticsScreen({
    super.key,
    required this.establishmentId,
  });

  @override
  State<PartnerStatisticsScreen> createState() => _PartnerStatisticsScreenState();
}

class _PartnerStatisticsScreenState extends State<PartnerStatisticsScreen> {
  // Figma colors
  static const Color _backgroundColor = Color(0xFFF4F1EC);
  static const Color _primaryOrange = Color(0xFFDB4F13);
  static const Color _secondaryOrange = Color(0xFFF06B32);
  static const Color _greyText = Color(0xFFABABAB);
  static const Color _greenColor = Color(0xFF34C759);
  static const Color _redColor = Color(0xFFE83A3A);
  static const Color _navyBlue = Color(0xFF3631C0);
  static const Color _strokeGrey = Color(0xFFD6D6D6);

  // Selected period
  String _selectedPeriod = '1 неделя';
  final List<String> _periods = ['1 неделя', '1 месяц', '3 месяца', 'Всё время'];

  @override
  void initState() {
    super.initState();
    // Load establishment details
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<PartnerDashboardProvider>().loadEstablishmentDetails(widget.establishmentId);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SafeArea(
        child: Consumer<PartnerDashboardProvider>(
          builder: (context, provider, child) {
            // Find establishment from list or use selected
            final establishment = provider.selectedEstablishment ??
                provider.establishments.where((e) => e.id == widget.establishmentId).firstOrNull;

            if (provider.isLoadingDetails) {
              return const Center(
                child: CircularProgressIndicator(color: _primaryOrange),
              );
            }

            if (establishment == null) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'Заведение не найдено',
                      style: TextStyle(
                        fontFamily: 'Avenir Next',
                        fontSize: 16,
                        color: _greyText,
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text(
                        'Назад',
                        style: TextStyle(color: _primaryOrange),
                      ),
                    ),
                  ],
                ),
              );
            }

            return Column(
              children: [
                // Header
                _buildHeader(context),

                // Content
                Expanded(
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Establishment card
                        _buildEstablishmentCard(establishment),

                        const SizedBox(height: 16),

                        // Period selector
                        _buildPeriodSelector(),

                        const SizedBox(height: 8),

                        // Summary metrics row
                        _buildSummaryMetrics(establishment),

                        // Divider
                        _buildDivider(),

                        // Views section with chart
                        _buildViewsSection(establishment),

                        // Divider
                        _buildDivider(),

                        // Interactions section
                        _buildInteractionsSection(establishment),

                        // Favorites section
                        _buildStatSection(
                          title: 'Избранное',
                          value: establishment.stats.favorites,
                          trend: establishment.stats.favoritesTrend,
                          trendText: '+20% сохранений, чем за период 1 Сен – 7 Сен',
                        ),

                        // Ratings section with distribution
                        _buildRatingsSection(establishment),

                        // Reviews button
                        _buildReviewsButton(context, establishment),

                        const SizedBox(height: 120),
                      ],
                    ),
                  ),
                ),
              ],
            );
          },
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
              color: Colors.black,
            ),
          ),
          const SizedBox(width: 8),
          const Text(
            'Статистика',
            style: TextStyle(
              fontFamily: 'Unbounded',
              fontSize: 25,
              fontWeight: FontWeight.w400,
              color: _primaryOrange,
            ),
          ),
        ],
      ),
    );
  }

  /// Build establishment info card
  Widget _buildEstablishmentCard(PartnerEstablishment establishment) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: _backgroundColor,
          borderRadius: BorderRadius.circular(10),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFFD35620).withValues(alpha: 0.05),
              blurRadius: 15,
              spreadRadius: 2,
              offset: const Offset(4, 4),
            ),
            BoxShadow(
              color: const Color(0xFFD35620).withValues(alpha: 0.05),
              blurRadius: 15,
              spreadRadius: 2,
              offset: const Offset(-4, -4),
            ),
          ],
        ),
        child: Row(
          children: [
            // Image
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: establishment.primaryImageUrl != null
                  ? CachedNetworkImage(
                      imageUrl: establishment.primaryImageUrl!,
                      width: 107,
                      height: 116,
                      fit: BoxFit.cover,
                      placeholder: (context, url) => Container(
                        width: 107,
                        height: 116,
                        color: _greyText.withValues(alpha: 0.3),
                      ),
                      errorWidget: (context, url, error) => Container(
                        width: 107,
                        height: 116,
                        color: _greyText.withValues(alpha: 0.3),
                        child: const Icon(Icons.restaurant, size: 40),
                      ),
                    )
                  : Container(
                      width: 107,
                      height: 116,
                      color: _greyText.withValues(alpha: 0.3),
                      child: const Icon(Icons.restaurant, size: 40),
                    ),
            ),
            const SizedBox(width: 16),

            // Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    establishment.name,
                    style: const TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 22,
                      fontWeight: FontWeight.w500,
                      color: Colors.black,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    establishment.categoryDisplayName,
                    style: const TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 15,
                      color: Colors.black,
                    ),
                  ),
                  Text(
                    establishment.cuisineDisplayName,
                    style: const TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 13,
                      color: Color(0xFFD2D2D2),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    establishment.shortAddress,
                    style: const TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 14,
                      color: Colors.black,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Build period selector
  Widget _buildPeriodSelector() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Period dropdown
          GestureDetector(
            onTap: _showPeriodPicker,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                border: Border.all(color: _secondaryOrange),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _selectedPeriod,
                    style: const TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 15,
                      color: _secondaryOrange,
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Icon(
                    Icons.keyboard_arrow_down,
                    color: _secondaryOrange,
                    size: 18,
                  ),
                ],
              ),
            ),
          ),

          // Date range display
          Text(
            _getDateRangeText(),
            style: const TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 15,
              fontWeight: FontWeight.w500,
              color: Colors.black,
            ),
          ),
        ],
      ),
    );
  }

  /// Show period picker bottom sheet
  void _showPeriodPicker() {
    showModalBottomSheet(
      context: context,
      backgroundColor: _backgroundColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 16),
            const Text(
              'Выберите период',
              style: TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 18,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 16),
            ..._periods.map((period) => ListTile(
              title: Text(
                period,
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 16,
                  color: period == _selectedPeriod ? _primaryOrange : Colors.black,
                ),
              ),
              trailing: period == _selectedPeriod
                  ? const Icon(Icons.check, color: _primaryOrange)
                  : null,
              onTap: () {
                setState(() => _selectedPeriod = period);
                Navigator.pop(context);
              },
            )),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  /// Get date range text based on selected period
  String _getDateRangeText() {
    final now = DateTime.now();
    final months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

    switch (_selectedPeriod) {
      case '1 неделя':
        final start = now.subtract(const Duration(days: 7));
        return '${start.day.toString().padLeft(2, '0')} ${months[start.month - 1]} – ${now.day.toString().padLeft(2, '0')} ${months[now.month - 1]}';
      case '1 месяц':
        final start = DateTime(now.year, now.month - 1, now.day);
        return '${start.day.toString().padLeft(2, '0')} ${months[start.month - 1]} – ${now.day.toString().padLeft(2, '0')} ${months[now.month - 1]}';
      case '3 месяца':
        final start = DateTime(now.year, now.month - 3, now.day);
        return '${start.day.toString().padLeft(2, '0')} ${months[start.month - 1]} – ${now.day.toString().padLeft(2, '0')} ${months[now.month - 1]}';
      default:
        return 'Всё время';
    }
  }

  /// Build summary metrics row (Average rating, Ratings, Reviews)
  Widget _buildSummaryMetrics(PartnerEstablishment establishment) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Row(
        children: [
          // Average rating
          Expanded(
            child: _buildMetricItem(
              title: 'Средняя оценка',
              value: establishment.stats.averageRating?.toStringAsFixed(1).replaceAll('.', ',') ?? '-',
              trend: -0.1,
              showStar: true,
            ),
          ),

          // Ratings count
          Expanded(
            child: _buildMetricItem(
              title: 'Оценки',
              value: _formatNumber(5230), // Mock data
              trend: 22,
            ),
          ),

          // Reviews count
          Expanded(
            child: _buildMetricItem(
              title: 'Отзывы',
              value: '${establishment.stats.reviews}',
              trend: 15,
            ),
          ),
        ],
      ),
    );
  }

  /// Build single metric item
  Widget _buildMetricItem({
    required String title,
    required String value,
    double? trend,
    bool showStar = false,
  }) {
    final isPositive = trend != null && trend > 0;
    final trendColor = trend == null ? _greyText : (isPositive ? _navyBlue : _redColor);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 15,
            fontWeight: FontWeight.w500,
            color: Colors.black,
          ),
        ),
        Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          height: 1,
          color: _strokeGrey,
        ),
        Row(
          children: [
            Text(
              value,
              style: const TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 13,
                color: Colors.black,
              ),
            ),
            if (showStar) ...[
              const SizedBox(width: 4),
              const Icon(Icons.star, color: _secondaryOrange, size: 14),
            ],
            const SizedBox(width: 8),
            if (trend != null)
              Text(
                '${isPositive ? '+' : ''}${trend.toStringAsFixed(trend.truncateToDouble() == trend ? 0 : 1)}',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 13,
                  color: trendColor,
                ),
              ),
          ],
        ),
      ],
    );
  }

  /// Build divider
  Widget _buildDivider() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      height: 0.5,
      color: _strokeGrey,
    );
  }

  /// Build views section with bar chart
  Widget _buildViewsSection(PartnerEstablishment establishment) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Просмотры',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 22,
                  fontWeight: FontWeight.w500,
                  color: Colors.black,
                ),
              ),
              Text(
                _formatNumber(establishment.stats.views * 100), // Mock multiplier
                style: const TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 18,
                  fontWeight: FontWeight.w500,
                  color: Colors.black,
                ),
              ),
            ],
          ),

          const SizedBox(height: 4),

          // Trend text
          Text(
            '+ ${_formatNumber(1581)} чем за период 1 Сен – 7 Сен',
            style: const TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 13,
              color: _greyText,
            ),
          ),

          const SizedBox(height: 24),

          // Bar chart
          SizedBox(
            height: 150,
            child: _buildBarChart(),
          ),
        ],
      ),
    );
  }

  /// Build simple bar chart
  Widget _buildBarChart() {
    // Mock data for 7 days
    final data = [44, 30, 69, 74, 129, 150, 87];
    final maxValue = data.reduce((a, b) => a > b ? a : b).toDouble();
    final labels = ['8 Сен', '9 Сен', '10 Сен', '11 Сен', '12 Сен', '13 Сен', '14 Сен'];

    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        // Y-axis labels
        SizedBox(
          width: 30,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const Text('1к', style: TextStyle(fontSize: 13, color: _greyText, fontFamily: 'Avenir Next')),
              const Text('500', style: TextStyle(fontSize: 13, color: _greyText, fontFamily: 'Avenir Next')),
              const Text('100', style: TextStyle(fontSize: 13, color: _greyText, fontFamily: 'Avenir Next')),
              const Text('0', style: TextStyle(fontSize: 13, color: _greyText, fontFamily: 'Avenir Next')),
            ],
          ),
        ),
        const SizedBox(width: 8),

        // Bars
        Expanded(
          child: Column(
            children: [
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: List.generate(data.length, (index) {
                    final height = (data[index] / maxValue) * 120;
                    return Container(
                      width: 17,
                      height: height,
                      decoration: BoxDecoration(
                        color: _secondaryOrange,
                        borderRadius: BorderRadius.circular(5),
                      ),
                    );
                  }),
                ),
              ),
              const SizedBox(height: 8),
              // X-axis labels (show only some)
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  Text(labels[0], style: const TextStyle(fontSize: 13, color: Colors.black, fontFamily: 'Avenir Next')),
                  const Spacer(),
                  Text(labels[3], style: const TextStyle(fontSize: 13, color: Colors.black, fontFamily: 'Avenir Next')),
                  const Spacer(),
                  Text(labels[6], style: const TextStyle(fontSize: 13, color: Colors.black, fontFamily: 'Avenir Next')),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// Build interactions section
  Widget _buildInteractionsSection(PartnerEstablishment establishment) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Взаимодействия',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 22,
                  fontWeight: FontWeight.w500,
                  color: Colors.black,
                ),
              ),
              const Text(
                '641',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 18,
                  fontWeight: FontWeight.w500,
                  color: Colors.black,
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // Actions sub-section
          _buildSubStatRow(
            title: 'Акции',
            value: 483,
            trendText: '+100% нажатий, чем за период 1 Сен – 7 Сен',
          ),
        ],
      ),
    );
  }

  /// Build stat section
  Widget _buildStatSection({
    required String title,
    required int value,
    int? trend,
    required String trendText,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 18,
                  fontWeight: FontWeight.w500,
                  color: Colors.black,
                ),
              ),
              Text(
                '$value',
                style: const TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 15,
                  color: Colors.black,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            trendText,
            style: const TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 13,
              color: _greyText,
            ),
          ),
          const SizedBox(height: 8),
          _buildDivider(),
        ],
      ),
    );
  }

  /// Build sub stat row
  Widget _buildSubStatRow({
    required String title,
    required int value,
    required String trendText,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              title,
              style: const TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 18,
                fontWeight: FontWeight.w500,
                color: Colors.black,
              ),
            ),
            Text(
              '$value',
              style: const TextStyle(
                fontFamily: 'Avenir Next',
                fontSize: 15,
                color: Colors.black,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          trendText,
          style: const TextStyle(
            fontFamily: 'Avenir Next',
            fontSize: 13,
            color: _greyText,
          ),
        ),
        const SizedBox(height: 8),
        Container(height: 0.5, color: _strokeGrey),
      ],
    );
  }

  /// Build ratings section with star distribution
  Widget _buildRatingsSection(PartnerEstablishment establishment) {
    // Mock ratings distribution
    final ratingsDistribution = {5: 80, 4: 122, 3: 47, 2: 12, 1: 5};
    final totalRatings = ratingsDistribution.values.reduce((a, b) => a + b);

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Оценки',
                style: TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 18,
                  fontWeight: FontWeight.w500,
                  color: Colors.black,
                ),
              ),
              Text(
                '${establishment.stats.reviews}',
                style: const TextStyle(
                  fontFamily: 'Avenir Next',
                  fontSize: 15,
                  color: Colors.black,
                ),
              ),
            ],
          ),

          const SizedBox(height: 4),

          const Text(
            '+20% сохранений, чем за период 1 Сен – 7 Сен',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 13,
              color: _greyText,
            ),
          ),

          const SizedBox(height: 16),

          // Rating distribution
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Average rating badge
              Container(
                width: 55,
                height: 55,
                decoration: BoxDecoration(
                  color: _greenColor,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Center(
                  child: Text(
                    establishment.stats.averageRating?.toStringAsFixed(1).replaceAll('.', ',') ?? '-',
                    style: const TextStyle(
                      fontFamily: 'Avenir Next',
                      fontSize: 28,
                      color: _backgroundColor,
                    ),
                  ),
                ),
              ),

              const SizedBox(width: 24),

              // Star distribution bars
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Оценки: $totalRatings',
                      style: const TextStyle(
                        fontFamily: 'Avenir Next',
                        fontSize: 14,
                        color: Colors.black,
                      ),
                    ),
                    const SizedBox(height: 8),
                    ...List.generate(5, (index) {
                      final star = 5 - index;
                      final count = ratingsDistribution[star] ?? 0;
                      final percentage = totalRatings > 0 ? count / totalRatings : 0.0;

                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          children: [
                            SizedBox(
                              width: 12,
                              child: Text(
                                '$star',
                                style: const TextStyle(
                                  fontFamily: 'Avenir Next',
                                  fontSize: 18,
                                  color: Colors.black,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            const Icon(Icons.star, color: _secondaryOrange, size: 15),
                            const SizedBox(width: 8),
                            // Progress bar
                            Expanded(
                              child: Stack(
                                children: [
                                  Container(
                                    height: 4,
                                    decoration: BoxDecoration(
                                      color: _strokeGrey,
                                      borderRadius: BorderRadius.circular(2),
                                    ),
                                  ),
                                  FractionallySizedBox(
                                    widthFactor: percentage,
                                    child: Container(
                                      height: 4,
                                      decoration: BoxDecoration(
                                        color: _secondaryOrange,
                                        borderRadius: BorderRadius.circular(2),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            SizedBox(
                              width: 30,
                              child: Text(
                                '$count',
                                style: const TextStyle(
                                  fontFamily: 'Avenir Next',
                                  fontSize: 13,
                                  color: Colors.black,
                                ),
                                textAlign: TextAlign.end,
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),
          _buildDivider(),
        ],
      ),
    );
  }

  /// Build reviews button
  Widget _buildReviewsButton(BuildContext context, PartnerEstablishment establishment) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          onPressed: () {
            Navigator.of(context).pushNamed(
              '/partner/reviews',
              arguments: establishment.id,
            );
          },
          style: ElevatedButton.styleFrom(
            backgroundColor: _primaryOrange,
            foregroundColor: _backgroundColor,
            padding: const EdgeInsets.symmetric(vertical: 16),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(11),
            ),
            elevation: 0,
          ),
          child: const Text(
            'Просмотр отзывов',
            style: TextStyle(
              fontFamily: 'Avenir Next',
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }

  /// Format large numbers
  String _formatNumber(int number) {
    if (number >= 1000) {
      return '${(number / 1000).toStringAsFixed(number % 1000 == 0 ? 0 : 1)}k';
    }
    return number.toString().replaceAllMapped(
      RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
      (match) => '${match[1]} ',
    );
  }
}
