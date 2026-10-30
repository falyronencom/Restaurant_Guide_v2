import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';

import '../helpers/dart_source_scan.dart';

/// Контраст текста панели — не ниже 4,5 : 1 (WCAG AA для текста до 18 px).
///
/// До 29.10.2026 вторичный и третичный текст панели был светло-серым:
/// #9E9E9E и #ABABAB давали на белом 2,7 и 2,3 : 1, а #757575 на бежевых
/// карточках — 4,1 : 1 (F-11, ≈ 71 место); тёмно-оранжевый в мелком тексте —
/// 4,1 : 1 (F-12). Координатор выбрал палитру «холодную контрастную»
/// (вариант 3 показа 29.10), и её цвета обещают 4,5 : 1 везде, где стоит
/// текст. Сторож держит это обещание в двух местах:
///
/// 1. Пары «текстовый цвет — фон, на котором он стоит». Пара перечислена,
///    только если такое сочетание в панели есть; фон с прозрачностью
///    сводится к непрозрачному так, как его нарисует экран.
/// 2. Исходники `lib/`: цвет текста берётся из текстовых токенов темы, а не
///    из серой шкалы, `Colors.grey` или шестнадцатеричного литерала. Именно
///    так туда и попадал бледный серый — мимо токенов.
///
/// Вне сторожа сознательно: белая подпись на брендовом оранжевом
/// ([AppTheme.primaryOrange], кнопки «Одобрить», «Отклонить») — 3,06 : 1;
/// бренд директива не трогала, вопрос открыт. Статусные красный и зелёный
/// тоже не текстовые токены и в пары не входят.
void main() {
  group('пары «текст — фон»: не ниже 4,5 : 1', () {
    const white = AppTheme.backgroundPrimary;
    final pairs = <({String where, Color text, Color background})>[
      // Основная поверхность — экран, карточки, шторки.
      for (final (name, color) in _textTokens)
        (where: '$name на белом', text: color, background: white),
      // Светлая поверхность — «Требует внимания», пустые состояния, чип на
      // невыбранной карточке списка.
      for (final (name, color) in _textTokens)
        (
          where: '$name на светлой поверхности',
          text: color,
          background: AppTheme.backgroundWarm,
        ),
      for (final (name, color) in _textTokens)
        (
          where: '$name на чипе карточки списка',
          text: color,
          background: AppTheme.listChipBackground,
        ),
      // Disclaimer-пара: чип выбранной карточки, «скрыт», «приостановлено».
      (
        where: 'disclaimerText на disclaimerBg',
        text: AppTheme.disclaimerText,
        background: AppTheme.disclaimerBg,
      ),
      (
        where: 'textGrey на disclaimerBg (чип без причины)',
        text: AppTheme.textGrey,
        background: AppTheme.disclaimerBg,
      ),
      (
        where: 'textSecondary на disclaimerBg',
        text: AppTheme.textSecondary,
        background: AppTheme.disclaimerBg,
      ),
      // Брендовые подложки поверх белого: активный фильтр, полоса автора в
      // отзывах, плашка новой версии.
      (
        where: 'primaryOrangeDark на активном фильтре',
        text: AppTheme.primaryOrangeDark,
        background: Color.alphaBlend(AppTheme.brandTint(0.08), white),
      ),
      (
        where: 'textSecondary на активном фильтре',
        text: AppTheme.textSecondary,
        background: Color.alphaBlend(AppTheme.brandTint(0.08), white),
      ),
      (
        where: 'textSecondary на полосе автора',
        text: AppTheme.textSecondary,
        background: Color.alphaBlend(AppTheme.brandTint(0.06), white),
      ),
      (
        where: 'textDark на плашке новой версии',
        text: AppTheme.textDark,
        background: Color.alphaBlend(AppTheme.brandTint(0.10), white),
      ),
      // Белая буква на кружке: аватар вошедшего и бейдж свёрнутого меню
      // (тёмно-оранжевый), аватар чужого автора в журнале (серый).
      (
        where: 'белый на primaryOrangeDark',
        text: AppTheme.textOnPrimary,
        background: AppTheme.primaryOrangeDark,
      ),
      (
        where: 'белый на textTertiary (аватар)',
        text: AppTheme.textOnPrimary,
        background: AppTheme.textTertiary,
      ),
      // Тёмное меню слева.
      (
        where: 'railText на меню',
        text: AppTheme.railText,
        background: AppTheme.railBackground,
      ),
      (
        where: 'railText на пункте под курсором',
        text: AppTheme.railText,
        background:
            Color.alphaBlend(AppTheme.railHover, AppTheme.railBackground),
      ),
      (
        where: 'railMuted на меню (заголовки групп, роль)',
        text: AppTheme.railMuted,
        background: AppTheme.railBackground,
      ),
      (
        where: 'railSoon на меню («скоро»)',
        text: AppTheme.railSoon,
        background: AppTheme.railBackground,
      ),
      (
        where: 'railActiveText на активном пункте',
        text: AppTheme.railActiveText,
        background: AppTheme.railActiveBackground,
      ),
      (
        where: 'railBadgeText на бейдже очереди',
        text: AppTheme.railBadgeText,
        background: Color.alphaBlend(
          AppTheme.railBadgeBackground,
          AppTheme.railBackground,
        ),
      ),
    ];

    for (final pair in pairs) {
      test(pair.where, () {
        final ratio = _contrast(pair.text, pair.background);
        expect(
          ratio,
          greaterThanOrEqualTo(4.5),
          reason: '${pair.where}: ${_hex(pair.text)} на ${_hex(pair.background)}'
              ' — ${ratio.toStringAsFixed(2)} : 1',
        );
      });
    }
  });

  test('формула контраста сверена с WCAG: чёрный на белом — 21 : 1', () {
    // Якорь сторожа: формула с ошибкой могла бы пропускать всё подряд.
    expect(_contrast(Colors.black, Colors.white), closeTo(21, 0.01));
    expect(_contrast(Colors.white, Colors.white), closeTo(1, 0.001));
    // #767676 — известная граница AA на белом: 4,54 : 1.
    expect(_contrast(const Color(0xFF767676), Colors.white),
        closeTo(4.54, 0.01));
  });

  group('исходники lib/: цвет текста — из текстовых токенов темы', () {
    // Серая шкала, `Colors.grey`/`Colors.black` и литерал — это и есть тот
    // путь, которым бледный серый обходил тему. Тема (`config/theme.dart`)
    // сама определяет шкалу и литералы — её сторож не читает.
    final sources = libSources()
        .where((file) => !unixPath(file).endsWith('lib/config/theme.dart'))
        .toList();
    final forbidden = RegExp(
      r'AppTheme\.gray\d+|Colors\.grey|Colors\.black(?!\.withValues)'
      r'|Colors\.black\d+|Color\(0x[0-9A-Fa-f]{8}\)',
    );

    test('ни один TextStyle не красит текст мимо токенов', () {
      final offenders = <String>[];
      var styles = 0;
      for (final file in sources) {
        final source = stripped(file.readAsStringSync());
        for (final match in RegExp(r'\bTextStyle\(').allMatches(source)) {
          styles++;
          final args = namedArgs(argsAt(source, match.end - 1));
          final color = args['color']?.value.trim();
          if (color != null && forbidden.hasMatch(color)) {
            offenders.add('${unixPath(file)}:'
                '${lineAt(source, match.start)} — color: $color');
          }
        }
      }
      // Якорь: ноль найденных TextStyle значил бы, что сканер ослеп.
      expect(styles, greaterThan(100),
          reason: 'сканер не нашёл TextStyle в lib/ — разбор сломан');
      expect(offenders, isEmpty,
          reason: 'цвет текста мимо токенов темы — взять textSecondary, '
              'textTertiary или textGrey:\n${offenders.join('\n')}');
    });

    test('непрозрачных литералов и Colors.grey в lib/ нет', () {
      // Непрозрачный литерал — `0xFF…`. Полупрозрачные (тень тоста, дорожка
      // спиннера) — не цвет текста и остаются на месте.
      final literal = RegExp(r'Color\(0xFF[0-9A-Fa-f]{6}\)|Colors\.grey');
      final offenders = <String>[];
      for (final file in sources) {
        final source = stripped(file.readAsStringSync());
        for (final match in literal.allMatches(source)) {
          offenders.add('${unixPath(file)}:${lineAt(source, match.start)}'
              ' — ${match.group(0)}');
        }
      }
      expect(sources.length, greaterThan(50),
          reason: 'сканер не видит исходников lib/');
      expect(offenders, isEmpty,
          reason: 'цвет мимо темы — завести или взять токен в '
              'config/theme.dart:\n${offenders.join('\n')}');
    });
  });
}

/// Текстовые токены светлых поверхностей.
const List<(String, Color)> _textTokens = <(String, Color)>[
  ('textPrimary', AppTheme.textPrimary),
  ('textDark', AppTheme.textDark),
  ('textSecondary', AppTheme.textSecondary),
  ('textTertiary', AppTheme.textTertiary),
  ('textGrey', AppTheme.textGrey),
  ('primaryOrangeDark', AppTheme.primaryOrangeDark),
  ('disclaimerText', AppTheme.disclaimerText),
];

/// Контраст по WCAG 2.x: (L1 + 0,05) / (L2 + 0,05), L — относительная
/// яркость; `computeLuminance` считает её ровно по формуле WCAG.
double _contrast(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final hi = la > lb ? la : lb;
  final lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

String _hex(Color c) =>
    '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';
