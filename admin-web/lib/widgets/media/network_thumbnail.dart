import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

/// Снимок по сети с заглушкой, пока он грузится (Ч21, проход 20.10).
///
/// До 21.10.2026 до прихода байтов на месте фото стоял пустой квадрат без
/// рамки и заливки — читалось как «фото нет». Теперь до первого кадра
/// рисуется [placeholder] (или ровная подложка канона), при сбое — [fallback].
class NetworkThumbnail extends StatelessWidget {
  final String url;

  /// Что показать, если снимок не загрузился: битая ссылка, удалённый файл.
  final Widget fallback;

  /// Что показать до первого кадра. По умолчанию — подложка с иконкой.
  final Widget? placeholder;

  final BoxFit fit;

  const NetworkThumbnail({
    super.key,
    required this.url,
    required this.fallback,
    this.placeholder,
    this.fit = BoxFit.cover,
  });

  /// Ключ подложки — по нему тест отличает «ещё грузится» от «загрузилось».
  static const Key placeholderKey = ValueKey<String>('network-thumbnail-loading');

  @override
  Widget build(BuildContext context) {
    return Image.network(
      url,
      fit: fit,
      frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
        if (wasSynchronouslyLoaded || frame != null) return child;
        return KeyedSubtree(
          key: placeholderKey,
          child: placeholder ?? const _LoadingPlate(),
        );
      },
      errorBuilder: (_, __, ___) => fallback,
    );
  }
}

class _LoadingPlate extends StatelessWidget {
  const _LoadingPlate();

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: AppTheme.gray100,
      child: Center(
        child: Icon(Icons.image_outlined, size: 22, color: AppTheme.strokeGrey),
      ),
    );
  }
}
