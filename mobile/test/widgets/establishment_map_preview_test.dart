// Карточка-превью заведения над картой (`EstablishmentMapPreview`).
//
// До 17.10.2026 карточка жила внутри экрана вкладки «Карта» и тестов не имела.
// Здесь — то, что она показывает, что делают «✕» и «Подробнее», как работает
// свайп вниз и как она стоит над статус-баром и нижним отступом.
//
// Чего эти тесты НЕ утверждают: связку с экраном (пин → карточка → пин снова
// обычный, переход в карточку заведения). Нативная карта в `flutter_test` не
// рождается, по пину не нажать — эту часть проверяет телефон.
// Миниатюра с адресом (CachedNetworkImage) не поднимается: сеть и кэш диска в
// тесте недоступны, берётся заведение без картинки.
//
// Свайп. Пороги — «больше 80 px сдвига» ИЛИ «больше 200 px/с». Жест подаётся
// событиями с явными метками времени, а не кадрами: скорость трекера считается
// по меткам, поэтому она задана, а не зависит от того, сколько кадров
// накрутил `pump`. Сдвиг карточки меряется по кнопке «Подробнее» (она едет
// вместе с карточкой) прямо во время жеста: предпосылка «сдвиг ровно N» —
// отдельный `expect`, а не расчёт на глаз (часть пути съедает порог касания).
//
// Меряется настоящими шрифтами: тема приложения обязательна
// (test/flutter_test_config.dart).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/config/theme.dart';
import 'package:restaurant_guide_mobile/models/establishment.dart';
import 'package:restaurant_guide_mobile/widgets/map/establishment_map_preview.dart';

const double _statusBar = 47;
const double _homeBar = 34;
const double _screenHeight = 844;

Establishment _place({
  String id = 'a',
  String name = 'Гастрономическое пространство',
  double? rating = 4.8,
  String address = 'проспект Независимости, 117А',
}) =>
    Establishment(
      id: id,
      name: name,
      category: 'Ресторан',
      cuisine: 'Вегетарианская',
      priceRange: r'$$$',
      rating: rating,
      address: address,
      city: 'Минск',
      status: 'active',
      bookingEnabled: true,
      workingHours: const {},
      createdAt: DateTime(2026, 1, 1),
      updatedAt: DateTime(2026, 1, 1),
    );

/// Счётчики действий, чтобы тест видел, что вызвано, а что нет.
class _Calls {
  int close = 0;
  int details = 0;
}

final _detailsButton = find.widgetWithText(ElevatedButton, 'Подробнее');

Future<void> _pump(
  WidgetTester tester,
  _Calls calls, {
  Establishment? establishment,
  Widget? secondaryAction,
  double width = 390,
  double textScale = 1.0,
  bool systemInsets = true,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, _screenHeight);
  if (systemInsets) {
    tester.view.padding =
        const FakeViewPadding(top: _statusBar, bottom: _homeBar);
  }
  addTearDown(tester.view.reset);
  tester.platformDispatcher.textScaleFactorTestValue = textScale;
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.lightTheme,
    home: Scaffold(
      // Так карточка стоит на вкладке «Карта»: Positioned(bottom: 0).
      body: Stack(children: [
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          child: EstablishmentMapPreview(
            establishment: establishment ?? _place(),
            onClose: () => calls.close++,
            onDetails: () => calls.details++,
            secondaryAction: secondaryAction,
          ),
        ),
      ]),
    ),
  ));
  await tester.pump();
}

/// Насколько кнопка «Подробнее» (то есть вся карточка) сдвинута от покоя.
double _offset(WidgetTester tester, double restTop) =>
    tester.getTopLeft(_detailsButton).dy - restTop;

/// Палец на ручке карточки, метка времени 0.
Future<TestGesture> _touchHandle(WidgetTester tester) async {
  final rect = tester.getRect(find.byType(EstablishmentMapPreview));
  final gesture = await tester.createGesture();
  await gesture.down(Offset(rect.center.dx, rect.top + 8),
      timeStamp: Duration.zero);
  return gesture;
}

/// Жест вниз по ручке карточки: шаги по [stepDy] через [stepMs] миллисекунд,
/// [steps] шагов; палец НЕ отпущен — тест сам меряет сдвиг и отпускает.
Future<TestGesture> _dragDown(
  WidgetTester tester, {
  required double stepDy,
  required int stepMs,
  required int steps,
}) async {
  final gesture = await _touchHandle(tester);
  for (var i = 1; i <= steps; i++) {
    await gesture.moveBy(
      Offset(0, stepDy),
      timeStamp: Duration(microseconds: stepMs * 1000 * i),
    );
    await tester.pump();
  }
  return gesture;
}

/// Время отпускания — метка последнего шага: палец «не остановился».
Duration _releaseAt(int stepMs, int steps) =>
    Duration(microseconds: stepMs * 1000 * steps);

void main() {
  group('показ', () {
    testWidgets('название, рейтинг, категория, адрес, «✕» и «Подробнее'
        '»', (tester) async {
      await _pump(tester, _Calls());

      expect(find.text('Гастрономическое пространство'), findsOneWidget);
      expect(find.text('4.8'), findsOneWidget);
      expect(find.text('Ресторан'), findsOneWidget);
      expect(find.text('проспект Независимости, 117А'), findsOneWidget);
      expect(find.byIcon(Icons.close), findsOneWidget);
      expect(_detailsButton, findsOneWidget);
      // Без картинки — заглушка размером 40, как на вкладке «Карта».
      expect(
        tester.widget<Icon>(find.byIcon(Icons.restaurant)).size,
        40,
      );
    });

    testWidgets('без рейтинга звезды нет', (tester) async {
      await _pump(tester, _Calls(), establishment: _place(rating: null));

      expect(find.byIcon(Icons.star), findsNothing);
      expect(find.text('Гастрономическое пространство'), findsOneWidget);
    });

    testWidgets('цвета те же, что были на вкладке «Карта»', (tester) async {
      await _pump(tester, _Calls());

      // Значения записаны литералами: токены темы могут уехать, а видимый
      // цвет карточки — нет.
      expect(
        tester.widget<Icon>(find.byIcon(Icons.star)).color,
        const Color(0xFFFFB800),
      );
      final button = tester.widget<ElevatedButton>(_detailsButton);
      expect(
        button.style!.backgroundColor!.resolve(<WidgetState>{}),
        const Color(0xFFF06B32),
      );
      final card = tester
          .widgetList<Container>(find.descendant(
              of: find.byType(EstablishmentMapPreview),
              matching: find.byType(Container)))
          .map((c) => c.decoration)
          .whereType<BoxDecoration>()
          .firstWhere((d) => d.boxShadow != null);
      expect(card.color, const Color(0xFFF4F1EC));
    });
  });

  group('«✕» и «Подробнее»', () {
    testWidgets('«✕» зовёт «закрыть», и только его', (tester) async {
      final calls = _Calls();
      await _pump(tester, calls);

      await tester.tap(find.byIcon(Icons.close));
      await tester.pump();

      expect(calls.close, 1);
      expect(calls.details, 0);
    });

    testWidgets('«Подробнее» зовёт «подробнее», и только его', (tester) async {
      final calls = _Calls();
      await _pump(tester, calls);

      await tester.tap(_detailsButton);
      await tester.pump();

      expect(calls.details, 1);
      expect(calls.close, 0);
    });
  });

  group('свайп вниз', () {
    // Медленный жест: 1 px за 100 мс = 10 px/с, далеко ниже порога скорости.
    // Сдвиг набирается шагами по 1 px, чтобы попасть в границу порога точно.
    /// Возвращает положение кнопки в покое — его сверяют после отпускания.
    Future<double> slowRelease(WidgetTester tester, _Calls calls,
        {required double wantOffset}) async {
      await _pump(tester, calls);
      final rest = tester.getTopLeft(_detailsButton).dy;

      // Сначала шаги до порога касания и сверх, пока сдвиг не станет нужным.
      final gesture = await _touchHandle(tester);
      var t = 0;
      var travelled = 0;
      while (_offset(tester, rest) < wantOffset) {
        t += 100;
        travelled += 1;
        await gesture.moveBy(const Offset(0, 1),
            timeStamp: Duration(milliseconds: t));
        await tester.pump();
        expect(travelled, lessThan(400), reason: 'сдвиг не набирается');
      }
      // Предпосылка теста: сдвиг в момент отпускания — ровно заданный.
      expect(_offset(tester, rest), wantOffset);
      await gesture.up(timeStamp: Duration(milliseconds: t));
      await tester.pump();
      return rest;
    }

    testWidgets('сдвиг 80 px, медленно: карточка возвращается, не закрыта',
        (tester) async {
      final calls = _Calls();
      final rest = await slowRelease(tester, calls, wantOffset: 80);

      expect(calls.close, 0);
      expect(calls.details, 0);
      expect(tester.getTopLeft(_detailsButton).dy, rest);
    });

    testWidgets('сдвиг 81 px, медленно: закрыта', (tester) async {
      final calls = _Calls();
      await slowRelease(tester, calls, wantOffset: 81);

      expect(calls.close, 1);
      expect(calls.details, 0);
    });

    testWidgets('возврат на место: после короткого медленного сдвига кнопка там, '
        'где была', (tester) async {
      final calls = _Calls();
      await _pump(tester, calls);
      final rest = tester.getTopLeft(_detailsButton).dy;

      final gesture =
          await _dragDown(tester, stepDy: 1, stepMs: 100, steps: 60);
      expect(_offset(tester, rest), greaterThan(0)); // карточку действительно тянут
      expect(_offset(tester, rest), lessThan(80));
      await gesture.up(timeStamp: _releaseAt(100, 60));
      await tester.pump();

      expect(tester.getTopLeft(_detailsButton).dy, rest);
      expect(calls.close, 0);
      expect(calls.details, 0);
    });

    testWidgets('быстро 201 px/с и сдвиг далеко меньше 80: закрыта',
        (tester) async {
      final calls = _Calls();
      await _pump(tester, calls);
      final rest = tester.getTopLeft(_detailsButton).dy;

      // 2,01 px за 10 мс = 201 px/с; 14 шагов ≈ 28 px пути.
      final gesture =
          await _dragDown(tester, stepDy: 2.01, stepMs: 10, steps: 14);
      expect(_offset(tester, rest), lessThan(80)); // закрывает именно скорость
      await gesture.up(timeStamp: _releaseAt(10, 14));
      await tester.pump();

      expect(calls.close, 1);
      expect(calls.details, 0);
    });

    testWidgets('быстро 199 px/с и сдвиг далеко меньше 80: не закрыта',
        (tester) async {
      final calls = _Calls();
      await _pump(tester, calls);
      final rest = tester.getTopLeft(_detailsButton).dy;

      final gesture =
          await _dragDown(tester, stepDy: 1.99, stepMs: 10, steps: 14);
      expect(_offset(tester, rest), lessThan(80));
      await gesture.up(timeStamp: _releaseAt(10, 14));
      await tester.pump();

      expect(calls.close, 0);
      expect(calls.details, 0);
      expect(tester.getTopLeft(_detailsButton).dy, rest);
    });

    testWidgets('вверх карточка не едет', (tester) async {
      final calls = _Calls();
      await _pump(tester, calls);
      final rest = tester.getTopLeft(_detailsButton).dy;

      final gesture = await _touchHandle(tester);
      for (var i = 1; i <= 40; i++) {
        await gesture.moveBy(const Offset(0, -2),
            timeStamp: Duration(milliseconds: 100 * i));
        await tester.pump();
      }
      expect(tester.getTopLeft(_detailsButton).dy, rest);
      await gesture.up(timeStamp: const Duration(milliseconds: 4000));
      await tester.pump();

      expect(calls.close, 0);
    });

    testWidgets('другое заведение, пока карточку тянут: встаёт на место',
        (tester) async {
      final calls = _Calls();
      await _pump(tester, calls);
      final rest = tester.getTopLeft(_detailsButton).dy;

      final gesture =
          await _dragDown(tester, stepDy: 1, stepMs: 100, steps: 50);
      expect(_offset(tester, rest), greaterThan(0));

      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.lightTheme,
        home: Scaffold(
          body: Stack(children: [
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: EstablishmentMapPreview(
                establishment: _place(id: 'b', name: 'Другое место'),
                onClose: () => calls.close++,
                onDetails: () => calls.details++,
              ),
            ),
          ]),
        ),
      ));
      await tester.pump();

      expect(find.text('Другое место'), findsOneWidget);
      expect(tester.getTopLeft(_detailsButton).dy, rest);
      await gesture.up(timeStamp: _releaseAt(100, 50));
    });
  });

  group('раскладка', () {
    testWidgets('над нижним отступом, под статус-баром, на всю ширину',
        (tester) async {
      await _pump(tester, _Calls());

      final card = tester.getRect(find.byType(EstablishmentMapPreview));
      final button = tester.getRect(_detailsButton);

      // Карточка стоит на нижнем крае экрана, а кнопка — над нижним отступом.
      expect(card.bottom, _screenHeight);
      expect(card.left, 0);
      expect(card.right, 390);
      expect(button.bottom, _screenHeight - _homeBar - 16);
      // Без второго действия «Подробнее» занимает всю ширину: 16 с краёв.
      expect(button.left, 16);
      expect(button.right, 390 - 16);
      expect(card.top, greaterThan(_statusBar));
    });

    testWidgets('без нижнего отступа кнопка ниже ровно на этот отступ',
        (tester) async {
      await _pump(tester, _Calls(), systemInsets: false);

      final button = tester.getRect(_detailsButton);
      expect(button.bottom, _screenHeight - 16);
    });

    testWidgets('место под вторую кнопку: делит строку поровну через зазор 8',
        (tester) async {
      await _pump(
        tester,
        _Calls(),
        secondaryAction: const SizedBox(key: Key('second'), height: 48),
      );

      final details = tester.getRect(_detailsButton);
      final second = tester.getRect(find.byKey(const Key('second')));
      expect(details.left, 16);
      expect(details.width, 175);
      expect(second.left, 16 + 175 + 8);
      expect(second.right, 390 - 16);
      expect(second.center.dy, details.center.dy);
    });

    for (final width in [360.0, 390.0]) {
      testWidgets('крупный текст ×1,2 при ширине ${width.toInt()}: без '
          'переполнения, карточка в экране', (tester) async {
        // Худшая форма: название и адрес в две строки, рейтинг есть.
        await _pump(
          tester,
          _Calls(),
          width: width,
          textScale: 1.2,
          establishment: _place(
            name: 'Кафе на углу улицы Кирова',
            address: 'улица Кирова, 13, корпус 2, вход со двора',
          ),
        );

        expect(tester.takeException(), isNull);
        final card = tester.getRect(find.byType(EstablishmentMapPreview));
        final button = tester.getRect(_detailsButton);
        expect(card.top, greaterThan(_statusBar));
        expect(card.bottom, _screenHeight);
        expect(button.bottom, _screenHeight - _homeBar - 16);
        // Текст не заходит под «✕» и миниатюра не наезжает на текст.
        final close = tester.getRect(find.byIcon(Icons.close));
        for (final text in [
          find.text('Кафе на углу улицы Кирова'),
          find.text('улица Кирова, 13, корпус 2, вход со двора'),
        ]) {
          expect(tester.getRect(text).right, lessThanOrEqualTo(close.left));
        }
      });
    }
  });
}
