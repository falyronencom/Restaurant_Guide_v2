import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/models/partner_analytics.dart';
import 'package:restaurant_guide_mobile/providers/partner_dashboard_provider.dart';

/// Partner Statistics Screen - detailed analytics for establishment
/// Figma design: Statistics frame
/// Phase 5.2b - Partner Dashboard (enhanced with real analytics)
class PartnerStatisticsScreen extends StatefulWidget {
  final String establishmentId;

  const PartnerStatisticsScreen({
    super.key,
    required this.establishmentId,
  });

  @override
  State<PartnerStatisticsScreen> createState() =>
      _PartnerStatisticsScreenState();
}

class _PartnerStatisticsScreenState extends State<PartnerStatisticsScreen> {
  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _primaryOrange = AppTheme.primaryOrangeDark;
  static const Color _secondaryOrange = AppTheme.primaryOrange;
  static const Color _greyText = AppTheme.textGrey;
  static const Color _greenColor = AppTheme.statusGreen;
  static const Color _redColor = Color(0xFFE83A3A);
  static const Color _navyBlue = AppTheme.accentNavy;
  static const Color _strokeGrey = Color(0xFFD6D6D6);

  // Period selector — maps display label to backend period code
  static const Map<String, String> _periodMap = {
    '1 неделя': '7d',
    '1 месяц': '30d',
    '3 месяца': '90d',
  };

  String _selectedPeriod = '1 неделя';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final provider = context.read<PartnerDashboardProvider>();
      provider.loadEstablishmentDetails(widget.establishmentId);
      _loadAnalytics(provider);
    });
  }

  void _loadAnalytics(PartnerDashboardProvider provider) {
    final periodCode = _periodMap[_selectedPeriod] ?? '7d';
    provider.fetchAnalytics(widget.establishmentId, periodCode);
  }

  void _onPeriodChanged(String period) {
    setState(() => _selectedPeriod = period);
    _loadAnalytics(context.read<PartnerDashboardProvider>());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _backgroundColor,
      body: SafeArea(
        child: Consumer<PartnerDashboardProvider>(
          builder: (context, provider, child) {
            final establishment = provider.selectedEstablishment ??
                provider.establishments
                    .where((e) => e.id == widget.establishmentId)
                    .firstOrNull;

            if (provider.isLoadingDetails) {
              return const Center(
                child: CircularProgressIndicator(color: _primaryOrange),
              );
            }

            if (provider.detailsError != null && establishment == null) {
              return _buildErrorState(context, provider);
            }

            if (establishment == null) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'Заведение не найдено',
                      style: TextStyle(fontSize: 16, color: _greyText),
                    ),
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Назад', style: TextStyle(color: _primaryOrange)),
                    ),
                  ],
                ),
              );
            }

            final overview = provider.analyticsOverview;
            final trends = provider.analyticsTrends;

            return Column(
              children: [
                _buildHeader(context),
                Expanded(
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _buildEstablishmentCard(establishment),
                        const SizedBox(height: 16),
                        _buildPeriodSelector(),
                        const SizedBox(height: 8),
                        _buildSummaryMetrics(establishment, overview),
                        _buildDivider(),
                        _buildViewsSection(establishment, overview, trends),
                        _buildDivider(),
                        _buildCallsSection(overview),
                        _buildFavoritesSection(establishment, overview),
                        _buildRatingsSection(establishment),
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

  // ============================================================================
  // Header & Error
  // ============================================================================

  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: const Icon(Icons.chevron_left, size: 28, color: AppTheme.textPrimary),
          ),
          const SizedBox(width: 8),
          Text(
            'Статистика',
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

  Widget _buildErrorState(BuildContext context, PartnerDashboardProvider provider) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, size: 64, color: _greyText.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            const Text('Ошибка загрузки', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textPrimary)),
            const SizedBox(height: 8),
            const Text('Не удалось загрузить данные. Проверьте интернет-соединение.', style: TextStyle(fontSize: 14, color: _greyText), textAlign: TextAlign.center),
            const SizedBox(height: 24),
            GestureDetector(
              onTap: () => provider.loadEstablishmentDetails(widget.establishmentId),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                decoration: BoxDecoration(color: _primaryOrange, borderRadius: BorderRadius.circular(AppTheme.radiusSmall)),
                child: const Text('Повторить', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: _backgroundColor)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ============================================================================
  // Establishment Card
  // ============================================================================

  Widget _buildEstablishmentCard(PartnerEstablishment establishment) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: _backgroundColor,
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
          boxShadow: [
            BoxShadow(color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.05), blurRadius: 15, spreadRadius: 2, offset: const Offset(4, 4)),
            BoxShadow(color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.05), blurRadius: 15, spreadRadius: 2, offset: const Offset(-4, -4)),
          ],
        ),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
              child: establishment.primaryImageUrl != null
                  ? CachedNetworkImage(
                      imageUrl: establishment.primaryImageUrl!,
                      width: 107, height: 116, fit: BoxFit.cover,
                      placeholder: (context, url) => Container(width: 107, height: 116, color: _greyText.withValues(alpha: 0.3)),
                      errorWidget: (context, url, error) => Container(width: 107, height: 116, color: _greyText.withValues(alpha: 0.3), child: const Icon(Icons.restaurant, size: 40)),
                    )
                  : Container(width: 107, height: 116, color: _greyText.withValues(alpha: 0.3), child: const Icon(Icons.restaurant, size: 40)),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(establishment.name, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w500, color: AppTheme.textPrimary)),
                  const SizedBox(height: 4),
                  Text(establishment.categoryDisplayName, style: const TextStyle(fontSize: 15, color: AppTheme.textPrimary)),
                  Text(establishment.cuisineDisplayName, style: const TextStyle(fontSize: 13, color: AppTheme.strokeGrey)),
                  const SizedBox(height: 8),
                  Text(establishment.shortAddress, style: const TextStyle(fontSize: 14, color: AppTheme.textPrimary)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ============================================================================
  // Period Selector (now functional)
  // ============================================================================

  Widget _buildPeriodSelector() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          GestureDetector(
            onTap: _showPeriodPicker,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                border: Border.all(color: _secondaryOrange),
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_selectedPeriod, style: const TextStyle(fontSize: 15, color: _secondaryOrange)),
                  const SizedBox(width: 8),
                  const Icon(Icons.keyboard_arrow_down, color: _secondaryOrange, size: 18),
                ],
              ),
            ),
          ),
          Text(_getDateRangeText(), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: AppTheme.textPrimary)),
        ],
      ),
    );
  }

  void _showPeriodPicker() {
    showModalBottomSheet(
      context: context,
      backgroundColor: _backgroundColor,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 16),
            const Text('Выберите период', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500)),
            const SizedBox(height: 16),
            ..._periodMap.keys.map((period) => ListTile(
                  title: Text(period, style: TextStyle(fontSize: 16, color: period == _selectedPeriod ? _primaryOrange : AppTheme.textPrimary)),
                  trailing: period == _selectedPeriod ? const Icon(Icons.check, color: _primaryOrange) : null,
                  onTap: () {
                    Navigator.pop(context);
                    _onPeriodChanged(period);
                  },
                )),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  String _getDateRangeText() {
    final now = DateTime.now();
    final months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

    int days;
    switch (_selectedPeriod) {
      case '1 неделя': days = 7; break;
      case '1 месяц': days = 30; break;
      case '3 месяца': days = 90; break;
      default: return 'Всё время';
    }
    final start = now.subtract(Duration(days: days));
    return '${start.day.toString().padLeft(2, '0')} ${months[start.month - 1]} – ${now.day.toString().padLeft(2, '0')} ${months[now.month - 1]}';
  }

  // ============================================================================
  // Summary Metrics (with change_percent from overview)
  // ============================================================================

  Widget _buildSummaryMetrics(PartnerEstablishment establishment, EstablishmentOverview? overview) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: _buildMetricItem(
                title: 'Средняя\nоценка',
                value: establishment.stats.averageRating?.toStringAsFixed(1).replaceAll('.', ',') ?? '-',
                showStar: true,
              ),
            ),
            Expanded(
              child: _buildMetricItem(
                title: 'Оценки',
                value: _formatNumber(establishment.stats.reviews),
                changePercent: overview?.reviews.changePercent,
              ),
            ),
            Expanded(
              child: _buildMetricItem(
                title: 'Отзывы',
                value: '${establishment.stats.reviews}',
                changePercent: overview?.reviews.changePercent,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMetricItem({
    required String title,
    required String value,
    double? changePercent,
    bool showStar = false,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: AppTheme.textPrimary)),
        const Spacer(),
        Container(margin: const EdgeInsets.symmetric(vertical: 4), height: 1, color: _strokeGrey),
        Row(
          children: [
            Text(value, style: const TextStyle(fontSize: 13, color: AppTheme.textPrimary)),
            if (showStar) ...[
              const SizedBox(width: 4),
              const Icon(Icons.star, color: _secondaryOrange, size: 14),
            ],
            if (changePercent != null) ...[
              const SizedBox(width: 6),
              _buildChangeChip(changePercent),
            ],
          ],
        ),
      ],
    );
  }

  // ============================================================================
  // Change Percent Badge
  // ============================================================================

  Widget _buildChangeChip(double percent) {
    final isPositive = percent > 0;
    final color = isPositive ? _navyBlue : _redColor;
    final prefix = isPositive ? '+' : '';
    final text = '$prefix${percent.toStringAsFixed(percent.truncateToDouble() == percent ? 0 : 1)}%';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(text, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: color)),
    );
  }

  // ============================================================================
  // Views Section with Chart
  // ============================================================================

  Widget _buildViewsSection(PartnerEstablishment establishment, EstablishmentOverview? overview, AnalyticsTrends? trends) {
    final viewsInPeriod = overview?.views.inPeriod ?? 0;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Text('Просмотры', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w500, color: AppTheme.textPrimary)),
                  if (overview?.views.changePercent != null) ...[
                    const SizedBox(width: 8),
                    _buildChangeChip(overview!.views.changePercent!),
                  ],
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(_formatNumber(establishment.stats.views), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textPrimary)),
                  if (viewsInPeriod > 0)
                    Text('$viewsInPeriod за период', style: const TextStyle(fontSize: 12, color: _greyText)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 150,
            child: trends != null && trends.viewsTrend.isNotEmpty
                ? _buildTrendChart(trends.viewsTrend, _secondaryOrange)
                : _buildEmptyChart(),
          ),
        ],
      ),
    );
  }

  // ============================================================================
  // Trend Chart (fl_chart)
  // ============================================================================

  Widget _buildTrendChart(List<TrendPoint> data, Color color) {
    if (data.isEmpty) return _buildEmptyChart();

    final maxY = data.map((d) => d.count).reduce((a, b) => a > b ? a : b).toDouble();
    final spots = List.generate(data.length, (i) => FlSpot(i.toDouble(), data[i].count.toDouble()));

    return BarChart(
      BarChartData(
        alignment: BarChartAlignment.spaceAround,
        maxY: maxY > 0 ? maxY * 1.2 : 5,
        barTouchData: BarTouchData(
          touchTooltipData: BarTouchTooltipData(
            getTooltipItem: (group, groupIndex, rod, rodIndex) {
              final point = data[group.x.toInt()];
              final day = '${point.date.day}.${point.date.month.toString().padLeft(2, '0')}';
              return BarTooltipItem('$day\n${point.count}', const TextStyle(color: Colors.white, fontSize: 12));
            },
          ),
        ),
        titlesData: FlTitlesData(
          show: true,
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              getTitlesWidget: (value, meta) {
                final idx = value.toInt();
                if (idx < 0 || idx >= data.length) return const SizedBox.shrink();
                // For <= 7 data points show all labels; otherwise thin out
                if (data.length > 7) {
                  final step = (data.length / 5).ceil().clamp(1, data.length);
                  // Always show labels where there's data, first, and last
                  final hasData = data[idx].count > 0;
                  if (!hasData && idx % step != 0 && idx != data.length - 1) {
                    return const SizedBox.shrink();
                  }
                }
                final d = data[idx].date;
                return Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}', style: const TextStyle(fontSize: 10, color: _greyText)),
                );
              },
            ),
          ),
          leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
        ),
        gridData: const FlGridData(show: false),
        borderData: FlBorderData(show: false),
        barGroups: spots.map((spot) {
          return BarChartGroupData(
            x: spot.x.toInt(),
            barRods: [
              BarChartRodData(
                toY: spot.y,
                color: color.withValues(alpha: 0.7),
                width: data.length <= 7 ? 20 : (data.length <= 30 ? 8 : 4),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
              ),
            ],
          );
        }).toList(),
      ),
    );
  }

  Widget _buildEmptyChart() {
    return Container(
      decoration: BoxDecoration(
        color: _strokeGrey.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
      ),
      padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
      child: const Center(
        child: Text('Нет данных за выбранный период', style: TextStyle(fontSize: 14, color: _greyText), textAlign: TextAlign.center),
      ),
    );
  }

  // ============================================================================
  // Calls Section
  // ============================================================================

  Widget _buildCallsSection(EstablishmentOverview? overview) {
    final callsInPeriod = overview?.calls.inPeriod ?? 0;
    return _buildStatSection(
      title: 'Звонки',
      value: callsInPeriod,
      changePercent: overview?.calls.changePercent,
    );
  }

  // ============================================================================
  // Favorites Section
  // ============================================================================

  Widget _buildFavoritesSection(PartnerEstablishment establishment, EstablishmentOverview? overview) {
    final favInPeriod = overview?.favorites.inPeriod;
    return _buildStatSection(
      title: 'Избранное',
      value: establishment.stats.favorites,
      changePercent: overview?.favorites.changePercent,
      periodValue: favInPeriod,
    );
  }

  Widget _buildStatSection({
    required String title,
    required int value,
    double? changePercent,
    int? periodValue,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textPrimary)),
                  if (changePercent != null) ...[
                    const SizedBox(width: 8),
                    _buildChangeChip(changePercent),
                  ],
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('$value', style: const TextStyle(fontSize: 15, color: AppTheme.textPrimary)),
                  if (periodValue != null && periodValue > 0)
                    Text('+$periodValue за период', style: const TextStyle(fontSize: 11, color: _greyText)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          _buildDivider(),
        ],
      ),
    );
  }

  Widget _buildDivider() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      height: 0.5,
      color: _strokeGrey,
    );
  }

  // ============================================================================
  // Ratings Section (unchanged — from cached establishment data)
  // ============================================================================

  Widget _buildRatingsSection(PartnerEstablishment establishment) {
    final distribution = establishment.stats.ratingDistribution;
    final totalRatings = distribution != null
        ? distribution.values.fold(0, (a, b) => a + b)
        : 0;
    final hasRatings = totalRatings > 0;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Оценки', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: AppTheme.textPrimary)),
              Text('$totalRatings', style: const TextStyle(fontSize: 15, color: AppTheme.textPrimary)),
            ],
          ),
          const SizedBox(height: 16),
          if (!hasRatings)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Text('Пока нет оценок', style: TextStyle(fontSize: 14, color: _greyText)),
            )
          else
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 55, height: 55,
                  decoration: BoxDecoration(color: _greenColor, borderRadius: BorderRadius.circular(14)),
                  child: Center(
                    child: Text(
                      establishment.stats.averageRating?.toStringAsFixed(1).replaceAll('.', ',') ?? '-',
                      style: const TextStyle(fontSize: 28, color: _backgroundColor),
                    ),
                  ),
                ),
                const SizedBox(width: 24),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Оценки: $totalRatings', style: const TextStyle(fontSize: 14, color: AppTheme.textPrimary)),
                      const SizedBox(height: 8),
                      ...List.generate(5, (index) {
                        final star = 5 - index;
                        final count = distribution![star] ?? 0;
                        final percentage = count / totalRatings;
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            children: [
                              SizedBox(width: 12, child: Text('$star', style: const TextStyle(fontSize: 18, color: AppTheme.textPrimary))),
                              const SizedBox(width: 8),
                              const Icon(Icons.star, color: _secondaryOrange, size: 15),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Stack(
                                  children: [
                                    Container(height: 4, decoration: BoxDecoration(color: _strokeGrey, borderRadius: BorderRadius.circular(2))),
                                    FractionallySizedBox(
                                      widthFactor: percentage,
                                      child: Container(height: 4, decoration: BoxDecoration(color: _secondaryOrange, borderRadius: BorderRadius.circular(2))),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 8),
                              SizedBox(width: 30, child: Text('$count', style: const TextStyle(fontSize: 13, color: AppTheme.textPrimary), textAlign: TextAlign.end)),
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

  // ============================================================================
  // Reviews Button
  // ============================================================================

  Widget _buildReviewsButton(BuildContext context, PartnerEstablishment establishment) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          onPressed: () {
            Navigator.of(context).pushNamed('/partner/reviews', arguments: establishment.id);
          },
          style: ElevatedButton.styleFrom(
            backgroundColor: _primaryOrange,
            foregroundColor: _backgroundColor,
            padding: const EdgeInsets.symmetric(vertical: 16),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radiusMedium)),
            elevation: 0,
          ),
          child: const Text('Просмотр отзывов', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
        ),
      ),
    );
  }

  // ============================================================================
  // Helpers
  // ============================================================================

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
