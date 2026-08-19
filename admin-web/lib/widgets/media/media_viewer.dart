import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/utils/open_url.dart';

/// Полноэкранный просмотр медиа с увеличением.
///
/// Существует потому, что без него модерация медиа невозможна физически: в
/// сетке снимки идут миниатюрами 120×90, а меню — это текст, который на таком
/// размере не читается. Одобрять меню, не прочитав его, — не модерация.
///
/// Фон затемнён почти до чёрного. Это не новый цвет канона, а функциональная
/// необходимость: снимок нужно смотреть без соседства с интерфейсом.
class MediaViewer extends StatefulWidget {
  final List<MediaItem> items;
  final int initialIndex;

  /// «Фото» или «Меню» — что именно смотрим.
  final String title;

  const MediaViewer({
    super.key,
    required this.items,
    required this.title,
    this.initialIndex = 0,
  });

  @override
  State<MediaViewer> createState() => _MediaViewerState();
}

class _MediaViewerState extends State<MediaViewer> {
  late int _index = widget.initialIndex;
  late final TransformationController _transform = TransformationController();

  static const double _maxScale = 6;

  MediaItem get _current => widget.items[_index];
  bool get _hasPrev => _index > 0;
  bool get _hasNext => _index < widget.items.length - 1;

  @override
  void dispose() {
    _transform.dispose();
    super.dispose();
  }

  void _go(int delta) {
    final next = _index + delta;
    if (next < 0 || next >= widget.items.length) return;
    setState(() {
      _index = next;
      // Масштаб сбрасывается при переходе: увеличенный угол предыдущего
      // снимка на новом кадре означает совсем другое место.
      _transform.value = Matrix4.identity();
    });
  }

  void _toggleZoom(TapDownDetails details) {
    final zoomedIn = _transform.value.getMaxScaleOnAxis() > 1.01;
    if (zoomedIn) {
      _transform.value = Matrix4.identity();
      return;
    }
    // Приближаем к точке нажатия, а не к центру: модератор целится в деталь.
    const scale = 2.5;
    final p = details.localPosition;
    _transform.value = Matrix4.identity()
      ..translateByDouble(-p.dx * (scale - 1), -p.dy * (scale - 1), 0, 1)
      ..scaleByDouble(scale, scale, scale, 1);
  }

  void _openOriginal() => openInNewTab(_current.url);

  @override
  Widget build(BuildContext context) {
    return CallbackShortcuts(
      bindings: <ShortcutActivator, VoidCallback>{
        const SingleActivator(LogicalKeyboardKey.arrowLeft): () => _go(-1),
        const SingleActivator(LogicalKeyboardKey.arrowRight): () => _go(1),
      },
      child: Focus(
        autofocus: true,
        child: Scaffold(
          backgroundColor: Colors.black.withValues(alpha: 0.92),
          body: Column(
            children: [
              _Chrome(
                title: widget.title,
                position: '${_index + 1} из ${widget.items.length}',
                isPdf: _current.isPdf,
                onOpenOriginal: _openOriginal,
                onClose: () => Navigator.of(context).pop(),
              ),
              Expanded(
                child: Row(
                  children: [
                    _ArrowButton(
                      icon: Icons.chevron_left,
                      onTap: _hasPrev ? () => _go(-1) : null,
                    ),
                    Expanded(
                      child: GestureDetector(
                        onDoubleTapDown: _toggleZoom,
                        onDoubleTap: () {},
                        child: InteractiveViewer(
                          transformationController: _transform,
                          maxScale: _maxScale,
                          child: Center(
                            child: _Frame(
                              key: ValueKey(_current.id ?? _current.url),
                              item: _current,
                            ),
                          ),
                        ),
                      ),
                    ),
                    _ArrowButton(
                      icon: Icons.chevron_right,
                      onTap: _hasNext ? () => _go(1) : null,
                    ),
                  ],
                ),
              ),
              const _Hint(),
            ],
          ),
        ),
      ),
    );
  }
}

/// Верхняя панель: что смотрим, какой по счёту, оригинал и закрытие.
class _Chrome extends StatelessWidget {
  final String title;
  final String position;
  final bool isPdf;
  final VoidCallback onOpenOriginal;
  final VoidCallback onClose;

  const _Chrome({
    required this.title,
    required this.position,
    required this.isPdf,
    required this.onOpenOriginal,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 64,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Row(
        spacing: 12,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: Colors.white,
            ),
          ),
          Text(
            position,
            style: TextStyle(
              fontSize: 13,
              color: Colors.white.withValues(alpha: 0.65),
            ),
          ),
          if (isPdf)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppTheme.disclaimerBg,
                borderRadius: BorderRadius.circular(AppTheme.radiusSmall),
              ),
              child: const Text(
                'PDF — показана первая страница',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.disclaimerText,
                ),
              ),
            ),
          const Spacer(),
          TextButton.icon(
            onPressed: onOpenOriginal,
            style: TextButton.styleFrom(foregroundColor: Colors.white),
            icon: const Icon(Icons.open_in_new, size: 17),
            label: Text(isPdf ? 'Открыть PDF' : 'Открыть оригинал'),
          ),
          IconButton(
            onPressed: onClose,
            tooltip: 'Закрыть',
            icon: const Icon(Icons.close, color: Colors.white),
          ),
        ],
      ),
    );
  }
}

class _ArrowButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;

  const _ArrowButton({required this.icon, this.onTap});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 64,
      child: onTap == null
          ? const SizedBox.shrink()
          : IconButton(
              onPressed: onTap,
              iconSize: 34,
              icon: Icon(icon, color: Colors.white.withValues(alpha: 0.8)),
            ),
    );
  }
}

/// Сам кадр: картинка с индикатором загрузки и понятным отказом.
class _Frame extends StatelessWidget {
  final MediaItem item;

  const _Frame({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    return Image.network(
      item.viewableUrl,
      fit: BoxFit.contain,
      loadingBuilder: (context, child, progress) {
        if (progress == null) return child;
        return const SizedBox(
          width: 40,
          height: 40,
          child: CircularProgressIndicator(strokeWidth: 2),
        );
      },
      errorBuilder: (_, __, ___) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.broken_image_outlined,
              size: 48, color: Colors.white38),
          const SizedBox(height: 12),
          Text(
            item.isPdf
                ? 'Первая страница PDF не отрисовалась.\nОткройте оригинал.'
                : 'Снимок не загрузился.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              color: Colors.white.withValues(alpha: 0.7),
            ),
          ),
        ],
      ),
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16, top: 4),
      child: Text(
        'Двойное нажатие — увеличить · колесо и перетаскивание — масштаб и '
        'сдвиг · стрелки ← → — соседние снимки · Esc — закрыть',
        style: TextStyle(
          fontSize: 12,
          color: Colors.white.withValues(alpha: 0.45),
        ),
      ),
    );
  }
}

/// Открывает просмотрщик поверх экрана.
Future<void> showMediaViewer(
  BuildContext context, {
  required List<MediaItem> items,
  required String title,
  int initialIndex = 0,
}) {
  if (items.isEmpty) return Future<void>.value();

  return Navigator.of(context, rootNavigator: true).push<void>(
    PageRouteBuilder<void>(
      opaque: false,
      barrierDismissible: true,
      barrierColor: Colors.transparent,
      pageBuilder: (_, __, ___) => MediaViewer(
        items: items,
        title: title,
        initialIndex: initialIndex,
      ),
    ),
  );
}
