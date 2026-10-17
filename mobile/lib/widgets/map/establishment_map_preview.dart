import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';

/// Карточка-превью заведения над картой: миниатюра, название, рейтинг,
/// категория, адрес, «✕» и кнопка «Подробнее». Одна на все карты приложения
/// (вкладка «Карта», карта избранного): две копии разошлись бы при первой
/// правке.
///
/// Виджет не знает ни о карте, ни о навигаторе. Он получает заведение и
/// действия; что происходит после — пин снова не выбран, открывается карточка
/// заведения — решает экран-хозяин. Размещение (`Positioned(bottom: 0)`) тоже
/// у хозяина: виджет занимает ширину, которую ему дали.
///
/// Свайп вниз закрывает карточку: сдвиг больше [dismissDistance] или скорость
/// больше [dismissVelocity]; иначе карточка возвращается на место.
class EstablishmentMapPreview extends StatefulWidget {
  /// Сдвиг вниз (логических пикселей), после которого отпускание закрывает.
  static const double dismissDistance = 80;

  /// Скорость вниз (логических пикселей в секунду), при которой отпускание
  /// закрывает даже короткий сдвиг.
  static const double dismissVelocity = 200;

  final Establishment establishment;

  /// «✕» или свайп вниз. Карточку убирает хозяин.
  final VoidCallback onClose;

  /// «Подробнее». Закрывает ли хозяин карточку перед переходом — его решение.
  final VoidCallback onDetails;

  /// Необязательное действие рядом с «Подробнее» (кнопка «Маршрут», решение
  /// Р6). Без него «Подробнее» занимает всю ширину, как всегда; с ним обе
  /// кнопки делят строку поровну через зазор 8.
  final Widget? secondaryAction;

  const EstablishmentMapPreview({
    super.key,
    required this.establishment,
    required this.onClose,
    required this.onDetails,
    this.secondaryAction,
  });

  @override
  State<EstablishmentMapPreview> createState() =>
      _EstablishmentMapPreviewState();
}

class _EstablishmentMapPreviewState extends State<EstablishmentMapPreview> {
  /// Сдвиг при перетаскивании: 0 — на месте, положительный — тянут вниз.
  double _dragOffset = 0.0;

  @override
  void didUpdateWidget(EstablishmentMapPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Выбрали другое заведение, пока карточка открыта, — она встаёт на место,
    // как при каждом новом выборе пина.
    if (oldWidget.establishment.id != widget.establishment.id) {
      _dragOffset = 0.0;
    }
  }

  void _onDragUpdate(DragUpdateDetails details) {
    setState(() {
      // Only allow downward drag (clamp to >= 0)
      _dragOffset = (_dragOffset + details.delta.dy).clamp(0.0, double.infinity);
    });
  }

  void _onDragEnd(DragEndDetails details) {
    final dismiss = _dragOffset > EstablishmentMapPreview.dismissDistance ||
        (details.primaryVelocity ?? 0) >
            EstablishmentMapPreview.dismissVelocity;
    setState(() => _dragOffset = 0.0);
    if (dismiss) widget.onClose();
  }

  @override
  Widget build(BuildContext context) {
    final establishment = widget.establishment;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onVerticalDragUpdate: _onDragUpdate,
      onVerticalDragEnd: _onDragEnd,
      child: Transform.translate(
        offset: Offset(0, _dragOffset),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppTheme.backgroundWarm,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.15),
                blurRadius: 10,
                offset: const Offset(0, -2),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Handle bar
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),

              // Content row with close button
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Thumbnail
                  ClipRRect(
                    borderRadius: BorderRadius.circular(AppTheme.radiusMedium),
                    child: SizedBox(
                      width: 100,
                      height: 100,
                      child: establishment.thumbnailUrl != null
                          ? CachedNetworkImage(
                              imageUrl: establishment.thumbnailUrl!,
                              fit: BoxFit.cover,
                              placeholder: (context, url) => Container(
                                color: Colors.grey[200],
                                child: const Icon(Icons.restaurant,
                                    color: Colors.grey),
                              ),
                              errorWidget: (context, url, error) => Container(
                                color: Colors.grey[200],
                                child: const Icon(Icons.restaurant,
                                    color: Colors.grey),
                              ),
                            )
                          : Container(
                              color: Colors.grey[200],
                              child: const Icon(Icons.restaurant,
                                  color: Colors.grey, size: 40),
                            ),
                    ),
                  ),

                  const SizedBox(width: 12),

                  // Info
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Name
                        Text(
                          establishment.name,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                            color: Colors.black87,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),

                        const SizedBox(height: 4),

                        // Rating
                        if (establishment.rating != null)
                          Row(
                            children: [
                              const Icon(Icons.star,
                                  color: AppTheme.ratingStar, size: 18),
                              const SizedBox(width: 4),
                              Text(
                                establishment.rating!.toStringAsFixed(1),
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w500,
                                  color: Colors.black87,
                                ),
                              ),
                            ],
                          ),

                        const SizedBox(height: 4),

                        // Category
                        Text(
                          establishment.category,
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.grey[600],
                          ),
                        ),

                        const SizedBox(height: 4),

                        // Address
                        Text(
                          establishment.address,
                          style: TextStyle(
                            fontSize: 13,
                            color: Colors.grey[500],
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(width: 8),

                  // Close button
                  GestureDetector(
                    onTap: widget.onClose,
                    child: Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        color: Colors.grey[200],
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.close,
                        size: 18,
                        color: Colors.grey[600],
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 16),

              // Buttons
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton(
                      onPressed: widget.onDetails,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppTheme.primaryOrange,
                        foregroundColor: AppTheme.textOnPrimary,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(AppTheme.radiusMedium),
                        ),
                      ),
                      child: const Text(
                        'Подробнее',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                  if (widget.secondaryAction != null) ...[
                    const SizedBox(width: 8),
                    Expanded(child: widget.secondaryAction!),
                  ],
                ],
              ),

              // Bottom padding for safe area
              SizedBox(height: MediaQuery.of(context).padding.bottom),
            ],
          ),
        ),
      ),
    );
  }
}
