import 'dart:math' as math;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

/// Фото из сети в мелкой рамке (`BoxFit.cover`), декодированное под рамку,
/// а не в полный размер файла.
///
/// Только для рамок, которые в несколько раз мельче фото: превью на карте
/// (100 dp), карточка прогулки (56), отзывы в профиле (59), статистика
/// кабинета (107 × 116). Без ужатия фото там держится в памяти целиком —
/// 1200 × 1600 точек (≈ 7,7 МБ) или 1920 × 2560 (≈ 19,7 МБ) ради рамки в
/// 168–348 точек на телефоне ×3 — и рисуется с «зерном»: большое фото в
/// маленькой рамке телефон рисует без сглаживания (`FilterQuality.low`).
/// Ужатое — глаже и ближе к оригиналу (замер на фото с прода, 25.10.2026).
///
/// В ленте, на главном фото карточки, в меню и акциях — не применять: там
/// фото крупнее рамки лишь в 1,1–2,3 раза, и ужатие при декодировании вместе
/// с пересчётом при отрисовке делает фото мягче (замер 25.10.2026, карточка
/// ленты на ×3: близость к оригиналу 37–41 → 32–36 дБ). Вид там Координатор
/// оставил прежним (25.10.2026).
///
/// Рамку фото закрывает целиком: декодированное фото не меньше рамки ×
/// плотность экрана по обеим сторонам — при любом соотношении сторон фото от
/// 1 : 2 до 2 : 1 (см. [decodeSize]). Больше, чем в файле, не декодируется
/// никогда.
///
/// Адрес и скачивание не меняются: кеш на диске хранит файл как пришёл.
/// `maxWidthDiskCache` здесь сознательно не задан — `flutter_cache_manager`
/// 3.4.1 кладёт ужатую копию на диск рядом с оригиналом, а не вместо него, и в
/// PNG (тяжелее JPEG того же фото); кеш ограничен 200 файлами, и каждая такая
/// пара вытесняла бы вдвое больше фото — их пришлось бы скачивать снова.
///
/// Полноэкранная галерея этим виджетом не пользуется: там увеличение до ×4, ей
/// нужен файл целиком.
class FrameCachedImage extends StatelessWidget {
  const FrameCachedImage({
    super.key,
    required this.imageUrl,
    this.width,
    this.height,
    this.placeholder,
    this.errorWidget,
  });

  final String imageUrl;

  /// Размер рамки, если его задаёт сама картинка. Не задан — берётся из
  /// ограничений родителя.
  final double? width;
  final double? height;

  final PlaceholderWidgetBuilder? placeholder;
  final LoadingErrorWidgetBuilder? errorWidget;

  /// Самое узкое (1 : 2) и самое широкое (2 : 1) фото, которое при декодировании
  /// по [decodeSize] ещё закрывает рамку без растяжения. Фото с телефона — от
  /// 9 : 16 до 16 : 9 — внутри с запасом.
  static const double narrowestAspect = 1 / 2;
  static const double widestAspect = 2;

  /// Размер декодирования для рамки [frame] (dp) на экране с плотностью
  /// [devicePixelRatio]: задаётся ровно одна сторона, вторая следует из
  /// пропорций файла.
  ///
  /// Задать обе стороны нельзя: `ResizeImage` тогда растянет фото в эти
  /// размеры без сохранения пропорций. А при одной стороне соотношение сторон
  /// фото заранее неизвестно, поэтому сторона берётся с запасом: в широкой
  /// рамке ширина декодирования — не меньше высоты рамки × [widestAspect],
  /// в высокой высота — не меньше ширины рамки / [narrowestAspect]. Тогда фото
  /// любой формы между ними закрывает рамку по обеим сторонам.
  ///
  /// Рамка без конечного размера — без ужатия.
  static ({int? width, int? height}) decodeSize(
    Size frame,
    double devicePixelRatio,
  ) {
    if (!frame.width.isFinite || !frame.height.isFinite || frame.isEmpty) {
      return (width: null, height: null);
    }
    final w = frame.width * devicePixelRatio;
    final h = frame.height * devicePixelRatio;
    if (w >= h) {
      return (width: math.max(w, h * widestAspect).ceil(), height: null);
    }
    return (width: null, height: math.max(h, w / narrowestAspect).ceil());
  }

  @override
  Widget build(BuildContext context) {
    final explicit = width != null && height != null;
    if (explicit) return _image(context, Size(width!, height!));
    return LayoutBuilder(
      builder: (context, constraints) => _image(
        context,
        Size(width ?? constraints.maxWidth, height ?? constraints.maxHeight),
      ),
    );
  }

  Widget _image(BuildContext context, Size frame) {
    final decode = decodeSize(frame, MediaQuery.devicePixelRatioOf(context));
    return CachedNetworkImage(
      imageUrl: imageUrl,
      width: width,
      height: height,
      fit: BoxFit.cover,
      memCacheWidth: decode.width,
      memCacheHeight: decode.height,
      placeholder: placeholder,
      errorWidget: errorWidget,
    );
  }
}
