import 'package:flutter/material.dart';
import 'package:restaurant_guide_mobile/config/cities.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';

/// «Минск — по умолчанию» в листе выбора города.
///
/// Прежде здесь была кнопка «Сброс» в шапке листа: она молча ставила галочку
/// на Минск, и непонятно было, что именно сбрасывается (сверка находок
/// тестировщика, 17.10, пункт 6). Пункта «все города» нет, город по умолчанию
/// один — так и написано. Нажатие выбирает его в листе; применяет, как и
/// любой выбор, кнопка «Применить».
class DefaultCityButton extends StatelessWidget {
  final VoidCallback onTap;

  const DefaultCityButton({super.key, required this.onTap});

  static const String label = '${BelarusCities.defaultCity} — по умолчанию';

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: const Padding(
        padding: EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w500,
            color: AppTheme.textPrimary,
            decoration: TextDecoration.underline,
          ),
        ),
      ),
    );
  }
}
