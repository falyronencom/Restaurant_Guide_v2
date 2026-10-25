import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/utils/page_reload.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_sidebar.dart';

/// Плашка над экраном: «Вышла новая версия панели — обновить» (К-7).
///
/// Не закрывает работу и не перезагружает сама: модератор мог быть посреди
/// заявки. «Обновить» перезагружает вкладку; если по заявкам стоят
/// неотправленные отметки — сначала спросит, как выход.
class PanelUpdateBanner extends StatelessWidget {
  /// Перезагрузка вкладки — подменяется в тестах.
  final VoidCallback reload;

  const PanelUpdateBanner({super.key, this.reload = reloadPage});

  static const String message = 'Вышла новая версия панели';

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey<String>('panel-update-banner'),
      padding: const EdgeInsets.fromLTRB(24, 6, 16, 6),
      decoration: BoxDecoration(
        color: AppTheme.brandTint(0.10),
        border: const Border(bottom: BorderSide(color: AppTheme.borderLight)),
      ),
      child: Row(
        children: <Widget>[
          const Icon(Icons.system_update_alt,
              size: 18, color: AppTheme.primaryOrangeDark),
          const SizedBox(width: 10),
          const Expanded(
            child: Text(
              '$message — обновите страницу, чтобы работать в ней.',
              style: TextStyle(fontSize: 13, color: AppTheme.textDark),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 12),
          FilledButton(
            onPressed: () async {
              final go = await confirmLosingVerdicts(
                context,
                title: 'Обновить панель?',
                confirm: 'Обновить',
              );
              if (go) reload();
            },
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.primaryOrangeDark,
              visualDensity: VisualDensity.compact,
            ),
            child: const Text('Обновить'),
          ),
        ],
      ),
    );
  }
}
