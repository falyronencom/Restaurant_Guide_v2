import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:restaurant_guide_admin_web/config/category_icons.dart';
import 'package:restaurant_guide_admin_web/config/theme.dart';
import 'package:restaurant_guide_admin_web/models/establishment.dart';
import 'package:restaurant_guide_admin_web/providers/moderation_provider.dart';
import 'package:restaurant_guide_admin_web/widgets/moderation/moderation_list_panel.dart';

// Экран «Ожидают просмотра», кадр 05 редизайна.
//
// Проверяется не «виджет отрисовался», а обещания макета, которые ломаются
// молча: ширина очереди, ширина медиа-полосы и то, что три числа на экране
// (прогресс в шапке, счётчики вкладок, «осталось проверить») считаются из
// одного места и потому не могут разойтись.

/// Провайдер с заранее выложенной очередью: сеть в этих тестах не нужна.
class _StubModerationProvider extends ModerationProvider {
  final List<EstablishmentListItem> _items;

  _StubModerationProvider(this._items);

  @override
  List<EstablishmentListItem> get establishments => _items;

  @override
  int get totalCount => _items.length;

  @override
  bool get isLoadingList => false;

  @override
  String? get listError => null;
}

EstablishmentListItem _item({
  required String id,
  required String name,
  String city = 'Минск',
  List<String> categories = const <String>['Ресторан'],
  List<String> cuisines = const <String>['Народная'],
  required int waitingDays,
}) {
  return EstablishmentListItem(
    id: id,
    name: name,
    city: city,
    categories: categories,
    cuisines: cuisines,
    // Полдня сверху, чтобы округление вниз не превратило 4 дня в 3 на
    // границе суток: тест обязан мерить логику, а не момент запуска.
    updatedAt: DateTime.now().subtract(
      Duration(days: waitingDays, hours: 12),
    ),
  );
}

void main() {
  group('Очередь: геометрия', () {
    Future<void> pumpQueue(
      WidgetTester tester,
      List<EstablishmentListItem> items,
    ) async {
      tester.view.physicalSize = const Size(1440, 820);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        ChangeNotifierProvider<ModerationProvider>.value(
          value: _StubModerationProvider(items),
          child: MaterialApp(
            theme: AppTheme.lightTheme,
            home: const Scaffold(
              body: Row(children: <Widget>[ModerationListPanel()]),
            ),
          ),
        ),
      );
      await tester.pump();
    }

    testWidgets('колонка сузилась до 360', (tester) async {
      await pumpQueue(tester, <EstablishmentListItem>[
        _item(id: 'a', name: 'Кухмістр', waitingDays: 4),
      ]);

      expect(
        tester.getSize(find.byType(ModerationListPanel)).width,
        ModerationListPanel.width,
      );
      expect(ModerationListPanel.width, 360);
    });

    testWidgets('медиа-полоса занимает 96 и отодвигает текст', (tester) async {
      await pumpQueue(tester, <EstablishmentListItem>[
        _item(id: 'a', name: 'Кухмістр', waitingDays: 4),
      ]);

      // 16 паддинг списка + 96 полоса + 14 паддинг тела = 126.
      // Одно число доказывает все три величины сразу; расползётся любая —
      // тест упадёт и назовёт, на сколько.
      expect(tester.getRect(find.text('Кухмістр')).left, 126);
    });

    testWidgets('бейдж называет срок словами, а не числом суток',
        (tester) async {
      await pumpQueue(tester, <EstablishmentListItem>[
        _item(id: 'a', name: 'Кухмістр', waitingDays: 4),
        _item(id: 'b', name: 'Лідо', waitingDays: 1),
        _item(id: 'c', name: 'Тбілісо', waitingDays: 0),
      ]);

      expect(find.text('4 дня'), findsOneWidget);
      expect(find.text('1 день'), findsOneWidget);
      // Ноль суток — «сегодня»: «0 дней» сказало бы, что заявка уже лежит.
      expect(find.text('сегодня'), findsOneWidget);
    });

    testWidgets('без фотографии непокрытая категория даёт нейтральный глиф',
        (tester) async {
      await pumpQueue(tester, <EstablishmentListItem>[
        _item(
          id: 'a',
          name: 'Страйк',
          categories: <String>['Боулинг'],
          cuisines: <String>['Смешанная'],
          waitingDays: 2,
        ),
      ]);

      expect(find.byIcon(Icons.storefront_outlined), findsOneWidget);
    });
  });

  group('Карта иконок', () {
    test('категория важнее кухни', () {
      expect(
        iconNameForEstablishment(
          categories: <String>['Кофейня'],
          cuisines: <String>['Итальянская'],
        ),
        'coffee',
      );
    });

    test('кухня подхватывает, когда у категории иконки нет', () {
      expect(
        iconNameForEstablishment(
          categories: <String>['Пиццерия'],
          cuisines: <String>['Итальянская'],
        ),
        'italian',
      );
    });

    test('регистр и «ё» не решают', () {
      expect(
        iconNameForEstablishment(categories: <String>['РЕСТОРАН']),
        'restaurant',
      );
    });

    test('непокрытое отдаёт null, а не чужую иконку', () {
      expect(
        iconNameForEstablishment(
          categories: <String>['Боулинг'],
          cuisines: <String>['Смешанная'],
        ),
        isNull,
      );
    });
  });

  group('Прогресс проверки', () {
    test('состав вкладок — 5 + 6 + 2 + 1 = 14', () {
      final provider = ModerationProvider();

      expect(provider.tabFieldCounts, <int>[5, 6, 2, 1]);
      expect(provider.totalFieldCount, 14);
      expect(kModerationTabTitles.length, kModerationTabFields.length);
    });

    test('три числа экрана считаются из одного состояния', () {
      final provider = ModerationProvider()
        ..approveField('legal_name')
        ..approveField('unp')
        ..rejectField('registration_doc', comment: 'нечитаемо');

      // Прогресс шапки, счётчики вкладок и «осталось» — одна арифметика.
      expect(provider.checkedFieldCount, 3);
      expect(provider.tabCheckedCounts, <int>[3, 0, 0, 0]);
      expect(provider.remainingFieldCount, 11);
      expect(provider.checkedFraction, closeTo(3 / 14, 1e-9));
    });

    test('отклонённое поле закрывает одобрение, но не отказ', () {
      final provider = ModerationProvider()..approveField('unp');
      expect(provider.canApprove, isTrue);
      expect(provider.rejectedFieldCount, 0);

      provider.rejectField('legal_name', comment: 'не совпадает с УНП');
      expect(provider.canApprove, isFalse);
      expect(provider.rejectedFieldCount, 1);

      // Снятый вердикт возвращает возможность одобрить.
      provider.resetField('legal_name');
      expect(provider.canApprove, isTrue);
    });

    test('комментарий без вердикта проверкой не считается', () {
      final provider = ModerationProvider()
        ..commentField('website', 'сайт не открывается');

      // Заметка написана, но поле не закрыто — иначе прогресс покажет
      // работу, которой не было.
      expect(provider.checkedFieldCount, 0);
      expect(provider.remainingFieldCount, 14);
    });
  });

  group('Срок ожидания', () {
    final now = DateTime(2026, 8, 20, 12);

    test('считает полные сутки', () {
      expect(
        moderationWaitingDays(DateTime(2026, 8, 16, 9), now: now),
        4,
      );
    });

    test('свежая заявка — ноль, а не отрицательное', () {
      expect(moderationWaitingDays(DateTime(2026, 8, 20, 18), now: now), 0);
      expect(moderationWaitingDays(DateTime(2026, 8, 20, 11), now: now), 0);
    });

    test('пустая метка не выдумывает срок', () {
      expect(moderationWaitingDays(null, now: now), isNull);
    });
  });
}
