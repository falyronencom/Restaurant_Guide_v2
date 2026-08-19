import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Шапка экрана — 72px, нижняя граница, слот действий справа.
///
/// Единственная шапка админки. Заголовок называет раздел, подпись под ним
/// объясняет состояние: «0 из 1 240 подходят под фильтр», «старейшая заявка
/// ждёт 9 дней». Подпись не обязательна, но если её нечем наполнить —
/// лучше пусто, чем приблизительно.
///
/// [actions] — сегмент-контрол периода, поиск, чипы фильтров. По канону это
/// именно слот шапки: внутрь тела вкладки такие контролы не опускаются.
class AdminScreenHeader extends StatelessWidget {
  final String title;
  final String? subtitle;

  /// Виджет-индикатор рядом с подписью — спиннер фоновой загрузки и т.п.
  final Widget? subtitleLeading;
  final List<Widget> actions;

  /// Идёт фоновое обновление: по нижней кромке шапки бежит полоса 2px.
  /// Данные при этом остаются на экране и читаемыми — подменять их
  /// скелетоном на обновлении нельзя, это первичная загрузка так делает.
  final bool busy;

  const AdminScreenHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.subtitleLeading,
    this.actions = const <Widget>[],
    this.busy = false,
  });

  static const double height = 72;

  @override
  Widget build(BuildContext context) {
    final subtitleText = subtitle;

    return Stack(
      children: [
        _bar(subtitleText),
        if (busy)
          const Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: SizedBox(
              height: 2,
              child: LinearProgressIndicator(
                minHeight: 2,
                color: AppTheme.primaryOrange,
                backgroundColor: AppTheme.backgroundWarm,
              ),
            ),
          ),
      ],
    );
  }

  Widget _bar(String? subtitleText) {
    return Container(
      height: height,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppTheme.borderLight)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: AppTheme.canonScreenTitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitleText != null || subtitleLeading != null) ...[
                  const SizedBox(height: 3),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    spacing: 8,
                    children: [
                      if (subtitleLeading != null) subtitleLeading!,
                      if (subtitleText != null)
                        Flexible(
                          child: Text(
                            subtitleText,
                            style: AppTheme.canonScreenSubtitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          if (actions.isNotEmpty) ...[
            const SizedBox(width: 16),
            Row(mainAxisSize: MainAxisSize.min, spacing: 10, children: actions),
          ],
        ],
      ),
    );
  }
}
