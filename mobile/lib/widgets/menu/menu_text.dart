import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/public_menu_item.dart';

/// Меню текстом — общие куски для карточки заведения (первые позиции) и
/// экрана меню (всё меню). Слова и правила — сайта (`MenuItemsList.tsx`):
/// пометка «извлечено автоматически» над меню, «уточнить» у позиции
/// `needs_caution`, «—» серым вместо цены.

/// Пометка над распознанным меню (SDL CAT-C-2.7: платформенная оговорка).
class MenuAutoExtractedNote extends StatelessWidget {
  const MenuAutoExtractedNote({super.key});

  static const String text =
      'Меню извлечено автоматически — уточняйте у заведения';

  /// Тёплый фон сайта; текст темнее сайтового (#A07A52 на нём — около
  /// 3,4 : 1, мелкому тексту мало).
  static const Color _background = Color(0xFFF7EFE6);
  static const Color _foreground = Color(0xFF7A5A3A);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: _background,
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: EdgeInsets.only(top: 1),
            child: Icon(Icons.info_outline, size: 16, color: _foreground),
          ),
          SizedBox(width: 6),
          Flexible(
            child: Text(
              text,
              style: TextStyle(fontSize: 13, color: _foreground, height: 1.3),
            ),
          ),
        ],
      ),
    );
  }
}

/// Раздел меню: заголовок (если раздел распознан) и строки позиций на белой
/// подложке.
class MenuSectionView extends StatelessWidget {
  const MenuSectionView({super.key, required this.section});

  final MenuSection section;

  @override
  Widget build(BuildContext context) {
    final title = section.title;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (title != null) ...[
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: AppTheme.backgroundPrimary,
                  borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
                ),
                child: const Icon(
                  Icons.restaurant_menu,
                  size: 16,
                  color: AppTheme.primaryOrange,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontFamily: AppTheme.fontDisplayFamily,
                    fontSize: 17,
                    fontWeight: FontWeight.w400,
                    color: AppTheme.textPrimary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
        ],
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: AppTheme.backgroundPrimary,
            borderRadius: BorderRadius.circular(AppTheme.radiusLarge),
          ),
          child: Column(
            children: [
              for (var i = 0; i < section.items.length; i++)
                MenuItemRow(item: section.items[i], first: i == 0),
            ],
          ),
        ),
      ],
    );
  }
}

/// Строка позиции: название (переносится), справа цена. Без цены — серое
/// «—», чтобы не читалось как цена соседней строки.
class MenuItemRow extends StatelessWidget {
  const MenuItemRow({super.key, required this.item, this.first = false});

  final PublicMenuItem item;

  /// Над первой строкой раздела черты нет.
  final bool first;

  static const String cautionLabel = 'уточнить';
  static const String cautionHint = 'Эта позиция требует уточнения у заведения';

  @override
  Widget build(BuildContext context) {
    final hasPrice = item.priceByn != null;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        border: first
            ? null
            : const Border(top: BorderSide(color: AppTheme.strokeWarm)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text.rich(
              TextSpan(
                text: item.itemName,
                children: [
                  if (item.needsCaution)
                    const WidgetSpan(
                      alignment: PlaceholderAlignment.middle,
                      child: Padding(
                        padding: EdgeInsets.only(left: 8),
                        child: _CautionBadge(),
                      ),
                    ),
                ],
              ),
              style: const TextStyle(
                fontSize: 16,
                color: AppTheme.textPrimary,
                height: 1.3,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Text(
            formatMenuPrice(item.priceByn),
            style: TextStyle(
              fontSize: 16,
              height: 1.3,
              fontWeight: FontWeight.w600,
              color: hasPrice ? AppTheme.textPrimary : AppTheme.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _CautionBadge extends StatelessWidget {
  const _CautionBadge();

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: MenuItemRow.cautionHint,
      triggerMode: TooltipTriggerMode.tap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: AppTheme.backgroundWarm,
          borderRadius: BorderRadius.circular(AppTheme.radiusXSmall),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 12, color: AppTheme.textDark),
            SizedBox(width: 3),
            Text(
              MenuItemRow.cautionLabel,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: AppTheme.textDark,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// «Загружаем меню…» — пока идёт запрос.
class MenuLoadingBox extends StatelessWidget {
  const MenuLoadingBox({super.key});

  static const String text = 'Загружаем меню…';

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 12),
      child: Row(
        children: [
          SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: AppTheme.primaryOrange,
            ),
          ),
          SizedBox(width: 10),
          Text(
            text,
            style: TextStyle(fontSize: 15, color: AppTheme.textSecondary),
          ),
        ],
      ),
    );
  }
}

/// Меню не загрузилось — это не «меню нет»: говорим прямо и даём
/// «Повторить», как в блоке отзывов.
class MenuLoadFailedBox extends StatelessWidget {
  const MenuLoadFailedBox({super.key, required this.onRetry});

  final VoidCallback onRetry;

  static const String text = 'Не удалось загрузить меню';

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
      decoration: BoxDecoration(
        color: AppTheme.backgroundPrimary,
        borderRadius: BorderRadius.circular(AppTheme.radiusLarge),
      ),
      child: Row(
        children: [
          const Expanded(
            child: Text(
              text,
              style: TextStyle(fontSize: 15, color: AppTheme.textPrimary),
            ),
          ),
          TextButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Повторить'),
            style: TextButton.styleFrom(
              foregroundColor: AppTheme.primaryOrange,
              minimumSize: const Size(44, 44),
            ),
          ),
        ],
      ),
    );
  }
}
