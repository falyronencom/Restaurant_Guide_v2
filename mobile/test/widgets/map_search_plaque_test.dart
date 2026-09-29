import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:restaurant_guide_mobile/widgets/map/map_search_plaque.dart';

/// Карта и фраза поиска — решение Координатора 29.09.2026, вариант 2Б.
///
/// До него карта молча применяла фразу своим, прежним движком: после поиска
/// «underdog» соседние заведения пропадали без объяснения, а на «завтрак»
/// список находил 14 заведений, карта — ни одного (прод, 29.09). Теперь с
/// фразой карта показывает ровно выдачу списка и плашку «Поиск: … ✕».
///
/// Сама карта (YandexMap) в тестах не поднимается — это платформенный вид.
/// Поэтому решения экрана вынесены в чистые функции и проверяются здесь, а
/// что карта шлёт умному поиску то же тело, что и список, — в
/// test/providers/search_routing_test.dart.
void main() {
  group('activeMapPhrase — какую фразу показывает карта', () {
    test('фраза в строке поиска — карта показывает её выдачу', () {
      expect(
        activeMapPhrase(searchQuery: 'underdog', dismissedPhrase: null, focused: false),
        'underdog',
      );
    });

    test('пробелы по краям не в счёт; пустая строка, пробелы и null — карта без поиска', () {
      expect(
        activeMapPhrase(searchQuery: '  underdog ', dismissedPhrase: null, focused: false),
        'underdog',
      );
      for (final empty in [null, '', '   ']) {
        expect(
          activeMapPhrase(searchQuery: empty, dismissedPhrase: null, focused: false),
          isNull,
        );
      }
    });

    test('фраза снята крестиком — карта без поиска; другая фраза — снова с поиском', () {
      expect(
        activeMapPhrase(searchQuery: 'underdog', dismissedPhrase: 'underdog', focused: false),
        isNull,
      );
      expect(
        activeMapPhrase(searchQuery: 'Tiden', dismissedPhrase: 'underdog', focused: false),
        'Tiden',
      );
    });

    test('карта одного заведения (из его карточки) фразу не применяет', () {
      // Иначе фраза, набранная раньше, могла бы спрятать само это заведение.
      expect(
        activeMapPhrase(searchQuery: 'underdog', dismissedPhrase: null, focused: true),
        isNull,
      );
    });
  });

  group('MapFetchGate — когда загружать пины заново', () {
    const phraseKey = 'phrase:пицца|f0';

    MapFetchGate loaded(String key) => MapFetchGate()..started(key);

    test('ревью 29.09: семь смен фильтров, пока карта скрыта, — ни одной загрузки; карту показали — одна', () {
      final gate = loaded(phraseKey);
      expect(gate.onVisibilityChanged(false, phraseKey), isFalse);

      var loads = 0;
      for (var tap = 1; tap <= 7; tap++) {
        if (gate.onProviderChanged('phrase:пицца|f$tap')) loads++;
      }
      expect(loads, 0, reason: 'скрытая вкладка карты не ходит в умный поиск на каждое касание чипа');

      expect(gate.onVisibilityChanged(true, 'phrase:пицца|f7'), isTrue);
      gate.started('phrase:пицца|f7');
      expect(gate.onProviderChanged('phrase:пицца|f7'), isFalse);
    });

    test('фильтры поменяли и вернули, пока карта скрыта, — при показе загрузки нет', () {
      final gate = loaded(phraseKey);
      gate.onVisibilityChanged(false, phraseKey);
      gate.onProviderChanged('phrase:пицца|f1');
      gate.onProviderChanged(phraseKey);

      expect(gate.onVisibilityChanged(true, phraseKey), isFalse);
    });

    test('видимой карте смена фразы грузится сразу; уведомление без смены — нет', () {
      final gate = loaded(phraseKey);

      expect(gate.onProviderChanged(phraseKey), isFalse);
      expect(gate.onProviderChanged('phrase:суши|f0'), isTrue);
    });

    test('несколько отложенных загрузок на одну смену — одна загрузка', () {
      final gate = loaded(phraseKey);
      const next = 'phrase:суши|f0';
      expect(gate.onProviderChanged(next), isTrue);
      expect(gate.onProviderChanged(next), isTrue);

      expect(gate.isStale(next), isTrue);
      gate.started(next);
      expect(gate.isStale(next), isFalse);
    });

    test('с фразой остановка камеры НЕ загружает: выдача фразы от области не зависит', () {
      // Иначе каждый сдвиг карты стоил бы запроса к умному поиску (лимит 30 в минуту).
      final gate = loaded(phraseKey);
      expect(gate.onCameraStopped(phraseKey, phraseMode: true), isFalse);
    });

    test('без фразы остановка камеры загружает всегда, как раньше', () {
      final gate = loaded('area|f0');
      expect(gate.onCameraStopped('area|f0', phraseMode: false), isTrue);
    });

    test('ревью 29.09: ошибка не перевзводит загрузку — уведомления с тем же ключом её не повторяют', () {
      // Загрузка началась и упала; ключ остался. Список закончил загрузку,
      // избранное обновилось — провайдер уведомляет, ключ тот же.
      final gate = loaded(phraseKey);
      expect(gate.onProviderChanged(phraseKey), isFalse);
      expect(gate.isStale(phraseKey), isFalse);
    });

    test('первая загрузка — всегда', () {
      expect(MapFetchGate().isStale(phraseKey), isTrue);
    });
  });

  group('MapSearchPlaque', () {
    Widget host(Widget child) => MaterialApp(home: Scaffold(body: child));

    testWidgets('показывает фразу; крестик снимает поиск ровно один раз', (tester) async {
      var cleared = 0;
      await tester.pumpWidget(host(Center(
        child: MapSearchPlaque(phrase: 'underdog', shown: 1, total: 1, onClear: () => cleared++),
      )));

      expect(find.text('Поиск: «underdog»'), findsOneWidget);
      await tester.tap(find.byTooltip('Показать все заведения'));
      await tester.pump();
      expect(cleared, 1);
    });

    testWidgets('найдено больше, чем поместилось на карту, — «N из M»', (tester) async {
      await tester.pumpWidget(host(Center(
        child: MapSearchPlaque(phrase: 'кофе', shown: 100, total: 132, onClear: () {}),
      )));

      expect(find.text('Поиск: «кофе» · 100 из 132'), findsOneWidget);
    });

    testWidgets('длинная фраза на узком экране: многоточие, плашка в пределах полосы, без переполнения', (tester) async {
      // 320 dp — самый узкий экран в расчёте; полоса как на карте из экрана
      // результатов: по 64 dp с краёв под кнопку «назад».
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(host(Stack(children: [
        Positioned(
          top: 12,
          left: 64,
          right: 64,
          child: Center(
            child: MapSearchPlaque(
              phrase: 'очень длинная фраза про завтрак с видом на реку и террасой',
              shown: 3,
              total: 3,
              onClear: () {},
            ),
          ),
        ),
      ])));

      expect(tester.takeException(), isNull);
      expect(tester.getSize(find.byType(MapSearchPlaque)).width, lessThanOrEqualTo(320 - 128));
      final text = tester.widget<Text>(find.textContaining('Поиск:'));
      expect(text.overflow, TextOverflow.ellipsis);
      expect(text.maxLines, 1);
      // Крестик на месте и нажимается, как бы длинна ни была фраза.
      expect(find.byTooltip('Показать все заведения'), findsOneWidget);
    });
  });
}
