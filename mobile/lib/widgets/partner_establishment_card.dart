import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:restaurant_guide_mobile/models/partner_establishment.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// Partner Establishment Card widget
/// Displays establishment info with stats and status for partner dashboard
/// Based on Figma design: Profile/Log In - Partner card section
/// Phase 5.2 - Partner Dashboard
class PartnerEstablishmentCard extends StatelessWidget {
  final PartnerEstablishment establishment;
  final VoidCallback? onTap;
  final VoidCallback? onEditTap;
  final VoidCallback? onPromotionTap;

  const PartnerEstablishmentCard({
    super.key,
    required this.establishment,
    this.onTap,
    this.onEditTap,
    this.onPromotionTap,
  });

  // ============================================================================
  // Colors from Figma
  // ============================================================================

  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _cardDarkBg = Color(0xFF000000);
  static const Color _primaryOrange = AppTheme.primaryOrange;
  static const Color _greyText = Color(0xFFC7C3BC);
  static const Color _darkGreyText = Color(0xFF717171);

  // Status colors
  static const Color _statusPending = Color(0xFFFFA500);
  static const Color _statusApproved = AppTheme.statusGreen;
  static const Color _statusRejected = Color(0xFFFF3B30);
  static const Color _statusSuspended = Color(0xFF8E8E93);

  // ============================================================================
  // Dimensions
  // ============================================================================

  /// Высота карточки по макету — она же наименьшая: выше карточка становится,
  /// только когда содержимое в неё не помещается (см. [build]).
  static const double _cardHeight = 310.0;

  /// Место кнопки «Продвижение» в нижнем ряду. По макету шкала заполненности
  /// идёт от левого поля до 160 dp от правого края карточки, а кнопка стоит
  /// в этих 160 dp, в 10 от края. Шире место становится, только когда
  /// кнопке с крупным шрифтом тесно, — тогда уступает шкала.
  static const double _buttonSlotWidth = 150.0;

  /// Наименьший зазор между шкалой и кнопкой «Продвижение».
  static const double _barButtonGap = 8.0;

  /// Наименьший зазор между адресом и нижним рядом — тот, что остаётся между
  /// ними по макету при обычном шрифте.
  static const double _contentBottomGap = 3.0;

  /// Предел системного размера шрифта — тот же, что у карточки заведения в
  /// поиске, и на всю карточку вместе со строками под ней («Редактировать»,
  /// статус, комментарий модератора): решение Координатора 30.09.2026.
  ///
  /// Высоту карточка добирает сама (см. [build]), а ширина задана экраном:
  /// нижний ряд делят шкала заполненности и кнопка «Продвижение», и кнопка
  /// растёт вместе с буквами. Без предела (замер 30.09.2026 шрифтами сборки)
  /// на 360-dp телефоне при ×2 шкале оставалось меньше 60 dp, а при самом
  /// крупном тексте iPhone (×3,1) кнопка выходила шире нижнего ряда.
  static const double _maxTextScale = 1.2;

  @override
  Widget build(BuildContext context) {
    final isPremium = establishment.isPremium;

    return MediaQuery.withClampedTextScaling(
      maxScaleFactor: _maxTextScale,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          // Main card
          GestureDetector(
            onTap: onTap,
            child: Container(
              width: double.infinity,
              // Не ниже макета; выше — только когда содержимое не помещается.
              constraints: const BoxConstraints(minHeight: _cardHeight),
              decoration: BoxDecoration(
                color: isPremium ? _cardDarkBg : _backgroundColor,
                borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.08),
                    blurRadius: 15,
                    spreadRadius: 2,
                    offset: const Offset(4, 4),
                  ),
                  BoxShadow(
                    color: AppTheme.primaryOrangeShadow.withValues(alpha: 0.08),
                    blurRadius: 15,
                    spreadRadius: 2,
                    offset: const Offset(-4, -4),
                  ),
                ],
              ),
              // Фото, текст и нижний ряд — один поток. Прежде текст рос от
              // top: 125, а шкала и кнопка были прибиты к низу карточки
              // фиксированной высоты, и адрес молча заходил на них — с
              // крупным шрифтом, а на 320-dp экране с тремя кухнями и при
              // обычном: наезд ошибки раскладки не даёт. Под наименьшей
              // высотой колонка растягивается до неё, и остаток места
              // встаёт между текстом и нижним рядом — нижний ряд прижат к
              // низу, как в макете.
              child: Column(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Image section (top portion with mask)
                      SizedBox(
                        height: 120,
                        child: ClipRRect(
                          borderRadius: const BorderRadius.only(
                            topLeft: Radius.circular(10),
                            topRight: Radius.circular(10),
                            bottomLeft: Radius.circular(60),
                            bottomRight: Radius.circular(60),
                          ),
                          child: _buildImage(),
                        ),
                      ),

                      // Content section (name + stats + address below)
                      Padding(
                        padding: const EdgeInsets.only(
                          left: 18,
                          top: 5,
                          right: 10,
                          bottom: _contentBottomGap,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _buildEstablishmentInfo(isPremium),
                            const SizedBox(height: 6),
                            _buildStats(isPremium),
                            const SizedBox(height: 6),
                            _buildAddress(isPremium),
                          ],
                        ),
                      ),
                    ],
                  ),
                  _buildBottomRow(isPremium),
                ],
              ),
            ),
          ),

          const SizedBox(height: 8),

          // Edit link
          GestureDetector(
            onTap: onEditTap,
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 8),
              child: Text(
                'Редактировать',
                style: TextStyle(
                  fontSize: 14,
                  color: AppTheme.textPrimary,
                  decoration: TextDecoration.underline,
                ),
              ),
            ),
          ),

          const SizedBox(height: 8),

          // Status badge
          _buildStatusBadge(),
        ],
      ),
    );
  }

  /// Нижний ряд карточки: шкала заполненности (пока данные заполнены не
  /// полностью) и кнопка «Продвижение».
  ///
  /// Низы — как в макете: шкала в 10 dp от низа карточки, кнопка в 18.
  /// Шкала занимает всё, что оставляет ей место кнопки ([_buttonSlotWidth]
  /// или шире, если кнопке тесно), поэтому они не сходятся ни при каком
  /// размере шрифта.
  Widget _buildBottomRow(bool isPremium) {
    return Padding(
      padding: const EdgeInsets.only(left: 18, right: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: establishment.baseScore < 100
                ? Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _buildCompletenessBar(isPremium),
                  )
                : const SizedBox.shrink(),
          ),
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: _buttonSlotWidth),
            child: Padding(
              padding: const EdgeInsets.only(left: _barButtonGap, bottom: 18),
              child: Align(
                alignment: Alignment.centerRight,
                child: _buildPromotionButton(),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Build establishment image
  Widget _buildImage() {
    if (establishment.primaryImageUrl != null &&
        establishment.primaryImageUrl!.isNotEmpty) {
      return CachedNetworkImage(
        imageUrl: establishment.primaryImageUrl!,
        fit: BoxFit.cover,
        placeholder: (context, url) => Container(
          color: _greyText.withValues(alpha: 0.3),
          child: const Center(
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: _primaryOrange,
            ),
          ),
        ),
        errorWidget: (context, url, error) => Container(
          color: _greyText.withValues(alpha: 0.3),
          child: const Icon(Icons.restaurant, size: 40, color: Colors.grey),
        ),
      );
    }

    return Container(
      color: _greyText.withValues(alpha: 0.3),
      child: const Center(
        child: Icon(Icons.restaurant, size: 40, color: Colors.grey),
      ),
    );
  }

  /// Build establishment info (name, type, cuisine)
  Widget _buildEstablishmentInfo(bool isPremium) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Name — одна строка, как в макете: длинное уходит в многоточие
        Text(
          establishment.name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontFamily: AppTheme.fontDisplayFamily,
            fontSize: 22,
            fontWeight: FontWeight.w400,
            color: isPremium ? _backgroundColor : AppTheme.textPrimary,
          ),
        ),
        // Type
        Text(
          establishment.categoryDisplayName,
          style: TextStyle(
            fontSize: 15,
            color: isPremium ? _backgroundColor : AppTheme.textPrimary,
          ),
        ),
        // Cuisine
        Text(
          establishment.cuisineDisplayName,
          style: TextStyle(
            fontSize: 13,
            color: isPremium ? _darkGreyText : _greyText,
          ),
        ),
      ],
    );
  }

  /// Build address line (последняя строка блока контента)
  Widget _buildAddress(bool isPremium) {
    return Text(
      establishment.shortAddress,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(
        fontSize: 14,
        color: isPremium ? _backgroundColor : AppTheme.textPrimary,
      ),
    );
  }

  /// Build stats row (views, shares, favorites)
  Widget _buildStats(bool isPremium) {
    final stats = establishment.stats;
    final statColor = isPremium ? _backgroundColor : _greyText;

    return Row(
      children: [
        _buildStatItem(
          icon: Icons.visibility_outlined,
          value: stats.views,
          color: statColor,
        ),
        const SizedBox(width: 12),
        _buildStatItem(
          icon: Icons.ios_share_outlined,
          value: stats.shares,
          color: statColor,
        ),
        const SizedBox(width: 12),
        _buildStatItem(
          icon: Icons.favorite_border,
          value: stats.favorites,
          color: statColor,
        ),
      ],
    );
  }

  /// Build single stat item
  Widget _buildStatItem({
    required IconData icon,
    required int value,
    required Color color,
  }) {
    return Row(
      children: [
        Icon(icon, size: 20, color: color),
        const SizedBox(width: 4),
        Text(
          '$value',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w500,
            color: color,
          ),
        ),
      ],
    );
  }

  /// Build completeness progress bar with label
  Widget _buildCompletenessBar(bool isPremium) {
    final score = establishment.baseScore;
    final progress = score / 100.0;
    final labelColor = isPremium ? _greyText : _darkGreyText;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // Одна строка: на узкой шкале (экран 320 dp, или крупный шрифт, когда
        // шкала уступает место кнопке) подпись сокращается многоточием
        Text(
          'Заполненность данных',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 11,
            color: labelColor,
          ),
        ),
        const SizedBox(height: 4),
        Row(
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(3),
                child: LinearProgressIndicator(
                  value: progress,
                  minHeight: 6,
                  backgroundColor: labelColor.withValues(alpha: 0.2),
                  valueColor: const AlwaysStoppedAnimation<Color>(_primaryOrange),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Text(
              '$score%',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: labelColor,
              ),
            ),
          ],
        ),
      ],
    );
  }

  /// Build promotion button
  Widget _buildPromotionButton() {
    return GestureDetector(
      onTap: onPromotionTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: _primaryOrange,
          borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
        ),
        child: const Text(
          'Продвижение',
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w500,
            color: _backgroundColor,
          ),
        ),
      ),
    );
  }

  /// Build status badge below the card
  Widget _buildStatusBadge() {
    Color statusColor;
    String statusText;

    switch (establishment.status) {
      case EstablishmentStatus.draft:
        statusColor = _statusPending;
        statusText = 'Черновик';
        break;
      case EstablishmentStatus.pending:
        statusColor = _statusPending;
        statusText = 'На модерации';
        break;
      case EstablishmentStatus.approved:
        statusColor = _statusApproved;
        statusText = 'Одобрено';
        break;
      case EstablishmentStatus.rejected:
        statusColor = _statusRejected;
        statusText = 'Отклонено';
        break;
      case EstablishmentStatus.suspended:
        statusColor = _statusSuspended;
        statusText = 'Приостановлено';
        break;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Text(
            statusText,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w500,
              color: statusColor,
            ),
          ),
        ),
        // Feedback section for rejected/suspended
        if (establishment.status == EstablishmentStatus.rejected &&
            establishment.hasModerationFeedback)
          _buildFeedbackHint(
            establishment.rejectionReason ?? 'Есть комментарии модератора',
            _statusRejected,
          ),
        if (establishment.status == EstablishmentStatus.suspended &&
            establishment.suspendReason != null)
          _buildFeedbackHint(
            establishment.suspendReason!,
            _statusSuspended,
          ),
      ],
    );
  }

  /// Build compact feedback hint below status badge
  Widget _buildFeedbackHint(String text, Color color) {
    return Container(
      margin: const EdgeInsets.only(right: 12, left: 12, bottom: 4),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.info_outline, size: 14, color: color),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              text,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
