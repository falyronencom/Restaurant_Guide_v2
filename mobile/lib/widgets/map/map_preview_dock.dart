import 'package:flutter/material.dart';

/// Низ карты: кнопка «моё место» справа и под ней карточка-превью, если она
/// открыта. Хозяин ставит док `Positioned(bottom: 0, left: 0, right: 0)`.
///
/// Без карточки кнопка стоит в [buttonBottom] от низа, как всегда. С
/// карточкой — над ней через [buttonGapAboveCard]: до этапа 3 кнопка была
/// последним слоем карты и накрывала правый край строки кнопок карточки,
/// где теперь «Маршрут» (A72, 17.10.2026). Док не меряет карточку: кнопка
/// стоит в той же колонке, сразу над ней.
///
/// Пустое место слева от кнопки касаний не ловит — они уходят карте.
class MapPreviewDock extends StatelessWidget {
  const MapPreviewDock({super.key, this.preview, this.locationButton});

  /// Карточка-превью или `null`, если она закрыта.
  final Widget? preview;

  /// Кнопка «моё место» или `null`, если на этой карте её нет.
  final Widget? locationButton;

  static const double buttonRight = 16;
  static const double buttonBottom = 24;
  static const double buttonGapAboveCard = 12;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        if (locationButton != null)
          Padding(
            padding: EdgeInsets.only(
              right: buttonRight,
              bottom: preview == null ? buttonBottom : buttonGapAboveCard,
            ),
            child: locationButton,
          ),
        if (preview != null) SizedBox(width: double.infinity, child: preview),
      ],
    );
  }
}
