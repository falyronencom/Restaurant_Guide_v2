import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/widgets/adaptive_title.dart';

/// Reusable card component for displaying establishment information
/// Figma design implementation with image on left, content on right
class EstablishmentCard extends StatelessWidget {
  final Establishment establishment;
  final bool isFavorite;
  final VoidCallback? onTap;
  final VoidCallback? onFavoriteToggle;
  final double? distanceKm;

  const EstablishmentCard({
    super.key,
    required this.establishment,
    this.isFavorite = false,
    this.onTap,
    this.onFavoriteToggle,
    this.distanceKm,
  });

  // Figma colors
  static const Color _backgroundColor = AppTheme.backgroundWarm;
  static const Color _greenColor = AppTheme.statusGreen;
  static const Color _orangeHeart = AppTheme.primaryOrange;
  static const Color _greyText = Color(0xFFAAAAAA);

  // Figma dimensions
  static const double _cardHeight = 291.0;
  static const double _imageWidth = 172.0;
  static const double _ratingSize = 31.0;

  // Сердечко избранного: сама иконка + прозрачный паддинг под палец.
  static const double _favoriteIconSize = 27.0;
  static const double _favoriteTapPadding = 8.0;

  /// Сдвиг кнопки избранного, ставящий центр сердечка на ту же вертикаль,
  /// что центр бейджа рейтинга и цена под ним. Бейдж прижат к правому краю
  /// контента → его центр в _ratingSize/2 от края; центр иконки — в
  /// (паддинг + половина иконки) от края кнопки. Разница и есть смещение
  /// (отрицательное = кнопка выезжает в правый паддинг контента, 15px —
  /// хватает с запасом, скругление угла 40px не задевается).
  static const double _favoriteAxisOffset =
      _ratingSize / 2 - (_favoriteTapPadding + _favoriteIconSize / 2);

  /// Ширина зоны, занятой сердечком у правого края контента, — на неё
  /// резервируется отступ адреса.
  static const double _favoriteReserve =
      _favoriteIconSize + _favoriteTapPadding * 2 + _favoriteAxisOffset;

  /// Отступ названия под правую колонку (бейдж рейтинга + цена под ним).
  /// Действует на ОБЕ строки: колонка высотой 31+6+25=62dp перекрывает по
  /// высоте оба ряда заголовка (~50dp), свободной второй строки не бывает.
  static const double _titleBadgeReserve = _ratingSize + 12;

  /// Пол подбора кегля заголовка: ниже — многоточие вместо уменьшения.
  static const double _titleMinFontSize = 15.0;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: _cardHeight,
        margin: const EdgeInsets.symmetric(horizontal: 13, vertical: 15),
        child: Row(
          children: [
            // Left: Image with custom shape + optional promotion badge
            _buildImageWithBadge(),
            // Right: Content area
            Expanded(child: _buildContentArea()),
          ],
        ),
      ),
    );
  }

  /// Wrap image with optional [АКЦИЯ] badge overlay
  Widget _buildImageWithBadge() {
    if (!establishment.hasPromotion) return _buildImage();

    return SizedBox(
      width: _imageWidth,
      height: _cardHeight,
      child: Stack(
        children: [
          _buildImage(),
          Positioned(
            bottom: 12,
            left: 8,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: _orangeHeart,
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text(
                'АКЦИЯ',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Build image with rounded corners mask (Figma design)
  Widget _buildImage() {
    return ClipPath(
      clipper: _ImageClipper(),
      child: SizedBox(
        width: _imageWidth,
        height: _cardHeight,
        child: establishment.thumbnailUrl != null
            ? CachedNetworkImage(
                imageUrl: establishment.thumbnailUrl!,
                fit: BoxFit.cover,
                placeholder: (context, url) => Container(
                  color: Colors.grey[300],
                  child: const Center(
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
                errorWidget: (context, url, error) => Container(
                  color: Colors.grey[300],
                  child: const Icon(Icons.restaurant, size: 48, color: Colors.grey),
                ),
              )
            : Container(
                color: Colors.grey[300],
                child: const Icon(Icons.restaurant, size: 48, color: Colors.grey),
              ),
      ),
    );
  }

  /// Build content area with beige background (Figma design)
  Widget _buildContentArea() {
    return Container(
      decoration: const BoxDecoration(
        color: _backgroundColor,
        borderRadius: BorderRadius.only(
          topRight: Radius.circular(10),
          bottomRight: Radius.circular(40),
        ),
        boxShadow: [
          BoxShadow(
            color: Color(0x0AD35620),
            offset: Offset(4, 4),
            blurRadius: 15,
            spreadRadius: 2,
          ),
          BoxShadow(
            color: Color(0x0AD35620),
            offset: Offset(-4, -4),
            blurRadius: 15,
            spreadRadius: 2,
          ),
        ],
      ),
      padding: const EdgeInsets.fromLTRB(14, 38, 15, 16),
      child: Stack(
        children: [
          // Main content column
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Name
              _buildName(),
              const SizedBox(height: 2),
              // Category (type)
              _buildCategory(),
              // Cuisine in brackets
              _buildCuisine(),
              const SizedBox(height: 20),
              // Status with closing time
              _buildStatus(),
              const SizedBox(height: 17),
              // Distance
              if (distanceKm != null) _buildDistance(),
              // Address
              _buildAddress(),
              // Booking indicator
              if (establishment.bookingEnabled)
                const Text(
                  'Онлайн бронь',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.successGreen,
                    height: 18 / 12,
                  ),
                ),
            ],
          ),
          // Rating badge (top right)
          Positioned(
            top: 0,
            right: 0,
            child: _buildRatingAndPrice(),
          ),
          // Favorite button (bottom right) — по одной вертикали с рейтингом
          Positioned(
            bottom: 0,
            right: _favoriteAxisOffset,
            child: _buildFavoriteButton(),
          ),
        ],
      ),
    );
  }

  /// Build establishment name — «витринный» заголовок карточки через токен
  /// AppTheme.canonCardTitle (шрифт и кегль заданы там — единый источник правды).
  /// Раньше стоял широкий Unbounded, из-за которого даже «Сорренто» не влезало
  /// в строку и ломалось по буквам.
  /// Right padding prevents overlap with rating badge + price column
  Widget _buildName() {
    return Padding(
      padding: const EdgeInsets.only(right: _titleBadgeReserve),
      child: AdaptiveTitle(
        text: establishment.name,
        style: AppTheme.canonCardTitle,
        minFontSize: _titleMinFontSize,
      ),
    );
  }

  /// Build category/type (Avenir Next, 13px)
  Widget _buildCategory() {
    return Text(
      _getCategoryLabel(establishment.category),
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w400,
        color: AppTheme.textPrimary,
        height: 20 / 13,
      ),
    );
  }

  /// Build cuisine in brackets (Avenir Next, 13px, grey)
  Widget _buildCuisine() {
    if (establishment.cuisine == null) return const SizedBox.shrink();

    return Text(
      '{${establishment.cuisine}}',
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w400,
        color: _greyText,
        height: 20 / 13,
      ),
    );
  }

  /// Build rating badge and price (Figma design)
  Widget _buildRatingAndPrice() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        // Rating badge
        if (establishment.rating != null)
          Container(
            width: _ratingSize,
            height: _ratingSize,
            decoration: BoxDecoration(
              color: _greenColor,
              borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
            ),
            alignment: Alignment.center,
            child: Text(
              establishment.rating!.toStringAsFixed(1).replaceAll('.', ','),
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w400,
                color: _backgroundColor,
                height: 25 / 16,
              ),
            ),
          ),
        const SizedBox(height: 6),
        // Price range
        if (establishment.priceRange != null)
          Text(
            establishment.priceRange!,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w400,
              color: AppTheme.textPrimary,
              height: 25 / 15,
            ),
          ),
      ],
    );
  }

  /// Build status with closing time (Figma design)
  Widget _buildStatus() {
    final isOpen = establishment.isCurrentlyOpen;
    final closingTime = establishment.todayClosingTime;

    // RichText, в отличие от Text, стиль темы НЕ наследует: у корневого
    // TextSpan без семейства строка рисуется системным шрифтом.
    return RichText(
      text: TextSpan(
        style: const TextStyle(
          fontFamily: AppTheme.fontBodyFamily,
          fontSize: 14,
          fontWeight: FontWeight.w500,
          height: 20 / 14,
        ),
        children: [
          TextSpan(
            text: isOpen ? 'Открыто' : 'Закрыто',
            style: TextStyle(
              color: isOpen ? _greenColor : Colors.red,
            ),
          ),
          if (closingTime != null && isOpen)
            TextSpan(
              text: '/до $closingTime',
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontWeight: FontWeight.w400,
              ),
            ),
        ],
      ),
    );
  }

  /// Build distance text (Figma design)
  Widget _buildDistance() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Text(
        '${distanceKm!.toStringAsFixed(1).replaceAll('.', ',')} км от вас',
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w400,
          color: AppTheme.textPrimary,
          height: 20 / 14,
        ),
      ),
    );
  }

  /// Build address with underline (Figma design)
  /// Правый отступ резервирует место под иконку избранного в правом-нижнем
  /// углу — иначе длинный адрес заходит под неё. Переносится адрес только
  /// между словами — см. [_WholeWordText].
  Widget _buildAddress() {
    return Padding(
      padding: const EdgeInsets.only(right: _favoriteReserve),
      child: _WholeWordText(
        establishment.address,
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w400,
          color: AppTheme.textPrimary,
          decoration: TextDecoration.underline,
          height: 20 / 14,
        ),
        maxLines: 2,
      ),
    );
  }

  /// Build favorite button (Figma design - heart icon)
  Widget _buildFavoriteButton() {
    return GestureDetector(
      onTap: onFavoriteToggle,
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: const EdgeInsets.all(_favoriteTapPadding),
        child: Icon(
          isFavorite ? Icons.favorite : Icons.favorite_border,
          size: _favoriteIconSize,
          color: _orangeHeart,
        ),
      ),
    );
  }

  /// Get category label in Russian
  String _getCategoryLabel(String category) {
    const categoryLabels = {
      'restaurant': 'ресторан',
      'cafe': 'кафе',
      'bar': 'бар',
      'coffee_shop': 'кофейня',
      'fast_food': 'фастфуд',
      'bakery': 'пекарня',
      'pizzeria': 'пиццерия',
    };
    return categoryLabels[category.toLowerCase()] ?? category;
  }

}

/// Текст в узкой колонке, который переносится только между словами.
///
/// На 360 dp колонке адреса достаётся 96 dp, и слово вроде «Независимости,»
/// или «Революционная,» в неё целиком не входит. `Text` с `maxLines: 2` рвёт
/// такое слово по буквам («проспект Нез / ависимости, …»): многоточие
/// Flutter ставит только на последней строке. Поэтому решение принимается до
/// отрисовки: каждое слово помещается в ширину — до [maxLines] строк с
/// переносом между словами; хоть одно не помещается — одна строка с
/// многоточием. Кегль не уменьшается: полный адрес есть на детальной.
///
/// «Слово» здесь — кусок, внутри которого переносить нельзя, и границы кусков
/// определяет сам движок строк, а не деление по пробелам: составное слово он
/// переносит после дефиса («Юрово-» / «Завальная,»), а «« Независимости» с
/// пробелом после кавычки или скобки не делит вовсе. Регулярное выражение
/// повторило бы эти правила Unicode не целиком, и там, где оно разошлось бы
/// с движком, слово снова порвалось бы по буквам.
///
/// Замер — как у [AdaptiveTitle]: тем же стилем, каким рисует `Text` (слияние
/// с `DefaultTextStyle`: тема приносит межбуквенный интервал 0.1, и на 375 dp
/// «Революционная,» из-за него шире колонки на 0.06 dp), с масштабом текста из
/// `MediaQuery` и по ширине, которую колонка отдаёт на самом деле
/// (`LayoutBuilder`). Пересчёта при смене шрифта, как у [AdaptiveTitle], здесь
/// нет: семейство тела вшито и объявлено в pubspec — оно есть с первого
/// кадра, а шрифтов в рантайме приложение не грузит.
class _WholeWordText extends StatelessWidget {
  const _WholeWordText(
    this.text, {
    required this.style,
    required this.maxLines,
  });

  final String text;
  final TextStyle style;
  final int maxLines;

  /// Стиль, которым `Text` будет рисовать на самом деле — той же сборкой, что
  /// и в `Text.build`: слияние с `DefaultTextStyle` и системный «жирный текст».
  TextStyle _renderedStyle(BuildContext context) {
    var effective = style;
    if (effective.inherit) {
      effective = DefaultTextStyle.of(context).style.merge(effective);
    }
    if (MediaQuery.boldTextOf(context)) {
      effective = effective.merge(const TextStyle(fontWeight: FontWeight.bold));
    }
    return effective;
  }

  @override
  Widget build(BuildContext context) {
    final rendered = _renderedStyle(context);
    final textScaler = MediaQuery.textScalerOf(context);
    final direction = Directionality.of(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final wrap = _everyWordFits(
            rendered, constraints.maxWidth, textScaler, direction);
        return Text(
          text,
          style: style,
          maxLines: wrap ? maxLines : 1,
          softWrap: wrap,
          overflow: TextOverflow.ellipsis,
        );
      },
    );
  }

  bool _everyWordFits(
    TextStyle rendered,
    double maxWidth,
    TextScaler textScaler,
    TextDirection direction,
  ) {
    if (maxWidth <= 0 || !maxWidth.isFinite) return true;

    final painter = TextPainter(
      text: TextSpan(text: text, style: rendered),
      textDirection: direction,
      textScaler: textScaler,
    )..layout();
    try {
      // Минимальная собственная ширина абзаца — ширина самого широкого куска,
      // который движок не вправе разорвать. Колонка у́же — он порвёт его по
      // буквам.
      return painter.minIntrinsicWidth <= maxWidth;
    } finally {
      painter.dispose();
    }
  }
}

/// Custom clipper for image with rounded LEFT corners (Figma design - "bathtub" shape)
/// Top-left and bottom-left corners are rounded, right side is straight
class _ImageClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size size) {
    final path = Path();
    const radius = 40.0;

    // Start from top-left corner (after curve)
    path.moveTo(0, radius);
    // Curve at top-left
    path.quadraticBezierTo(0, 0, radius, 0);
    // Line to top-right (straight)
    path.lineTo(size.width, 0);
    // Line down to bottom-right (straight)
    path.lineTo(size.width, size.height);
    // Line to bottom-left (before curve)
    path.lineTo(radius, size.height);
    // Curve at bottom-left
    path.quadraticBezierTo(0, size.height, 0, size.height - radius);
    // Line back to start
    path.lineTo(0, radius);
    path.close();

    return path;
  }

  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}
