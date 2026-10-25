import 'package:flutter/material.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/widgets/admin_filter_dropdown.dart';

/// Оформление поля поиска в шапке экрана — одно на все экраны с поиском
/// («Одобренные», «Отзывы», «Пользователи», «Позиции меню»).
///
/// Зачем общее (проход по панели модератора, 20.10, Ч20, F-29): поле стояло
/// в слоте высотой 40, но рамку рисовало по своему содержимому — плотное
/// поле без отступов давало рамку 21 px, прижатую к верху слота, рядом с
/// пилюлями фильтров по 40. После ввода появлялся крестик очистки, и рамка
/// вырастала до 40: поле «прыгало». Рамку материаловского поля задаёт
/// высота его содержимого, а не слота, — поэтому высоту здесь держат
/// значки: оба ровно [AdminFilterDropdown.height], с крестиком и без.
InputDecoration adminSearchDecoration({
  required String hint,
  Widget? suffixIcon,
}) {
  const height = AdminFilterDropdown.height;
  return InputDecoration(
    hintText: hint,
    hintStyle: const TextStyle(fontSize: 14, color: AppTheme.textGrey),
    isDense: true,
    contentPadding: EdgeInsets.zero,
    prefixIcon: const Icon(
      Icons.search,
      size: 17,
      color: AppTheme.textTertiary,
    ),
    prefixIconConstraints: const BoxConstraints(
      minWidth: 38,
      minHeight: height,
      maxHeight: height,
    ),
    suffixIcon: suffixIcon,
    suffixIconConstraints: const BoxConstraints(
      minWidth: 36,
      minHeight: height,
      maxHeight: height,
    ),
    // Радиус задан явно всем состояниям: глобальная тема полей держит r12,
    // а поле стоит в одном ряду с пилюлями фильтров на r10, и разница в два
    // пикселя рядом читается как небрежность. Точечно перекрыть только
    // `border` нельзя — остальные состояния наследуют тему и разъезжаются
    // при фокусе.
    border: _border(AppTheme.strokeGrey),
    enabledBorder: _border(AppTheme.strokeGrey),
    focusedBorder: _border(AppTheme.primaryOrange, width: 1.5),
    disabledBorder: _border(AppTheme.strokeGrey),
  );
}

OutlineInputBorder _border(Color color, {double width = 1}) =>
    OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppTheme.radiusControl),
      borderSide: BorderSide(color: color, width: width),
    );
