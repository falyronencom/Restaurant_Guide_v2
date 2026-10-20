import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_screen_header.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_empty_state.dart';

/// Уведомления — раздел ещё не запущен (кадр 14 редизайна).
///
/// Это не заглушка «в разработке», а честный экран: перечисляет, что здесь
/// появится, и называет реальную зависимость, а не безадресный срок. Пункт
/// рейла помечен «скоро», чтобы тупик был виден до клика.
class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Column(
      children: [
        AdminScreenHeader(
          title: 'Уведомления',
          // «В разработке» говорит статус ниже — дважды подряд это шум
          // (проход по панели 20.10, A2-16).
          subtitle: 'Событий пока нет',
        ),
        Expanded(
          child: AdminEmptyState.section(
            icon: Icons.notifications_outlined,
            title: 'Пока тихо',
            status: 'Система уведомлений в разработке',
            message: 'Когда раздел заработает, здесь будет лента событий '
                'платформы — то, что сейчас приходится проверять вручную '
                'на каждом экране модерации.',
            rows: <EmptyStateRow>[
              EmptyStateRow(
                icon: Icons.pending_actions_outlined,
                text: 'Новые заявки на модерацию',
              ),
              EmptyStateRow(
                icon: Icons.reviews_outlined,
                // Без «жалоб»: механизма жалоб нет и по решению В10 не
                // будет — экран «Отзывы» отказался от этой строки так же.
                text: 'Отзывы с низкой оценкой',
              ),
              EmptyStateRow(
                icon: Icons.monitor_heart_outlined,
                text: 'Важные события платформы',
              ),
            ],
            footnote: 'В следующих обновлениях. '
                'Пока сигналы собраны в «Здоровье данных»',
          ),
        ),
      ],
    );
  }
}
