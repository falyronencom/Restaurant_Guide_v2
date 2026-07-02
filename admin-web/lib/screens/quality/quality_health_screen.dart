import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/models/quality_health_models.dart';
import 'package:restaurant_guide_admin_web/providers/quality_health_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/quality/quality_stat_card.dart';

/// Quality Health — AI-ops Brick-1 (Tier-0 immunity, read-only).
///
/// Standing health signals over active establishments: canon/slug reachability,
/// menu completeness, geo bounds, working-hours sanity, hanging OCR flags, plus an
/// attribute-key census. Price distribution is deferred to the 500-import.
class QualityHealthScreen extends StatefulWidget {
  const QualityHealthScreen({super.key});

  @override
  State<QualityHealthScreen> createState() => _QualityHealthScreenState();
}

class _QualityHealthScreenState extends State<QualityHealthScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<QualityHealthProvider>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<QualityHealthProvider>(
      builder: (context, provider, _) {
        return SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Здоровье данных',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF1A1A1A),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Обновить',
                    onPressed:
                        provider.isLoading ? null : () => provider.load(),
                    icon: const Icon(Icons.refresh),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                'Автоматический контроль качества активных заведений '
                '(Tier-0, только чтение)',
                style: TextStyle(fontSize: 13, color: Colors.grey[600]),
              ),
              const SizedBox(height: 24),
              if (provider.isLoading && provider.data == null)
                _buildLoading()
              else if (provider.error != null && provider.data == null)
                _buildError(provider)
              else if (provider.data != null)
                _buildContent(provider.data!),
            ],
          ),
        );
      },
    );
  }

  Widget _buildLoading() => const Center(
        child: Padding(
          padding: EdgeInsets.all(48),
          child: CircularProgressIndicator(color: Color(0xFFF06B32)),
        ),
      );

  Widget _buildError(QualityHealthProvider provider) => Center(
        child: Padding(
          padding: const EdgeInsets.all(48),
          child: Column(
            children: [
              Icon(Icons.error_outline, size: 48, color: Colors.red[300]),
              const SizedBox(height: 12),
              Text(provider.error!, style: TextStyle(color: Colors.red[600])),
              const SizedBox(height: 12),
              ElevatedButton(
                onPressed: () => provider.load(),
                child: const Text('Повторить'),
              ),
            ],
          ),
        ),
      );

  Widget _buildContent(QualityHealthData d) {
    final cards = <Widget>[
      QualityStatCard(
        title: 'Недостижимы в sitemap',
        count: d.unreachableCount,
        subtitle: 'Категория/город вне канона → нет канонического URL',
        icon: Icons.link_off,
      ),
      QualityStatCard(
        title: 'Категории вне канона',
        count: d.categoryOffCanonCount,
        subtitle: 'Значение категории не из 15 канонических',
        icon: Icons.category_outlined,
      ),
      QualityStatCard(
        title: 'Кухни вне канона',
        count: d.cuisineOffCanonCount,
        subtitle: 'Значение кухни не из 12 канонических',
        icon: Icons.restaurant_menu,
      ),
      QualityStatCard(
        title: 'Пустые меню',
        count: d.emptyMenusCount,
        subtitle: 'Есть фото меню, но OCR не дал позиций',
        icon: Icons.menu_book_outlined,
      ),
      QualityStatCard(
        title: 'Ошибки OCR',
        count: d.ocrFailedCount,
        subtitle: 'Задачи распознавания в статусе failed',
        icon: Icons.error_outline,
      ),
      QualityStatCard(
        title: 'Зависшие OCR',
        count: d.ocrStuckCount,
        subtitle: 'pending после неудачной попытки',
        icon: Icons.hourglass_bottom,
      ),
      QualityStatCard(
        title: 'Координаты вне границ',
        count: d.outOfBoundsCount,
        subtitle: 'Вне Беларуси или вне границ города',
        icon: Icons.wrong_location_outlined,
      ),
      QualityStatCard(
        title: 'Часы: битый формат',
        count: d.hoursMalformedCount,
        subtitle: 'Нераспознаваемое время работы',
        icon: Icons.schedule,
      ),
      QualityStatCard(
        title: 'Часы: всё закрыто',
        count: d.hoursAllClosedCount,
        subtitle: 'Не открыто ни в один день недели',
        icon: Icons.lock_clock,
      ),
      QualityStatCard(
        title: 'Флаги без реакции',
        count: d.hangingFlagsCount,
        subtitle: 'Позиции меню с sanity_flag без модерации',
        icon: Icons.flag_outlined,
      ),
      QualityStatCard(
        title: 'Атрибуты: не-объект',
        count: d.nonObjectAttributesCount,
        subtitle: 'attributes не JSON-объект (folded)',
        icon: Icons.data_object,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            const spacing = 16.0;
            final columns = constraints.maxWidth > 1100
                ? 3
                : (constraints.maxWidth > 720 ? 2 : 1);
            final itemWidth =
                (constraints.maxWidth - spacing * (columns - 1)) / columns;
            return Wrap(
              spacing: spacing,
              runSpacing: spacing,
              children: cards
                  .map((c) => SizedBox(width: itemWidth, child: c))
                  .toList(),
            );
          },
        ),
        const SizedBox(height: 28),
        _buildCensus(d),
        const SizedBox(height: 24),
        _buildPriceNote(),
      ],
    );
  }

  Widget _buildCensus(QualityHealthData d) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Перепись ключей атрибутов',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: Color(0xFF1A1A1A),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Наблюдение, не проверка — вход для сверки канона атрибутов (AF1)',
            style: TextStyle(fontSize: 12, color: Colors.grey[600]),
          ),
          const SizedBox(height: 16),
          if (d.attributeKeys.isEmpty)
            Text(
              'Ключи не найдены',
              style: TextStyle(fontSize: 13, color: Colors.grey[500]),
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: d.attributeKeys
                  .map(
                    (k) => Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF3F4F6),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        '${k.key} · ${k.count}',
                        style: const TextStyle(
                          fontSize: 13,
                          color: Color(0xFF374151),
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  )
                  .toList(),
            ),
        ],
      ),
    );
  }

  Widget _buildPriceNote() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7ED),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0x22F06B32)),
      ),
      child: Row(
        children: [
          const Icon(Icons.info_outline, size: 20, color: Color(0xFFB45309)),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Распределение цен — отложено (статистический сигнал; '
              'подключается на импорте 500 заведений). Абсолютные ценовые '
              'выбросы уже ловятся при OCR (sanity_flag).',
              style: TextStyle(fontSize: 13, color: Colors.grey[800]),
            ),
          ),
        ],
      ),
    );
  }
}
