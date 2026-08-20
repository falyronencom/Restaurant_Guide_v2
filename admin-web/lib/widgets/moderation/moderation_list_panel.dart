import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/category_icons.dart';
import 'package:restaurant_guide_admin_web/config/formatters.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/state/admin_skeleton.dart';

/// Очередь заявок — средняя колонка экрана «Ожидают просмотра».
///
/// Ширина 360, без шапки секции и без пагинации: сортировка и счётчик очереди
/// живут в шапке экрана, а не дублируются над списком. Карточка отвечает на
/// три вопроса сразу — что за место, где оно и сколько уже ждёт.
class ModerationListPanel extends StatelessWidget {
  const ModerationListPanel({super.key});

  static const double width = 360;

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ModerationProvider>();

    return Container(
      width: width,
      decoration: const BoxDecoration(
        border: Border(right: BorderSide(color: AppTheme.borderLight)),
      ),
      child: _buildContent(context, provider),
    );
  }

  Widget _buildContent(BuildContext context, ModerationProvider provider) {
    if (provider.isLoadingList) return const _QueueSkeleton();

    final error = provider.listError;
    if (error != null) {
      return _QueueMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Очередь не загрузилась',
        message: error,
        onRetry: () => provider.loadPendingEstablishments(),
      );
    }

    if (provider.establishments.isEmpty) {
      return const _QueueMessage(
        icon: Icons.done_all,
        title: 'Очередь пуста',
        message: 'Все заявки разобраны — новых на модерации нет.',
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      itemCount: provider.establishments.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final item = provider.establishments[index];
        return _EstablishmentCard(
          item: item,
          isSelected: provider.selectedId == item.id,
          onTap: () => provider.selectEstablishment(item.id),
        );
      },
    );
  }
}

/// Карточка заявки в очереди.
class _EstablishmentCard extends StatelessWidget {
  final EstablishmentListItem item;
  final bool isSelected;
  final VoidCallback onTap;

  const _EstablishmentCard({
    required this.item,
    required this.isSelected,
    required this.onTap,
  });

  /// Ширина полосы слева. Полоса, а не квадрат: карточка низкая, и квадрат
  /// по её высоте оставил бы тексту слишком мало места.
  static const double mediaWidth = 96;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        child: Container(
          decoration: isSelected
              ? AppTheme.canonSelectedCardDecoration()
              : BoxDecoration(
                  color: AppTheme.backgroundWarm,
                  borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                  // Рамка прозрачная, но ширины той же, что у выбранной.
                  // Без неё выбор карточки раздвигает её на 1.5px с каждой
                  // стороны, и весь список под ней прыгает — при обходе
                  // очереди это заметно на каждом шаге.
                  border: Border.all(color: Colors.transparent, width: 1.5),
                ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _MediaStrip(item: item, isSelected: isSelected),
                  Expanded(child: _CardBody(item: item, isSelected: isSelected)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Полоса слева: фотография заведения, а без неё — иконка категории.
///
/// Фотография обязательна при создании карточки, поэтому иконка — защитный
/// фаллбэк, а не обычный вид: она закрывает битую ссылку и старые записи.
class _MediaStrip extends StatelessWidget {
  final EstablishmentListItem item;
  final bool isSelected;

  const _MediaStrip({required this.item, required this.isSelected});

  @override
  Widget build(BuildContext context) {
    final url = item.thumbnailUrl;

    return SizedBox(
      width: _EstablishmentCard.mediaWidth,
      child: url != null && url.isNotEmpty
          // Stack только из позиционированных детей заявляет нулевой
          // собственный размер. Это принципиально: высоту карточки задаёт
          // IntrinsicHeight, а `Image.network` иначе отдал бы ей высоту по
          // соотношению сторон снимка. `thumbnail_url` в базе обнуляем, и
          // тогда сюда приходит полноразмерный файл — портретное фото
          // растянуло бы карточку вдвое, причём уже после загрузки байтов,
          // то есть прыжком.
          ? Stack(
              children: <Widget>[
                Positioned.fill(
                  child: Image.network(
                    url,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => _fallback(),
                  ),
                ),
              ],
            )
          : _fallback(),
    );
  }

  Widget _fallback() {
    // Под выбранной карточкой фон белый, под обычной — бежевый; полоса берёт
    // соседний по каноническому ряду оттенок, чтобы читаться на обоих.
    final background =
        isSelected ? AppTheme.backgroundWarm : AppTheme.beigeDivider;
    final glyph = isSelected ? AppTheme.strokeGrey : AppTheme.textGrey;
    final asset = iconAssetForEstablishment(
      categories: item.categories,
      cuisines: item.cuisines,
    );

    return Container(
      color: background,
      alignment: Alignment.center,
      child: asset != null
          ? SvgPicture.asset(
              asset,
              width: 26,
              height: 26,
              colorFilter: ColorFilter.mode(glyph, BlendMode.srcIn),
            )
          : Icon(Icons.storefront_outlined, size: 26, color: glyph),
    );
  }
}

class _CardBody extends StatelessWidget {
  final EstablishmentListItem item;
  final bool isSelected;

  const _CardBody({required this.item, required this.isSelected});

  @override
  Widget build(BuildContext context) {
    final category = item.categories.isNotEmpty
        ? item.categories.first.toLowerCase()
        : null;
    final cuisine =
        item.cuisines.isNotEmpty ? item.cuisines.first.toLowerCase() : null;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            item.name,
            style: TextStyle(
              fontFamily: AppTheme.fontCardTitleFamily,
              fontSize: 17,
              fontWeight: FontWeight.w600,
              color: AppTheme.textPrimary,
              height: 1.2,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          if (category != null || cuisine != null) ...[
            const SizedBox(height: 4),
            // Тип и кухня различаются цветом, а не разными строками: тип
            // отвечает «что это», кухня лишь уточняет — и приглушена.
            Text.rich(
              TextSpan(
                style: const TextStyle(
                  fontSize: 12,
                  color: AppTheme.textSecondary,
                ),
                children: <InlineSpan>[
                  if (category != null) TextSpan(text: category),
                  if (category != null && cuisine != null)
                    const TextSpan(text: ' · '),
                  if (cuisine != null)
                    TextSpan(
                      text: cuisine,
                      style: const TextStyle(color: AppTheme.textGrey),
                    ),
                ],
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: 9),
          Row(
            children: [
              // Город забирает всю свободную ширину, а не половину: с
              // `Flexible` рядом со `Spacer` остаток от короткого названия
              // уходил за бейдж, и тот вставал не по правому краю, а вразнобой
              // от карточки к карточке.
              if (item.city != null)
                Expanded(
                  child: Text(
                    item.city!,
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppTheme.textDark,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                )
              else
                const Spacer(),
              _WaitingBadge(
                days: moderationWaitingDays(item.updatedAt),
                isSelected: isSelected,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Бейдж срока ожидания. У выбранной карточки — disclaimer-пара канона,
/// у прочих белый на бежевом: выделение достаётся только выбранной.
class _WaitingBadge extends StatelessWidget {
  final int? days;
  final bool isSelected;

  const _WaitingBadge({required this.days, required this.isSelected});

  @override
  Widget build(BuildContext context) {
    final value = days;
    if (value == null) return const SizedBox.shrink();

    // Ноль суток — это «сегодня», а не «0 дней»: заявка пришла и ещё не
    // пролежала ни дня, и число здесь сказало бы обратное.
    final label =
        value == 0 ? 'сегодня' : countWithNoun(value, 'день', 'дня', 'дней');

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: isSelected ? AppTheme.disclaimerBg : AppTheme.backgroundPrimary,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.schedule,
            size: 12,
            color: isSelected ? AppTheme.disclaimerText : AppTheme.textSecondary,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color:
                  isSelected ? AppTheme.disclaimerText : AppTheme.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

/// Скелетон очереди: карточки той же геометрии, что и настоящие.
class _QueueSkeleton extends StatelessWidget {
  const _QueueSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      itemCount: 4,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, __) => Container(
        // Высота настоящей карточки при однострочных полях — скелетон не
        // должен смещать список в момент подмены.
        height: 94,
        decoration: AppTheme.canonPanelDecoration(radius: AppTheme.radiusMedium),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              width: _EstablishmentCard.mediaWidth,
              decoration: const BoxDecoration(
                color: AppTheme.skeletonStrong,
                borderRadius: BorderRadius.horizontal(
                  left: Radius.circular(AppTheme.radiusMedium),
                ),
              ),
            ),
            const Expanded(
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SkeletonBlock.line(widthFactor: .62, height: 15),
                    SizedBox(height: 8),
                    SkeletonBlock.line(widthFactor: .44, height: 11),
                    Spacer(),
                    SkeletonBlock.line(widthFactor: .3, height: 11),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Компактное сообщение в колонке 360px.
///
/// Витринная панель пустого состояния (`AdminEmptyState`, 560px) сюда не
/// помещается — в узкой колонке она стала бы горизонтальной прокруткой.
class _QueueMessage extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;
  final VoidCallback? onRetry;

  const _QueueMessage({
    required this.icon,
    required this.title,
    required this.message,
    this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final retry = onRetry;

    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 32, color: AppTheme.textGrey),
            const SizedBox(height: 12),
            Text(
              title,
              style: AppTheme.canonSubsectionHeader,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              message,
              style: const TextStyle(
                fontSize: 13,
                color: AppTheme.textSecondary,
                height: 1.4,
              ),
              textAlign: TextAlign.center,
            ),
            if (retry != null) ...[
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: retry,
                style: AppTheme.canonHeaderAction(),
                child: const Text('Повторить'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
