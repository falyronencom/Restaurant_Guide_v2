import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
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
  /// Высота по макету — она же наименьшая: выше карточка становится, только
  /// когда содержимое в неё не помещается (см. [build]).
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

  /// Предел системного размера шрифта внутри карточки.
  ///
  /// Высоту карточка добирает сама (см. [build]), а ширина задана макетом и
  /// от шрифта не зависит: колонка текста ≈163 dp на 390-dp телефоне,
  /// квадрат рейтинга [_ratingSize]. Настройка телефона «Размер шрифта»
  /// увеличивает буквы, а не их коробки, и без предела (замер 29.09.2026
  /// шрифтами сборки на 360 и 390 dp) рейтинг обрезался с ×1,35 на любой
  /// карточке («4,5» → «4,»), кухня рвалась посреди слова (самая длинная в
  /// справочнике, «Вегетарианская», на 360 dp — с ×1,25). ×1,2 — наибольший
  /// шаг, при котором целы и рейтинг, и слова; заодно предел держит в рамках
  /// рост высоты. Наезд длинных типа и кухни на цену на узких экранах — дело
  /// не шрифта, а вёрстки правой колонки («{Вегетарианская}» при «$$$»
  /// касалась цены уже при ×1,0): его снимает [_CardHeader].
  /// Полный размер текста — на странице заведения. Обложка «Избранного»
  /// ограничена так же, своим пределом.
  static const double _maxTextScale = 1.2;

  /// Тип заведения и кухня (Avenir Next по макету, 13px) и цена под
  /// рейтингом. Кегли нужны и раскладке верха: по ним она находит, где буквы
  /// строк и цены (см. [_CardHeader]).
  static const TextStyle _categoryStyle = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w400,
    color: AppTheme.textPrimary,
    height: 20 / 13,
  );
  static const TextStyle _cuisineStyle = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w400,
    color: _greyText,
    height: 20 / 13,
  );
  static const TextStyle _priceStyle = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w400,
    color: AppTheme.textPrimary,
    height: 25 / 15,
  );

  @override
  Widget build(BuildContext context) {
    return MediaQuery.withClampedTextScaling(
      maxScaleFactor: _maxTextScale,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          // Не ниже макета; выше — только когда содержимое не помещается.
          // Название и адрес в две строки вместе с расстоянием и «Онлайн
          // бронь» не помещались в макетную высоту уже при обычном шрифте.
          constraints: const BoxConstraints(minHeight: _cardHeight),
          margin: const EdgeInsets.symmetric(horizontal: 13, vertical: 15),
          // Высоту задаёт колонка текста, фото тянется за ней сверху донизу.
          // Row так не умеет: растянуть фото по соседу он может только через
          // IntrinsicHeight, а заголовок и адрес построены на LayoutBuilder,
          // который собственных размеров не сообщает.
          child: Stack(
            fit: StackFit.passthrough,
            children: [
              // Left: Image with custom shape + optional promotion badge
              Positioned(
                left: 0,
                top: 0,
                bottom: 0,
                width: _imageWidth,
                child: _buildImageWithBadge(),
              ),
              // Right: Content area
              Padding(
                padding: const EdgeInsets.only(left: _imageWidth),
                child: _buildContentArea(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Wrap image with optional [АКЦИЯ] badge overlay
  Widget _buildImageWithBadge() {
    if (!establishment.hasPromotion) return _buildImage();

    // Размер задаёт карточка: фото с плашкой тянется на всю её высоту.
    return Stack(
      fit: StackFit.expand,
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
    );
  }

  /// Build image with rounded corners mask (Figma design)
  /// Размер задаёт карточка: ширина [_imageWidth], высота — вся карточка.
  Widget _buildImage() {
    return ClipPath(
      clipper: _ImageClipper(),
      child: SizedBox.expand(
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
              // Name, category, cuisine; rating badge and price (top right)
              _buildHeader(),
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

  /// Верх карточки: название, тип и кухня слева, бейдж рейтинга с ценой под
  /// ним — справа. Тип и кухня уступают цене место, только если их буквы с
  /// ней сходятся, — см. [_CardHeader].
  Widget _buildHeader() {
    return _CardHeader(
      title: _buildName(),
      category: _buildCategory(),
      cuisine: _buildCuisine(),
      rating: _buildRatingBadge(),
      price: _buildPrice(),
      categoryFontSize: _categoryStyle.fontSize!,
      cuisineFontSize: _cuisineStyle.fontSize!,
      priceFontSize: _priceStyle.fontSize!,
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
  /// Одной строкой: упёрлась в цену — многоточие (см. [_CardHeader]).
  Widget _buildCategory() {
    return Text(
      _getCategoryLabel(establishment.category),
      style: _categoryStyle,
      maxLines: 1,
      softWrap: false,
      overflow: TextOverflow.ellipsis,
    );
  }

  /// Build cuisine in brackets (Avenir Next, 13px, grey)
  /// Одной строкой: упёрлась в цену — многоточие внутри скобок.
  Widget? _buildCuisine() {
    final cuisine = establishment.cuisine;
    if (cuisine == null) return null;
    return _BracedText(cuisine, style: _cuisineStyle);
  }

  /// Build rating badge (Figma design)
  Widget? _buildRatingBadge() {
    final rating = establishment.rating;
    if (rating == null) return null;
    return Container(
      width: _ratingSize,
      height: _ratingSize,
      decoration: BoxDecoration(
        color: _greenColor,
        borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
      ),
      alignment: Alignment.center,
      child: Text(
        rating.toStringAsFixed(1).replaceAll('.', ','),
        style: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w400,
          color: _backgroundColor,
          height: 25 / 16,
        ),
      ),
    );
  }

  /// Build price range under the rating badge (Figma design)
  Widget? _buildPrice() {
    final priceRange = establishment.priceRange;
    if (priceRange == null) return null;
    return Text(priceRange, style: _priceStyle);
  }

  /// Build status with closing time (Figma design)
  Widget _buildStatus() {
    final isOpen = establishment.isCurrentlyOpen;
    final closingTime = establishment.todayClosingTime;

    // RichText, в отличие от Text, стиль темы НЕ наследует: у корневого
    // TextSpan без семейства строка рисуется системным шрифтом. И размер
    // шрифта из настроек телефона он сам не читает — без явного textScaler
    // строка оставалась мелкой при любом системном шрифте. Масштаб берётся
    // из контекста ПОД пределом карточки (отсюда Builder): контекст самой
    // карточки лежит выше предела, и строка росла бы без ограничения.
    return Builder(
      builder: (context) => RichText(
        textScaler: MediaQuery.textScalerOf(context),
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

/// Стиль, которым `Text` рисует на самом деле, — той же сборкой, что и в
/// `Text.build`: слияние с `DefaultTextStyle` и системный «жирный текст».
/// Замер «влезет ли» голым стилем промахивается: тема приносит межбуквенный
/// интервал 0.1 dp на знак.
TextStyle _renderedStyle(BuildContext context, TextStyle style) {
  var effective = style;
  if (effective.inherit) {
    effective = DefaultTextStyle.of(context).style.merge(effective);
  }
  if (MediaQuery.boldTextOf(context)) {
    effective = effective.merge(const TextStyle(fontWeight: FontWeight.bold));
  }
  return effective;
}

/// Места верха карточки.
enum _HeaderSlot { title, category, cuisine, rating, price }

/// Верх карточки: название, тип заведения и кухня слева, бейдж рейтинга с
/// ценой под ним — справа.
///
/// Зачем своя раскладка. Колонка «рейтинг над ценой» стоит поверх текста, и
/// место под неё отведено только названию. Тип и кухня оказываются рядом с
/// ценой, когда название уместилось в одну строку, а сколько у него строк,
/// известно лишь после его раскладки. Поэтому раскладка общая: сначала
/// колонка и название, потом каждая строка на своём месте — и только строка,
/// которая в колонку упирается, получает ширину до неё. Постоянный отступ
/// справа у типа и кухни резал бы их и под колонкой, где место есть
/// (название в две строки).
///
/// «Упирается» — по буквам, а не по коробкам. Коробка строки выше её букв на
/// межстрочный интервал, и коробки кухни и цены пересекаются и там, где буквы
/// расходятся на 5–10 dp: кухня проходит под ценой. Строка, чьи буквы
/// сходятся с буквами цены или с квадратом рейтинга (как именно — у
/// [_RenderCardHeader._nearBy]), кончается многоточием перед ними (решение
/// Координатора 30.09.2026). Строка, чья коробка в колонку не заходит, не
/// меняется: при обычном шрифте — байт в байт.
///
/// Где буквы сходятся (замер по пикселям 30.09.2026, ревью того же дня):
/// длинные значения справочника — «{Вегетарианская}», «{Американская}»,
/// «Кондитерская» — на экранах уже 391 dp; чем ниже строка названия, тем
/// выше тип и кухня, и хуже всех название, ужатое до пола кегля в одну
/// строку. С ценами «$»–«$$$» — при обычном шрифте до 364 dp, при ×1,2 до
/// 384 dp; с «$$$$», который допускает база, — до 370 и 390 dp. У 26
/// карточек прода буквы на экранах от 360 dp не сходились ближе 3,5 dp, и
/// там раскладка их не меняет; уже — на 356–358 dp при ×1,2 — «Европейская»
/// и «Итальянская» подходят к «$$» на 0,9–3 dp и обрываются.
///
/// Высота — название, тип и кухня: колонка на неё не влияет, как и прежде,
/// когда она лежала поверх текста.
class _CardHeader
    extends SlottedMultiChildRenderObjectWidget<_HeaderSlot, RenderBox> {
  const _CardHeader({
    required this.title,
    required this.category,
    required this.cuisine,
    required this.rating,
    required this.price,
    required this.categoryFontSize,
    required this.cuisineFontSize,
    required this.priceFontSize,
  });

  final Widget title;
  final Widget category;
  final Widget? cuisine;
  final Widget? rating;
  final Widget? price;

  /// Кегли до масштаба: по ним раскладка находит, где буквы.
  final double categoryFontSize;
  final double cuisineFontSize;
  final double priceFontSize;

  @override
  Iterable<_HeaderSlot> get slots => _HeaderSlot.values;

  @override
  Widget? childForSlot(_HeaderSlot slot) => switch (slot) {
        _HeaderSlot.title => title,
        _HeaderSlot.category => category,
        _HeaderSlot.cuisine => cuisine,
        _HeaderSlot.rating => rating,
        _HeaderSlot.price => price,
      };

  // Масштаб текста — из контекста самого верха, то есть под пределом
  // карточки, тем же, что у строк.
  @override
  _RenderCardHeader createRenderObject(BuildContext context) {
    return _RenderCardHeader(
      categoryFontSize: categoryFontSize,
      cuisineFontSize: cuisineFontSize,
      priceFontSize: priceFontSize,
      textScaler: MediaQuery.textScalerOf(context),
    );
  }

  @override
  void updateRenderObject(
      BuildContext context, _RenderCardHeader renderObject) {
    renderObject
      ..categoryFontSize = categoryFontSize
      ..cuisineFontSize = cuisineFontSize
      ..priceFontSize = priceFontSize
      ..textScaler = MediaQuery.textScalerOf(context);
  }
}

class _RenderCardHeader extends RenderBox
    with SlottedContainerRenderObjectMixin<_HeaderSlot, RenderBox> {
  _RenderCardHeader({
    required double categoryFontSize,
    required double cuisineFontSize,
    required double priceFontSize,
    required TextScaler textScaler,
  })  : _categoryFontSize = categoryFontSize,
        _cuisineFontSize = cuisineFontSize,
        _priceFontSize = priceFontSize,
        _textScaler = textScaler;

  /// Отступ под названием.
  static const double _titleGap = 2;

  /// От бейджа рейтинга до цены.
  static const double _ratingPriceGap = 6;

  /// Оборванная строка кончается за столько dp до колонки.
  static const double _cutGap = 4;

  /// Строка сходится с препятствием колонки, если её коробка заходит за его
  /// левый край и полосы букв по высоте перекрываются или расходятся меньше
  /// чем на столько (сглаживание краёв букв и приблизительность полос).
  static const double _nearBy = 1.75;

  /// Полосы букв перекрываются на столько и больше — буквы стоят вровень, и
  /// касание наступает при любом заходе коробки: поля знаков у «}» и «$»
  /// вместе около 1,2 dp. Меньше — буквы встречаются углами (скобка кухни под
  /// «$»), и касаются, только если строка зашла глубже [_cornerIntrusion].
  static const double _sideBySide = 4;
  static const double _cornerIntrusion = 1.5;

  // Пороги подобраны по пиксельному замеру 30.09.2026: 25 920 строк (три
  // формы названия, 12 пар тип/кухня, четыре цены, 356–390 dp, ×1,0–1,2),
  // касание — буквы ближе 1 dp. Все 855 касаний обрываются; обрывается и
  // около половины строк, чьи буквы подходили к цене на 1,3–4,3 dp: почти
  // все ближе 2 dp, дальше 3 dp — редко (тесно). Ревью проверило и 12 192
  // сочетания вне подбора — касаний после правки нет.
  // Пропуски появлялись бы при [_nearBy] ниже 1,3, [_sideBySide] выше 5 или
  // [_cornerIntrusion] выше 2 — выбраны значения с запасом.

  /// Где буквы от базовой линии, в долях кегля — Nunito Sans, по файлу
  /// шрифта: «$» поднимается на 0,82 и опускается на 0,115; заглавные и
  /// фигурные скобки поднимаются на 0,705, скобки и «р», «у» опускаются на
  /// 0,18. Смена шрифта тела требует перемерить и доли, и пороги.
  static const double _priceInkAbove = 0.82;
  static const double _priceInkBelow = 0.115;
  static const double _lineInkAbove = 0.705;
  static const double _lineInkBelow = 0.18;

  double _categoryFontSize;
  set categoryFontSize(double value) {
    if (value == _categoryFontSize) return;
    _categoryFontSize = value;
    markNeedsLayout();
  }

  double _cuisineFontSize;
  set cuisineFontSize(double value) {
    if (value == _cuisineFontSize) return;
    _cuisineFontSize = value;
    markNeedsLayout();
  }

  double _priceFontSize;
  set priceFontSize(double value) {
    if (value == _priceFontSize) return;
    _priceFontSize = value;
    markNeedsLayout();
  }

  TextScaler _textScaler;
  set textScaler(TextScaler value) {
    if (value == _textScaler) return;
    _textScaler = value;
    markNeedsLayout();
  }

  static BoxParentData _parentData(RenderBox child) =>
      child.parentData! as BoxParentData;

  /// Текст снизу, колонка поверх — как было, когда колонка лежала над
  /// текстом в Stack.
  Iterable<RenderBox> get _paintOrder => const [
        _HeaderSlot.title,
        _HeaderSlot.category,
        _HeaderSlot.cuisine,
        _HeaderSlot.rating,
        _HeaderSlot.price,
      ].map(childForSlot).whereType<RenderBox>();

  /// Верх и низ букв текста [child], стоящего на высоте [top]: от базовой
  /// линии на доли кегля [fontSize]. Нет базовой линии — вся коробка.
  (double, double) _inkBand(RenderBox child, double top, double fontSize,
      double above, double below) {
    final baseline = child.getDistanceToBaseline(TextBaseline.alphabetic,
        onlyReal: true);
    if (baseline == null) return (top, top + child.size.height);
    final size = _textScaler.scale(fontSize);
    return (top + baseline - above * size, top + baseline + below * size);
  }

  @override
  void performLayout() {
    assert(constraints.hasBoundedWidth);
    final width = constraints.maxWidth;
    final loose = BoxConstraints(maxWidth: width);

    // Колонка у правого края: бейдж, под ним цена, центры на одной
    // вертикали.
    final rating = childForSlot(_HeaderSlot.rating);
    final price = childForSlot(_HeaderSlot.price);
    rating?.layout(loose, parentUsesSize: true);
    price?.layout(loose, parentUsesSize: true);
    final columnWidth =
        math.max(rating?.size.width ?? 0.0, price?.size.width ?? 0.0);
    final columnLeft = width - columnWidth;

    // Где в колонке буквы: левый край, верх, низ. Бейдж залит целиком.
    final obstacles = <(double, double, double)>[];
    if (rating != null) {
      final offset =
          Offset(columnLeft + (columnWidth - rating.size.width) / 2, 0);
      _parentData(rating).offset = offset;
      obstacles.add((offset.dx, 0, rating.size.height));
    }
    if (price != null) {
      final offset = Offset(
        columnLeft + (columnWidth - price.size.width) / 2,
        (rating?.size.height ?? 0) + _ratingPriceGap,
      );
      _parentData(price).offset = offset;
      final (top, bottom) = _inkBand(
          price, offset.dy, _priceFontSize, _priceInkAbove, _priceInkBelow);
      obstacles.add((offset.dx, top, bottom));
    }

    final title = childForSlot(_HeaderSlot.title)!;
    title.layout(loose, parentUsesSize: true);
    _parentData(title).offset = Offset.zero;
    var y = title.size.height + _titleGap;

    for (final (slot, fontSize) in [
      (_HeaderSlot.category, _categoryFontSize),
      (_HeaderSlot.cuisine, _cuisineFontSize),
    ]) {
      final line = childForSlot(slot);
      if (line == null) continue;
      line.layout(loose, parentUsesSize: true);
      final (inkTop, inkBottom) =
          _inkBand(line, y, fontSize, _lineInkAbove, _lineInkBelow);
      double? limit;
      for (final (left, top, bottom) in obstacles) {
        final overlap = math.min(inkBottom, bottom) - math.max(inkTop, top);
        if (overlap <= -_nearBy) continue;
        final intrusion = line.size.width - left;
        if (intrusion > (overlap >= _sideBySide ? 0 : _cornerIntrusion)) {
          limit = math.min(limit ?? left, left);
        }
      }
      if (limit != null) {
        line.layout(
          BoxConstraints(maxWidth: math.max(0.0, limit - _cutGap)),
          parentUsesSize: true,
        );
      }
      _parentData(line).offset = Offset(0, y);
      y += line.size.height;
    }

    size = constraints.constrain(Size(width, y));
  }

  @override
  void paint(PaintingContext context, Offset offset) {
    for (final child in _paintOrder) {
      context.paintChild(child, _parentData(child).offset + offset);
    }
  }

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) {
    for (final child in _paintOrder.toList().reversed) {
      final isHit = result.addWithPaintOffset(
        offset: _parentData(child).offset,
        position: position,
        hitTest: (result, transformed) =>
            child.hitTest(result, position: transformed),
      );
      if (isHit) return true;
    }
    return false;
  }

  @override
  double? computeDistanceToActualBaseline(TextBaseline baseline) {
    final title = childForSlot(_HeaderSlot.title);
    final distance = title?.getDistanceToActualBaseline(baseline);
    return distance == null ? null : distance + _parentData(title!).offset.dy;
  }

  // Собственных размеров без раскладки верх не знает — как и название на
  // LayoutBuilder: строки подгоняются по месту.

  @override
  double computeMinIntrinsicWidth(double height) {
    assert(_debugThrowIfNotCheckingIntrinsics());
    return 0.0;
  }

  @override
  double computeMaxIntrinsicWidth(double height) {
    assert(_debugThrowIfNotCheckingIntrinsics());
    return 0.0;
  }

  @override
  double computeMinIntrinsicHeight(double width) {
    assert(_debugThrowIfNotCheckingIntrinsics());
    return 0.0;
  }

  @override
  double computeMaxIntrinsicHeight(double width) {
    assert(_debugThrowIfNotCheckingIntrinsics());
    return 0.0;
  }

  @override
  Size computeDryLayout(covariant BoxConstraints constraints) {
    assert(debugCannotComputeDryLayout(
      reason: 'The card header fits its lines by laying them out.',
    ));
    return Size.zero;
  }

  bool _debugThrowIfNotCheckingIntrinsics() {
    assert(() {
      if (!RenderObject.debugCheckingIntrinsics) {
        throw FlutterError(
          'The establishment card header does not support returning intrinsic '
          'dimensions: it fits its lines by laying them out.',
        );
      }
      return true;
    }());
    return true;
  }
}

/// Кухня в фигурных скобках одной строкой. Не помещается — многоточие
/// внутри скобок: «{Вегетарианс…}», а не «{Вегетарианс…» без закрывающей,
/// как оборвал бы `Text`.
///
/// Места не хватает, когда кухня упирается в цену (см. [_CardHeader]) или
/// шире всей колонки (356 dp при ×1,2 — прежний `Text` рвал слово по
/// буквам); помещается — это прежний `Text`. Замер — стилем, каким рисует `Text`
/// ([_renderedStyle]), с масштабом из `MediaQuery` и по ширине, которую
/// строке отдали на самом деле (`LayoutBuilder`).
class _BracedText extends StatelessWidget {
  const _BracedText(this.value, {required this.style});

  final String value;
  final TextStyle style;

  @override
  Widget build(BuildContext context) {
    final rendered = _renderedStyle(context, style);
    final textScaler = MediaQuery.textScalerOf(context);
    final direction = Directionality.of(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final full = '{$value}';
        final text =
            _fitted(rendered, constraints.maxWidth, textScaler, direction);
        return Text(
          text,
          style: style,
          maxLines: 1,
          softWrap: false,
          // Экранный чтец читает оборванную кухню целиком — как тип, который
          // обрывает многоточием сам движок.
          semanticsLabel: text == full ? null : full,
        );
      },
    );
  }

  /// Полный текст, если помещается; иначе самое длинное начало слова,
  /// которое помещается вместе с «…}».
  String _fitted(
    TextStyle rendered,
    double maxWidth,
    TextScaler textScaler,
    TextDirection direction,
  ) {
    final full = '{$value}';
    if (!maxWidth.isFinite) return full;

    final painter = TextPainter(
      textDirection: direction,
      textScaler: textScaler,
      maxLines: 1,
    );
    try {
      bool fits(String text) {
        painter.text = TextSpan(text: text, style: rendered);
        painter.layout();
        return painter.width <= maxWidth;
      }

      if (fits(full)) return full;
      final letters = value.characters.toList();
      for (var n = letters.length - 1; n > 0; n--) {
        final cut = '{${letters.take(n).join().trimRight()}…}';
        if (fits(cut)) return cut;
      }
      return '{…}';
    } finally {
      painter.dispose();
    }
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

  @override
  Widget build(BuildContext context) {
    final rendered = _renderedStyle(context, style);
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
