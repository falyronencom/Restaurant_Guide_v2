import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/providers/auth_provider.dart';
import 'package:restaurant_guide_mobile/providers/booking_provider.dart';
import 'package:restaurant_guide_mobile/providers/establishments_provider.dart';
import 'package:restaurant_guide_mobile/screens/establishment/detail_screen.dart';
import 'package:restaurant_guide_mobile/screens/reviews/reviews_list_screen.dart';
import 'package:restaurant_guide_mobile/widgets/adaptive_title.dart';
import 'package:restaurant_guide_mobile/widgets/glass_action_chip.dart';
import 'package:restaurant_guide_mobile/widgets/hero_scrim.dart';

import '../support/wire_fixtures.dart';
import '../support/wire_stand.dart';

/// Карточка заведения по проходу тестировщика 17.10: пп. 11, 15, 28, 29, 46,
/// 48, Х6.
///
/// Геометрию меряем `getRect` на настоящих шрифтах — тема приложения
/// обязательна (test/flutter_test_config.dart); без неё ширину текста не
/// узнать. Контраст считаем по формуле WCAG 2.x от цветов, которые экран
/// нарисовал, и от затемнения, которое он использует (`HeroScrim`).

const _id = '11111111-1111-4111-8111-111111111111';

/// Длинное имя автора: одно слово без пробелов и имя из многих слов.
final _longNoSpaces = 'Ы' * 160;
final _longWithSpaces = List.filled(30, 'Длинноеимя').join(' ');

class _NoLocation extends EstablishmentsProvider {
  @override
  Future<bool> fetchUserLocation() async => false;
}

class _Auth extends AuthProvider {
  @override
  bool get isAuthenticated => false;
}

/// Родной конец канала «Поделиться»: записывает, что у него попросили, и по
/// желанию отказывает так, как отказывает iOS без окна для меню. Подменён
/// именно канал, а не обёртка плагина: до него доходит всё, что отправил
/// плагин, включая рамку кнопки для iPad.
class _ShareChannel {
  _ShareChannel({this.fail = false});
  final bool fail;
  final List<Map<Object?, Object?>> calls = [];

  static const channel = MethodChannel('dev.fluttercommunity.plus/share');

  void install() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method != 'share') return null;
      calls.add(call.arguments as Map<Object?, Object?>);
      if (fail) {
        throw PlatformException(
            code: 'error', message: 'No root view controller found');
      }
      return 'dev.fluttercommunity.plus/share/unavailable';
    });
    addTearDown(() => TestDefaultBinaryMessengerBinding
        .instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null));
  }
}

const _weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

Map<String, dynamic> _row({
  Map<String, dynamic>? hours,
  String name = 'Васильки',
  List<dynamic> media = const [],
}) =>
    establishmentRow(
      id: _id,
      name: name,
      // «00:00–00:00» — круглосуточно: открыто в любую минуту, от часов
      // машины, на которой идёт тест, ничего не зависит.
      workingHours: hours ?? {for (final d in _weekdays) d: '00:00-00:00'},
      media: media,
    )
      // Как отдаёт бэкенд для «Ресторан» (`CATEGORY_SLUG_MAP`); у общей
      // фикстуры здесь другое значение, и тест закрепил бы адрес, которого
      // на сайте нет.
      ..['category_slug'] = 'restaurants'
      // Сетевая картинка и карта Яндекса в тесте не работают.
      ..['primary_image_url'] = null
      ..['latitude'] = null
      ..['longitude'] = null;

/// Окно 360 × 900: герой 657 dp помещается целиком.
void _useScreen(WidgetTester tester) {
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = const Size(360, 900);
  tester.view.padding = const FakeViewPadding(top: 24);
  tester.view.viewPadding = const FakeViewPadding(top: 24);
  addTearDown(tester.view.reset);
}

/// Ответ сервера на отзывы: тест кладёт сюда строки перед `_stand`.
List<Map<String, dynamic>> _reviews = [];

void _stand(Map<String, dynamic> row) {
  installWireStand((options) {
    final path = options.uri.path;
    if (path == '/api/v1/search/establishments/$_id') {
      return jsonBody({'success': true, 'data': row});
    }
    if (path == '/api/v1/establishments/$_id/reviews') {
      return jsonBody(reviewsEnvelope(reviews: _reviews, total: 24));
    }
    if (path == '/api/v1/establishments/$_id/booking-settings') {
      return jsonBody({'success': false}, status: 404);
    }
    return jsonBody({'success': false}, status: 404);
  });
}

Future<void> _pumpDetail(WidgetTester tester) async {
  _useScreen(tester);
  await tester.pumpWidget(MultiProvider(
    providers: [
      ChangeNotifierProvider<AuthProvider>(create: (_) => _Auth()),
      ChangeNotifierProvider<EstablishmentsProvider>(
          create: (_) => _NoLocation()),
      ChangeNotifierProvider<BookingProvider>(create: (_) => BookingProvider()),
    ],
    child: MaterialApp(
      theme: AppTheme.lightTheme,
      debugShowCheckedModeBanner: false,
      home: const EstablishmentDetailScreen(establishmentId: _id),
    ),
  ));
  await tester.pumpAndSettle();
}

// ---------------------------------------------------------------------------
// Контраст WCAG 2.x
// ---------------------------------------------------------------------------

double _channel(double c) =>
    c <= 0.03928 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();

double _luminance(Color c) =>
    0.2126 * _channel(c.r) + 0.7152 * _channel(c.g) + 0.0722 * _channel(c.b);

double _contrast(Color a, Color b) {
  final la = _luminance(a), lb = _luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

/// Сверху лежит [top] с прозрачностью [alpha] над [bottom] (непрозрачным).
Color _over(Color top, Color bottom, double alpha) => Color.lerp(bottom, top, alpha)!;

void main() {
  setUp(() {
    _reviews = [];
  });

  // -------------------------------------------------------------------------
  group('п. 29 — длинное имя автора в карусели отзывов', () {
    for (final entry in {
      'одно слово без пробелов': _longNoSpaces,
      'много слов': _longWithSpaces,
    }.entries) {
      testWidgets('${entry.key}: звёзды и дата на месте, карточка цела',
          (tester) async {
        _reviews = [
          reviewRow(id: '33333333-3333-4333-8333-333333333331',
              authorName: entry.value),
          reviewRow(id: '33333333-3333-4333-8333-333333333332',
              authorName: 'Ирина'),
        ];
        _stand(_row());
        await _pumpDetail(tester);

        final name = find.text(entry.value);
        await tester.ensureVisible(name);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull,
            reason: 'длинное имя переполнило строку шапки отзыва');

        // Карточка — контейнер шириной 348 dp (макет карусели).
        final card = find
            .ancestor(
              of: name,
              matching: find.byWidgetPredicate((w) =>
                  w is Container && w.constraints?.maxWidth == 348),
            )
            .first;
        final cardRect = tester.getRect(card);
        final nameRect = tester.getRect(name);
        final stars = find.descendant(of: card, matching: find.byIcon(Icons.star));
        final starsLeft = tester.getRect(stars.first).left;
        final starsRight = tester.getRect(stars.last).right;
        final date = tester.getRect(
            find.descendant(of: card, matching: find.text('10 июня')));

        const inset = 11.0; // внутренний отступ карточки
        expect(starsRight, lessThanOrEqualTo(cardRect.right - inset + 0.5),
            reason: 'звёзды вытолкнуты за правый край карточки');
        expect(date.right, lessThanOrEqualTo(cardRect.right - inset + 0.5),
            reason: 'дата вытолкнута за правый край карточки');
        expect(nameRect.right, lessThanOrEqualTo(starsLeft),
            reason: 'имя налезает на звёзды');
        expect(nameRect.left, greaterThanOrEqualTo(cardRect.left));

        // Соседняя карточка стоит правее и не задета.
        final second = find
            .ancestor(
              of: find.text('Ирина'),
              matching: find.byWidgetPredicate((w) =>
                  w is Container && w.constraints?.maxWidth == 348),
            )
            .first;
        expect(tester.getRect(second).left,
            greaterThanOrEqualTo(cardRect.right));
        expect(nameRect.right, lessThanOrEqualTo(cardRect.right));
      });
    }
  });

  group('п. 29 — тот же случай в списке всех отзывов', () {
    for (final entry in {
      'одно слово без пробелов': _longNoSpaces,
      'много слов': _longWithSpaces,
    }.entries) {
      testWidgets('${entry.key}: имя держится в карточке', (tester) async {
        _reviews = [
          reviewRow(authorName: entry.value),
        ];
        _stand(_row());
        _useScreen(tester);
        await tester.pumpWidget(MaterialApp(
          theme: AppTheme.lightTheme,
          home: ReviewsListScreen(
              establishment: Establishment.fromJson(_row())),
        ));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        final name = find.text(entry.value);
        final cardRect = tester.getRect(find
            .ancestor(
                of: name,
                matching: find.byWidgetPredicate(
                    (w) => w is Container && w.decoration is BoxDecoration &&
                        (w.decoration! as BoxDecoration).borderRadius != null))
            .first);
        final stars = find.byIcon(Icons.star);
        expect(tester.getRect(name).right,
            lessThanOrEqualTo(tester.getRect(stars.first).left));
        expect(tester.getRect(stars.last).right,
            lessThanOrEqualTo(cardRect.right));
      });
    }
  });

  // -------------------------------------------------------------------------
  group('п. 28 — реакций на отзывы нет', () {
    testWidgets('в списке нет «пальцев» и выдуманных чисел', (tester) async {
      _reviews = [
        reviewRow(id: '33333333-3333-4333-8333-333333333331'),
        reviewRow(id: '33333333-3333-4333-8333-333333333332'),
      ];
      _stand(_row());
      _useScreen(tester);
      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home:
            ReviewsListScreen(establishment: Establishment.fromJson(_row())),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Драники как у бабушки'), findsNWidgets(2),
          reason: 'отзывы должны были загрузиться');
      for (final icon in [
        Icons.thumb_up,
        Icons.thumb_up_outlined,
        Icons.thumb_down,
        Icons.thumb_down_outlined,
      ]) {
        expect(find.byIcon(icon), findsNothing, reason: '$icon');
      }
    });
  });

  // -------------------------------------------------------------------------
  group('Х6 — склонение в шапке отзывов', () {
    testWidgets('24 → «24 отзыва», 1 → «1 отзыв»', (tester) async {
      _reviews = [reviewRow()];
      _stand(_row());
      await _pumpDetail(tester);
      expect(find.text('24 отзыва'), findsOneWidget);
      expect(find.textContaining('отзывов'), findsNothing);
    });
  });

  // -------------------------------------------------------------------------
  group('п. 15 — «Поделиться»', () {
    testWidgets('в меню уходит название, адрес и ссылка на страницу на сайте',
        (tester) async {
      final share = _ShareChannel()..install();
      _stand(_row());
      await _pumpDetail(tester);

      await tester.tap(find.byIcon(Icons.ios_share));
      await tester.pump();

      expect(share.calls, hasLength(1),
          reason: 'нажатие на «Поделиться» ничего не вызвало');
      final sent = share.calls.single;
      final text = sent['text'] as String;
      expect(text, startsWith('Васильки — ресторан\n'));
      expect(text, contains('https://cheerful-nature-production-71c6.up.railway.app/minsk/restaurants/vasilki-minsk'),
          reason: 'нет ссылки на страницу заведения на сайте');
      expect(text, endsWith('Найдено в NIRIVIO'));
      expect(text, isNot(contains('Restaurant Guide Belarus')));
      // Для iPad меню рисуется от рамки кнопки (55 × 42).
      expect(sent['originWidth'], 55.0);
      expect(sent['originHeight'], 42.0);
    });

    testWidgets('«Поделиться» в листе ссылки на сайт тоже несёт рамку для iPad',
        (tester) async {
      final share = _ShareChannel()..install();
      _stand(_row());
      await _pumpDetail(tester);

      await tester.tap(find.text('Сайт'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Поделиться'));
      await tester.pump();

      expect(share.calls, hasLength(1));
      expect(share.calls.single['text'], 'https://vasilki.by');
      // Рамки кнопки у листа нет — меню рисуется от точки внизу экрана.
      expect(share.calls.single['originWidth'], 1.0);
      expect(share.calls.single['originHeight'], 1.0);
    });

    testWidgets('отказ меню виден: плашка, а текст остаётся в буфере',
        (tester) async {
      _ShareChannel(fail: true).install();
      // Буфер обмена: канал платформы в тесте без обработчика молчит, а
      // `Clipboard.getData` в поддельных часах не отвечает — пишем сами.
      String? copied;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String?;
        }
        return null;
      });
      addTearDown(() => TestDefaultBinaryMessengerBinding
          .instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null));
      _stand(_row());
      await _pumpDetail(tester);

      await tester.tap(find.byIcon(Icons.ios_share));
      await tester.pumpAndSettle();

      expect(find.textContaining('Меню «Поделиться» не открылось'),
          findsOneWidget,
          reason: 'отказ плагина прошёл без следа — «ничего не происходит»');
      expect(copied, contains('Васильки — ресторан'));
    });
  });

  // -------------------------------------------------------------------------
  group('п. 11 — «Открыто · до …» на карточке заведения', () {
    testWidgets('круглосуточно — «Открыто · до 00:00»', (tester) async {
      _stand(_row());
      await _pumpDetail(tester);
      final status = find.byWidgetPredicate((w) =>
          w is RichText && w.text.toPlainText().startsWith('Открыто'));
      expect(status, findsOneWidget);
      expect(
          (tester.widget(status) as RichText).text.toPlainText(),
          'Открыто\u00A0· до 00:00');
    });
  });

  // -------------------------------------------------------------------------
  group('п. 46 — крестик на фото меню', () {
    testWidgets('крестик на подложке: белый лист меню его не съедает',
        (tester) async {
      _stand(_row(media: [mediaRow(type: 'menu')]));
      await _pumpDetail(tester);

      // Открываем просмотр так же, как тап по фото меню.
      final tile = find.byWidgetPredicate((w) =>
          w is Container && w.constraints?.maxWidth == 165).first;
      await tester.ensureVisible(tile);
      await tester.pumpAndSettle();
      await tester.tap(tile);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      final close = find.byTooltip('Закрыть');
      expect(close, findsOneWidget, reason: 'просмотр фото меню не открылся');

      final backing = tester.widget<Container>(find
          .ancestor(of: close, matching: find.byType(Container))
          .first);
      final decoration = backing.decoration! as BoxDecoration;
      expect(decoration.shape, BoxShape.circle);
      final fill = decoration.color!;

      // Худший фон — белый лист. Иконка белая: контраст не ниже 3 : 1
      // (знак интерфейса, WCAG 1.4.11).
      final onWhite = _over(Colors.black, Colors.white, fill.a);
      expect(_contrast(Colors.white, onWhite), greaterThanOrEqualTo(3.0),
          reason: 'крестик не виден на белом листе меню');
    });
  });

  // -------------------------------------------------------------------------
  group('п. 48 — текст поверх обложки читается на самой светлой фотографии', () {
    // Самая светлая обложка — белая. Под текстом лежит затемнение
    // (`HeroScrim`), поверх него — текст; у чипов ещё и белая подложка 0,2.
    const white = Colors.white;

    /// Верх прямоугольника — самое слабое затемнение в его пределах: чем выше,
    /// тем фото чище.
    double alphaOver(Rect scrim, Rect element) =>
        HeroScrim.alphaAt(scrim.bottom - element.top);

    Future<void> checkContrast(WidgetTester tester, Map<String, dynamic> row,
        {required String statusPrefix}) async {
      _stand(row);
      await _pumpDetail(tester);

      final scrim = tester.getRect(find.byType(HeroScrim));
      // Полоса на экране той высоты, по которой считается контраст: иначе
      // смена высоты в экране оставила бы расчёт на старой шкале.
      expect(scrim.height, HeroScrim.height);
      final failures = <String>[];

      void check(String what, Rect rect, Color text, double need,
          {bool chip = false}) {
        final a = alphaOver(scrim, rect);
        var bg = _over(Colors.black, white, a);
        if (chip) bg = _over(Colors.white, bg, 0.2);
        final ratio = _contrast(text, bg);
        if (ratio < need) {
          failures.add('$what: ${ratio.toStringAsFixed(2)} < $need '
              '(затемнение ${a.toStringAsFixed(2)}, верх на '
              '${(scrim.bottom - rect.top).toStringAsFixed(0)} dp от низа)');
        }
      }

      // Название — крупное (не меньше 24 dp): 3 : 1.
      final title = find.byType(AdaptiveTitle);
      final titleStyle = tester.widget<Text>(find
          .descendant(of: title, matching: find.byType(Text))
          .first).style!;
      expect(titleStyle.fontSize!, greaterThanOrEqualTo(24));
      check('название', tester.getRect(title), titleStyle.color!, 3.0);

      // Остальное мельче 24 dp — как обычный текст: 4,5 : 1.
      Text textOf(String s) => tester.widget<Text>(find.text(s));
      check('тип', tester.getRect(find.text('ресторан')),
          textOf('ресторан').style!.color!, 4.5);

      final cuisine = find.text('{народная}');
      final opacity = tester.widget<Opacity>(
          find.ancestor(of: cuisine, matching: find.byType(Opacity)).first);
      final cuisineRect = tester.getRect(cuisine);
      final cuisineBg = _over(
          Colors.black, white, alphaOver(scrim, cuisineRect));
      check(
          'кухня',
          cuisineRect,
          _over(textOf('{народная}').style!.color!, cuisineBg, opacity.opacity),
          4.5);

      final status = find.byWidgetPredicate((w) =>
          w is RichText && w.text.toPlainText().startsWith(statusPrefix));
      expect(status, findsOneWidget);
      final span = (tester.widget(status) as RichText).text as TextSpan;
      check('статус', tester.getRect(status),
          (span.children!.first as TextSpan).style!.color!, 4.5);

      for (final chip in tester.widgetList<GlassActionChip>(
          find.byType(GlassActionChip))) {
        final label = find.descendant(
            of: find.byWidget(chip), matching: find.text(chip.label));
        check('чип «${chip.label}»', tester.getRect(label),
            AppTheme.backgroundWarm, 4.5,
            chip: true);
      }

      expect(failures, isEmpty,
          reason: 'на белой обложке не читается:\n${failures.join('\n')}');
    }

    testWidgets('заведение открыто, длинное название, адрес, телефон, сайт',
        (tester) async {
      await checkContrast(
        tester,
        _row(name: 'Ресторан Большой Белорусский Дом')
          ..['address'] = 'проспект Независимости, 100, корпус 5, офис 12',
        statusPrefix: 'Открыто',
      );
    });

    testWidgets('заведение закрыто — «Закрыто» тоже читается', (tester) async {
      await checkContrast(
        tester,
        _row(
          name: 'Ресторан Большой Белорусский Дом',
          hours: {for (final d in _weekdays) d: {'is_open': false}},
        )..['address'] = 'проспект Независимости, 100, корпус 5, офис 12',
        statusPrefix: 'Закрыто',
      );
    });

    testWidgets('затемнение рисуется по тем же точкам (пиксели)',
        (tester) async {
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(100, 700);
      addTearDown(tester.view.reset);
      final key = GlobalKey();
      await tester.pumpWidget(Directionality(
        textDirection: TextDirection.ltr,
        child: RepaintBoundary(
          key: key,
          child: ColoredBox(
            color: Colors.white,
            child: Align(
              alignment: Alignment.bottomCenter,
              child: SizedBox(
                  height: HeroScrim.height, child: const HeroScrim()),
            ),
          ),
        ),
      ));
      late ByteData bytes;
      await tester.runAsync(() async {
        final image = await (key.currentContext!.findRenderObject()!
                as RenderRepaintBoundary)
            .toImage(pixelRatio: 1);
        bytes = (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
        image.dispose();
      });
      // Холст 100 × 700; полоса прижата к низу, её верх — на y = 700 − 620.
      for (final distance in [5.0, 120.0, 250.0, 300.0, 450.0, 560.0]) {
        final y = (700 - distance).round() - 1;
        final i = (y * 100 + 50) * 4;
        final painted = bytes.getUint8(i); // красный канал серого
        final expected = 255 * (1 - HeroScrim.alphaAt(distance));
        expect(painted.toDouble(), closeTo(expected, 4.0),
            reason: 'на $distance dp от низа');
      }
    });
  });
}
