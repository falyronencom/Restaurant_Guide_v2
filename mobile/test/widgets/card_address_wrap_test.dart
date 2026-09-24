import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/widgets/establishment_card.dart';

/// Адрес в карточке списка не рвётся посреди слова.
///
/// Найдено 23.09.2026 на рендере 360 dp: «проспект Независимости, 18»
/// рисовался как «проспект Нез / ависимости, …», «Революционная, 24» — как
/// «Революционн / ая, 24». Колонке адреса на 360 dp достаётся 96 dp, а слово
/// целиком в неё не входит. `Text` с `maxLines: 2` рвёт такое слово по
/// буквам: многоточие Flutter ставит только на последней строке. На 375 dp
/// (iPhone mini) тот же адрес отрывал запятую: «Революционная,» шире колонки
/// на 0.06 dp.
///
/// Как и в adaptive_title_test.dart, всё меряется настоящим шрифтом (его на
/// весь сьют грузит test/flutter_test_config.dart) под настоящей темой: на
/// квадратном подстановочном шрифте ширины слов были бы другими.
void main() {
  const addresses = <String>[
    'проспект Независимости, 18',
    'Революционная, 24',
    'улица Юрово-Завальная, 11',
    // Пробел после кавычки — описка, которую мастер партнёра и бэкенд не
    // чистят (обрезаются только края строки). Движок строк после «« » не
    // переносит даже через пробел, и деление по пробелам, которым мерил
    // первый вариант правки, рвало здесь слово на 367–376 dp:
    // «ТЦ « Независим | ости », 18».
    'ТЦ « Независимости », 18',
  ];

  testWidgets('каждая ширина от 360 до 411 dp: разрыв только у пробела или '
      'после дефиса, не больше двух строк, одна строка — с многоточием',
      (tester) async {
    // Шаг 1 dp, а не четыре типовых экрана: дефект живёт на границах замера
    // (на 375 dp слово шире колонки на 0.06 dp), и между типовыми ширинами
    // их не видно. 360 — типовой бюджетник, 375 — iPhone mini, 384 — A72,
    // 411 — Pixel 9a.
    for (var width = 360.0; width <= 411; width++) {
      for (final address in addresses) {
        await _pumpCard(tester, address: address, screenWidth: width);
        final where = '$address на $width dp';
        _expectBreaksOnlyAtSpacesOrHyphens(tester, address, where: where);

        final para = _paragraph(tester, address);
        expect(_lineCount(para), lessThanOrEqualTo(2),
            reason: 'адрес не длиннее двух строк ($where)');
        if (para.maxLines == 1) {
          expect(para.didExceedMaxLines, isTrue,
              reason: 'одна строка выбрана, потому что слово не влезает, — '
                  'значит, адрес обрезан, и обрезка обязана быть видна '
                  'многоточием ($where)');
        }
      }
    }
  });

  testWidgets('адрес, который помещается целиком, не обрезается',
      (tester) async {
    // Встречная половина: одна строка с многоточием на всех ширинах прошла бы
    // проверку выше, ни разу не порвав слова. Ожидания — литералы: до правки
    // эти адреса на этих ширинах шли целиком (в скобках — как именно).
    const fitsWhole = <(String, double)>[
      ('улица Юрово-Завальная, 11', 360), // «улица Юрово-» / «Завальная, 11»
      ('улица Юрово-Завальная, 11', 375),
      ('улица Юрово-Завальная, 11', 384),
      ('улица Юрово-Завальная, 11', 411),
      ('Революционная, 24', 384), // «Революционная,» / «24»
      ('Революционная, 24', 411), // в одну строку
      ('проспект Независимости, 18', 411), // «проспект» / «Независимости, 18»
    ];
    for (final (address, width) in fitsWhole) {
      await _pumpCard(tester, address: address, screenWidth: width);
      expect(_paragraph(tester, address).didExceedMaxLines, isFalse,
          reason: '$address на $width dp помещается целиком — обрезать его '
              'многоточием нельзя');
    }
  });

  testWidgets('iPhone mini: слово шире колонки на доли dp — решает стиль, '
      'которым адрес нарисован', (tester) async {
    const address = 'Революционная, 24';
    await _pumpCard(tester, address: address, screenWidth: 375);

    final para = _paragraph(tester, address);
    final column = para.constraints.maxWidth;
    final drawn = para.text.style!;
    // Предпосылка: из колонки слово выводит только межбуквенный интервал 0.1,
    // который приносит тема через `DefaultTextStyle`. Иначе тест не отличает
    // замер стилем отрисовки от замера без него.
    expect(_width('Революционная,', drawn, para.textScaler),
        greaterThan(column),
        reason: 'предпосылка: стилем отрисовки слово шире колонки');
    expect(
        _width('Революционная,', drawn.copyWith(letterSpacing: 0),
            para.textScaler),
        lessThanOrEqualTo(column),
        reason: 'предпосылка: без интервала темы слово влезало бы');

    _expectBreaksOnlyAtSpacesOrHyphens(tester, address, where: '375 dp');
    _expectOneLineWithEllipsis(para, where: '375 dp');
  });

  testWidgets('крупный системный шрифт на A72: решение с учётом масштаба '
      'текста', (tester) async {
    tester.platformDispatcher.textScaleFactorTestValue = 1.15;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    const address = 'проспект Независимости, 18';
    await _pumpCard(tester, address: address, screenWidth: 384);

    final para = _paragraph(tester, address);
    final column = para.constraints.maxWidth;
    final drawn = para.text.style!;
    // Предпосылка: без масштаба слово в колонку A72 влезает, с масштабом —
    // нет. Иначе тест не отличает замер с масштабом от замера без него.
    expect(_width('Независимости,', drawn, TextScaler.noScaling),
        lessThanOrEqualTo(column),
        reason: 'предпосылка: без масштаба слово влезает');
    expect(_width('Независимости,', drawn, para.textScaler),
        greaterThan(column),
        reason: 'предпосылка: при масштабе 1.15 слово шире колонки');

    _expectBreaksOnlyAtSpacesOrHyphens(tester, address,
        where: '384 dp, масштаб 1.15');
    _expectOneLineWithEllipsis(para, where: '384 dp, масштаб 1.15');
  });

  testWidgets('системный «жирный текст»: решение по жирному начертанию',
      (tester) async {
    tester.platformDispatcher.accessibilityFeaturesTestValue =
        const FakeAccessibilityFeatures(boldText: true);
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    const address = 'Революционная, 24';
    // Среди ширин выше нет такой, где слово влезало бы обычным начертанием и
    // не влезало жирным. Ширина 377 подобрана так, чтобы колонка (113 dp)
    // легла между ними; предпосылки ниже это проверяют.
    await _pumpCard(tester, address: address, screenWidth: 377);

    final para = _paragraph(tester, address);
    final column = para.constraints.maxWidth;
    final drawn = para.text.style!;
    expect(drawn.fontWeight, FontWeight.bold,
        reason: 'предпосылка: «жирный текст» дошёл до отрисовки');
    expect(_width('Революционная,', drawn, para.textScaler),
        greaterThan(column),
        reason: 'предпосылка: жирным слово шире колонки');
    expect(
        _width('Революционная,', drawn.copyWith(fontWeight: FontWeight.w400),
            para.textScaler),
        lessThanOrEqualTo(column),
        reason: 'предпосылка: обычным начертанием слово влезало бы');

    _expectBreaksOnlyAtSpacesOrHyphens(tester, address,
        where: '377 dp, жирный текст');
    _expectOneLineWithEllipsis(para, where: '377 dp, жирный текст');
  });
}

Establishment _establishment(String address) => Establishment(
      id: 'e1',
      name: 'Осмоловка',
      category: 'restaurant',
      cuisine: 'Европейская',
      priceRange: r'$$',
      rating: 4.5,
      address: address,
      city: 'Минск',
      status: 'active',
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );

/// Карточка ровно в той геометрии, что на экране результатов: `SliverList`
/// без внешних полей, поля у карточки собственные.
Future<void> _pumpCard(
  WidgetTester tester, {
  required String address,
  required double screenWidth,
}) async {
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = Size(screenWidth, 812);
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: ListView(
          padding: EdgeInsets.zero,
          children: [EstablishmentCard(establishment: _establishment(address))],
        ),
      ),
    ),
  );
  await tester.pump();
}

RenderParagraph _paragraph(WidgetTester tester, String address) =>
    tester.renderObject<RenderParagraph>(find.text(address));

double _width(String text, TextStyle style, TextScaler textScaler) {
  final painter = TextPainter(
    text: TextSpan(text: text, style: style),
    textDirection: TextDirection.ltr,
    textScaler: textScaler,
  )..layout();
  try {
    return painter.width;
  } finally {
    painter.dispose();
  }
}

/// Отрисованный абзац, разложенный заново: тот же текст со слитым стилем,
/// масштаб, предел строк, многоточие и ширина, что и на экране. Закрыть
/// вызывающему.
TextPainter _relayout(RenderParagraph para) => TextPainter(
      text: para.text,
      textDirection: TextDirection.ltr,
      textScaler: para.textScaler,
      maxLines: para.maxLines,
      ellipsis: para.overflow == TextOverflow.ellipsis ? '…' : null,
    )..layout(maxWidth: para.constraints.maxWidth);

int _lineCount(RenderParagraph para) {
  final painter = _relayout(para);
  try {
    return painter.computeLineMetrics().length;
  } finally {
    painter.dispose();
  }
}

/// Слово не влезает — адрес идёт в одну строку, и обрезка видна многоточием.
///
/// Проверка разрывов на одной строке пуста: разрывов нет. Без этой пары
/// утверждений адрес, обрезанный посреди буквы без «…» (`TextOverflow.clip`),
/// прошёл бы все тесты.
void _expectOneLineWithEllipsis(RenderParagraph para, {required String where}) {
  expect(para.maxLines, 1,
      reason: 'слово не влезает — адрес в одну строку ($where)');
  expect(para.didExceedMaxLines, isTrue,
      reason: 'адрес обрезан, и обрезка видна многоточием ($where)');
}

/// Разрывы строк отрисованного адреса стоят только у пробела или сразу после
/// дефиса («Юрово-» / «Завальная»).
///
/// Проверка не повторяет логику виджета: абзац перекладывается заново тем же
/// текстом, слитым стилем, масштабом и шириной, что и на экране, и каждый
/// разрыв строки обязан стоять у пробела или после дефиса. Так ловится разрыв
/// по буквам, откуда бы он ни взялся. Конец последней строки разрывом не
/// считается: там кончается текст или стоит многоточие.
void _expectBreaksOnlyAtSpacesOrHyphens(
  WidgetTester tester,
  String address, {
  required String where,
}) {
  final para = _paragraph(tester, address);
  final text = para.text.toPlainText();
  final painter = _relayout(para);
  try {
    final lineCount = painter.computeLineMetrics().length;
    var offset = 0;
    for (var i = 0; i < lineCount - 1; i++) {
      final line = painter.getLineBoundary(TextPosition(offset: offset));
      final before = text[line.end - 1];
      final after = text[line.end];
      expect(before == ' ' || after == ' ' || before == '-', isTrue,
          reason: 'разрыв внутри слова ($where): '
              '«${text.substring(0, line.end)} | ${text.substring(line.end)}»');
      offset = line.end;
    }
  } finally {
    painter.dispose();
  }
}
