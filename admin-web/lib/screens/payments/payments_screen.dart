import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_empty_state.dart';

/// История платежей — раздел ещё не запущен (кадр 15 редизайна).
///
/// Зависимость названа честно: раздел ждёт не «следующего обновления», а
/// первой платящей подписки, то есть запуска монетизации после публичного
/// выхода платформы. Пункт рейла помечен «скоро».
class PaymentsScreen extends StatelessWidget {
  const PaymentsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Column(
      children: [
        AdminScreenHeader(
          title: 'История платежей',
          subtitle: 'Появится вместе с монетизацией',
        ),
        Expanded(
          child: AdminEmptyState.section(
            icon: Icons.receipt_long_outlined,
            title: 'Платежей пока нет',
            status: 'Монетизация запускается после выхода платформы',
            message: 'Раздел ждёт первую платящую подписку. До запуска '
                'монетизации показывать здесь нечего — партнёры пользуются '
                'платформой бесплатно.',
            rows: <EmptyStateRow>[
              EmptyStateRow(
                icon: Icons.workspace_premium_outlined,
                text: 'Активные подписки партнёров',
              ),
              EmptyStateRow(
                icon: Icons.receipt_long_outlined,
                text: 'История транзакций',
              ),
              EmptyStateRow(
                icon: Icons.sell_outlined,
                text: 'Управление тарифами',
              ),
            ],
            footnote: 'Поздний этап — после публичного запуска',
          ),
        ),
      ],
    );
  }
}
